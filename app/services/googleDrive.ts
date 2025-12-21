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
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] CLIENT: Starting files list request`, {
    folderId: folderId || 'root',
    hasAccessToken: !!accessToken,
    accessTokenLength: accessToken?.length || 0
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch('/api/drive/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
        folderId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(`[${requestId}] CLIENT: Response received`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Unknown error' };
      }

      console.error(`[${requestId}] CLIENT: API Error Response`, {
        status: response.status,
        statusText: response.statusText,
        errorData
      });

      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[${requestId}] CLIENT: Success`, {
      dataType: typeof data,
      isArray: Array.isArray(data),
      hasDataKey: 'data' in data,
      totalFiles: Array.isArray(data) ? data.length : data.data?.length || 0,
      requestId: data.requestId
    });

    // Handle new response format with data wrapper
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }

    // Handle legacy format (direct array)
    if (Array.isArray(data)) {
      return data;
    }

    console.error(`[${requestId}] CLIENT: Unexpected response format`, data);
    throw new Error('Invalid response format from API');

  } catch (error) {
    console.error(`[${requestId}] CLIENT: Request failed`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
      isAborted: error instanceof Error && error.name === 'AbortError'
    });

    // Don't throw if request was aborted (user navigated away)
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

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
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] CLIENT: Starting folders list request`, {
    hasAccessToken: !!accessToken,
    accessTokenLength: accessToken?.length || 0
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch('/api/drive/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(`[${requestId}] CLIENT: Response received`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Unknown error' };
      }

      console.error(`[${requestId}] CLIENT: API Error Response`, {
        status: response.status,
        statusText: response.statusText,
        errorData
      });

      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[${requestId}] CLIENT: Success`, {
      dataType: typeof data,
      isArray: Array.isArray(data),
      hasDataKey: 'data' in data,
      totalFolders: Array.isArray(data) ? data.length : data.data?.length || 0,
      requestId: data.requestId
    });

    // Handle new response format with data wrapper
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }

    // Handle legacy format (direct array)
    if (Array.isArray(data)) {
      return data;
    }

    console.error(`[${requestId}] CLIENT: Unexpected response format`, data);
    throw new Error('Invalid response format from API');

  } catch (error) {
    console.error(`[${requestId}] CLIENT: Request failed`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
      isAborted: error instanceof Error && error.name === 'AbortError'
    });

    // Don't throw if request was aborted (user navigated away)
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

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

// Get image files count in a folder
export const getImageFilesCountInFolder = async (folderId: string): Promise<number> => {
  const accessToken = await googleAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }

  try {
    const response = await fetch('/api/drive/files/count', {
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
      throw new Error('Failed to get files count');
    }

    const data = await response.json();
    return data.count || 0;
  } catch (error) {
    console.error('Error getting files count:', error);
    return 0;
  }
};

// Get PDF files count in a folder
export const getPdfFilesCountInFolder = async (folderId: string): Promise<number> => {
  const accessToken = await googleAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }

  try {
    const response = await fetch('/api/drive/files/pdf-count', {
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
      throw new Error('Failed to get PDF files count');
    }

    const data = await response.json();
    return data.count || 0;
  } catch (error) {
    console.error('Error getting PDF files count:', error);
    return 0;
  }
};