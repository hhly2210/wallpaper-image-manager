import { google } from 'googleapis';

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { accessToken } = await request.json();

    if (!accessToken) {
      return new Response("Access token is required", { status: 400 });
    }

    // Initialize Google Drive service with access token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    // Query for top-level folders in root drive and shared folders
    const response = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed=false and ('root' in parents or sharedWithMe = true)",
      fields: 'files(id, name, createdTime, shared, permissions, owners)',
      pageSize: 100,
    });

    const folders = response.data.files || [];

    // Process folders to add shared status and owner information
    const processedFolders = folders.map(folder => {
      const isShared = folder.shared || (folder.permissions && folder.permissions.length > 1);
      const owner = folder.owners && folder.owners.length > 0 ? folder.owners[0].displayName : 'Me';
      const isOwnedByMe = owner === 'Me';

      return {
        id: folder.id,
        name: folder.name,
        createdTime: folder.createdTime,
        isShared,
        owner,
        isOwnedByMe
      };
    });

    // Sort folders: owned by me first, then shared with me
    processedFolders.sort((a, b) => {
      if (a.isOwnedByMe && !b.isOwnedByMe) return -1;
      if (!a.isOwnedByMe && b.isOwnedByMe) return 1;
      return a.name.localeCompare(b.name);
    });

    return new Response(
      JSON.stringify(processedFolders),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error("Error listing folders:", error);
    return new Response("Failed to list folders", { status: 500 });
  }
}