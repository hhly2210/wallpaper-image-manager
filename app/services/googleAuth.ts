export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiryDate?: number;
}

export class GoogleAuthService {
  private static instance: GoogleAuthService;
  private tokens: GoogleTokens | null = null;

  private constructor() {
    this.loadTokens();
  }

  static getInstance(): GoogleAuthService {
    if (!GoogleAuthService.instance) {
      GoogleAuthService.instance = new GoogleAuthService();
    }
    return GoogleAuthService.instance;
  }

  private loadTokens(): void {
    try {
      const stored = sessionStorage.getItem('googleTokens');
      if (stored) {
        this.tokens = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load Google tokens:', error);
      this.clearTokens();
    }
  }

  private saveTokens(): void {
    if (this.tokens) {
      sessionStorage.setItem('googleTokens', JSON.stringify(this.tokens));
    } else {
      sessionStorage.removeItem('googleTokens');
    }
  }

  setTokens(tokens: GoogleTokens): void {
    this.tokens = tokens;
    this.saveTokens();
  }

  getTokens(): GoogleTokens | null {
    return this.tokens;
  }

  getAccessToken(): string | null {
    return this.tokens?.accessToken || null;
  }

  isTokenExpired(): boolean {
    if (!this.tokens?.expiryDate) return false;
    return Date.now() >= this.tokens.expiryDate;
  }

  isConnected(): boolean {
    return !!this.tokens && !this.isTokenExpired();
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.tokens?.refreshToken) {
      return null;
    }

    try {
      const response = await fetch('/api/auth/google/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: this.tokens.refreshToken,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const { accessToken, expiryDate } = await response.json();

      this.tokens.accessToken = accessToken;
      if (expiryDate) {
        this.tokens.expiryDate = expiryDate;
      }

      this.saveTokens();
      return accessToken;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      this.clearTokens();
      return null;
    }
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;

    if (this.isTokenExpired()) {
      return await this.refreshAccessToken();
    }

    return this.tokens.accessToken;
  }

  clearTokens(): void {
    this.tokens = null;
    sessionStorage.removeItem('googleTokens');
  }

  getAuthUrl(shop: string = 'localhost'): string {
    return `/api/auth/google?shop=${shop}`;
  }
}

export const googleAuth = GoogleAuthService.getInstance();