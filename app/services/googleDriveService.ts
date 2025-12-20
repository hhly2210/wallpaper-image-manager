import { google } from "googleapis";
import { AsyncRateLimiter } from "@tanstack/pacer";

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  webContentLink?: string;
}

export interface GoogleDriveFolder {
  id: string;
  name: string;
  createdTime: string;
  isShared: boolean;
  owner: string;
  isOwnedByMe: boolean;
}

export interface GoogleDriveServiceConfig {
  maxRetries?: number;
  timeout?: number;
}

/**
 * Rate-limited Google Drive Service
 *
 * This service handles all Google Drive API operations with built-in rate limiting
 * using TanStack Pacer to respect API quotas (200 requests/second).
 */
export class GoogleDriveService {
  private static instance: GoogleDriveService;
  private rateLimitedListFiles: AsyncRateLimiter<any[]>;
  private rateLimitedListFolders: AsyncRateLimiter<any[]>;
  private rateLimitedCountFiles: AsyncRateLimiter<number>;
  private maxRetries: number;
  private timeout: number;

  constructor(config: GoogleDriveServiceConfig = {}) {
    this.maxRetries = config.maxRetries || 3;
    this.timeout = config.timeout || 30000;

    // Create rate-limited functions for each operation
    this.rateLimitedListFiles = new AsyncRateLimiter(
      this.listFilesInternal.bind(this),
      {
        limit: 5, // 12,000 requests per 60 seconds (200 requests/second)
        window: 60000, // 60 seconds window
        windowType: "sliding",
        onError: (error, limiter) => {
          console.error("❌ Files rate-limited function failed:", error);
        },
      },
    );

    this.rateLimitedListFolders = new AsyncRateLimiter(
      this.listFoldersInternal.bind(this),
      {
        limit: 5, // 12,000 requests per 60 seconds (200 requests/second)
        window: 60000, // 60 seconds window
        windowType: "sliding",
        onError: (error, limiter) => {
          console.error("❌ Folders rate-limited function failed:", error);
        },
      },
    );

    this.rateLimitedCountFiles = new AsyncRateLimiter(
      this.countFilesInternal.bind(this),
      {
        limit: 5, // 12,000 requests per 60 seconds (200 requests/second)
        window: 60000, // 60 seconds window
        windowType: "sliding",
        onError: (error, limiter) => {
          console.error("❌ Count files rate-limited function failed:", error);
        },
      },
    );
  }

  static getInstance(config?: GoogleDriveServiceConfig): GoogleDriveService {
    if (!GoogleDriveService.instance) {
      GoogleDriveService.instance = new GoogleDriveService(config);
    }
    return GoogleDriveService.instance;
  }

