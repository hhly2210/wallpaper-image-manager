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
  console.log(`[${requestId}] API: Folders request started`);

  try {
    const { accessToken } = await request.json();

    console.log(`[${requestId}] Request data:`, {
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0
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

    const query = "mimeType = 'application/vnd.google-apps.folder' and trashed=false and ('root' in parents or sharedWithMe = true)";
    console.log(`[${requestId}] Query:`, query);

    console.log(`[${requestId}] Executing drive.files.list for folders...`);
    const startTime = Date.now();

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, createdTime, shared, permissions, owners)',
      pageSize: 100,
    });

    const duration = Date.now() - startTime;
    const folders = response.data.files || [];

    console.log(`[${requestId}] SUCCESS: Found ${folders.length} folders in ${duration}ms`, {
      folderCount: folders.length,
      duration,
      query,
      responseStatus: response.status,
      responseHeaders: response.headers
    });

    // Process folders to add shared status and owner information
    console.log(`[${requestId}] Processing folder data...`);
    const processedFolders = folders.map(folder => {
      const isShared = folder.shared || (folder.permissions && folder.permissions.length > 1);
      const owner = folder.owners && folder.owners.length > 0 ? folder.owners[0].displayName : 'Me';
      const isOwnedByMe = owner === 'Me';

      return {
        id: folder.id,
        name: folder.name,
        createdTime: folder.createdTime,
        isShared,
        owner,
        isOwnedByMe
      };
    });

    // Sort folders: owned by me first, then shared with me
    processedFolders.sort((a, b) => {
      if (a.isOwnedByMe && !b.isOwnedByMe) return -1;
      if (!a.isOwnedByMe && b.isOwnedByMe) return 1;
      return a.name.localeCompare(b.name);
    });

    console.log(`[${requestId}] Processed ${processedFolders.length} folders`, {
      ownedByMe: processedFolders.filter(f => f.isOwnedByMe).length,
      shared: processedFolders.filter(f => f.isShared).length
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: processedFolders,
        requestId,
        timestamp: new Date().toISOString(),
        query,
        totalFolders: processedFolders.length
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
    let errorMessage = "Failed to list folders";
    let statusCode = 500;

    if (error instanceof Error) {
      if (error.message.includes('invalid_grant')) {
        errorMessage = "Access token expired or invalid";
        statusCode = 401;
      } else if (error.message.includes('forbidden')) {
        errorMessage = "Access denied - insufficient permissions";
        statusCode = 403;
      } else if (error.message.includes('notFound')) {
        errorMessage = "Root folder not found";
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