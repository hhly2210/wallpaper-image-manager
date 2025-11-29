// Google OAuth 2.0 configuration
export const googleConfig = {
  clientId: typeof import.meta.env !== 'undefined' ? (import.meta.env.VITE_GOOGLE_CLIENT_ID || '') : '',
  scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
  get redirectUri() {
    return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  },
  responseType: 'token',
};

// Initialize Google OAuth - simplified for SSR compatibility
export const initGoogleAuth = () => {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      // Server-side - just resolve without error
      resolve();
      return;
    }

    // Check if client ID is configured
    if (!googleConfig.clientId) {
      reject(new Error('Google Client ID not configured'));
      return;
    }

    // OAuth flow doesn't need initialization
    resolve();
  });
};

// Sign in with Google using OAuth2 flow with popup
export const signInWithGoogle = async () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window not available'));
      return;
    }

    const currentOrigin = window.location.origin;

    // Debug logging
    console.log('🔍 OAuth Debug Info:');
    console.log('Client ID:', googleConfig.clientId);
    console.log('Current Origin:', currentOrigin);
    console.log('Redirect URI:', googleConfig.redirectUri);
    console.log('Full URL:', window.location.href);
    console.log('User Agent:', navigator.userAgent);

    // Build OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', googleConfig.clientId);
    authUrl.searchParams.set('redirect_uri', googleConfig.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', googleConfig.scope);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    console.log('🔗 Full OAuth URL:', authUrl.toString());

    // Open popup for OAuth flow
    const popup = window.open(
      authUrl.toString(),
      'googleAuth',
      'width=500,height=600,scrollbars=yes,resizable=yes'
    );

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    // Listen for messages from popup
    const messageHandler = (event: MessageEvent) => {
      // Only accept messages from same origin
      if (event.origin !== window.location.origin) return;

      if (event.data.type === 'GOOGLE_AUTH_SUCCESS') {
        window.removeEventListener('message', messageHandler);
        popup.close();

        // Get user info using the access token
        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            'Authorization': `Bearer ${event.data.accessToken}`
          }
        })
        .then(response => response.json())
        .then(userInfo => {
          window.googleAccessToken = event.data.accessToken;
          resolve({
            token: event.data.accessToken,
            profile: {
              id: userInfo.id || 'google_user',
              name: userInfo.name || 'Google User',
              email: userInfo.email || 'user@gmail.com',
              imageUrl: userInfo.picture || '',
            }
          });
        })
        .catch(error => {
          console.error('Error getting user info:', error);
          window.googleAccessToken = event.data.accessToken;
          resolve({
            token: event.data.accessToken,
            profile: {
              id: 'google_user',
              name: 'Google User',
              email: 'user@gmail.com',
              imageUrl: '',
            }
          });
        });
      } else if (event.data.type === 'GOOGLE_AUTH_ERROR') {
        window.removeEventListener('message', messageHandler);
        popup.close();
        reject(new Error(event.data.error || 'Authentication failed'));
      }
    };

    window.addEventListener('message', messageHandler);

    // Check if popup was closed manually
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        reject(new Error('Authentication cancelled'));
      }
    }, 1000);
  });
};

// Sign out from Google
export const signOutFromGoogle = async () => {
  if (typeof window !== 'undefined' && window.google) {
    window.google.accounts.id.disableAutoSelect();
    window.googleAccessToken = null;
  }
};

// Check if user is signed in
export const isSignedIn = () => {
  if (typeof window === 'undefined') return false;
  return !!window.googleAccessToken;
};

// Get current user
export const getCurrentUser = () => {
  if (typeof window === 'undefined' || !window.googleAccessToken) {
    return null;
  }

  return {
    profile: {
      id: 'google_user',
      name: 'Google User',
      email: 'user@gmail.com',
      imageUrl: '',
    }
  };
};

// Add global type declarations
declare global {
  interface Window {
    google: any;
    gapi: any;
    googleAccessToken?: string;
  }
}