import { google } from 'googleapis';

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { accessToken, folderId } = await request.json();

    if (!accessToken) {
      return new Response("Access token is required", { status: 400 });
    }

    // Initialize Google Drive service with access token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const query = folderId
      ? `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`
      : `(mimeType contains 'image/') and trashed=false`;

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
      pageSize: 100,
    });

    const files = response.data.files || [];

    return new Response(
      JSON.stringify(files),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error("Error listing files:", error);
    return new Response("Failed to list files", { status: 500 });
  }
}