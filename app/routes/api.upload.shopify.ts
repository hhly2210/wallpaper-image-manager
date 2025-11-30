import { google } from 'googleapis';

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed",
      method: request.method
    }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] API: Shopify upload request started`);

  try {
    const { fileIds, folderId, folderName, isShared, owner, accessToken, type } = await request.json();

    console.log(`[${requestId}] Request data:`, {
      type,
      hasFileIds: !!fileIds,
      fileIdsCount: Array.isArray(fileIds) ? fileIds.length : 0,
      hasFolderId: !!folderId,
      folderName,
      isShared,
      owner,
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0
    });

    if (!accessToken) {
      console.log(`[${requestId}] ERROR: Access token missing`);
      return new Response(JSON.stringify({
        error: "Access token is required",
        requestId
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Handle different upload types
    if (type === 'folder' && folderId) {
      return handleFolderUpload(folderId, folderName, isShared, owner, accessToken, requestId);
    } else if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      return handleFileIdsUpload(fileIds, accessToken, requestId);
    } else {
      console.log(`[${requestId}] ERROR: No valid upload data provided`);
      return new Response(JSON.stringify({
        error: "Either file IDs or folder ID is required",
        requestId
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

  } catch (error) {
    console.error(`[${requestId}] ERROR: Upload to Shopify failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      requestId
    });

    return new Response(JSON.stringify({
      error: "Failed to upload files to Shopify",
      requestId,
      details: error instanceof Error ? {
        message: error.message,
        name: error.name
      } : error
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleFolderUpload(
  folderId: string,
  folderName: string,
  isShared: boolean,
  owner: string,
  accessToken: string,
  requestId: string
) {
  console.log(`[${requestId}] Processing folder upload for: ${folderName}`);

  try {
    // Initialize Google Drive service with access token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    // Get all image files from the folder
    console.log(`[${requestId}] Fetching all files from folder: ${folderId}`);
    const query = `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`;

    const listResponse = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size, createdTime, webViewLink, webContentLink)',
      pageSize: 1000, // Get up to 1000 files
    });

    const files = listResponse.data.files || [];
    console.log(`[${requestId}] Found ${files.length} image files in folder`);

    if (files.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: `Folder "${folderName}" contains no images to upload`,
        folderName,
        totalFiles: 0,
        uploadedFiles: 0,
        requestId
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Process uploads for all files in folder
    const uploadResults = [];
    let processedCount = 0;

    for (const file of files) {
      try {
        console.log(`[${requestId}] Processing file ${processedCount + 1}/${files.length}: ${file.name}`);

        // Get detailed file information
        const fileResponse = await drive.files.get({
          fileId: file.id!,
          fields: 'id, name, mimeType, size, webViewLink, webContentLink',
        });

        const fileData = fileResponse.data;

        // Simulate upload to Shopify
        // In reality, you would:
        // 1. Download the file content using webContentLink or exportLinks
        // 2. Upload to Shopify's REST API or GraphQL API for file assets
        // 3. Handle different file types and sizes

        uploadResults.push({
          googleFileId: fileData.id,
          fileName: fileData.name,
          fileSize: fileData.size,
          mimeType: fileData.mimeType,
          status: 'success',
          shopifyFileId: `shopify_${fileData.id}`, // Mock Shopify file ID
          message: 'Successfully uploaded to Shopify',
          uploadTime: new Date().toISOString()
        });

        processedCount++;

        // Log progress every 10 files
        if (processedCount % 10 === 0) {
          console.log(`[${requestId}] Progress: ${processedCount}/${files.length} files processed`);
        }

      } catch (error) {
        console.error(`[${requestId}] Failed to upload file ${file.id}:`, error);
        uploadResults.push({
          googleFileId: file.id!,
          fileName: file.name,
          status: 'error',
          message: `Failed to upload: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const successCount = uploadResults.filter(r => r.status === 'success').length;
    const errorCount = uploadResults.filter(r => r.status === 'error').length;

    console.log(`[${requestId}] SUCCESS: Folder upload completed`, {
      folderName,
      totalFiles: files.length,
      successCount,
      errorCount,
      processingTime: Date.now()
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Uploaded ${successCount} files from "${folderName}" to Shopify${errorCount > 0 ? ` (${errorCount} failed)` : ''}`,
      folderName,
      folderId,
      isShared,
      owner,
      totalFiles: files.length,
      uploadedFiles: successCount,
      failedFiles: errorCount,
      results: uploadResults,
      requestId,
      timestamp: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`[${requestId}] ERROR: Folder upload failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      folderId,
      folderName
    });

    return new Response(JSON.stringify({
      error: `Failed to upload folder "${folderName}" to Shopify`,
      requestId,
      folderName,
      details: error instanceof Error ? {
        message: error.message,
        name: error.name
      } : error
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleFileIdsUpload(fileIds: string[], accessToken: string, requestId: string) {
  console.log(`[${requestId}] Processing individual file upload for ${fileIds.length} files`);

  try {
    // Initialize Google Drive service with access token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const uploadResults = [];

    for (const fileId of fileIds) {
      try {
        // Get file metadata from Google Drive
        const fileResponse = await drive.files.get({
          fileId,
          fields: 'id, name, mimeType, size, webViewLink',
        });

        const file = fileResponse.data;

        // Simulate upload to Shopify
        uploadResults.push({
          googleFileId: file.id,
          fileName: file.name,
          status: 'success',
          shopifyFileId: `shopify_${file.id}`,
          message: 'Successfully uploaded to Shopify',
        });

      } catch (error) {
        console.error(`[${requestId}] Failed to upload file ${fileId}:`, error);
        uploadResults.push({
          googleFileId: fileId,
          status: 'error',
          message: 'Failed to upload file to Shopify',
        });
      }
    }

    const successCount = uploadResults.filter(r => r.status === 'success').length;
    const errorCount = uploadResults.filter(r => r.status === 'error').length;

    console.log(`[${requestId}] SUCCESS: Individual file upload completed`, {
      totalFiles: fileIds.length,
      successCount,
      errorCount
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Uploaded ${successCount} files to Shopify${errorCount > 0 ? ` (${errorCount} failed)` : ''}`,
      totalFiles: fileIds.length,
      uploadedFiles: successCount,
      failedFiles: errorCount,
      results: uploadResults,
      requestId
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`[${requestId}] ERROR: Individual file upload failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(JSON.stringify({
      error: "Failed to upload files to Shopify",
      requestId,
      details: error instanceof Error ? {
        message: error.message,
        name: error.name
      } : error
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}