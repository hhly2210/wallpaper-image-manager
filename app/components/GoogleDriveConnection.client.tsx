import { useState, useEffect } from 'react';
import { googleAuth, type GoogleTokens } from '../services/googleAuth';
import { listFoldersWithAuth, type GoogleFolder } from '../services/googleDrive';

interface ApiError {
  error: string;
  requestId?: string;
  details?: any;
}

export default function GoogleDriveConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [folders, setFolders] = useState<GoogleFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [lastError, setLastError] = useState<ApiError | null>(null);

  useEffect(() => {
    // Check existing connection status on component mount
    setIsConnected(googleAuth.isConnected());

    // If connected, load folders
    if (googleAuth.isConnected()) {
      loadFolders();
    }
  }, []);

  
  const loadFolders = async () => {
    setIsLoadingFolders(true);
    setLastError(null);
    try {
      const foldersList = await listFoldersWithAuth();
      setFolders(foldersList);
      console.log(`[UI] Successfully loaded ${foldersList.length} folders`);
    } catch (error) {
      console.error('[UI] Failed to load folders:', error);
      const apiError: ApiError = {
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error
      };
      setLastError(apiError);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  
  const handleGoogleConnect = () => {
    setIsLoading(true);

    // Get current shop from Shopify or use localhost for development
    const shop = (window as any).shopify?.config?.shop || 'localhost';

    // Open Google auth in popup
    const authUrl = googleAuth.getAuthUrl(shop);
    const popup = window.open(
      authUrl,
      'google-auth',
      'width=500,height=600,scrollbars=yes,resizable=yes'
    );

    if (popup) {
      // Listen for success message from popup
      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'google_auth_success') {
          googleAuth.setTokens(event.data.tokens);
          setIsConnected(true);
          setIsLoading(false);
          window.removeEventListener('message', messageHandler);
          popup.close();
          // Load folders after successful connection
          loadFolders();
        } else if (event.data?.type === 'google_auth_error') {
          setIsLoading(false);
          window.removeEventListener('message', messageHandler);
          popup.close();
          alert(`Google Drive connection failed: ${event.data.error}`);
        }
      };

      window.addEventListener('message', messageHandler);

      // Listen for popup close (fallback)
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          setIsLoading(false);
          window.removeEventListener('message', messageHandler);
          // Check if auth was successful
          setIsConnected(googleAuth.isConnected());
        }
      }, 1000);
    } else {
      setIsLoading(false);
      alert('Please allow popups to connect to Google Drive');
    }
  };

  const handleDisconnect = () => {
    googleAuth.clearTokens();
    setIsConnected(false);
    setFolders([]);
    setSelectedFolder('');
    setLastError(null); // Clear any errors
  };

  const handleFolderChange = (folderId: string) => {
    // Only update if folder actually changed
    if (folderId !== selectedFolder) {
      setSelectedFolder(folderId);
      setLastError(null); // Clear any previous errors
      console.log(`[UI] Folder changed to: ${folderId}`);
    }
  };

  // Helper function to get folder info for upload
  const getFolderInfo = () => {
    const selectedFolderInfo = folders.find(f => f.id === selectedFolder);
    return {
      id: selectedFolder,
      name: selectedFolderInfo?.name || 'Unknown Folder',
      isShared: selectedFolderInfo?.isShared || false,
      owner: selectedFolderInfo?.owner || 'Me'
    };
  };

  const handleUploadToShopify = async () => {
    if (!selectedFolder) {
      alert('Please select a folder first');
      return;
    }

    try {
      const folderInfo = getFolderInfo();

      // Show confirmation dialog
      const confirmUpload = confirm(
        `Upload all images from "${folderInfo.name}" to Shopify?\n\nThis will upload all images in the selected folder to your Shopify store.`
      );

      if (!confirmUpload) return;

      setIsUploading(true);

      // Get access token for the upload
      const accessToken = await googleAuth.getValidAccessToken();

      if (!accessToken) {
        throw new Error('Not authenticated with Google Drive');
      }

      // Call upload API with folder instead of specific files
      const response = await fetch('/api/upload/shopify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folderId: selectedFolder,
          folderName: folderInfo.name,
          isShared: folderInfo.isShared,
          owner: folderInfo.owner,
          accessToken,
          // Indicate this is a folder upload
          type: 'folder'
        }),
      });

      if (!response.ok) {
        throw new Error('Upload request failed');
      }

      const result = await response.json();

      if (result.success) {
        alert(`🎉 Upload Complete!\n\n${result.message}\n\nFolder: ${folderInfo.name}`);
      } else {
        throw new Error(result.message || 'Upload failed');
      }

    } catch (error) {
      console.error('Upload failed:', error);
      alert(`❌ Upload Failed\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try again or check your connection.`);
    } finally {
      setIsUploading(false);
    }
  };

  const testConnection = async () => {
    const accessToken = await googleAuth.getValidAccessToken();

    if (!accessToken) {
      alert('No valid access token. Please reconnect.');
      handleDisconnect();
      return;
    }

    try {
      // Test the connection by making a request to Google Drive API
      const response = await fetch('https://www.googleapis.com/drive/v3/files', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        alert('Google Drive connection is working!');
      } else {
        alert('Connection test failed. Please reconnect.');
        handleDisconnect();
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      alert('Connection test failed. Please reconnect.');
      handleDisconnect();
    }
  };

  return (
    <s-section heading="Google Drive Integration">
      <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" alignment="center" gap="base">
            <s-icon source="https://www.gstatic.com/images/icons/material/system/1x/drive_cloud_24dp.png" />
            <s-heading level="3">Google Drive Integration</s-heading>
          </s-stack>

          {!isConnected ? (
            <>
              <s-paragraph>
                Connect your Google Drive account to access and manage your wallpaper images directly from Drive.
              </s-paragraph>

              <s-button
                variant="primary"
                onClick={handleGoogleConnect}
                loading={isLoading}
              >
                {isLoading ? 'Connecting...' : 'Connect Google Drive'}
              </s-button>
            </>
          ) : (
            <>
              <s-paragraph>
                <strong>✅ Connected to Google Drive</strong><br />
                Select a folder to browse and upload images to Shopify.
              </s-paragraph>

              {/* Folder Selection */}
              <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                <s-heading level="4">Select Folder</s-heading>
                {isLoadingFolders ? (
                  <s-paragraph>Loading folders...</s-paragraph>
                ) : folders.length > 0 ? (
                  <>
                    <s-paragraph>
                      📁 Your folders | 🔗 Shared folders
                    </s-paragraph>
                    <select
                      value={selectedFolder}
                      onChange={(e) => handleFolderChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        backgroundColor: 'white',
                        fontSize: '14px',
                      }}
                    >
                      <option value="">Choose a folder...</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.isShared ? '🔗' : '📁'} {folder.name}
                          {folder.isShared && !folder.isOwnedByMe && ` (Shared by ${folder.owner})`}
                          {folder.isShared && folder.isOwnedByMe && ' (Shared)'}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <s-paragraph>No folders found in your Google Drive.</s-paragraph>
                )}

                {/* Error Display */}
                {lastError && (
                  <s-box padding="base" background="critical-subdued" borderRadius="base">
                    <s-stack direction="block" gap="small">
                      <s-heading level="4" tone="critical">
                        ⚠️ Error Loading Data
                      </s-heading>
                      <s-paragraph>
                        <strong>{lastError.error}</strong>
                        {lastError.requestId && (
                          <div style={{ fontSize: '11px', marginTop: '4px', color: '#666' }}>
                            Request ID: {lastError.requestId}
                          </div>
                        )}
                        <div style={{ fontSize: '11px', marginTop: '4px', color: '#666' }}>
                          Check browser console (F12) for detailed debugging information
                        </div>
                      </s-paragraph>
                      <s-button variant="plain" onClick={() => {
                        setLastError(null);
                        loadFolders();
                      }}>
                        🔄 Retry
                      </s-button>
                    </s-stack>
                  </s-box>
                )}
              </s-box>

              {/* Upload Action */}
              {selectedFolder && (
                <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                  <s-stack direction="block" gap="base">
                    <s-heading level="4">Ready to Upload</s-heading>

                    <s-paragraph>
                      📁 <strong>Selected Folder:</strong> {getFolderInfo().name}
                      {getFolderInfo().isShared && (
                        <span style={{ marginLeft: '8px', color: '#6b7280', fontSize: '13px' }}>
                          ({getFolderInfo().isShared && !getFolderInfo().isOwnedByMe ? `Shared by ${getFolderInfo().owner}` : 'Shared folder'})
                        </span>
                      )}
                    </s-paragraph>

                    <s-box padding="base" background="info-subdued" borderRadius="base">
                      <s-paragraph style={{ fontSize: '13px' }}>
                        📤 <strong>All images in this folder will be uploaded to Shopify</strong><br />
                        This process will upload all image files from the selected folder to your Shopify store.
                      </s-paragraph>
                    </s-box>

                    <s-button
                      variant="primary"
                      onClick={handleUploadToShopify}
                      loading={isUploading}
                      size="large"
                    >
                      {isUploading ? 'Uploading...' : '🚀 Upload Entire Folder to Shopify'}
                    </s-button>
                  </s-stack>
                </s-box>
              )}

              {/* Connection Controls */}
              <s-stack direction="inline" gap="base">
                <s-button variant="secondary" onClick={testConnection}>
                  Test Connection
                </s-button>
                <s-button variant="critical" onClick={handleDisconnect}>
                  Disconnect
                </s-button>
              </s-stack>
            </>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}