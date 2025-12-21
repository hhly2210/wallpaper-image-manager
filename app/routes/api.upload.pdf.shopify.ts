import { google } from "googleapis";
import { authenticate } from "../shopify.server";

export async function action({ request }: { request: Request }) {
  console.log(`[SERVER] Shopify PDF upload API called`, {
    method: request.method,
    url: request.url,
    timestamp: new Date().toISOString(),
  });

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
        method: request.method,
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const requestId = Math.random().toString(36).slice(2, 11);
  console.log(`[${requestId}] API: Shopify PDF upload request started`);

  try {
    const {
      fileIds,
      folderId,
      folderName,
      isShared,
      owner,
      accessToken,
      type,
      skuTarget,
      conflictResolution,
    } = await request.json();

    console.log(`[${requestId}] Request data:`, {
      type,
      hasFileIds: !!fileIds,
      fileIdsCount: Array.isArray(fileIds) ? fileIds.length : 0,
      hasFolderId: !!folderId,
      folderName,
      isShared,
      owner,
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0,
    });

    if (!accessToken) {
      console.log(`[${requestId}] ERROR: Access token missing`);
      return new Response(
        JSON.stringify({
          error: "Access token is required",
          requestId,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Handle different upload types
    if (type === "folder" && folderId) {
      return handleFolderUpload(
        folderId,
        folderName,
        isShared,
        owner,
        accessToken,
        requestId,
        { skuTarget, conflictResolution },
        request,
      );
    } else if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      return handleFileIdsUpload(
        fileIds,
        accessToken,
        requestId,
        { skuTarget, conflictResolution },
        request,
      );
    } else {
      console.log(`[${requestId}] ERROR: No valid upload data provided`);
      return new Response(
        JSON.stringify({
          error: "Either file IDs or folder ID is required",
          requestId,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  } catch (error) {
    console.error(`[${requestId}] ERROR: Upload PDFs to Shopify failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      requestId,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to upload PDFs to Shopify",
        requestId,
        details:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
              }
            : error,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

async function handleFolderUpload(
  folderId: string,
  folderName: string,
  isShared: boolean,
  owner: string,
  accessToken: string,
  requestId: string,
  config: { skuTarget?: string; conflictResolution?: string },
  request: Request,
) {
  console.log(
    `[${requestId}] Processing PDF folder upload for: ${folderName || folderId}`,
  );

  try {
    // Initialize Google Drive service with access token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    // Get folder name if not provided
    let actualFolderName = folderName;
    if (!actualFolderName) {
      try {
        const folderResponse = await drive.files.get({
          fileId: folderId,
          fields: "name",
        });
        actualFolderName = folderResponse.data.name || folderId;
        console.log(
          `[${requestId}] Retrieved folder name: ${actualFolderName}`,
        );
      } catch (error) {
        console.warn(
          `[${requestId}] Could not retrieve folder name, using ID: ${folderId}`,
        );
        actualFolderName = folderId;
      }
    }

    // Authenticate with Shopify
    const { admin } = await authenticate.admin(request);

    // Get all PDF files from the folder
    console.log(`[${requestId}] Fetching all PDF files from folder: ${folderId}`);
    const query = `'${folderId}' in parents and (mimeType contains 'pdf') and trashed=false`;

    const listResponse = await drive.files.list({
      q: query,
      fields:
        "files(id, name, mimeType, size, createdTime, webViewLink, webContentLink)",
      pageSize: 1000, // Get up to 1000 files
    });

    const files = listResponse.data.files || [];
    console.log(`[${requestId}] Found ${files.length} PDF files in folder`);

    if (files.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Folder "${actualFolderName}" contains no PDFs to upload`,
          folderName: actualFolderName,
          totalFiles: 0,
          uploadedFiles: 0,
          requestId,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Fetch SKU data for matching
    console.log(`[${requestId}] Fetching SKU data for product matching...`);
    let availableSKUs = [];

    if (config.skuTarget) {
      try {
        // Import SKU handling directly to avoid fetch issues
        const { authenticate } = await import("../shopify.server");
        const { admin } = await authenticate.admin(request);

        const skuQuery = `
          query getProducts($first: Int!) {
            products(first: $first, query: "product_type:Wallpaper") {
              edges {
                node {
                  id
                  title
                  handle
                  productType
                  tags
                  variants(first: 50) {
                    edges {
                      node {
                        id
                        sku
                        title
                        price
                        inventoryQuantity
                        selectedOptions {
                          name
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const skuResponse = await admin.graphql(skuQuery, {
          variables: { first: 50 },
        });

        const skuData = await skuResponse.json();

        if (skuData?.data?.products?.edges) {
          availableSKUs = skuData.data.products.edges.flatMap(
            (productEdge: any) => {
              const product = productEdge.node;
              return product.variants.edges.map((variantEdge: any) => {
                const variant = variantEdge.node;
                const colorOption = variant.selectedOptions.find(
                  (opt: any) => opt.name.toLowerCase() === "color",
                );
                return {
                  ...variant,
                  productId: product.id,
                  productHandle: product.handle,
                  productTitle: product.title,
                  productType: product.productType,
                  productTags: product.tags,
                  color: colorOption?.value || null,
                };
              });
            },
          );
          console.log(
            `[${requestId}] Loaded ${availableSKUs.length} SKUs for matching`,
          );
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to fetch SKUs:`, error);
      }
    }

    // Process uploads for all PDF files in folder
    const uploadResults = [];
    let processedCount = 0;
    let metafieldUpdates = 0;

    // Track products that already have spec sheets uploaded
    const processedProductIds = new Set<string>();

    for (const file of files) {
      try {
        console.log(
          `[${requestId}] Processing PDF file ${processedCount + 1}/${files.length}: ${file.name}`,
        );

        // Get detailed file information
        const fileResponse = await drive.files.get({
          fileId: file.id!,
          fields: "id, name, mimeType, size, webViewLink, webContentLink",
        });

        const fileData = fileResponse.data;

        // Debug logging
        console.log(`[${requestId}] PDF file ${processedCount + 1} data:`, {
          id: fileData?.id,
          name: fileData?.name,
          mimeType: fileData?.mimeType,
          size: fileData?.size,
          fileDataKeys: fileData ? Object.keys(fileData) : "fileData is null",
        });

        if (!fileData || !fileData.name) {
          throw new Error("Invalid file data or missing file name");
        }

        // Validate that it's a PDF file
        if (!fileData.mimeType || !fileData.mimeType.includes('pdf')) {
          console.log(
            `[${requestId}] Skipping non-PDF file: ${fileData.name}`,
          );

          uploadResults.push({
            googleFileId: fileData.id,
            fileName: fileData.name,
            fileSize: fileData.size,
            mimeType: fileData.mimeType,
            status: "skipped",
            shopifyFileId: null,
            shopifyUrl: null,
            skuMatch: null,
            reason: "Not a PDF file",
            uploadedAt: new Date().toISOString(),
          });

          processedCount++;
          continue;
        }

        // Match file with SKU - REQUIRED for PDF upload
        let skuMatch = null;
        let shouldUploadFile = false; // Default to false - only upload if SKU matches

        if (config.skuTarget && availableSKUs.length > 0) {
          console.log(
            `[${requestId}] Validating PDF file with SKU before upload:`,
            {
              fileName: fileData.name,
              skuTarget: config.skuTarget,
              availableSKUsCount: availableSKUs.length,
            },
          );

          skuMatch = matchFileWithSKU(
            fileData.name,
            availableSKUs,
            config.skuTarget,
          );

          console.log(`[${requestId}] PDF Pre-upload validation result:`, {
            skuMatch: skuMatch
              ? {
                  sku: skuMatch.sku,
                  productTitle: skuMatch.productTitle,
                  productId: skuMatch.productId,
                  matchType: skuMatch.matchType
                }
              : null,
          });

          // For PDF upload, we REQUIRE SKU match
          shouldUploadFile = !!skuMatch;

          // Check if this product already has a spec sheet uploaded
          if (skuMatch && processedProductIds.has(skuMatch.productId)) {
            console.log(
              `[${requestId}] Product ${skuMatch.productId} already processed, skipping PDF: ${fileData.name}`,
            );
            shouldUploadFile = false;
            skuMatch = null; // Clear match to mark as skipped
          }

          if (!skuMatch) {
            console.log(
              `[${requestId}] No SKU match found for PDF file or product already processed: ${fileData.name}`,
            );
          }
        }

        if (!shouldUploadFile) {
          console.log(
            `[${requestId}] Skipping PDF file (no SKU match or product already processed): ${fileData.name}`,
          );

          uploadResults.push({
            googleFileId: fileData.id,
            fileName: fileData.name,
            fileSize: fileData.size,
            mimeType: fileData.mimeType,
            status: "skipped",
            shopifyFileId: null,
            shopifyUrl: null,
            skuMatch: skuMatch
              ? {
                  productId: skuMatch.productId,
                  productTitle: skuMatch.productTitle,
                  sku: skuMatch.sku,
                  matchType: skuMatch.matchType
                }
              : null,
            reason: skuMatch
              ? `Product already processed (${skuMatch.productTitle})`
              : "No SKU match found for PDF",
            uploadedAt: new Date().toISOString(),
          });

          processedCount++;
          continue;
        }

        // Download PDF content from Google Drive
        console.log(`[${requestId}] Downloading PDF content: ${file.name}`);
        const downloadResponse = await drive.files.get(
          {
            fileId: file.id!,
            alt: "media",
          },
          { responseType: "arraybuffer" },
        );

        const fileBuffer = Buffer.from(downloadResponse.data as ArrayBuffer);

        // Upload PDF to Shopify Files API
        console.log(
          `[${requestId}] Starting PDF upload to Shopify Files API: ${file.name}`,
        );
        console.log(`[${requestId}] PDF details:`, {
          name: file.name,
          size: fileData.size,
          mimeType: fileData.mimeType,
          bufferSize: fileBuffer.length,
        });

        // Generate a staged upload target for PDF
        const stagedUploadQuery = `
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const stagedUploadInput = {
          filename: file.name,
          mimeType: fileData.mimeType || "application/pdf",
          httpMethod: "POST",
          resource: "FILE",
          fileSize: String(fileData.size || "0"),
        };

        const stagedResponse = await admin.graphql(stagedUploadQuery, {
          variables: {
            input: [stagedUploadInput],
          },
        });

        const stagedData = await stagedResponse.json();

        if (stagedData?.data?.stagedUploadsCreate?.userErrors?.length > 0) {
          throw new Error(
            stagedData.data.stagedUploadsCreate.userErrors[0].message,
          );
        }

        const stagedTarget =
          stagedData?.data?.stagedUploadsCreate?.stagedTargets?.[0];
        if (!stagedTarget) {
          throw new Error("Failed to get staged upload target");
        }

        // Create multipart form data for PDF
        const boundary =
          "----WebKitFormBoundary" + Math.random().toString(36).slice(2, 18);
        let body = "";

        // Add parameters from Shopify
        console.log(`[${requestId}] Adding Shopify parameters to PDF form data:`, {
          parameterCount: stagedTarget.parameters?.length || 0,
          parameters: stagedTarget.parameters,
        });

        if (stagedTarget.parameters) {
          stagedTarget.parameters.forEach((param: any) => {
            console.log(
              `[${requestId}] Adding parameter: ${param.name} = ${param.value}`,
            );
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="${param.name}"\r\n\r\n`;
            body += `${param.value}\r\n`;
          });
        }

        // Add PDF file content
        console.log(`[${requestId}] Adding PDF to form data:`, {
          filename: file.name,
          contentType: fileData.mimeType,
          bufferLength: fileBuffer.length,
        });

        const mimeType = fileData.mimeType || "application/pdf";
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="${file.name || "unknown-file.pdf"}"\r\n`;
        body += `Content-Type: ${mimeType}\r\n\r\n`;

        // Convert body to buffer and append file buffer
        const headerBuffer = Buffer.from(body, "utf8");
        const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

        const finalBuffer = Buffer.concat([
          headerBuffer,
          fileBuffer,
          footerBuffer,
        ]);

        console.log(`[${requestId}] Final PDF multipart buffer created:`, {
          headerLength: headerBuffer.length,
          fileLength: fileBuffer.length,
          footerLength: footerBuffer.length,
          totalLength: finalBuffer.length,
          boundary,
        });

        const uploadResponse = await fetch(stagedTarget.url, {
          method: "POST",
          body: finalBuffer,
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": finalBuffer.length.toString(),
          },
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error(`[${requestId}] PDF staged upload error details:`, {
            status: uploadResponse.status,
            statusText: uploadResponse.statusText,
            errorText,
            stagedUrl: stagedTarget.url,
            fileSize: fileBuffer.length,
            fileName: file.name,
          });
          throw new Error(
            `PDF staged upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
          );
        }

        console.log(
          `[${requestId}] PDF successfully uploaded to staged URL, now creating Shopify file asset`,
        );

        // Create Shopify file asset using the staged upload resource URL
        const fileCreateQuery = `
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                id
                fileStatus
                alt
                createdAt
                ... on GenericFile {
                  url
                  originalFileSize
                  mimeType
                }
                ... on MediaImage {
                  status
                  image {
                    url
                    width
                    height
                  }
                  preview {
                    image {
                      url
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const fileCreateInput = {
          alt: fileData.name || "Uploaded PDF spec sheet",
          contentType: "FILE", // Use FILE instead of IMAGE for PDFs
          originalSource: stagedTarget.resourceUrl,
        };

        const fileCreateResponse = await admin.graphql(fileCreateQuery, {
          variables: {
            files: [fileCreateInput],
          },
        });

        const fileCreateData = await fileCreateResponse.json();

        if (fileCreateData?.data?.fileCreate?.userErrors?.length > 0) {
          throw new Error(fileCreateData.data.fileCreate.userErrors[0].message);
        }

        const createdFile = fileCreateData?.data?.fileCreate?.files?.[0];
        if (!createdFile) {
          throw new Error("Failed to create Shopify file asset");
        }

        const shopifyFileId = createdFile.id;

        // For file_reference metafield, we need the GID, not the CDN URL
        const fileGid = shopifyFileId;
        let shopifyUrl: string;

        if (createdFile.url) {
          // For display purposes, try to get the CDN URL
          shopifyUrl = createdFile.url;
        } else {
          // Use the GID for display
          shopifyUrl = shopifyFileId;
        }

        console.log(`[${requestId}] PDF file created with details:`, {
          shopifyFileId,
          shopifyUrl,
          fileGid,
          fileStatus: createdFile.fileStatus,
          hasDirectUrl: !!createdFile.url,
        });

        // Update spec sheet metafield if we have a SKU match
        if (skuMatch) {
          console.log(
            `[${requestId}] Updating spec sheet metafield for product ${skuMatch.productId}`,
          );

          try {
            const metafieldUpdateResult = await updateProductSpecSheetMetafield(
              admin,
              skuMatch.productId,
              fileGid, // Use GID for file_reference
              file.name,
              requestId,
            );

            if (metafieldUpdateResult) {
              metafieldUpdates++;
              // Mark this product as processed
              processedProductIds.add(skuMatch.productId);
              console.log(
                `[${requestId}] Product ${skuMatch.productId} marked as processed to avoid duplicate uploads`,
              );
            }
          } catch (metafieldError) {
            console.error(
              `[${requestId}] Failed to update spec sheet metafield:`,
              metafieldError,
            );
          }
        }

        uploadResults.push({
          googleFileId: fileData.id,
          fileName: fileData.name,
          fileSize: fileData.size,
          mimeType: fileData.mimeType,
          status: "success",
          shopifyFileId,
          shopifyUrl,
          skuMatch: skuMatch
            ? {
                productId: skuMatch.productId,
                productTitle: skuMatch.productTitle,
                sku: skuMatch.sku,
                color: skuMatch.color,
              }
            : null,
          message:
            skuMatch
              ? `PDF spec sheet uploaded and linked to ${skuMatch.productTitle} (${skuMatch.sku})`
              : "PDF spec sheet uploaded to Shopify",
          uploadTime: new Date().toISOString(),
        });

        processedCount++;

        // Log progress every 10 files
        if (processedCount % 10 === 0) {
          console.log(
            `[${requestId}] Progress: ${processedCount}/${files.length} PDF files processed`,
          );
        }
      } catch (error) {
        console.error(`[${requestId}] FAILED TO UPLOAD PDF FILE ${file.id}:`, {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          fileName: file.name,
          fileSize: file.size,
          errorType: typeof error,
          errorDetails: error,
        });
        uploadResults.push({
          googleFileId: file.id!,
          fileName: file.name,
          status: "error",
          message: `Failed to upload PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = uploadResults.filter(
      (r) => r.status === "success",
    ).length;
    const errorCount = uploadResults.filter((r) => r.status === "error").length;
    const matchedCount = uploadResults.filter((r) => r.skuMatch).length;

    console.log(`[${requestId}] SUCCESS: PDF folder upload completed`, {
      folderName: actualFolderName,
      totalFiles: files.length,
      successCount,
      errorCount,
      matchedCount,
      processingTime: Date.now(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Uploaded ${successCount} PDF spec sheets from "${actualFolderName}" to Shopify${errorCount > 0 ? ` (${errorCount} failed)` : ""}`,
        folderName: actualFolderName,
        folderId,
        isShared,
        owner,
        totalFiles: files.length,
        uploadedFiles: successCount,
        failedFiles: errorCount,
        matchedFiles: matchedCount,
        metafieldUpdates, // Add metafield count to response
        results: uploadResults,
        requestId,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const actualFolderName = folderName || folderId;
    console.error(`[${requestId}] ERROR: PDF folder upload failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      folderId,
      folderName: actualFolderName,
    });

    return new Response(
      JSON.stringify({
        error: `Failed to upload PDF folder "${actualFolderName}" to Shopify`,
        requestId,
        folderName: actualFolderName,
        details:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
              }
            : error,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

async function handleFileIdsUpload(
  fileIds: string[],
  accessToken: string,
  requestId: string,
  config: { skuTarget?: string; conflictResolution?: string },
  request: Request,
) {
  console.log(
    `[${requestId}] Processing individual PDF file upload for ${fileIds.length} files`,
  );

  try {
    // Initialize Google Drive service with access token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    // Authenticate with Shopify
    const { admin } = await authenticate.admin(request);

    const uploadResults = [];
    let metafieldUpdates = 0; // Individual uploads typically don't update metafields

    for (const fileId of fileIds) {
      try {
        // Get file metadata from Google Drive
        const fileResponse = await drive.files.get({
          fileId,
          fields: "id, name, mimeType, size, webViewLink",
        });

        const file = fileResponse.data;

        // Validate PDF
        if (!file.mimeType || !file.mimeType.includes('pdf')) {
          console.log(`[${requestId}] Skipping non-PDF file: ${file.name}`);
          uploadResults.push({
            googleFileId: file.id,
            fileName: file.name,
            status: "skipped",
            message: "Not a PDF file",
          });
          continue;
        }

        // Download PDF content from Google Drive
        console.log(`[${requestId}] Downloading PDF content: ${file.name}`);
        const downloadResponse = await drive.files.get(
          {
            fileId: fileId,
            alt: "media",
          },
          { responseType: "arraybuffer" },
        );

        const fileBuffer = Buffer.from(downloadResponse.data as ArrayBuffer);

        // Create staged upload target for PDF
        const stagedUploadQuery = `
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const stagedUploadInput = {
          filename: file.name,
          mimeType: file.mimeType,
          httpMethod: "POST",
          resource: "FILE",
          fileSize: String(file.size || "0"),
        };

        const stagedResponse = await admin.graphql(stagedUploadQuery, {
          variables: {
            input: [stagedUploadInput],
          },
        });

        const stagedData = await stagedResponse.json();

        if (stagedData?.data?.stagedUploadsCreate?.userErrors?.length > 0) {
          throw new Error(
            stagedData.data.stagedUploadsCreate.userErrors[0].message,
          );
        }

        const stagedTarget =
          stagedData?.data?.stagedUploadsCreate?.stagedTargets?.[0];
        if (!stagedTarget) {
          throw new Error("Failed to get staged upload target");
        }

        // Upload PDF to staged URL
        const boundary =
          "----WebKitFormBoundary" + Math.random().toString(36).slice(2, 18);
        let body = "";

        // Add parameters from Shopify
        if (stagedTarget.parameters) {
          stagedTarget.parameters.forEach((param: any) => {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="${param.name}"\r\n\r\n`;
            body += `${param.value}\r\n`;
          });
        }

        // Add PDF file content
        const mimeType = file.mimeType || "application/pdf";
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="${file.name || "unknown-file.pdf"}"\r\n`;
        body += `Content-Type: ${mimeType}\r\n\r\n`;

        const headerBuffer = Buffer.from(body, "utf8");
        const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
        const finalBuffer = Buffer.concat([
          headerBuffer,
          fileBuffer,
          footerBuffer,
        ]);

        const uploadResponse = await fetch(stagedTarget.url, {
          method: "POST",
          body: finalBuffer,
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": finalBuffer.length.toString(),
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(
            `PDF staged upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
          );
        }

        // Create Shopify file asset for PDF
        const fileCreateQuery = `
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                id
                fileStatus
                alt
                createdAt
                ... on GenericFile {
                  url
                  originalFileSize
                  mimeType
                }
                ... on MediaImage {
                  status
                  image {
                    url
                    width
                    height
                  }
                  preview {
                    image {
                      url
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const fileCreateInput = {
          alt: file.name || "Uploaded PDF spec sheet",
          contentType: "FILE", // Use FILE for PDFs
          originalSource: stagedTarget.resourceUrl,
        };

        const fileCreateResponse = await admin.graphql(fileCreateQuery, {
          variables: {
            files: [fileCreateInput],
          },
        });

        const fileCreateData = await fileCreateResponse.json();

        if (fileCreateData?.data?.fileCreate?.userErrors?.length > 0) {
          throw new Error(fileCreateData.data.fileCreate.userErrors[0].message);
        }

        const createdFile = fileCreateData?.data?.fileCreate?.files?.[0];
        if (!createdFile) {
          throw new Error("Failed to create Shopify file asset");
        }

        // Get URL
        let shopifyUrl: string;

        if (createdFile.url) {
          shopifyUrl = createdFile.url;
        } else {
          shopifyUrl = createdFile.id;
        }

        uploadResults.push({
          googleFileId: file.id,
          fileName: file.name,
          status: "success",
          shopifyFileId: createdFile.id,
          shopifyUrl,
          message: "PDF spec sheet uploaded to Shopify Files",
        });
      } catch (error) {
        console.error(`[${requestId}] Failed to upload PDF file ${fileId}:`, error);
        uploadResults.push({
          googleFileId: fileId,
          status: "error",
          message: `Failed to upload PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = uploadResults.filter(
      (r) => r.status === "success",
    ).length;
    const errorCount = uploadResults.filter((r) => r.status === "error").length;

    console.log(`[${requestId}] SUCCESS: Individual PDF file upload completed`, {
      totalFiles: fileIds.length,
      successCount,
      errorCount,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Uploaded ${successCount} PDF spec sheets to Shopify${errorCount > 0 ? ` (${errorCount} failed)` : ""}`,
        totalFiles: fileIds.length,
        uploadedFiles: successCount,
        failedFiles: errorCount,
        metafieldUpdates, // Add metafield count to response (individual uploads don't update metafields)
        results: uploadResults,
        requestId,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(`[${requestId}] ERROR: Individual PDF file upload failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to upload PDF files to Shopify",
        requestId,
        details:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
              }
            : error,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Helper function to match PDF file with product SKU (partial match)
function matchFileWithSKU(
  fileName: string,
  availableSKUs: any[],
  skuTarget: string,
): any {
  // Add null/undefined checks
  if (!fileName || !availableSKUs || availableSKUs.length === 0) {
    return null;
  }

  const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, "").toLowerCase();
  const fileNameClean = fileNameWithoutExt.replace(/[-_\s]/g, "");

  // Extract the base part from filename (before '-spec' or similar)
  let baseFileName = fileNameWithoutExt;
  const specPatterns = ['-spec', '_spec', '-specs', '_specs', '-documentation', '_docs'];
  for (const pattern of specPatterns) {
    if (fileNameWithoutExt.includes(pattern)) {
      baseFileName = fileNameWithoutExt.split(pattern)[0].trim();
      break;
    }
  }

  console.log(`[SKU MATCH] Processing: ${fileName} -> Base: ${baseFileName}`);

  if (skuTarget === "exact-sku" || skuTarget === "contains-sku") {
    // Group SKUs by product to find partial matches
    const productsMap = new Map<string, any[]>();

    availableSKUs.forEach(sku => {
      if (!sku || !sku.sku || !sku.productId) return;

      if (!productsMap.has(sku.productId)) {
        productsMap.set(sku.productId, []);
      }
      productsMap.get(sku.productId)!.push(sku);
    });

    console.log(`[SKU MATCH] Found ${productsMap.size} unique products to check`);

    // Check each product for partial match
    for (const [productId, productSKUs] of productsMap.entries()) {
      for (const sku of productSKUs) {
        if (!sku.sku) continue;

        const skuClean = sku.sku.toLowerCase().replace(/[-_\s]/g, "");
        const baseFileNameClean = baseFileName.replace(/[-_\s]/g, "");

        console.log(`[SKU MATCH] Checking: ${baseFileNameClean} vs ${skuClean}`);

        // Check if base filename matches the beginning of SKU (partial match)
        if (skuClean.startsWith(baseFileNameClean)) {
          console.log(`[SKU MATCH] ✓ Found partial match: ${baseFileName} matches ${sku.sku}`);

          // Return the first variant of this product
          return {
            ...sku,
            productSKUs: productSKUs, // All variants of this product
            matchType: 'partial',
            matchDetails: {
              fileName: fileName,
              baseFileName: baseFileName,
              matchedSku: sku.sku,
              matchedProduct: sku.productTitle
            }
          };
        }

        // Also check reverse - if SKU starts with base filename
        if (baseFileNameClean.startsWith(skuClean)) {
          console.log(`[SKU MATCH] ✓ Found reverse partial match: ${baseFileName} matches ${sku.sku}`);

          return {
            ...sku,
            productSKUs: productSKUs,
            matchType: 'partial-reverse',
            matchDetails: {
              fileName: fileName,
              baseFileName: baseFileName,
              matchedSku: sku.sku,
              matchedProduct: sku.productTitle
            }
          };
        }
      }
    }

    console.log(`[SKU MATCH] ✗ No partial match found for: ${baseFileName}`);
  }

  return null;
}

// Helper function to update product spec sheet metafield with file_reference type
async function updateProductSpecSheetMetafield(
  admin: any,
  productId: string,
  fileGid: string,
  fileName: string,
  requestId: string,
): Promise<boolean> {
  try {
    console.log(
      `[${requestId}] Updating spec sheet metafield: productId=${productId}, fileName=${fileName}, fileGid=${fileGid}`,
    );

    // Use metafieldsSet mutation to set file_reference metafield
    const updateMetafieldQuery = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
            type
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    console.log(`[${requestId}] Using file reference: ${fileGid}`);

    const updateResponse = await admin.graphql(updateMetafieldQuery, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "custom",
            key: "spec_sheet_pdf",
            type: "file_reference",
            value: fileGid,
          },
        ],
      },
    });

    const updateData = await updateResponse.json();

    if (updateData?.data?.metafieldsSet?.userErrors?.length > 0) {
      const errors = updateData.data.metafieldsSet.userErrors;
      console.error(`[${requestId}] GraphQL errors:`, errors);
      return false;
    }

    const createdMetafield = updateData?.data?.metafieldsSet?.metafields?.[0];
    if (createdMetafield) {
      console.log(
        `[${requestId}] SUCCESS: Spec sheet metafield updated for product ${productId}`,
      );
      console.log(`[${requestId}] Metafield details:`, {
        id: createdMetafield.id,
        namespace: createdMetafield.namespace,
        key: createdMetafield.key,
        type: createdMetafield.type,
      });
      console.log(`[${requestId}] File GID: ${fileGid}`);
      console.log(`[${requestId}] File name: ${fileName}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[${requestId}] ERROR: Spec sheet metafield update failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
}