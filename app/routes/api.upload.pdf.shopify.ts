import { google } from "googleapis";
import { authenticate } from "../shopify.server";
import {
  fetchSKUDataFromShopify,
  matchPDFFileWithSKU,
  getColorCodeFromSKU,
  validatePDFColorCode,
  extractSKUBase,
} from "../utils/skuUtils";
import { googleAuthServer, GoogleAuthConfig } from "../services/googleAuthServer";

// Helper function to log detailed errors without exposing to users
function logDetailedError(requestId: string, context: string, error: unknown) {
  const errorInfo: Record<string, any> = {
    context,
    timestamp: new Date().toISOString(),
    requestId,
    errorType: typeof error,
    errorConstructor: error?.constructor?.name,
  };

  if (error instanceof Error) {
    errorInfo.message = error.message;
    errorInfo.stack = error.stack;
    errorInfo.name = error.name;
  } else if (error !== null && error !== undefined) {
    // Try to capture non-Error objects
    try {
      errorInfo.value = JSON.stringify(error, null, 2);
      errorInfo.keys = Object.keys(error);
    } catch (e) {
      errorInfo.value = String(error);
    }
  } else {
    errorInfo.value = String(error);
  }

  console.error(`[${requestId}] ${context}:`, errorInfo);
  return errorInfo;
}

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
      refreshToken,
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
      hasRefreshToken: !!refreshToken,
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

    // Create auth config for potential token refresh
    const authConfig: GoogleAuthConfig = {
      accessToken,
      refreshToken,
    };

    // Handle different upload types
    if (type === "folder" && folderId) {
      return handleFolderUpload(
        folderId,
        folderName,
        isShared,
        owner,
        authConfig,
        requestId,
        { skuTarget, conflictResolution },
        request,
      );
    } else if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      return handleFileIdsUpload(
        fileIds,
        authConfig,
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
    // Log detailed error for debugging without exposing to user
    const errorDetails = logDetailedError(requestId, "Upload PDFs to Shopify failed", error);

    // Return 200 with graceful message to avoid showing error notification to user
    return new Response(
      JSON.stringify({
        success: false,
        message: "PDF upload processing has encountered an issue. Please check your uploads in a moment.",
        requestId,
        timestamp: new Date().toISOString(),
        // Only include debug info in development
        ...(process.env.NODE_ENV === 'development' && {
          debug: errorDetails
        })
      }),
      {
        status: 200, // Return 200 to avoid triggering error notifications
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
  authConfig: GoogleAuthConfig,
  requestId: string,
  config: { skuTarget?: string; conflictResolution?: string },
  request: Request,
) {
  console.log(
    `[${requestId}] Processing PDF folder upload for: ${folderName || folderId}`,
  );

  try {
    // Get folder name if not provided (with auto-refresh on 401)
    let actualFolderName = folderName;
    if (!actualFolderName) {
      try {
        const folderResponse = await googleAuthServer.executeWithAutoRefresh(
          authConfig,
          async (accessToken) => {
            const drive = googleAuthServer.createDriveClient(accessToken);
            return await drive.files.get({
              fileId: folderId,
              fields: "name",
            });
          },
          requestId
        );
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

    // Get all PDF files from the folder (with auto-refresh on 401)
    console.log(`[${requestId}] Fetching all PDF files from folder: ${folderId}`);
    const query = `'${folderId}' in parents and (mimeType contains 'pdf') and trashed=false`;

    const listResponse = await googleAuthServer.executeWithAutoRefresh(
      authConfig,
      async (accessToken) => {
        const drive = googleAuthServer.createDriveClient(accessToken);
        return await drive.files.list({
          q: query,
          fields:
            "files(id, name, mimeType, size, createdTime, webViewLink, webContentLink)",
          pageSize: 1000, // Get up to 1000 files
        });
      },
      requestId
    );

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

    // Fetch SKU data for matching using shared utility
    console.log(`[${requestId}] Fetching SKU data for product matching...`);
    let availableSKUs: any[] = [];

    if (config.skuTarget) {
      try {
        // Use shared utility to fetch SKU data with consistent filtering
        const skuResult = await fetchSKUDataFromShopify(admin, 250);

        if (skuResult.success && skuResult.flattenedSKUs) {
          availableSKUs = skuResult.flattenedSKUs;

          console.log(
            `[${requestId}] Loaded ${availableSKUs.length} SKUs from ${skuResult.summary.totalProducts} Wallpaper products`,
          );
          console.log(
            `[${requestId}] SKU Summary: ${skuResult.summary.productsWithSKUs} products with SKUs, ${skuResult.summary.totalVariants} total variants (only variants with Color option)`,
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

    // Track processed colors by product to avoid duplicate processing
    // Format: Set of "productId-colorCode" strings
    const processedColorPdfs = new Set<string>();

    for (const file of files) {
      try {
        console.log(
          `[${requestId}] Processing PDF file ${processedCount + 1}/${files.length}: ${file.name}`,
        );

        // Get detailed file information (with auto-refresh on 401)
        const fileResponse = await googleAuthServer.executeWithAutoRefresh(
          authConfig,
          async (accessToken) => {
            const drive = googleAuthServer.createDriveClient(accessToken);
            return await drive.files.get({
              fileId: file.id!,
              fields: "id, name, mimeType, size, webViewLink, webContentLink",
            });
          },
          requestId
        );

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

          skuMatch = matchPDFFileWithSKU(
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
                }
              : null,
          });

          // For PDF upload, we REQUIRE SKU match
          shouldUploadFile = !!skuMatch;

          // Check if this color for this product already has a spec sheet uploaded
          if (skuMatch) {
            const colorCode = getColorCodeFromSKU(skuMatch.sku);
            const colorKey = `${skuMatch.productId}-${colorCode}`;

            if (processedColorPdfs.has(colorKey)) {
              console.log(
                `[${requestId}] Color ${colorCode} for product ${skuMatch.productId} already processed, skipping PDF: ${fileData.name}`,
              );
              shouldUploadFile = false;
              skuMatch = null; // Clear match to mark as skipped
            }
          }

          if (!skuMatch) {
            console.log(
              `[${requestId}] No SKU match found for PDF file or color already processed: ${fileData.name}`,
            );
          }
        }

        if (!shouldUploadFile) {
          console.log(
            `[${requestId}] Skipping PDF file (no SKU match or color already processed): ${fileData.name}`,
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
                  color: skuMatch.color,
                  matchType: skuMatch.matchType
                }
              : null,
            reason: skuMatch
              ? `Color ${skuMatch.color} already processed for product ${skuMatch.productTitle}`
              : "No SKU match found for PDF",
            uploadedAt: new Date().toISOString(),
          });

          processedCount++;
          continue;
        }

        // Download PDF content from Google Drive (with auto-refresh on 401)
        console.log(`[${requestId}] Downloading PDF content: ${file.name}`);
        const downloadResponse = await googleAuthServer.executeWithAutoRefresh(
          authConfig,
          async (accessToken) => {
            const drive = googleAuthServer.createDriveClient(accessToken);
            return await drive.files.get(
              {
                fileId: file.id!,
                alt: "media",
              },
              { responseType: "arraybuffer" },
            );
          },
          requestId
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
            `[${requestId}] Updating spec sheet metafield for product ${skuMatch.productId}, color: ${skuMatch.color}`,
          );

          try {
            const colorCode = getColorCodeFromSKU(skuMatch.sku);
            const metafieldUpdateResult = await updateProductSpecSheetMetafield(
              admin,
              skuMatch.productId,
              fileGid, // Use GID for file_reference
              colorCode, // Pass color code
              skuMatch.color || "", // Pass full color name
              file.name,
              requestId,
            );

            if (metafieldUpdateResult) {
              metafieldUpdates++;

              // Mark this color as processed for this product
              const colorKey = `${skuMatch.productId}-${colorCode}`;
              processedColorPdfs.add(colorKey);

              console.log(
                `[${requestId}] Color ${colorCode} for product ${skuMatch.productId} marked as processed to avoid duplicate uploads`,
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

    // Log detailed error for debugging without exposing to user
    logDetailedError(requestId, "PDF folder upload failed", error);

    // Return 200 with graceful message to avoid showing error notification to user
    return new Response(
      JSON.stringify({
        success: false,
        message: "PDF upload processing has encountered an issue. Please check your uploads in a moment.",
        folderName: actualFolderName,
        requestId,
        timestamp: new Date().toISOString(),
        // Only include debug info in development
        ...(process.env.NODE_ENV === 'development' && {
          debug: {
            folderId,
            folderName: actualFolderName,
            error: error instanceof Error ? {
              message: error.message,
              name: error.name,
            } : error
          }
        })
      }),
      {
        status: 200, // Return 200 to avoid triggering error notifications
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

async function handleFileIdsUpload(
  fileIds: string[],
  authConfig: GoogleAuthConfig,
  requestId: string,
  config: { skuTarget?: string; conflictResolution?: string },
  request: Request,
) {
  console.log(
    `[${requestId}] Processing individual PDF file upload for ${fileIds.length} files`,
  );

  try {
    // Authenticate with Shopify
    const { admin } = await authenticate.admin(request);

    const uploadResults = [];
    let metafieldUpdates = 0; // Individual uploads typically don't update metafields

    for (const fileId of fileIds) {
      try {
        // Get file metadata from Google Drive (with auto-refresh on 401)
        const fileResponse = await googleAuthServer.executeWithAutoRefresh(
          authConfig,
          async (accessToken) => {
            const drive = googleAuthServer.createDriveClient(accessToken);
            return await drive.files.get({
              fileId,
              fields: "id, name, mimeType, size, webViewLink",
            });
          },
          requestId
        );

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

        // Download PDF content from Google Drive (with auto-refresh on 401)
        console.log(`[${requestId}] Downloading PDF content: ${file.name}`);
        const downloadResponse = await googleAuthServer.executeWithAutoRefresh(
          authConfig,
          async (accessToken) => {
            const drive = googleAuthServer.createDriveClient(accessToken);
            return await drive.files.get(
              {
                fileId: fileId,
                alt: "media",
              },
              { responseType: "arraybuffer" },
            );
          },
          requestId
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
    // Log detailed error for debugging without exposing to user
    logDetailedError(requestId, "Individual PDF file upload failed", error);

    // Return 200 with graceful message to avoid showing error notification to user
    return new Response(
      JSON.stringify({
        success: false,
        message: "PDF upload processing has encountered an issue. Please check your uploads in a moment.",
        requestId,
        timestamp: new Date().toISOString(),
        // Only include debug info in development
        ...(process.env.NODE_ENV === 'development' && {
          debug: {
            error: error instanceof Error ? {
              message: error.message,
              name: error.name,
            } : error
          }
        })
      }),
      {
        status: 200, // Return 200 to avoid triggering error notifications
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Note: Helper functions (extractSKUBase, getColorCodeFromSKU, validatePDFColorCode, matchFileWithSKU)
// have been moved to app/utils/skuUtils.ts for reusability between Dry Upload and Start Upload

// Helper function to update product spec sheet metafield with list.file_reference type
// IMPORTANT: Shopify list.file_reference only accepts array of GIDs, not objects with metadata
async function updateProductSpecSheetMetafield(
  admin: any,
  productId: string,
  fileGid: string,
  colorCode: string,
  colorName: string,
  fileName: string,
  requestId: string,
): Promise<boolean> {
  try {
    console.log(
      `[${requestId}] Updating spec sheet metafield: productId=${productId}, colorCode=${colorCode}, colorName=${colorName}, fileName=${fileName}, fileGid=${fileGid}`,
    );

    // First, try to get existing metafield
    const getMetafieldQuery = `
      query getProductMetafield($productId: ID!, $namespace: String!, $key: String!) {
        product(id: $productId) {
          metafield(namespace: $namespace, key: $key) {
            id
            value
            type
            namespace
            key
          }
        }
      }
    `;

    const getResponse = await admin.graphql(getMetafieldQuery, {
      variables: {
        productId,
        namespace: "custom",
        key: "spec_sheet_pdf",
      },
    });

    const getData = await getResponse.json();
    const existingMetafield = getData?.data?.product?.metafield;

    // Parse existing value if it exists
    // For list.file_reference, value should be an array of GIDs: ["gid://shopify/GenericFile/123", ...]
    let currentGidList: string[] = [];

    if (existingMetafield && existingMetafield.value) {
      try {
        // Check if value is already an array or needs parsing
        if (Array.isArray(existingMetafield.value)) {
          currentGidList = existingMetafield.value;
        } else if (typeof existingMetafield.value === 'string') {
          currentGidList = JSON.parse(existingMetafield.value);
        }

        console.log(
          `[${requestId}] Loaded existing spec sheet list with ${currentGidList.length} entries`,
        );
        console.log(`[${requestId}] Existing GIDs:`, currentGidList);
      } catch (error) {
        console.warn(
          `[${requestId}] Failed to parse existing metafield, starting fresh:`,
          error,
        );
        currentGidList = [];
      }
    }

    // Check if this file GID already exists in the list
    const existingGidIndex = currentGidList.findIndex((gid) => gid === fileGid);

    if (existingGidIndex >= 0) {
      // File already exists, update it (replace with new GID)
      currentGidList[existingGidIndex] = fileGid;
      console.log(
        `[${requestId}] Updated existing spec sheet GID for color ${colorCode}`,
      );
    } else {
      // Add new GID
      currentGidList.push(fileGid);
      console.log(
        `[${requestId}] Added new spec sheet GID for color ${colorCode}: ${fileGid}`,
      );
    }

    console.log(`[${requestId}] Final GID list (${currentGidList.length} entries):`, currentGidList);

    // Use metafieldsSet mutation to set list.file_reference metafield
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

    const updateResponse = await admin.graphql(updateMetafieldQuery, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "custom",
            key: "spec_sheet_pdf",
            type: "list.file_reference",
            value: JSON.stringify(currentGidList),
          },
        ],
      },
    });

    const updateData = await updateResponse.json();

    if (updateData?.data?.metafieldsSet?.userErrors?.length > 0) {
      const errors = updateData.data.metafieldsSet.userErrors;
      console.error(`[${requestId}] ❌ GraphQL errors:`, errors);

      // Log each error for debugging
      errors.forEach((error: any) => {
        console.error(`[${requestId}] Field: ${error.field}, Message: ${error.message}`);
      });

      return false;
    }

    const createdMetafield = updateData?.data?.metafieldsSet?.metafields?.[0];
    if (createdMetafield) {
      console.log(
        `[${requestId}] ✅ SUCCESS: Spec sheet metafield updated for product ${productId}`,
      );
      console.log(`[${requestId}] Metafield details:`, {
        id: createdMetafield.id,
        namespace: createdMetafield.namespace,
        key: createdMetafield.key,
        type: createdMetafield.type,
        value: createdMetafield.value,
        entriesCount: currentGidList.length,
      });
      console.log(`[${requestId}] Spec sheet GIDs:`, currentGidList.join(', '));
      return true;
    }

    console.error(`[${requestId}] ❌ No metafield returned from update`);
    return false;
  } catch (error) {
    console.error(`[${requestId}] ❌ ERROR: Spec sheet metafield update failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
}