import { google } from 'googleapis';

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed",
      method: request.method,
      timestamp: new Date().toISOString()
    }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] API: Files request started`);

  try {
    const { accessToken, folderId } = await request.json();

    console.log(`[${requestId}] Request data:`, {
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0,
      folderId: folderId || 'root'
    });

    if (!accessToken) {
      console.log(`[${requestId}] ERROR: Access token missing`);
      return new Response(JSON.stringify({
        error: "Access token is required",
        requestId,
        timestamp: new Date().toISOString()
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Initialize Google Drive service with access token
    console.log(`[${requestId}] Initializing Google Drive service...`);
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const query = folderId
      ? `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`
      : `(mimeType contains 'image/') and trashed=false`;

    console.log(`[${requestId}] Query:`, query);

    console.log(`[${requestId}] Executing drive.files.list...`);
    const startTime = Date.now();

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
      pageSize: 100,
    });

    const duration = Date.now() - startTime;
    const files = response.data.files || [];

    console.log(`[${requestId}] SUCCESS: Found ${files.length} files in ${duration}ms`, {
      fileCount: files.length,
      duration,
      query,
      responseStatus: response.status,
      responseHeaders: response.headers
    });

    // Log sample file info (first 3 files)
    if (files.length > 0) {
      console.log(`[${requestId}] Sample files:`, files.slice(0, 3).map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size
      })));
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: files,
        requestId,
        timestamp: new Date().toISOString(),
        query,
        totalFiles: files.length
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error(`[${requestId}] ERROR: Drive API call failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      code: (error as any)?.code,
      requestId,
      timestamp: new Date().toISOString()
    });

    // Provide more detailed error information
    let errorMessage = "Failed to list files";
    let statusCode = 500;

    if (error instanceof Error) {
      if (error.message.includes('invalid_grant')) {
        errorMessage = "Access token expired or invalid";
        statusCode = 401;
      } else if (error.message.includes('forbidden')) {
        errorMessage = "Access denied - insufficient permissions";
        statusCode = 403;
      } else if (error.message.includes('notFound')) {
        errorMessage = "Folder not found";
        statusCode = 404;
      } else if (error.message.includes('quotaExceeded')) {
        errorMessage = "Google Drive quota exceeded";
        statusCode = 429;
      }
    }

    return new Response(JSON.stringify({
      error: errorMessage,
      requestId,
      timestamp: new Date().toISOString(),
      details: error instanceof Error ? {
        message: error.message,
        name: error.name,
        code: (error as any)?.code
      } : error
    }), {
      status: statusCode,
      headers: { "Content-Type": "application/json" }
    });
  }
}