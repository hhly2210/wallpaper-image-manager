import { json } from "@remix-run/node";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Debug logging
  console.log('🔍 OAuth Callback Debug Info:');
  console.log('Full callback URL:', url.toString());
  console.log('Origin:', url.origin);
  console.log('Host:', url.host);
  console.log('Code:', code ? '✅ Received' : '❌ Missing');
  console.log('Error:', error || 'None');
  console.log('All params:', Object.fromEntries(url.searchParams.entries()));

  // Check environment variables
  console.log('🔧 Environment:');
  console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Missing');
  console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Missing');

  if (error) {
    return new Response(`
      <html>
        <script>
          window.opener.postMessage({
            type: 'GOOGLE_AUTH_ERROR',
            error: '${error}'
          }, '${url.origin}');
          window.close();
        </script>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (code) {
    try {
      // Exchange authorization code for access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: url.origin,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        return new Response(`
          <html>
            <script>
              window.opener.postMessage({
                type: 'GOOGLE_AUTH_ERROR',
                error: '${tokenData.error_description || tokenData.error}'
              }, '${url.origin}');
              window.close();
            </script>
          </html>
        `, {
          headers: { 'Content-Type': 'text/html' }
        });
      }

      return new Response(`
        <html>
          <script>
            window.opener.postMessage({
              type: 'GOOGLE_AUTH_SUCCESS',
              accessToken: '${tokenData.access_token}',
              refreshToken: '${tokenData.refresh_token || ''}'
            }, '${url.origin}');
            window.close();
          </script>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });

    } catch (error) {
      return new Response(`
        <html>
          <script>
            window.opener.postMessage({
              type: 'GOOGLE_AUTH_ERROR',
              error: 'Failed to exchange authorization code'
            }, '${url.origin}');
            window.close();
          </script>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  return new Response('Missing authorization code', { status: 400 });
}