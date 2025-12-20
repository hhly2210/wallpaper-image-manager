import { googleDriveService } from "../services/googleDriveService";
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
  console.log(`[${requestId}] 🚀 Rate-limited API: Files request started`);

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

    console.log(`[${requestId}] ⏳ Executing rate-limited files request...`);
    const startTime = Date.now();

    // Use rate-limited Google Drive service
    const files = await googleDriveService.listFiles(accessToken, folderId);

    const duration = Date.now() - startTime;

    console.log(
      `[${requestId}] ✅ Rate-limited SUCCESS: Found ${files.length} files in ${duration}ms`,
      {
        fileCount: files.length,
        duration,
        rateLimited: true,
        service: "googleDriveService",
      },
    );

    // Log sample file info (first 3 files)
    if (files.length > 0) {
      console.log(
        `[${requestId}] Sample files:`,
        files.slice(0, 3).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
        })),
      );
    }

    // Get updated rate limiter status after the call
    const updatedRateLimitStatus = getRateLimiterStatus();

    return new Response(
      JSON.stringify({
        success: true,
        data: files,
        requestId,
        timestamp: new Date().toISOString(),
        totalFiles: files.length,
        rateLimiting: {
          enabled: true,
          implementation: "TanStack Pacer",
          status: updatedRateLimitStatus,
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Rate-Limit-Limit": "10000",
          "X-Rate-Limit-Window": "60000",
          "X-Rate-Limit-Remaining":
            updatedRateLimitStatus.remainingInWindow.toString(),
          "X-Rate-Limit-Max-RPS": "200", // Maximum requests per second
        },
      },
    );
  } catch (error) {
    console.error(`[${requestId}] ERROR: Rate-limited Drive API call failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      code: (error as any)?.code,
      requestId,
      timestamp: new Date().toISOString(),
    });

    // Provide more detailed error information with rate limiting context
    let errorMessage = "Failed to list files";
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
          "Google Drive API rate limit exceeded - request has been queued";
        statusCode = 429;
      } else if (error.message.includes("timeout")) {
        errorMessage = "Request timeout - please try again";
        statusCode = 408;
      }
    }

    // Get current rate limiter status for error response
    const rateLimitStatus = getRateLimiterStatus();

    return new Response(
      JSON.stringify({
        error: errorMessage,
        requestId,
        timestamp: new Date().toISOString(),
        rateLimiting: {
          enabled: true,
          implementation: "TanStack Pacer",
          status: rateLimitStatus,
          retryAfter: rateLimitStatus.msUntilNextWindow,
        },
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
          "X-Rate-Limit-Limit": "10000",
          "X-Rate-Limit-Window": "60000",
          "X-Rate-Limit-Remaining":
            rateLimitStatus.remainingInWindow.toString(),
          "X-Rate-Limit-Max-RPS": "200", // Maximum requests per second
          ...(statusCode === 429 && {
            "Retry-After": Math.ceil(
              rateLimitStatus.msUntilNextWindow / 1000,
            ).toString(),
          }),
        },
      },
    );
  }
}
