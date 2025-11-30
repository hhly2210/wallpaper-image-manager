import { redirect } from "react-router";
import { google } from "googleapis";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }

  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;

  if (!clientId) {
    throw new Response("Google client ID not configured", { status: 500 });
  }

  const redirectUri = `${request.headers.get('host')?.includes('localhost')
    ? 'http://localhost:5173'
    : `https://${request.headers.get('host')}`}/api/auth/google/callback`;

  const auth = new google.auth.OAuth2({
    clientId,
    redirectUri,
  });

  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file'
  ];

  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: JSON.stringify({ shop }),
  });

  return redirect(authUrl);
}