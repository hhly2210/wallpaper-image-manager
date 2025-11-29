import { google } from 'googleapis';

// Initialize Google Drive API
export const initDriveService = (accessToken: string) => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  return google.drive({ version: 'v3', auth });
};

// List files from Google Drive
export const listDriveFiles = async (accessToken: string, folderId?: string) => {
  try {
    const drive = initDriveService(accessToken);

    const query = folderId
      ? `'${folderId}' in parents and (mimeType contains 'image/')`
      : `(mimeType contains 'image/') and trashed=false`;

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
      pageSize: 100,
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing Drive files:', error);
    throw error;
  }
};

// Get file metadata
export const getFileInfo = async (accessToken: string, fileId: string) => {
  try {
    const drive = initDriveService(accessToken);

    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink',
    });

    return response.data;
  } catch (error) {
    console.error('Error getting file info:', error);
    throw error;
  }
};

// Download file
export const downloadFile = async (accessToken: string, fileId: string) => {
  try {
    const drive = initDriveService(accessToken);

    const response = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'stream' });

    return response.data;
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
};

// Search files by name or SKU
export const searchFiles = async (accessToken: string, query: string, exactMatch = false) => {
  try {
    const drive = initDriveService(accessToken);

    const searchQuery = exactMatch
      ? `name = '${query}' and (mimeType contains 'image/') and trashed=false`
      : `name contains '${query}' and (mimeType contains 'image/') and trashed=false`;

    const response = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
      pageSize: 50,
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error searching files:', error);
    throw error;
  }
};

// Upload file to Google Drive
export const uploadFile = async (
  accessToken: string,
  file: File,
  folderId?: string,
  conflictResolution: 'overwrite' | 'rename' = 'rename'
) => {
  try {
    const drive = initDriveService(accessToken);

    let fileMetadata: any = {
      name: file.name,
    };

    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    // Check for existing file if conflict resolution is 'overwrite'
    if (conflictResolution === 'overwrite') {
      const existingFiles = await searchFiles(accessToken, file.name, true);
      if (existingFiles.length > 0) {
        // Delete existing file
        await drive.files.delete({
          fileId: existingFiles[0].id!,
        });
      }
    }

    const media = {
      mimeType: file.type,
      body: file as any, // Convert File to readable stream
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, mimeType, size, webViewLink, webContentLink',
    });

    return response.data;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

// Get folders in Drive
export const listFolders = async (accessToken: string) => {
  try {
    const drive = initDriveService(accessToken);

    const response = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id, name, createdTime)',
      pageSize: 50,
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing folders:', error);
    throw error;
  }
};