import { googleAuth } from './googleAuth';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  webContentLink?: string;
}

export interface GoogleFolder {
  id: string;
  name: string;
  createdTime: string;
  isShared: boolean;
  owner: string;
  isOwnedByMe: boolean;
}

// These functions are client-side and will call the server-side API

// List files from Google Drive (client-side wrapper)
export const listDriveFiles = async (accessToken: string, folderId?: string): Promise<DriveFile[]> => {
  try {
    const response = await fetch('/api/drive/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
        folderId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to list files');
    }

    return await response.json();
  } catch (error) {
    console.error('Error listing Drive files:', error);
    throw error;
  }
};

// Get file metadata
export const getFileInfo = async (accessToken: string, fileId: string): Promise<DriveFile> => {
  try {
    const response = await fetch('/api/drive/file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
        fileId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get file info');
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting file info:', error);
    throw error;
  }
};

// Search files by name or SKU
export const searchFiles = async (accessToken: string, query: string, exactMatch = false): Promise<DriveFile[]> => {
  try {
    const response = await fetch('/api/drive/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
        query,
        exactMatch,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to search files');
    }

    return await response.json();
  } catch (error) {
    console.error('Error searching files:', error);
    throw error;
  }
};

// Get folders in Drive
export const listFolders = async (accessToken: string): Promise<GoogleFolder[]> => {
  try {
    const response = await fetch('/api/drive/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to list folders');
    }

    return await response.json();
  } catch (error) {
    console.error('Error listing folders:', error);
    throw error;
  }
};

// Convenience functions that use the auth service automatically
export const listDriveFilesWithAuth = async (folderId?: string): Promise<DriveFile[]> => {
  const accessToken = await googleAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }
  return listDriveFiles(accessToken, folderId);
};

export const getFileInfoWithAuth = async (fileId: string): Promise<DriveFile> => {
  const accessToken = await googleAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }
  return getFileInfo(accessToken, fileId);
};

export const searchFilesWithAuth = async (query: string, exactMatch = false): Promise<DriveFile[]> => {
  const accessToken = await googleAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }
  return searchFiles(accessToken, query, exactMatch);
};

export const listFoldersWithAuth = async (): Promise<GoogleFolder[]> => {
  const accessToken = await googleAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }
  return listFolders(accessToken);
};