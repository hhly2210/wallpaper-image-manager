import { google } from "googleapis";
import { authenticate } from "../shopify.server";
import { googleAuthServer, GoogleAuthConfig } from "../services/googleAuthServer";

export async function action({ request }: { request: Request }) {
  console.log(`[SERVER] Shopify upload API called`, {
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
  console.log(`[${requestId}] API: Shopify upload request started`);

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
    console.error(`[${requestId}] ERROR: Upload to Shopify failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      requestId,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to upload files to Shopify",
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
  authConfig: GoogleAuthConfig,
  requestId: string,
  config: { skuTarget?: string; conflictResolution?: string },
  request: Request,
) {
  console.log(
    `[${requestId}] Processing folder upload for: ${folderName || folderId}`,
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

    // Get all image files from the folder (with auto-refresh on 401)
    console.log(`[${requestId}] Fetching all files from folder: ${folderId}`);
    const query = `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`;

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
    console.log(`[${requestId}] Found ${files.length} image files in folder`);

    if (files.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Folder "${actualFolderName}" contains no images to upload`,
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

    // Process uploads for all files in folder
    const uploadResults = [];
    let processedCount = 0;
    let metafieldUpdates = 0;

    // Track processed image types by product and color to avoid duplicate processing
    // Format: Map of "productId-colorCode" -> Set of uploaded types ("room", "hover")
    const processedImageTypes = new Map<string, Set<string>>();

    for (const file of files) {
      try {
        console.log(
          `[${requestId}] Processing file ${processedCount + 1}/${files.length}: ${file.name}`,
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
        console.log(`[${requestId}] File ${processedCount + 1} data:`, {
          id: fileData?.id,
          name: fileData?.name,
          mimeType: fileData?.mimeType,
          size: fileData?.size,
          fileDataKeys: fileData ? Object.keys(fileData) : "fileData is null",
        });

        if (!fileData || !fileData.name) {
          throw new Error("Invalid file data or missing file name");
        }

        // Validate color code in filename (must be exactly 3 characters)
        const colorCodeValidation = validateColorCode(fileData.name);
        if (!colorCodeValidation.valid) {
          console.log(
            `[${requestId}] Skipping file - invalid color code: ${fileData.name}`,
            { reason: colorCodeValidation.reason },
          );

          // Add to results as skipped
          uploadResults.push({
            googleFileId: fileData.id,
            fileName: fileData.name,
            fileSize: fileData.size,
            mimeType: fileData.mimeType,
            status: "skipped",
            shopifyFileId: null,
            shopifyUrl: null,
            skuMatch: null,
            imageType: null,
            reason: colorCodeValidation.reason || 'Invalid color code format',
            uploadedAt: new Date().toISOString(),
          });

          processedCount++;
          continue; // Skip to next file
        }

        console.log(
          `[${requestId}] Color code validation passed: ${fileData.name}`,
          { colorCode: colorCodeValidation.colorCode },
        );

        // Match file with SKU if configured (VALIDATE BEFORE UPLOAD)
        let skuMatch = null;
        let imageType = null;
        let shouldUploadFile = true; // Default to true for backward compatibility

        if (config.skuTarget && availableSKUs.length > 0) {
          console.log(
            `[${requestId}] Validating file with SKU before upload:`,
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
          imageType = detectImageType(fileData.name);

          console.log(`[${requestId}] Pre-upload validation result:`, {
            skuMatch: skuMatch
              ? {
                  sku: skuMatch.sku,
                  productTitle: skuMatch.productTitle,
                  color: skuMatch.color,
                }
              : null,
            imageType,
          });

          // IMPORTANT: Only upload files that have both SKU match AND valid image type
          shouldUploadFile = !!(skuMatch && imageType);

          if (!shouldUploadFile) {
            console.log(
              `[${requestId}] Skipping file - no SKU match or invalid image type: ${fileData.name}`,
            );

            // Add to results as skipped
            uploadResults.push({
              googleFileId: fileData.id,
              fileName: fileData.name,
              fileSize: fileData.size,
              mimeType: fileData.mimeType,
              status: "skipped",
              shopifyFileId: null,
              shopifyUrl: null,
              skuMatch: null,
              imageType: imageType,
              reason: !skuMatch
                ? "No SKU match found"
                : "Invalid or missing image type",
              uploadedAt: new Date().toISOString(),
            });

            processedCount++;
            continue; // Skip to next file
          }

          // Check if we've already processed this specific image type for this color and product
          if (skuMatch && skuMatch.productId && imageType) {
            const colorCode = getColorCodeFromSKU(skuMatch.sku);
            const colorKey = `${skuMatch.productId}-${colorCode}`;
            const uploadedTypes = processedImageTypes.get(colorKey);

            if (uploadedTypes && uploadedTypes.has(imageType)) {
              console.log(
                `[${requestId}] Skipping file - ${imageType} image for color ${colorCode} already processed for product ${skuMatch.productTitle}: ${fileData.name}`,
              );

              // Add to results as skipped
              uploadResults.push({
                googleFileId: fileData.id,
                fileName: fileData.name,
                fileSize: fileData.size,
                mimeType: fileData.mimeType,
                status: "skipped",
                shopifyFileId: null,
                shopifyUrl: null,
                skuMatch: {
                  productId: skuMatch.productId,
                  productTitle: skuMatch.productTitle,
                  sku: skuMatch.sku,
                  color: skuMatch.color,
                },
                imageType,
                reason: `${imageType} image for color ${skuMatch.color} (${colorCode}) already processed for this product`,
                uploadedAt: new Date().toISOString(),
              });

              processedCount++;
              continue; // Skip to next file
            }
          }
        } else {
          // No SKU filtering configured - detect image type for potential future use
          imageType = detectImageType(fileData.name);
          console.log(
            `[${requestId}] No SKU filtering configured - uploading all files. Detected image type: ${imageType}`,
          );
        }

        // Download file content from Google Drive (with auto-refresh on 401)
        console.log(`[${requestId}] Downloading file content: ${file.name}`);
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

        // Upload file to Shopify Files API
        console.log(
          `[${requestId}] Starting upload to Shopify Files API: ${file.name}`,
        );
        console.log(`[${requestId}] File details:`, {
          name: file.name,
          size: fileData.size,
          mimeType: fileData.mimeType,
          bufferSize: fileBuffer.length,
        });

        // Generate a staged upload target
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
          mimeType: fileData.mimeType,
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

        // Create multipart form data manually for better control
        const boundary =
          "----WebKitFormBoundary" + Math.random().toString(36).slice(2, 18);
        let body = "";

        // Add parameters from Shopify
        console.log(`[${requestId}] Adding Shopify parameters to form data:`, {
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

        // Add file content
        console.log(`[${requestId}] Adding file to form data:`, {
          filename: file.name,
          contentType: fileData.mimeType,
          bufferLength: fileBuffer.length,
        });

        const mimeType = fileData.mimeType || "application/octet-stream";
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="${file.name || "unknown-file"}"\r\n`;
        body += `Content-Type: ${mimeType}\r\n\r\n`;

        // Convert body to buffer and append file buffer
        const headerBuffer = Buffer.from(body, "utf8");
        const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

        const finalBuffer = Buffer.concat([
          headerBuffer,
          fileBuffer,
          footerBuffer,
        ]);

        console.log(`[${requestId}] Final multipart buffer created:`, {
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
          console.error(`[${requestId}] Staged upload error details:`, {
            status: uploadResponse.status,
            statusText: uploadResponse.statusText,
            errorText,
            stagedUrl: stagedTarget.url,
            fileSize: fileBuffer.length,
            fileName: file.name,
          });
          throw new Error(
            `Staged upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
          );
        }

        console.log(
          `[${requestId}] File successfully uploaded to staged URL, now creating Shopify file asset`,
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
          alt: fileData.name || "Uploaded image",
          contentType: "IMAGE",
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

        // Try to get CDN URL from various sources, fallback to GID if not available
        let shopifyUrl: string;

        if (createdFile.image?.url) {
          // Best case: MediaImage with processed CDN URL
          shopifyUrl = createdFile.image.url;
        } else if (createdFile.preview?.image?.url) {
          // Fallback: Preview image URL
          shopifyUrl = createdFile.preview.image.url;
        } else if (createdFile.url) {
          // Fallback: GenericFile direct URL
          shopifyUrl = createdFile.url;
        } else {
          // Last resort: Use the GID (as originally implemented)
          shopifyUrl = shopifyFileId;
        }

        console.log(`[${requestId}] File created with details:`, {
          shopifyFileId,
          shopifyUrl,
          fileStatus: createdFile.fileStatus,
          mediaStatus: (createdFile as any).status,
          hasImageUrl: !!createdFile.image?.url,
          hasPreviewUrl: !!createdFile.preview?.image?.url,
          hasDirectUrl: !!createdFile.url,
          imageWidth: createdFile.image?.width,
          imageHeight: createdFile.image?.height,
        });

        // If we only have GID, try to wait and query again for CDN URL with improved polling
        if (
          shopifyUrl === shopifyFileId &&
          (createdFile.fileStatus === "PROCESSING" || !createdFile.fileStatus)
        ) {
          console.log(
            `[${requestId}] File is processing, attempting to wait for CDN URL with polling...`,
          );

          try {
            const maxRetries = 5;
            const waitTime = 3000; // 3 seconds between retries
            let cdnUrlFound = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              console.log(
                `[${requestId}] CDN URL polling attempt ${attempt}/${maxRetries}...`,
              );

              // Wait before querying
              if (attempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, waitTime));
              }

              const retryQuery = `
                query node($id: ID!) {
                  node(id: $id) {
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
                }
              `;

              const retryResponse = await admin.graphql(retryQuery, {
                variables: { id: shopifyFileId },
              });

              const retryData = await retryResponse.json();
              const retryNode = retryData?.data?.node;

              console.log(
                `[${requestId}] Polling attempt ${attempt} result:`,
                {
                  status: retryNode?.status,
                  hasImageUrl: !!retryNode?.image?.url,
                  hasPreviewUrl: !!retryNode?.preview?.image?.url,
                  imageUrl: retryNode?.image?.url,
                },
              );

              if (retryNode?.image?.url && retryNode.image.url.startsWith("https://")) {
                shopifyUrl = retryNode.image.url;
                cdnUrlFound = true;
                console.log(
                  `[${requestId}] ✓ Successfully obtained CDN URL on attempt ${attempt}:`,
                  {
                    shopifyUrl,
                    status: retryNode.status,
                  },
                );
                break;
              } else if (retryNode?.preview?.image?.url && retryNode.preview.image.url.startsWith("https://")) {
                shopifyUrl = retryNode.preview.image.url;
                cdnUrlFound = true;
                console.log(
                  `[${requestId}] ✓ Using preview URL on attempt ${attempt}:`,
                  {
                    shopifyUrl,
                    status: retryNode.status,
                  },
                );
                break;
              } else if (retryNode?.status === "FAILED") {
                console.warn(
                  `[${requestId}] ✗ File processing failed, will use GID as fallback`,
                );
                break;
              } else if (retryNode?.status === "PROCESSING" && attempt < maxRetries) {
                console.log(
                  `[${requestId}] File still processing, will retry in ${waitTime}ms...`,
                );
                continue;
              } else if (attempt >= maxRetries) {
                console.warn(
                  `[${requestId}] ✗ Max retries reached without CDN URL, will use GID as fallback`,
                );
                break;
              }
            }

            if (cdnUrlFound) {
              console.log(
                `[${requestId}] CDN URL obtained after polling, ready for metafield update`,
              );
            } else {
              console.warn(
                `[${requestId}] Could not obtain CDN URL after ${maxRetries} attempts, using GID: ${shopifyUrl}`,
              );
            }
          } catch (retryError) {
            console.warn(
              `[${requestId}] Failed to poll for CDN URL:`,
              retryError,
            );
          }
        }

        console.log(`[${requestId}] Successfully created Shopify file asset:`, {
          shopifyFileId,
          shopifyUrl,
          fileStatus: createdFile.fileStatus,
          stagedUploadUrl: stagedTarget.url,
          resourceUrl: stagedTarget.resourceUrl,
        });

        // Update metafield if we have a match (skuMatch and imageType are already defined above)
        if (skuMatch && imageType) {
          console.log(
            `[${requestId}] Updating metafield for product ${skuMatch.productId}, color: ${skuMatch.color}, type: ${imageType}`,
          );

          try {
            const metafieldUpdateResult = await updateProductMetafield(
              admin,
              skuMatch.productId,
              skuMatch.color || "",
              shopifyUrl,
              imageType,
              requestId,
            );

            if (metafieldUpdateResult) {
              metafieldUpdates++;

              // Mark this specific image type as processed for this color and product
              const colorCode = getColorCodeFromSKU(skuMatch.sku);
              const colorKey = `${skuMatch.productId}-${colorCode}`;

              if (!processedImageTypes.has(colorKey)) {
                processedImageTypes.set(colorKey, new Set<string>());
              }

              const uploadedTypes = processedImageTypes.get(colorKey)!;
              uploadedTypes.add(imageType);

              console.log(
                `[${requestId}] Marked ${imageType} image for color ${colorCode} as processed for product ${skuMatch.productTitle}. Total uploaded types for this color: ${Array.from(uploadedTypes).join(", ")}`,
              );
            }
          } catch (metafieldError) {
            console.error(
              `[${requestId}] Failed to update metafield:`,
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
          imageType,
          message:
            skuMatch && imageType
              ? `Successfully uploaded and linked to ${skuMatch.productTitle} (${skuMatch.color} - ${imageType})`
              : "Successfully uploaded to Shopify",
          uploadTime: new Date().toISOString(),
        });

        processedCount++;

        // Log progress every 10 files
        if (processedCount % 10 === 0) {
          console.log(
            `[${requestId}] Progress: ${processedCount}/${files.length} files processed, ${metafieldUpdates} metafields updated`,
          );
        }
      } catch (error) {
        console.error(`[${requestId}] FAILED TO UPLOAD FILE ${file.id}:`, {
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
          message: `Failed to upload: ${error instanceof Error ? error.message : "Unknown error"}`,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = uploadResults.filter(
      (r) => r.status === "success",
    ).length;
    const errorCount = uploadResults.filter((r) => r.status === "error").length;
    const matchedCount = uploadResults.filter((r) => r.skuMatch).length;

    console.log(`[${requestId}] SUCCESS: Folder upload completed`, {
      folderName: actualFolderName,
      totalFiles: files.length,
      successCount,
      errorCount,
      matchedCount,
      metafieldUpdates,
      processingTime: Date.now(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Uploaded ${successCount} files from "${actualFolderName}" to Shopify${errorCount > 0 ? ` (${errorCount} failed)` : ""}${metafieldUpdates > 0 ? ` (${metafieldUpdates} metafields updated)` : ""}`,
        folderName: actualFolderName,
        folderId,
        isShared,
        owner,
        totalFiles: files.length,
        uploadedFiles: successCount,
        failedFiles: errorCount,
        matchedFiles: matchedCount,
        metafieldUpdates,
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
    console.error(`[${requestId}] ERROR: Folder upload failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      folderId,
      folderName: actualFolderName,
    });

    return new Response(
      JSON.stringify({
        error: `Failed to upload folder "${actualFolderName}" to Shopify`,
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
  authConfig: GoogleAuthConfig,
  requestId: string,
  config: { skuTarget?: string; conflictResolution?: string },
  request: Request,
) {
  console.log(
    `[${requestId}] Processing individual file upload for ${fileIds.length} files`,
  );

  try {
    // Authenticate with Shopify
    const { admin } = await authenticate.admin(request);

    const uploadResults = [];

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

        // Download file content from Google Drive (with auto-refresh on 401)
        console.log(`[${requestId}] Downloading file content: ${file.name}`);
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

        // Create staged upload target
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

        // Upload file to staged URL
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

        // Add file content
        const mimeType = file.mimeType || "application/octet-stream";
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="${file.name || "unknown-file"}"\r\n`;
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
            `Staged upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
          );
        }

        // Create Shopify file asset
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
          alt: file.name || "Uploaded image",
          contentType: "IMAGE",
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

        // Try to get CDN URL from various sources, fallback to GID if not available
        let shopifyUrl: string;

        if (createdFile.image?.url) {
          // Best case: MediaImage with processed CDN URL
          shopifyUrl = createdFile.image.url;
        } else if (createdFile.preview?.image?.url) {
          // Fallback: Preview image URL
          shopifyUrl = createdFile.preview.image.url;
        } else if (createdFile.url) {
          // Fallback: GenericFile direct URL
          shopifyUrl = createdFile.url;
        } else {
          // Last resort: Use the GID (as originally implemented)
          shopifyUrl = createdFile.id;
        }

        // If we only have GID and file is processing, try to wait for CDN URL with polling
        if (
          shopifyUrl === createdFile.id &&
          (createdFile.fileStatus === "PROCESSING" || !createdFile.fileStatus)
        ) {
          console.log(
            `[${requestId}] File is processing, attempting to wait for CDN URL with polling...`,
          );

          try {
            const maxRetries = 5;
            const waitTime = 3000; // 3 seconds between retries
            let cdnUrlFound = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              console.log(
                `[${requestId}] CDN URL polling attempt ${attempt}/${maxRetries}...`,
              );

              // Wait before querying
              if (attempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, waitTime));
              }

              const retryQuery = `
                query node($id: ID!) {
                  node(id: $id) {
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
                }
              `;

              const retryResponse = await admin.graphql(retryQuery, {
                variables: { id: createdFile.id },
              });

              const retryData = await retryResponse.json();
              const retryNode = retryData?.data?.node;

              console.log(
                `[${requestId}] Polling attempt ${attempt} result:`,
                {
                  status: retryNode?.status,
                  hasImageUrl: !!retryNode?.image?.url,
                  hasPreviewUrl: !!retryNode?.preview?.image?.url,
                  imageUrl: retryNode?.image?.url,
                },
              );

              if (retryNode?.image?.url && retryNode.image.url.startsWith("https://")) {
                shopifyUrl = retryNode.image.url;
                cdnUrlFound = true;
                console.log(
                  `[${requestId}] ✓ Successfully obtained CDN URL on attempt ${attempt}:`,
                  {
                    shopifyUrl,
                    status: retryNode.status,
                  },
                );
                break;
              } else if (retryNode?.preview?.image?.url && retryNode.preview.image.url.startsWith("https://")) {
                shopifyUrl = retryNode.preview.image.url;
                cdnUrlFound = true;
                console.log(
                  `[${requestId}] ✓ Using preview URL on attempt ${attempt}:`,
                  {
                    shopifyUrl,
                    status: retryNode.status,
                  },
                );
                break;
              } else if (retryNode?.status === "FAILED") {
                console.warn(
                  `[${requestId}] ✗ File processing failed, will use GID as fallback`,
                );
                break;
              } else if (retryNode?.status === "PROCESSING" && attempt < maxRetries) {
                console.log(
                  `[${requestId}] File still processing, will retry in ${waitTime}ms...`,
                );
                continue;
              } else if (attempt >= maxRetries) {
                console.warn(
                  `[${requestId}] ✗ Max retries reached without CDN URL, will use GID as fallback`,
                );
                break;
              }
            }

            if (cdnUrlFound) {
              console.log(
                `[${requestId}] CDN URL obtained after polling`,
              );
            } else {
              console.warn(
                `[${requestId}] Could not obtain CDN URL after ${maxRetries} attempts, using GID`,
              );
            }
          } catch (retryError) {
            console.warn(
              `[${requestId}] Failed to poll for CDN URL:`,
              retryError,
            );
          }
        }

        uploadResults.push({
          googleFileId: file.id,
          fileName: file.name,
          status: "success",
          shopifyFileId: createdFile.id,
          shopifyUrl,
          message: "Successfully uploaded to Shopify Files",
        });
      } catch (error) {
        console.error(`[${requestId}] Failed to upload file ${fileId}:`, error);
        uploadResults.push({
          googleFileId: fileId,
          status: "error",
          message: `Failed to upload: ${error instanceof Error ? error.message : "Unknown error"}`,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = uploadResults.filter(
      (r) => r.status === "success",
    ).length;
    const errorCount = uploadResults.filter((r) => r.status === "error").length;

    console.log(`[${requestId}] SUCCESS: Individual file upload completed`, {
      totalFiles: fileIds.length,
      successCount,
      errorCount,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Uploaded ${successCount} files to Shopify${errorCount > 0 ? ` (${errorCount} failed)` : ""}`,
        totalFiles: fileIds.length,
        uploadedFiles: successCount,
        failedFiles: errorCount,
        results: uploadResults,
        requestId,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(`[${requestId}] ERROR: Individual file upload failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to upload files to Shopify",
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

// Helper function to extract SKU base (cut at 3rd dash)
// Input: "WP-SCALLOPS-SKY-2748" -> Output: "WP-SCALLOPS-SKY"
function extractSKUBase(sku: string): string {
  if (!sku) return "";

  const parts = sku.split("-");
  if (parts.length < 4) return sku; // Return original if less than 4 parts

  // Join first 3 parts (WP, SCALLOPS, SKY) and ignore the rest (size codes)
  return parts.slice(0, 3).join("-");
}

// Helper function to extract 3-char color code from SKU
// Input: "WP-SCALLOPS-SKY-2748" -> Output: "SKY"
function getColorCodeFromSKU(sku: string): string {
  if (!sku) return "";

  const parts = sku.split("-");
  if (parts.length < 3) return "";

  // The 3rd part is the color code (index 2)
  return parts[2].toUpperCase();
}

// Helper function to validate color code in filename
// STRICT FORMAT: Must follow WP-XXX-CCC_1.png or WP-XXX-CCC_2.png
// where CCC is exactly 3 characters (color code)
// NO extra parts allowed (no size codes, etc.)
function validateColorCode(fileName: string): { valid: boolean; colorCode: string; reason?: string } {
  if (!fileName) return { valid: false, colorCode: "", reason: "No filename provided" };

  // Remove file extension
  const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, "");

  // Remove image type suffix from the end (_1, _2)
  let baseName = fileNameWithoutExt;
  const typeSuffixes = ['_1', '_2'];

  let foundSuffix = '';
  for (const suffix of typeSuffixes) {
    if (baseName.endsWith(suffix)) {
      baseName = baseName.slice(0, -suffix.length);
      foundSuffix = suffix;
      break;
    }
  }

  // If no valid suffix found for image file
  if (!foundSuffix && (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg'))) {
    return {
      valid: false,
      colorCode: "",
      reason: "Image filename must end with _1 or _2 (e.g., WP-SCALLOPS-DUS_1.png)"
    };
  }

  // Split by "-" and validate structure
  const parts = baseName.split("-");

  // Must have exactly 3 parts: WP, product, color
  if (parts.length !== 3) {
    return {
      valid: false,
      colorCode: "",
      reason: `Filename must have exactly 3 parts (WP-PRODUCT-COLOR), got ${parts.length} parts`
    };
  }

  const colorCode = parts[2]; // 3rd part is the color code (index 2)

  if (colorCode.length !== 3) {
    return {
      valid: false,
      colorCode,
      reason: `Color code "${colorCode}" has ${colorCode.length} characters (must be exactly 3)`
    };
  }

  return { valid: true, colorCode };
}

// Helper function to match file with SKU
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

  if (skuTarget === "exact-sku") {
    // Exact match with SKU - check if filename starts with SKU base
    return availableSKUs.find((sku) => {
      if (!sku || !sku.sku) return false;

      // Extract SKU base (without size code)
      const skuBase = extractSKUBase(sku.sku);
      const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, "");

      const isPrefixMatch =
        fileNameClean.startsWith(skuBaseClean) ||
        fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());
      const isExactMatch =
        skuBaseClean === fileNameClean ||
        skuBase.toLowerCase() === fileNameWithoutExt;

      return isPrefixMatch || isExactMatch;
    });
  } else if (skuTarget === "contains-sku") {
    // Enhanced contains match with SKU base
    const potentialMatches = availableSKUs.filter((sku) => {
      if (!sku || !sku.sku) return false;

      // Extract SKU base (without size code)
      const skuBase = extractSKUBase(sku.sku);
      const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, "");

      const isPrefixMatch =
        fileNameClean.startsWith(skuBaseClean) ||
        fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());
      const isContainsMatch =
        fileNameWithoutExt.includes(skuBase.toLowerCase()) ||
        fileNameClean.includes(skuBaseClean);

      return isPrefixMatch || isContainsMatch;
    });

    if (potentialMatches.length === 0) {
      return null;
    }

    if (potentialMatches.length === 1) {
      return potentialMatches[0];
    }

    // Smart matching for multiple potential matches
    const specificMatches = potentialMatches
      .map((sku) => {
        if (!sku || !sku.sku)
          return {
            sku: null,
            score: 0,
            isPrefixMatch: false,
            isExactMatch: false,
          };

        // Extract SKU base (without size code)
        const skuBase = extractSKUBase(sku.sku);
        const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, "");

        const isPrefixMatch =
          fileNameClean.startsWith(skuBaseClean) ||
          fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());
        const isExactMatch = fileNameClean === skuBaseClean;

        let score = 0;
        if (isPrefixMatch) {
          score = (fileNameClean.length + skuBaseClean.length) * 3;
        } else if (isExactMatch) {
          score = (fileNameClean.length + skuBaseClean.length) * 2;
        } else {
          score = fileNameClean.length + skuBaseClean.length;
        }

        return { sku, score, isPrefixMatch, isExactMatch };
      })
      .filter((match) => match.sku !== null);

    specificMatches.sort((a, b) => b.score - a.score);
    return specificMatches[0]?.sku || potentialMatches[0];
  }

  return null;
}

// Helper function to normalize color name from SKU to display format
function normalizeColorName(colorFromSku: string): string {
  if (!colorFromSku) return "";

  // Convert underscores to spaces and capitalize each word
  return colorFromSku
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Helper function to detect image type from filename
// New naming convention: _1. = room, _2. = hover
function detectImageType(fileName: string): "room" | "hover" | null {
  // Add null check
  if (!fileName) {
    return null;
  }

  const lowerFileName = fileName.toLowerCase();

  // Check for _1. pattern (room image)
  // Example: WP-SCALLOPS-SKY_1.jpg -> room
  if (lowerFileName.includes("_1.")) {
    return "room";
  }

  // Check for _2. pattern (hover image)
  // Example: WP-SCALLOPS-SKY_2.jpg -> hover
  if (lowerFileName.includes("_2.")) {
    return "hover";
  }

  return null;
}

// Helper function to get CDN URL from GID using reference query with improved polling
async function getCdnUrlFromGid(
  admin: any,
  gid: string,
  requestId: string,
): Promise<string> {
  try {
    console.log(`[${requestId}] Querying CDN URL for GID: ${gid}`);

    const referenceQuery = `
      query node($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            status
            image {
              originalSrc
              url
              width
              height
            }
            preview {
              image {
                originalSrc
                url
              }
            }
          }
        }
      }
    `;

    // Poll for CDN URL with multiple retries
    const maxRetries = 5;
    const waitTime = 3000; // 3 seconds between retries

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(
        `[${requestId}] CDN URL polling attempt ${attempt}/${maxRetries} for GID: ${gid}`,
      );

      // Wait before querying (except first attempt)
      if (attempt > 1) {
        console.log(`[${requestId}] Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const response = await admin.graphql(referenceQuery, {
        variables: { id: gid },
      });

      const data = await response.json();
      const node = data?.data?.node;

      console.log(`[${requestId}] Polling attempt ${attempt} result for GID ${gid}:`, {
        hasNode: !!node,
        status: node?.status,
        hasImage: !!node?.image,
        hasOriginalSrc: !!node?.image?.originalSrc,
        hasUrl: !!node?.image?.url,
        hasPreview: !!node?.preview,
        hasPreviewImage: !!node?.preview?.image,
        originalSrc: node?.image?.originalSrc,
        url: node?.image?.url,
        previewOriginalSrc: node?.preview?.image?.originalSrc,
        previewUrl: node?.preview?.image?.url,
      });

      // Try to get CDN URL from various sources
      if (node?.image?.originalSrc && node.image.originalSrc.startsWith("https://")) {
        console.log(
          `[${requestId}] ✓ Found CDN URL (originalSrc) on attempt ${attempt}: ${node.image.originalSrc}`,
        );
        return node.image.originalSrc;
      } else if (node?.image?.url && node.image.url.startsWith("https://")) {
        console.log(`[${requestId}] ✓ Found CDN URL (url) on attempt ${attempt}: ${node.image.url}`);
        return node.image.url;
      } else if (node?.preview?.image?.originalSrc && node.preview.image.originalSrc.startsWith("https://")) {
        console.log(
          `[${requestId}] ✓ Found CDN URL (preview originalSrc) on attempt ${attempt}: ${node.preview.image.originalSrc}`,
        );
        return node.preview.image.originalSrc;
      } else if (node?.preview?.image?.url && node.preview.image.url.startsWith("https://")) {
        console.log(
          `[${requestId}] ✓ Found CDN URL (preview url) on attempt ${attempt}: ${node.preview.image.url}`,
        );
        return node.preview.image.url;
      } else if (node?.status === "FAILED") {
        console.warn(
          `[${requestId}] ✗ File processing failed for GID: ${gid}`,
        );
        break; // Stop retrying if processing failed
      } else if (node?.status === "PROCESSING" && attempt < maxRetries) {
        console.log(
          `[${requestId}] File still processing, will retry in ${waitTime}ms...`,
        );
        continue; // Try again
      } else if (attempt >= maxRetries) {
        console.warn(
          `[${requestId}] ✗ Max retries reached without CDN URL for GID: ${gid}`,
        );
        break; // Stop retrying
      }
    }

    // If we get here, no CDN URL was found after all retries
    console.warn(
      `[${requestId}] No CDN URL found for GID: ${gid} after ${maxRetries} attempts, using GID as fallback`,
    );
    return gid; // Fallback to GID
  } catch (error) {
    console.warn(`[${requestId}] Failed to get CDN URL for GID ${gid}:`, error);
    return gid; // Fallback to GID
  }
}

// Helper function to update product metafield
async function updateProductMetafield(
  admin: any,
  productId: string,
  color: string,
  imageUrl: string,
  imageType: "room" | "hover",
  requestId: string,
): Promise<boolean> {
  try {
    // Add null checks
    if (
      !admin ||
      !productId ||
      !color ||
      !imageUrl ||
      !imageType ||
      !requestId
    ) {
      console.error(
        `[${requestId || "UNKNOWN"}] Missing required parameters for metafield update`,
      );
      return false;
    }

    // Normalize color name (e.g., "DUSTY_ROSE" -> "Dusty Rose")
    const normalizedColor = normalizeColorName(color);

    console.log(
      `[${requestId}] Updating metafield: productId=${productId}, color=${color} -> ${normalizedColor}, type=${imageType}`,
    );

    // If imageUrl is a GID, get the actual CDN URL first
    let finalImageUrl = imageUrl;
    if (imageUrl.startsWith("gid://")) {
      console.log(`[${requestId}] Converting GID to CDN URL: ${imageUrl}`);
      finalImageUrl = await getCdnUrlFromGid(admin, imageUrl, requestId);
    }

    // Try different metafield namespace/key combinations
    const metafieldCombinations = [
      { namespace: "wallpaper", key: "color_images" },
      { namespace: "custom", key: "wallpaper_color_images" },
      { namespace: "my_fields", key: "color_images" },
    ];

    let metafieldData = null;
    let usedNamespace = metafieldCombinations[0];

    // Try to find existing metafield
    for (const combo of metafieldCombinations) {
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

      const response = await admin.graphql(getMetafieldQuery, {
        variables: {
          productId,
          namespace: combo.namespace,
          key: combo.key,
        },
      });

      const data = await response.json();
      if (data?.data?.product?.metafield) {
        metafieldData = data.data.product.metafield;
        usedNamespace = combo;
        console.log(
          `[${requestId}] Found existing metafield with namespace: ${combo.namespace}, key: ${combo.key}`,
        );
        break;
      }
    }

    let currentMetafieldValue: any[] = [];
    if (metafieldData && metafieldData.value) {
      try {
        currentMetafieldValue = JSON.parse(metafieldData.value);
        console.log(
          `[${requestId}] Loaded existing metafield with ${currentMetafieldValue.length} color entries`,
        );
      } catch (error) {
        console.warn(
          `[${requestId}] Failed to parse existing metafield, starting fresh:`,
          error,
        );
        currentMetafieldValue = [];
      }
    }

    // Find or create color entry (case-insensitive comparison)
    let colorEntry = currentMetafieldValue.find(
      (entry: any) =>
        entry.color &&
        entry.color.toLowerCase() === normalizedColor.toLowerCase(),
    );

    if (!colorEntry) {
      colorEntry = {
        color: normalizedColor,
        images: [],
      };
      currentMetafieldValue.push(colorEntry);
      console.log(
        `[${requestId}] Created new color entry for: ${normalizedColor}`,
      );
    }

    // Update or add image with CDN URL
    const imageIndex = colorEntry.images.findIndex(
      (img: any) => img.type === imageType,
    );
    const newImage = {
      type: imageType,
      url: finalImageUrl, // Store the actual CDN URL
    };

    if (imageIndex >= 0) {
      colorEntry.images[imageIndex] = newImage;
      console.log(
        `[${requestId}] Updated existing ${imageType} image for color: ${normalizedColor}`,
      );
    } else {
      colorEntry.images.push(newImage);
      console.log(
        `[${requestId}] Added new ${imageType} image for color: ${normalizedColor}`,
      );
    }

    // Update metafield using metafieldsSet mutation with json type
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

    // Store with json type since we're storing actual CDN URLs
    const updateResponse = await admin.graphql(updateMetafieldQuery, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: usedNamespace.namespace,
            key: usedNamespace.key,
            type: "json",
            value: JSON.stringify(currentMetafieldValue),
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

    console.log(
      `[${requestId}] SUCCESS: Metafield updated for product ${productId}, color: ${normalizedColor}, type: ${imageType}`,
    );
    console.log(`[${requestId}] Original GID: ${imageUrl}`);
    console.log(`[${requestId}] Final CDN URL: ${finalImageUrl}`);
    console.log(
      `[${requestId}] Updated metafield value preview:`,
      JSON.stringify(currentMetafieldValue, null, 2),
    );
    return true;
  } catch (error) {
    console.error(`[${requestId}] ERROR: Metafield update failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
}
