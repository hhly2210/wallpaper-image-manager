import { redirect } from "react-router";
import { google } from "googleapis";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    // Return HTML page for error
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Failed</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #fff2f0;
          }
          .container {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            border: 1px solid #ffccc7;
          }
          .error-icon {
            color: #ff4d4f;
            font-size: 3rem;
            margin-bottom: 1rem;
          }
          .close-btn {
            background: #ff4d4f;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }
          .close-btn:hover {
            background: #ff7875;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">❌</div>
          <h2>Authentication Failed</h2>
          <p>Google Drive connection failed: ${error}</p>
          <button class="close-btn" onclick="window.close()">Close Window</button>
        </div>

        <script>
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'google_auth_error',
              error: '${error}'
            }, '*');
          }

          // Auto close after 3 seconds
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  }

  if (!code) {
    throw new Response("Missing authorization code", { status: 400 });
  }

  try {
    const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.VITE_GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Response("Google OAuth credentials not configured", { status: 500 });
    }

    const redirectUri = `${request.headers.get('host')?.includes('localhost')
      ? 'http://localhost:5173'
      : `https://${request.headers.get('host')}`}/api/auth/google/callback`;

    const auth = new google.auth.OAuth2({
      clientId,
      clientSecret,
      redirectUri,
    });

    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    let shop = null;
    try {
      shop = state ? JSON.parse(state)?.shop : null;
    } catch (e) {
      console.error("Failed to parse state:", e);
    }

    // Store tokens in session or database
    // For now, we'll return them to the client
    // In production, you should store these securely
    const response = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type,
      expiryDate: tokens.expiry_date,
      shop
    };

    // Return HTML page that will handle the callback and close popup
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f8f9fa;
          }
          .container {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .success-icon {
            color: #52c41a;
            font-size: 3rem;
            margin-bottom: 1rem;
          }
          .close-btn {
            background: #1890ff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }
          .close-btn:hover {
            background: #40a9ff;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h2>Authentication Successful!</h2>
          <p>Google Drive has been connected successfully.</p>
          <p>This window will close automatically...</p>
          <button class="close-btn" onclick="window.close()">Close Window</button>
        </div>

        <script>
          // Send success message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'google_auth_success',
              tokens: ${JSON.stringify(response)}
            }, '*');
          }

          // Auto close after 2 seconds
          setTimeout(() => {
            window.close();
          }, 2000);
        </script>
      </body>
      </html>
    `, {
      headers: {
        'Content-Type': 'text/html',
      },
    });

  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    throw new Response("Failed to exchange authorization code for tokens", { status: 500 });
  }
}