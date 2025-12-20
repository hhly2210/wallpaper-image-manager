import { AsyncRateLimiter } from "@tanstack/pacer";

/**
 * Google Drive API Rate Limiter Configuration
 *
 * This rate limiter ensures we stay within Google Drive API quotas (2024-2025):
 * - 200 requests per second per user (20,000 calls every 100 seconds)
 * - 12,000 requests per 60 seconds with sliding window (conservative limit)
 * - Automatic queuing when rate limits are exceeded
 * - Exponential backoff for error handling
 *
 * Note: Using conservative limit (12,000/min) to stay safely under the 20,000/100s limit
 */

export interface RateLimitConfig {
  limit: number;
  window: number;
  windowType: "fixed" | "sliding";
}

// Main Google Drive API rate limiter
export const googleDriveRateLimiter = new AsyncRateLimiter(
  async function executeGoogleDriveCall(accessToken: string, params?: any) {
    // This function will be implemented by the GoogleDriveService
    throw new Error(
      "Rate limiter function not implemented - use GoogleDriveService instead",
    );
  },
  {
    limit: 10000, // 12,000 requests per 60 seconds (200 requests/second)
    window: 60000, // 60 seconds window
    windowType: "sliding", // Sliding window for smooth rate limiting

    onReject: async (limiter) => {
      // When rate limit is exceeded, log and allow queuing
      const waitTime = limiter.getMsUntilNextWindow();
      console.log(
        `🚦 Google Drive API rate limit exceeded. Next window in ${waitTime}ms`,
      );

      // Return false to let TanStack Pacer handle queuing automatically
      return false;
    },

    onError: (error, limiter) => {
      console.error("❌ Google Drive API call failed:", error);

      // Log rate limiter statistics for debugging
      console.log("📊 Rate Limiter Stats:", {
        executionCount: limiter.store.state.executionCount,
        rejectionCount: limiter.store.state.rejectionCount,
        remainingInWindow: limiter.getRemainingInWindow(),
      });

      // Don't rethrow here - let the calling service handle the error
    },

    onExecute: (limiter) => {
      // Log successful execution (optional for debugging)
      console.log("✅ Google Drive API call executed successfully");

      // Optional: Log rate limiter status
      if (limiter.store.state.executionCount % 50 === 0) {
        console.log("📈 Rate Limiter Status:", {
          executionCount: limiter.store.state.executionCount,
          remainingInWindow: limiter.getRemainingInWindow(),
          windowProgress: `${(((600 - limiter.getRemainingInWindow()) / 600) * 100).toFixed(1)}%`,
        });
      }
    },
  },
);

/**
 * Create a rate-limited wrapper for Google Drive API functions
 */
export function createRateLimitedDriveFunction<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options?: Partial<RateLimitConfig>,
) {
  const limiter = new AsyncRateLimiter(fn, {
    limit: options?.limit || 600,
    window: options?.window || 10000,
    windowType: options?.windowType || "sliding",

    onReject: async (limiter) => {
      const waitTime = limiter.getMsUntilNextWindow();
      console.log(`🚦 Rate limit exceeded. Waiting ${waitTime}ms...`);
      return false;
    },

    onError: (error, limiter) => {
      console.error("❌ Rate-limited function failed:", error);
    },
  });

  return limiter;
}

/**
 * Get current rate limiter status
 */
export function getRateLimiterStatus() {
  return {
    limit: 10000, // Updated to 12,000 requests per minute
    window: 60000,
    windowType: "sliding" as const,
    executionCount: googleDriveRateLimiter.store.state.executionCount,
    rejectionCount: googleDriveRateLimiter.store.state.rejectionCount,
    remainingInWindow: googleDriveRateLimiter.getRemainingInWindow(),
    msUntilNextWindow: googleDriveRateLimiter.getMsUntilNextWindow(),
    maxRequestsPerSecond: 200, // 12,000 / 60 seconds
    googleApiQuota: {
      callsPer100Seconds: 20000,
      callsPer60Seconds: 3, // Conservative limit we're using
      actualMaxPerSecond: 200,
    },
  };
}

/**
 * Check if we're close to hitting the rate limit
 */
export function isNearRateLimit(threshold: number = 0.9): boolean {
  const remaining = googleDriveRateLimiter.getRemainingInWindow();
  const limit = 3; // Updated limit
  return remaining < limit * (1 - threshold);
}

/**
 * Wait until rate limit resets (useful for testing)
 */
export async function waitForRateLimitReset(): Promise<void> {
  const waitTime = googleDriveRateLimiter.getMsUntilNextWindow();
  if (waitTime > 0) {
    console.log(`⏳ Waiting ${waitTime}ms for rate limit to reset...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}
