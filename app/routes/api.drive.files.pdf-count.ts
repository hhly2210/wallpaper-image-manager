import { google } from "googleapis";
import { getRateLimiterStatus } from "../lib/rateLimiter";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
        method: request.method,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(
    `[${requestId}] 🚀 Rate-limited API: PDF files count request started`,
  );

  try {
    const { accessToken, folderId } = await request.json();

    console.log(`[${requestId}] Request data:`, {
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0,
      folderId: folderId || "root",
    });

    if (!accessToken) {
      console.log(`[${requestId}] ERROR: Access token missing`);
      return new Response(
        JSON.stringify({
          error: "Access token is required",
          requestId,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Get current rate limiter status for monitoring
    const rateLimitStatus = getRateLimiterStatus();
    console.log(`[${requestId}] 📊 Rate Limiter Status:`, rateLimitStatus);

    console.log(
      `[${requestId}] ⏳ Executing rate-limited PDF files count request...`,
    );
    const startTime = Date.now();

    // Initialize Google Drive service directly for PDF files
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    // Query for PDF files
    const query = folderId
      ? `'${folderId}' in parents and (mimeType contains 'pdf') and trashed=false`
      : `(mimeType contains 'pdf') and trashed=false`;

    console.log(
      `[${requestId}] 🔍 PDF query: ${query}`,
    );

    const listResponse = await drive.files.list({
      q: query,
      fields: "files(id, name, mimeType, size)",
      pageSize: 1000,
    });

    const files = listResponse.data.files || [];
    const count = files.length;

    const duration = Date.now() - startTime;

    console.log(
      `[${requestId}] ✅ SUCCESS: Found ${count} PDF files in ${duration}ms`,
      {
        fileCount: count,
        duration,
        query,
        files: files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType }))
      },
    );

    // Get updated rate limiter status after the call
    const updatedRateLimitStatus = getRateLimiterStatus();

    return new Response(
      JSON.stringify({
        success: true,
        count: count,
        requestId,
        timestamp: new Date().toISOString(),
        folderId: folderId || "root",
        rateLimiting: {
          enabled: false,
          implementation: "Direct API",
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error(
      `[${requestId}] ERROR: Drive API PDF count call failed:`,
      {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
        code: (error as any)?.code,
        requestId,
        timestamp: new Date().toISOString(),
      },
    );

    // Provide more detailed error information
    let errorMessage = "Failed to count PDF files";
    let statusCode = 500;

    if (error instanceof Error) {
      if (error.message.includes("invalid_grant")) {
        errorMessage = "Access token expired or invalid";
        statusCode = 401;
      } else if (error.message.includes("forbidden")) {
        errorMessage = "Access denied - insufficient permissions";
        statusCode = 403;
      } else if (error.message.includes("notFound")) {
        errorMessage = "Folder not found";
        statusCode = 404;
      } else if (
        error.message.includes("quotaExceeded") ||
        error.message.includes("rateLimit") ||
        error.message.includes("too many requests")
      ) {
        errorMessage =
          "Google Drive API rate limit exceeded";
        statusCode = 429;
      } else if (error.message.includes("timeout")) {
        errorMessage = "Request timeout - please try again";
        statusCode = 408;
      }
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        requestId,
        timestamp: new Date().toISOString(),
        count: 0,
        details:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
                code: (error as any)?.code,
              }
            : error,
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}