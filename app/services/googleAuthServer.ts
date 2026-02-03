import { google } from "googleapis";

export interface GoogleAuthConfig {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Server-side Google Auth helper with token refresh capability
 */
export class GoogleAuthServer {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = process.env.VITE_GOOGLE_CLIENT_ID || "";
    this.clientSecret = process.env.VITE_GOOGLE_CLIENT_SECRET || "";

    if (!this.clientId || !this.clientSecret) {
      console.warn("Google OAuth credentials not configured in environment variables");
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiryDate?: number } | null> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Google OAuth credentials not configured");
    }

    try {
      const auth = new google.auth.OAuth2({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      });

      const { tokens } = await auth.refreshToken(refreshToken);

      if (!tokens.access_token) {
        throw new Error("No access token returned from refresh");
      }

      return {
        accessToken: tokens.access_token,
        expiryDate: tokens.expiry_date,
      };
    } catch (error) {
      console.error("Failed to refresh access token:", error);
      throw new Error(`Failed to refresh access token: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Execute an operation with automatic token refresh on 401 errors
   */
  async executeWithAutoRefresh<T>(
    config: GoogleAuthConfig,
    operation: (accessToken: string) => Promise<T>,
    requestId: string
  ): Promise<T> {
    let accessToken = config.accessToken;
    let attempt = 0;
    const maxAttempts = 2; // Initial attempt + 1 retry after refresh

    while (attempt < maxAttempts) {
      attempt++;

      try {
        // Attempt the operation with current access token
        return await operation(accessToken);
      } catch (error: any) {
        const isAuthError =
          error?.code === 401 ||
          error?.status === 401 ||
          error?.response?.status === 401 ||
          error?.message?.includes("invalid authentication credentials") ||
          error?.message?.includes("UNAUTHENTICATED");

        // If it's a 401 error and we have a refresh token and haven't retried yet
        if (isAuthError && config.refreshToken && attempt < maxAttempts) {
          console.log(`[${requestId}] Access token expired, attempting to refresh...`);

          try {
            const refreshed = await this.refreshAccessToken(config.refreshToken);
            accessToken = refreshed.accessToken;
            console.log(`[${requestId}] Successfully refreshed access token, retrying operation...`);

            // Update config for potential next iteration
            config.accessToken = accessToken;

            // Continue to retry with new token
            continue;
          } catch (refreshError) {
            console.error(`[${requestId}] Failed to refresh token:`, refreshError);
            // Throw the original error with additional context
            throw new Error(
              `Authentication failed and token refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
        }

        // If not a 401 error, no refresh token, or max attempts reached, throw the error
        throw error;
      }
    }

    throw new Error("Max retry attempts reached");
  }

  /**
   * Create OAuth2 client with access token
   */
  createOAuth2Client(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return auth;
  }

  /**
   * Create Drive client with OAuth2 client
   */
  createDriveClient(accessToken: string) {
    const auth = this.createOAuth2Client(accessToken);
    return google.drive({ version: "v3", auth });
  }
}

// Export singleton instance
export const googleAuthServer = new GoogleAuthServer();
