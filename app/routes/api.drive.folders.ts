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
  console.log(`[${requestId}] 🚀 Rate-limited API: Folders request started`);

  try {
    const { accessToken } = await request.json();

    console.log(`[${requestId}] Request data:`, {
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0,
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

    console.log(`[${requestId}] ⏳ Executing rate-limited folders request...`);
    const startTime = Date.now();

    // Use rate-limited Google Drive service
    const folders = await googleDriveService.listFolders(accessToken);

    const duration = Date.now() - startTime;

    console.log(
      `[${requestId}] ✅ Rate-limited SUCCESS: Found ${folders.length} folders in ${duration}ms`,
      {
        folderCount: folders.length,
        duration,
        rateLimited: true,
        service: "googleDriveService",
      },
    );

    // Log folder processing info
    console.log(`[${requestId}] Processed ${folders.length} folders`, {
      ownedByMe: folders.filter((f) => f.isOwnedByMe).length,
      shared: folders.filter((f) => f.isShared).length,
    });

    // Get updated rate limiter status after the call
    const updatedRateLimitStatus = getRateLimiterStatus();

    return new Response(
      JSON.stringify({
        success: true,
        data: folders,
        requestId,
        timestamp: new Date().toISOString(),
        totalFolders: folders.length,
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
    let errorMessage = "Failed to list folders";
    let statusCode = 500;

    if (error instanceof Error) {
      if (error.message.includes("invalid_grant")) {
        errorMessage = "Access token expired or invalid";
        statusCode = 401;
      } else if (error.message.includes("forbidden")) {
        errorMessage = "Access denied - insufficient permissions";
        statusCode = 403;
      } else if (error.message.includes("notFound")) {
        errorMessage = "Root folder not found";
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