  /**
   * Initialize Google Drive API with access token
   */
  private initializeDrive(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: "v3", auth });
  }

  /**
   * List image files in a folder with rate limiting
   */
  async listFiles(
    accessToken: string,
    folderId?: string,
  ): Promise<GoogleDriveFile[]> {
    return this.executeWithRetry(
      () =>
        this.executeWithAutoRetry(() =>
          this.rateLimitedListFiles.maybeExecute(accessToken, folderId),
        ),
      "listFiles",
      { accessToken, folderId },
    );
  }

  /**
   * List folders with rate limiting
   */
  async listFolders(accessToken: string): Promise<GoogleDriveFolder[]> {
    return this.executeWithRetry(
      () =>
        this.executeWithAutoRetry(() =>
          this.rateLimitedListFolders.maybeExecute(accessToken),
        ),
      "listFolders",
      { accessToken },
    );
  }

  /**
   * Count image files in a folder with rate limiting
   */
  async countFiles(accessToken: string, folderId?: string): Promise<number> {
    return this.executeWithRetry(
      () =>
        this.executeWithAutoRetry(() =>
          this.rateLimitedCountFiles.maybeExecute(accessToken, folderId),
        ),
      "countFiles",
      { accessToken, folderId },
    );
  }

  /**
   * Internal implementation of file listing (rate-limited)
   */
  private async listFilesInternal(
    accessToken: string,
    folderId?: string,
  ): Promise<GoogleDriveFile[]> {
    const requestId = Math.random().toString(36).substr(2, 9);
    console.log(`[${requestId}] Rate-limited files request:`, {
      folderId: folderId || "root",
    });

    const drive = this.initializeDrive(accessToken);
    const query = folderId
      ? `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`
      : `(mimeType contains 'image/') and trashed=false`;

    console.log(`[${requestId}] Executing rate-limited drive.files.list...`);
    const startTime = Date.now();

    const response = await drive.files.list({
      q: query,
      fields:
        "files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)",
      pageSize: 100,
    });

    const duration = Date.now() - startTime;
    const files = response.data.files || [];

    console.log(
      `[${requestId}] Rate-limited SUCCESS: Found ${files.length} files in ${duration}ms`,
    );

    return files.map((file) => ({
      id: file.id!,
      name: file.name!,
      mimeType: file.mimeType!,
      size: file.size,
      createdTime: file.createdTime!,
      modifiedTime: file.modifiedTime!,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink,
    }));
  }

  /**
   * Internal implementation of folder listing (rate-limited)
   */
  private async listFoldersInternal(
    accessToken: string,
  ): Promise<GoogleDriveFolder[]> {
    const requestId = Math.random().toString(36).substr(2, 9);
    console.log(`[${requestId}] Rate-limited folders request`);

    const drive = this.initializeDrive(accessToken);
    const query =
      "mimeType = 'application/vnd.google-apps.folder' and trashed=false and ('root' in parents or sharedWithMe = true)";

    console.log(
      `[${requestId}] Executing rate-limited drive.files.list for folders...`,
    );
    const startTime = Date.now();

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name, createdTime, shared, permissions, owners)",
      pageSize: 100,
    });

    const duration = Date.now() - startTime;
    const folders = response.data.files || [];

    console.log(
      `[${requestId}] Rate-limited SUCCESS: Found ${folders.length} folders in ${duration}ms`,
    );

    // Process folders to add shared status and owner information
    const processedFolders = folders.map((folder) => {
      const isShared =
        folder.shared || (folder.permissions && folder.permissions.length > 1);
      const owner =
        folder.owners && folder.owners.length > 0
          ? folder.owners[0].displayName
          : "Me";
      const isOwnedByMe = owner === "Me";

      return {
        id: folder.id!,
        name: folder.name!,
        createdTime: folder.createdTime!,
        isShared,
        owner,
        isOwnedByMe,
      };
    });

    // Sort folders: owned by me first, then shared with me
    processedFolders.sort((a, b) => {
      if (a.isOwnedByMe && !b.isOwnedByMe) return -1;
      if (!a.isOwnedByMe && b.isOwnedByMe) return 1;
      return a.name.localeCompare(b.name);
    });

    return processedFolders;
  }

  /**
   * Internal implementation of file counting (rate-limited)
   */
  private async countFilesInternal(
    accessToken: string,
    folderId?: string,
  ): Promise<number> {
    const requestId = Math.random().toString(36).substr(2, 9);
    console.log(`[${requestId}] Rate-limited files count request:`, {
      folderId: folderId || "root",
    });

    const drive = this.initializeDrive(accessToken);
    const query = folderId
      ? `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`
      : `(mimeType contains 'image/') and trashed=false`;

    console.log(
      `[${requestId}] Executing rate-limited drive.files.list for count...`,
    );
    const startTime = Date.now();

    const response = await drive.files.list({
      q: query,
      fields: "files(id)",
      pageSize: 1000,
    });

    const duration = Date.now() - startTime;
    const files = response.data.files || [];

    console.log(
      `[${requestId}] Rate-limited SUCCESS: Found ${files.length} files in ${duration}ms`,
    );

    return files.length;
  }

  /**
   * Execute a function with retry logic and timeout
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    params: any,
    retryCount: number = 0,
  ): Promise<T> {
    try {
      // Add timeout to the operation
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("Operation timeout")),
            this.timeout,
          );
        }),
      ]);

      // Check if maybeExecute returned undefined (rate limited)
      if (result === undefined) {
        throw new Error(
          `Rate limit exceeded for ${operationName} - execution was blocked`,
        );
      }

      return result;
    } catch (error: any) {
      const requestId = Math.random().toString(36).substr(2, 9);
      console.error(
        `[${requestId}] ${operationName} failed (attempt ${retryCount + 1}):`,
        error,
      );

      // Determine if we should retry
      if (this.shouldRetry(error) && retryCount < this.maxRetries) {
        const delay = this.calculateRetryDelay(retryCount);
        console.log(
          `[${requestId}] Retrying ${operationName} in ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.executeWithRetry(
          operation,
          operationName,
          params,
          retryCount + 1,
        );
      }

      // Don't retry anymore, throw the error
      throw error;
    }
  }

  /**
   * Execute a rate-limited operation with automatic waiting when rate limited
   */
  private async executeWithAutoRetry<T>(
    operation: () => Promise<T | undefined>,
    maxAttempts: number = 10,
    maxWaitTime: number = 60000, // Maximum 1 minute wait
  ): Promise<T> {
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        const result = await operation();

        if (result !== undefined) {
          return result; // Success
        }

        // Rate limited - calculate wait time
        const waitTime = Math.min(
          1000 + (attempt - 1) * 1000, // Start at 1s, increase by 1s each attempt
          30000, // Max 30s per wait
          maxWaitTime / (maxAttempts - attempt), // Ensure we don't exceed maxWaitTime
        );

        console.log(
          `⏳ Rate limited (attempt ${attempt}/${maxAttempts}), waiting ${waitTime}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } catch (error) {
        // For actual errors, throw immediately (let executeWithRetry handle it)
        throw error;
      }
    }

    throw new Error(
      `Rate limit exceeded after ${maxAttempts} attempts. Operation timed out.`,
    );
  }

  /**
   * Determine if an error should trigger a retry
   */
  private shouldRetry(error: any): boolean {
    if (error instanceof Error) {
      // Retry on rate limit errors
      if (
        error.message.includes("quotaExceeded") ||
        error.message.includes("rateLimit") ||
        error.message.includes("too many requests")
      ) {
        return true;
      }

      // Retry on temporary network errors
      if (
        error.message.includes("timeout") ||
        error.message.includes("network") ||
        error.message.includes("ECONNRESET")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 10000; // 10 seconds

    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    const jitter = Math.random() * 1000; // Random jitter up to 1 second

    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  /**
   * Get current rate limiting status (useful for debugging)
   */
  getRateLimitStatus() {
    return {
      rateLimiting: "enabled",
      implementation: "TanStack Pacer",
      maxRequestsPerMinute: 3, // Updated to 12,000 per minute
      maxRequestsPerSecond: 200, // Updated to 200 per second
      googleApiQuota: {
        callsPer100Seconds: 20000,
        callsPer60Seconds: 3, // Conservative limit we're using
        actualMaxPerSecond: 200,
      },
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    };
  }
}

/**
 * Export singleton instance for easy usage
 */
export const googleDriveService = GoogleDriveService.getInstance();
