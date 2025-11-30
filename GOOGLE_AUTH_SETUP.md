# Google Drive Authentication Setup

This document explains how the Google Drive authentication system works in the Wallpaper Image Manager app.

## Overview

The app uses OAuth 2.0 to authenticate with Google Drive API and access user's files. The authentication flow is designed to work in both development and production environments.

## Authentication Flow

### 1. Initiate Authentication
- User clicks "Connect Google Drive" button
- A popup window opens to `/api/auth/google?shop={shop}`
- The backend generates a Google OAuth URL and redirects to Google's consent screen

### 2. User Consent
- User sees Google's consent screen with requested permissions:
  - `https://www.googleapis.com/auth/drive.readonly` - Read access to Drive files
  - `https://www.googleapis.com/auth/drive.file` - Access to files created by this app

### 3. Authorization Code Exchange
- After user consent, Google redirects to `/api/auth/google/callback?code={auth_code}`
- The backend exchanges the authorization code for access and refresh tokens
- Tokens are returned to the client via URL parameters

### 4. Token Storage
- Tokens are stored in browser's sessionStorage
- The `GoogleAuthService` class manages token lifecycle
- Automatic token refresh is handled when tokens expire

## API Endpoints

### `/api/auth/google`
- **Method**: GET
- **Purpose**: Initiates Google OAuth flow
- **Parameters**:
  - `shop` (optional): Shopify shop domain for redirect handling
- **Response**: Redirects to Google's OAuth consent screen

### `/api/auth/google/callback`
- **Method**: GET
- **Purpose**: Handles Google OAuth callback
- **Parameters**:
  - `code`: Authorization code from Google
  - `state`: State parameter containing shop info
  - `error`: Error parameter if authorization failed
- **Response**: Redirects to app with tokens or error message

### `/api/auth/google/refresh`
- **Method**: POST
- **Purpose**: Refreshes expired access tokens
- **Body**:
  ```json
  {
    "refreshToken": "user_refresh_token"
  }
  ```
- **Response**:
  ```json
  {
    "accessToken": "new_access_token",
    "expiryDate": 1234567890
  }
  ```

## Environment Variables

Required environment variables in `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_GOOGLE_CLIENT_SECRET=your_google_client_secret
```

## Usage Examples

### Using the Auth Service

```typescript
import { googleAuth } from '../services/googleAuth';

// Check if authenticated
if (googleAuth.isConnected()) {
  const accessToken = await googleAuth.getValidAccessToken();
  // Use access token for API calls
}

// Get auth URL for popup
const authUrl = googleAuth.getAuthUrl('shop-domain.myshopify.com');

// Clear tokens (disconnect)
googleAuth.clearTokens();
```

### Using Google Drive Service

```typescript
import { listDriveFilesWithAuth, listFoldersWithAuth, searchFilesWithAuth } from '../services/googleDrive';

// List top-level folders only
const folders = await listFoldersWithAuth();
// Returns: [{ id, name, isShared, owner, isOwnedByMe }, ...]

// List files in specific folder
const folderFiles = await listDriveFilesWithAuth('folder_id');

// Search for files
const searchResults = await searchFilesWithAuth('wallpaper');
```

### Folder Selection Features

The system now provides smart folder selection:

- **📁 Your folders**: Folders you own in root directory
- **🔗 Shared folders**: Folders shared with you
- **Owner information**: Shows who shared the folder
- **Smart sorting**: Your folders appear first, then shared folders

Example dropdown options:
```
📁 My Wallpapers
📁 Product Images
🔗 Team Shared Assets (Shared by john@example.com)
🔗 Client Photos (Shared by client@company.com)
```

## Configuration

### Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Drive API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs:
     - Development: `http://localhost:5173/api/auth/google/callback`
     - Production: `https://your-domain.com/api/auth/google/callback`
5. Copy Client ID and Client Secret to environment variables

### Shopify App Setup

Make sure your Shopify app is configured with proper redirect URLs:
- Development: `http://localhost:5173`
- Production: `https://your-app-domain.com`

## Security Considerations

- Tokens are stored in sessionStorage (cleared when browser tab closes)
- Refresh tokens should be stored securely in production (consider database storage)
- HTTPS is required in production
- Proper CORS headers should be configured
- Validate state parameter to prevent CSRF attacks

## Troubleshooting

### Common Issues

1. **"Google client ID not configured"**
   - Check that `VITE_GOOGLE_CLIENT_ID` is set in `.env`

2. **"Redirect URI mismatch"**
   - Verify redirect URI matches Google Cloud Console configuration
   - Check that the domain and port are correct

3. **"Invalid client"**
   - Verify `VITE_GOOGLE_CLIENT_SECRET` is correct
   - Ensure OAuth credentials are properly configured

4. **"Popup blocked"**
   - Users must allow popups for the authentication to work
   - Consider alternative authentication methods if popup blocking is an issue

5. **"Token expired"**
   - The auth service should handle automatic refresh
   - If refresh fails, user will need to re-authenticate

### Debug Mode

Enable debug logging by setting:
```env
VITE_DEBUG_GOOGLE_AUTH=true
```

## Testing

To test the authentication flow:

1. Start development server: `npm run dev`
2. Navigate to the app
3. Click "Connect Google Drive"
4. Complete the Google authentication flow
5. Verify connection status changes to "Connected"
6. Test connection with "Test Connection" button

The authentication system will automatically handle token refresh and error cases.