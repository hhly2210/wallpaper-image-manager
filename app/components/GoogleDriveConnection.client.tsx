import { useState, useEffect } from 'react';
import { googleAuth, type GoogleTokens } from '../services/googleAuth';
import { listFoldersWithAuth, listDriveFilesWithAuth, type DriveFile, type GoogleFolder } from '../services/googleDrive';

export default function GoogleDriveConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [folders, setFolders] = useState<GoogleFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  useEffect(() => {
    // Check existing connection status on component mount
    setIsConnected(googleAuth.isConnected());

    // If connected, load folders
    if (googleAuth.isConnected()) {
      loadFolders();
    }
  }, []);

  useEffect(() => {
    // Load files when folder is selected
    if (selectedFolder) {
      loadFiles();
    } else {
      setFiles([]);
    }
  }, [selectedFolder]);

  const loadFolders = async () => {
    setIsLoadingFolders(true);
    try {
      const foldersList = await listFoldersWithAuth();
      setFolders(foldersList);
    } catch (error) {
      console.error('Failed to load folders:', error);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const loadFiles = async () => {
    if (!selectedFolder) return;

    setIsLoadingFiles(true);
    try {
      const filesList = await listDriveFilesWithAuth(selectedFolder);
      setFiles(filesList);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setIsLoadingFiles(false);
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
    setFiles([]);
    setSelectedFiles([]);
  };

  const handleFolderChange = (folderId: string) => {
    setSelectedFolder(folderId);
    setSelectedFiles([]); // Clear selected files when folder changes
  };

  const handleFileSelection = (fileId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedFiles(prev => [...prev, fileId]);
    } else {
      setSelectedFiles(prev => prev.filter(id => id !== fileId));
    }
  };

  const handleSelectAllFiles = () => {
    if (selectedFiles.length === files.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(files.map(file => file.id!));
    }
  };

  const handleUploadToShopify = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one file to upload');
      return;
    }

    try {
      const selectedFilesData = files.filter(file => selectedFiles.includes(file.id!));

      // Show confirmation dialog
      const confirmUpload = confirm(
        `Are you sure you want to upload ${selectedFiles.length} image${selectedFiles.length !== 1 ? 's' : ''} to Shopify?`
      );

      if (!confirmUpload) return;

      // Get access token for the upload
      const accessToken = await googleAuth.getValidAccessToken();

      if (!accessToken) {
        throw new Error('Not authenticated with Google Drive');
      }

      // Call upload API
      const response = await fetch('/api/upload/shopify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: selectedFiles,
          folderId: selectedFolder,
          accessToken,
        }),
      });

      if (!response.ok) {
        throw new Error('Upload request failed');
      }

      const result = await response.json();

      if (result.success) {
        alert(`${result.message}\n\nUpload complete!`);
        setSelectedFiles([]); // Clear selection after successful upload
      } else {
        throw new Error(result.message || 'Upload failed');
      }

    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
              </s-box>

              {/* Files List */}
              {selectedFolder && (
                <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
                  <s-stack direction="inline" alignment="center" gap="base">
                    <s-heading level="4">Images in Folder</s-heading>
                    {files.length > 0 && (
                      <s-button variant="plain" onClick={handleSelectAllFiles}>
                        {selectedFiles.length === files.length ? 'Deselect All' : 'Select All'}
                      </s-button>
                    )}
                  </s-stack>

                  {isLoadingFiles ? (
                    <s-paragraph>Loading images...</s-paragraph>
                  ) : files.length > 0 ? (
                    <s-stack direction="block" gap="small">
                      <s-paragraph>
                        {files.length} image{files.length !== 1 ? 's' : ''} found | {selectedFiles.length} selected
                      </s-paragraph>

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: '12px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        padding: '12px',
                        backgroundColor: '#fafafa'
                      }}>
                        {files.map((file) => (
                          <div
                            key={file.id}
                            style={{
                              border: selectedFiles.includes(file.id!) ? '2px solid #3b82f6' : '1px solid #d1d5db',
                              borderRadius: '8px',
                              padding: '8px',
                              cursor: 'pointer',
                              backgroundColor: selectedFiles.includes(file.id!) ? '#eff6ff' : 'white',
                              transition: 'all 0.2s ease'
                            }}
                            onClick={() => handleFileSelection(
                              file.id!,
                              !selectedFiles.includes(file.id!)
                            )}
                          >
                            <img
                              src={`https://drive.google.com/thumbnail?id=${file.id}&sz=w150`}
                              alt={file.name}
                              style={{
                                width: '100%',
                                height: '100px',
                                objectFit: 'cover',
                                borderRadius: '4px',
                                marginBottom: '4px'
                              }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDE1MCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik03NSA0MEM5NSA0MCA5NSA2MCA5NSA2MEM5NSA2MCA3NSA2MCA3NSA2MEM3NSA2MCA1NSA2MCA1NSA2MEM1NSA2MCA1NSA0MCA3NSA0MFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHA+PHJlY3QgeD0iNjAiIHk9IjQ1IiB3aWR0aD0iMzAiIGhlaWdodD0iMTAiIGZpbGw9IndoaXRlIi8+CjwvZz4KPC9zdmc+';
                              }}
                            />
                            <div style={{
                              fontSize: '11px',
                              fontWeight: '500',
                              color: '#374151',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {file.name}
                            </div>
                            <div style={{
                              fontSize: '10px',
                              color: '#6b7280',
                              marginTop: '2px'
                            }}>
                              {file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(1)} MB` : 'Unknown size'}
                            </div>
                          </div>
                        ))}
                      </div>

                      {selectedFiles.length > 0 && (
                        <s-box padding="base" background="subdued" borderRadius="base">
                          <s-stack direction="inline" alignment="center" gap="base">
                            <s-paragraph>
                              <strong>{selectedFiles.length}</strong> image{selectedFiles.length !== 1 ? 's' : ''} selected
                            </s-paragraph>
                            <s-button variant="primary" onClick={handleUploadToShopify}>
                              Upload to Shopify
                            </s-button>
                          </s-stack>
                        </s-box>
                      )}
                    </s-stack>
                  ) : (
                    <s-paragraph>No images found in this folder.</s-paragraph>
                  )}
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