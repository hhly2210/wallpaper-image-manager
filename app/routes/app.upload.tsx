import { useState, lazy, Suspense, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { googleAuth } from "../services/googleAuth";

// Lazy load the Google Drive connection component
const GoogleDriveConnection = lazy(() => import("../components/GoogleDriveConnection.client"));

// Zod schema for form validation
const uploadFormSchema = z.object({
  skuTarget: z.string().min(1, "Please select a SKU target option"),
  conflictResolution: z.string().min(1, "Please select a conflict resolution option"),
});

type UploadFormData = z.infer<typeof uploadFormSchema>;

export default function UploadPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryResults, setDryResults] = useState<any>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [dryUploadProgress, setDryUploadProgress] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isValid },
    reset,
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadFormSchema),
    mode: "onChange",
  });

  // Effect to load selected folder from localStorage and sync with Google Drive component
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') {
      return;
    }

    // Function to check localStorage and update state
    const checkSelectedFolder = () => {
      try {
        const savedFolder = localStorage.getItem('selectedGoogleDriveFolder');
        if (savedFolder && savedFolder !== selectedFolder) {
          setSelectedFolder(savedFolder);
          console.log('Updated selected folder from localStorage:', savedFolder);
        }
      } catch (error) {
        console.error('Failed to read selected folder:', error);
      }
    };

    // Initial check
    checkSelectedFolder();

    // Set up interval to periodically check for changes (in case user updates in Google Drive component)
    const interval = setInterval(checkSelectedFolder, 1000);

    // Listen for storage events (in case user changes in another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'selectedGoogleDriveFolder') {
        checkSelectedFolder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Cleanup
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [selectedFolder]);

  // Helper function to add debug logs and update progress
  const addProgressLog = (step: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${step}${details ? `: ${details}` : ''}`;

    console.log(`🧪 DRY UPLOAD DEBUG - ${logMessage}`);

    setDryUploadProgress(prev => [...prev, logMessage]);
  };

  const onSubmit = async (data: UploadFormData) => {
    setIsSubmitting(true);
    try {
      console.log("Form submitted with data:", data);
      // TODO: Add actual upload logic here
      // await uploadImages(data);

      // Show success message
      setTimeout(() => {
        setIsSubmitting(false);
        reset();
      }, 2000);
    } catch (error) {
      console.error("Upload failed:", error);
      setIsSubmitting(false);
    }
  };

  // Function to get the currently selected folder from Google Drive component (client-side only)
  const getSelectedFolder = () => {
    // Use state instead of direct localStorage access for better reactivity
    if (typeof window === 'undefined') {
      return null;
    }

    // Return the state value first
    if (selectedFolder) {
      return selectedFolder;
    }

    // Fallback to localStorage check
    try {
      const savedFolder = localStorage.getItem('selectedGoogleDriveFolder');
      return savedFolder || null;
    } catch (error) {
      console.error('Failed to get selected folder:', error);
      return null;
    }
  };

  // Function to get Google Drive access token (client-side only)
  const getGoogleDriveToken = async (): Promise<string | null> => {
    // Only run on client side
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      // Use the same googleAuth service as GoogleDriveConnection component
      const accessToken = await googleAuth.getValidAccessToken();

      if (!accessToken) {
        console.log('No valid access token available from googleAuth service');
        return null;
      }

      console.log('Successfully retrieved access token from googleAuth service');
      return accessToken;

    } catch (error) {
      console.error('Failed to get Google Drive token from googleAuth service:', error);
      return null;
    }
  };

  // Client-side dry upload simulation
  const handleDryUpload = async () => {
    // Only run on client side
    if (typeof window === 'undefined') {
      console.error('Dry upload can only run on client side');
      return;
    }

    setIsDryRunning(true);
    setDryResults(null);
    setDryUploadProgress([]); // Clear previous progress

    try {
      // Bước 1: Validate input
      addProgressLog('BƯỚC 1', 'Kiểm tra đầu vào và form configuration');

      const formData = getValues();
      const selectedFolderId = getSelectedFolder();

      addProgressLog('Form Data', JSON.stringify(formData, null, 2));
      addProgressLog('Selected Folder', selectedFolderId || 'Chưa chọn thư mục');

      if (!selectedFolderId) {
        addProgressLog('❌ LỖI', 'Vui lòng chọn thư mục Google Drive trước');
        alert('Please select a Google Drive folder first');
        setIsDryRunning(false);
        return;
      }

      if (!formData.skuTarget || !formData.conflictResolution) {
        addProgressLog('❌ LỖI', 'Vui lòng điền đầy đủ form configuration');
        alert('Please fill in all form fields');
        setIsDryRunning(false);
        return;
      }

      addProgressLog('✅ Input validation', 'Tất cả đầu vào hợp lệ');

      // Bước 2: Kiểm tra kết nối Google Drive
      addProgressLog('BƯỚC 2', 'Kiểm tra kết nối Google Drive');

      const accessToken = await getGoogleDriveToken();

      if (!accessToken) {
        addProgressLog('❌ LỖI', 'Không thể lấy access token từ Google Drive');
        throw new Error('Not connected to Google Drive. Please connect first.');
      }

      addProgressLog('✅ Google Drive Connected', `Access token length: ${accessToken.length}`);
      addProgressLog('Token Preview', `${accessToken.substring(0, 20)}...`);

      // Bước 3: Kết nối đến Google Drive API
      addProgressLog('BƯỚC 3', 'Kết nối đến Google Drive API');

      const dryUploadResults = await simulateFolderUpload(
        selectedFolderId,
        accessToken,
        formData
      );

      addProgressLog('✅ API Connection', 'Đã kết nối thành công đến Google Drive API');

      // Bước 4: Xử lý kết quả
      addProgressLog('BƯỚC 4', 'Xử lý kết quả và tạo báo cáo');

      setDryResults(dryUploadResults);

      const { totalFiles, successCount, errorCount, processingTime, results } = dryUploadResults;

      addProgressLog('📊 Summary', `Tổng: ${totalFiles}, Thành công: ${successCount}, Lỗi: ${errorCount}`);
      addProgressLog('⏱️ Performance', `Processing time: ${processingTime}ms`);

      if (results && results.length > 0) {
        addProgressLog('📋 File Details', `Đã xử lý ${results.length} files`);
        results.slice(0, 5).forEach((result: any, index: number) => {
          addProgressLog(`File ${index + 1}`, `${result.fileName} - ${result.status.toUpperCase()}`);
        });
        if (results.length > 5) {
          addProgressLog('...', `và ${results.length - 5} files nữa`);
        }
      }

      // Bước 5: Hiển thị kết quả
      addProgressLog('BƯỚC 5', 'Hiển thị kết quả cho người dùng');

      const message = `🧪 Dry Upload Complete!\n\n` +
        `📁 Total files found: ${totalFiles}\n` +
        `✅ Would upload successfully: ${successCount}\n` +
        `❌ Would fail: ${errorCount}\n` +
        `⏱️ Processing time: ${processingTime}ms\n\n` +
        `📋 Configuration:\n` +
        `• SKU Target: ${formData.skuTarget}\n` +
        `• Conflict Resolution: ${formData.conflictResolution}\n\n` +
        `This was a simulation - no files were actually uploaded.`;

      alert(message);
      addProgressLog('✅ HOÀN TẤT', 'Dry upload simulation hoàn tất');

    } catch (error) {
      console.error('Dry upload failed:', error);
      addProgressLog('❌ FATAL ERROR', error instanceof Error ? error.message : 'Unknown error');
      alert(`❌ Dry Upload Failed\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your Google Drive connection.`);
    } finally {
      setIsDryRunning(false);
    }
  };

  // Client-side simulation of folder upload
  const simulateFolderUpload = async (
    folderId: string,
    accessToken: string,
    config: UploadFormData
  ) => {
    const startTime = Date.now();
    addProgressLog('🔍 API Request', `Bắt đầu gọi Google Drive API cho folder: ${folderId}`);

    try {
      // Step 3.1: Tạo query và gọi API
      addProgressLog('📝 Building Query', `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`);

      const query = `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`;
      const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,createdTime,webViewLink)&pageSize=1000`;

      addProgressLog('🌐 API Call', `Gọi API: ${apiUrl.substring(0, 100)}...`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      addProgressLog('📡 API Response', `Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        addProgressLog('❌ API Error', `Status: ${response.status}, Body: ${errorText.substring(0, 200)}...`);
        throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
      }

      // Step 3.2: Parse response
      addProgressLog('📊 Parsing Response', 'Đang parse JSON response...');
      const data = await response.json();
      const files = data.files || [];

      addProgressLog('📁 Files Found', `Tìm thấy ${files.length} image files trong folder`);

      if (files.length === 0) {
        addProgressLog('ℹ️ Empty Folder', 'Folder không chứa image files nào');
        return {
          dryRun: true,
          folderId,
          config,
          totalFiles: 0,
          successCount: 0,
          errorCount: 0,
          processingTime: Date.now() - startTime,
          results: [],
          timestamp: new Date().toISOString()
        };
      }

      // Step 3.3: Xử lý từng file
      addProgressLog('🔄 File Processing', `Bắt đầu xử lý ${files.length} files...`);

      const processedFiles = [];
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileNumber = i + 1;

        addProgressLog(`🖼️ File ${fileNumber}/${files.length}`, `Processing: ${file.name}`);

        try {
          // Step 3.3.1: Validate file
          addProgressLog(`  🔍 Validation ${fileNumber}`, `Kiểm tra ${file.name} (${file.mimeType}, ${file.size} bytes)`);

          // Step 3.3.2: Simulate file processing
          const simulatedResult = await simulateFileProcessing(file, config);
          processedFiles.push(simulatedResult);

          if (simulatedResult.status === 'success') {
            successCount++;
            addProgressLog(`  ✅ Success ${fileNumber}`, `${file.name} -> ${simulatedResult.shopifyFileId}`);
          } else {
            errorCount++;
            addProgressLog(`  ❌ Error ${fileNumber}`, `${file.name} -> ${simulatedResult.message}`);
          }

          // Add small delay to simulate processing time
          await new Promise(resolve => setTimeout(resolve, 10));

        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          addProgressLog(`  💥 Exception ${fileNumber}`, `${file.name} -> ${errorMessage}`);
          processedFiles.push({
            googleFileId: file.id,
            fileName: file.name,
            status: 'error',
            message: `Processing error: ${errorMessage}`
          });
        }
      }

      const processingTime = Date.now() - startTime;

      // Step 3.4: Create final results
      addProgressLog('📈 Final Summary', `Đã xử lý xong: ${successCount} thành công, ${errorCount} lỗi trong ${processingTime}ms`);

      const results = {
        dryRun: true,
        folderId,
        config,
        totalFiles: files.length,
        successCount,
        errorCount,
        processingTime,
        results: processedFiles,
        timestamp: new Date().toISOString()
      };

      addProgressLog('✅ Simulation Complete', `Tạo kết quả thành công với ${processedFiles.length} file records`);
      return results;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addProgressLog('❌ SIMULATION FAILED', `${errorMessage} (sau ${processingTime}ms)`);
      console.error(`[DRY RUN] Simulation failed:`, error);

      return {
        dryRun: true,
        folderId,
        config,
        totalFiles: 0,
        successCount: 0,
        errorCount: 1,
        processingTime,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  };

  // Simulate individual file processing
  const simulateFileProcessing = async (file: any, config: UploadFormData) => {
    const fileName = file.name || '';
    const fileSize = parseInt(file.size) || 0;
    const mimeType = file.mimeType || '';

    // Step: File validation
    // addProgressLog(`  📋 File Details ${fileName}`, `Size: ${fileSize} bytes, MIME: ${mimeType}`);

    // Validation 1: Image format
    const isValidImage = mimeType.startsWith('image/');
    if (!isValidImage) {
      // addProgressLog(`  ❌ Invalid Format ${fileName}`, `Not an image: ${mimeType}`);
      return {
        googleFileId: file.id,
        fileName,
        fileSize,
        mimeType,
        status: 'error',
        message: 'Invalid image format'
      };
    }

    // Validation 2: File size
    const isReasonableSize = fileSize > 0 && fileSize < 50 * 1024 * 1024; // 50MB limit
    if (!isReasonableSize) {
      // addProgressLog(`  ❌ Invalid Size ${fileName}`, `Size: ${fileSize} bytes (must be 0-50MB)`);
      return {
        googleFileId: file.id,
        fileName,
        fileSize,
        mimeType,
        status: 'error',
        message: 'File size too large or too small'
      };
    }

    // Validation 3: File name
    const hasValidName = fileName.length > 0 && fileName.length < 255;
    if (!hasValidName) {
      // addProgressLog(`  ❌ Invalid Name ${fileName}`, `Name length: ${fileName.length} (must be 1-254)`);
      return {
        googleFileId: file.id,
        fileName,
        fileSize,
        mimeType,
        status: 'error',
        message: 'Invalid file name'
      };
    }

    // addProgressLog(`  ✅ File Validation Passed ${fileName}`, 'Tất cả validation thành công');

    // Step: Simulate Shopify upload processing
    const simulatedShopifyFileId = `shopify_dry_${file.id}_${Date.now()}`;
    const simulatedUrl = `https://cdn.shopify.com/s/files/1/0000/0000/files/${encodeURIComponent(fileName)}?v=${Date.now()}`;

    // Simulate different processing based on configuration
    const estimatedUploadTime = Math.round(fileSize / (1024 * 1024) * 2); // ~2 seconds per MB
    const wouldOverwrite = config.conflictResolution === 'overwrite';

    // addProgressLog(`  🛒 Shopify Simulation ${fileName}`, `Target: ${config.skuTarget}, Overwrite: ${wouldOverwrite}, Time: ${estimatedUploadTime}s`);

    return {
      googleFileId: file.id,
      fileName,
      fileSize,
      mimeType,
      status: 'success',
      shopifyFileId: simulatedShopifyFileId,
      shopifyUrl: simulatedUrl,
      message: 'Would be uploaded successfully',
      processingDetails: {
        skuTarget: config.skuTarget,
        conflictResolution: config.conflictResolution,
        estimatedUploadTime,
        wouldOverwrite,
        simulatedProcessing: {
          validation: 'PASSED',
          sizeCheck: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
          formatCheck: mimeType,
          nameCheck: `${fileName.length} characters`,
          shopifyDestination: 'CDN upload simulation'
        }
      }
    };
  };

  return (
    <s-page heading="Upload">
      <Suspense fallback={
        <s-section heading="Google Drive Connection">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" alignment="center" gap="base">
                <s-icon source="https://www.gstatic.com/images/icons/material/system/1x/drive_cloud_24dp.png" />
                <s-heading level="3">Google Drive Integration</s-heading>
              </s-stack>
              <s-button loading disabled>Loading Google Drive...</s-button>
            </s-stack>
          </s-box>
        </s-section>
      }>
        <GoogleDriveConnection />
      </Suspense>

      <s-section heading="Upload Configuration">
        <form onSubmit={handleSubmit(onSubmit)}>
          <s-stack direction="block" gap="large">
            <s-box>
              <s-label required>SKU Target</s-label>
              <s-select
                {...register("skuTarget")}
                placeholder="Select SKU target option"
                invalid={!!errors.skuTarget}
              >
                <s-option value="">Choose SKU target...</s-option>
                <s-option value="exact-sku">Exact SKU Match</s-option>
                <s-option value="contains-sku">Contains SKU</s-option>
              </s-select>
              {errors.skuTarget && (
                <s-text-container tone="critical">
                  <s-text as="p" variant="bodySm">{errors.skuTarget.message}</s-text>
                </s-text-container>
              )}
            </s-box>

            <s-box>
              <s-label required>Conflict Resolution</s-label>
              <s-select
                {...register("conflictResolution")}
                placeholder="Select conflict resolution option"
                invalid={!!errors.conflictResolution}
              >
                <s-option value="">Choose conflict resolution...</s-option>
                <s-option value="overwrite">Overwrite</s-option>
                <s-option value="rename">Rename</s-option>
              </s-select>
              {errors.conflictResolution && (
                <s-text-container tone="critical">
                  <s-text as="p" variant="bodySm">{errors.conflictResolution.message}</s-text>
                </s-text-container>
              )}
            </s-box>
          </s-stack>

          <div style={{ marginTop: '32px' }}>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                type="submit"
                disabled={!isValid || isSubmitting}
                loading={isSubmitting}
              >
                {isSubmitting ? "Uploading..." : "Start Upload"}
              </s-button>
              <s-button
                variant="secondary"
                onClick={async () => await handleDryUpload()}
                disabled={isSubmitting || !selectedFolder || !isValid}
                loading={isDryRunning}
              >
                🧪 Dry Upload
              </s-button>
              <s-button
                variant="plain"
                onClick={() => reset()}
                disabled={isSubmitting}
              >
                Reset
              </s-button>
            </s-stack>
          </div>
        </form>
      </s-section>

      {/* Dry Upload Progress Section */}
      {dryUploadProgress.length > 0 && (
        <s-section heading="🧪 Dry Upload Progress">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="info-subdued">
            <s-stack direction="block" gap="small">
              <s-heading level="4">📋 Progress Logs</s-heading>

              <s-box
                padding="base"
                background="surface"
                borderRadius="base"
                style={{
                  maxHeight: '400px',
                  overflow: 'auto'
                }}
              >
                <div style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  whiteSpace: 'pre-wrap'
                }}>
                  {dryUploadProgress.map((log, index) => (
                    <div
                      key={index}
                      style={{
                        marginBottom: '4px',
                        padding: '2px 0',
                        borderBottom: '1px solid #e5e7eb',
                        color: log.includes('❌') || log.includes('💥') ? '#dc2626' :
                               log.includes('✅') ? '#059669' :
                               log.includes('⚠️') || log.includes('ℹ️') ? '#d97706' : '#374151'
                      }}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </s-box>

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="plain"
                  onClick={() => {
                    // Copy logs to clipboard
                    navigator.clipboard.writeText(dryUploadProgress.join('\n'));
                    alert('Progress logs copied to clipboard!');
                  }}
                >
                  📋 Copy Logs
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={() => setDryUploadProgress([])}
                >
                  Clear Logs
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Debug Information Section */}
      {process.env.NODE_ENV === 'development' && (
        <s-section heading="Debug Information">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="info-subdued">
            <s-stack direction="block" gap="small">
              <s-heading level="5">🔍 Debug Status</s-heading>
              <s-paragraph style={{ fontSize: '13px' }}>
                • Form Valid: <strong>{isValid ? '✅ Yes' : '❌ No'}</strong><br />
                • Selected Folder: <strong>{selectedFolder ? '✅ ' + selectedFolder : '❌ None'}</strong><br />
                • Is Submitting: <strong>{isSubmitting ? '✅ Yes' : '❌ No'}</strong><br />
                • Dry Upload Disabled: <strong>{(isSubmitting || !selectedFolder || !isValid) ? '✅ Yes' : '❌ No'}</strong>
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button
                  variant="plain"
                  onClick={() => {
                    console.log('Current state:', {
                      isValid,
                      selectedFolder,
                      isSubmitting,
                      formData: getValues()
                    });
                    alert('Debug info logged to console');
                  }}
                >
                  📋 Log State
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Dry Upload Results Section */}
      {dryResults && (
        <s-section heading="Dry Upload Results">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="info-subdued">
            <s-stack direction="block" gap="base">
              <s-heading level="4">🧪 Simulation Results</s-heading>

              <s-stack direction="inline" gap="large" alignment="center">
                <s-box padding="base" background="surface" borderRadius="base">
                  <s-paragraph>
                    <strong>📁 Total Files:</strong> {dryResults.totalFiles}
                  </s-paragraph>
                </s-box>
                <s-box padding="base" background="success-subdued" borderRadius="base">
                  <s-paragraph>
                    <strong>✅ Would Succeed:</strong> {dryResults.successCount}
                  </s-paragraph>
                </s-box>
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-paragraph>
                    <strong>❌ Would Fail:</strong> {dryResults.errorCount}
                  </s-paragraph>
                </s-box>
                <s-box padding="base" background="surface" borderRadius="base">
                  <s-paragraph>
                    <strong>⏱️ Processing Time:</strong> {dryResults.processingTime}ms
                  </s-paragraph>
                </s-box>
              </s-stack>

              <s-box padding="base" background="surface" borderRadius="base">
                <s-heading level="5">Configuration Used:</s-heading>
                <s-paragraph>
                  • SKU Target: <strong>{dryResults.config.skuTarget}</strong><br />
                  • Conflict Resolution: <strong>{dryResults.config.conflictResolution}</strong>
                </s-paragraph>
              </s-box>

              {dryResults.error && (
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-heading level="5" tone="critical">Error Details:</s-heading>
                  <s-paragraph>{dryResults.error}</s-paragraph>
                </s-box>
              )}

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="plain"
                  onClick={() => {
                    console.log('Dry upload results:', dryResults);
                  }}
                >
                  📊 View Details in Console
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={() => setDryResults(null)}
                >
                  Clear Results
                </s-button>
              </s-stack>

              {dryResults.results && dryResults.results.length > 0 && (
                <details style={{ marginTop: '16px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px' }}>
                    📋 File Processing Details ({dryResults.results.length} files)
                  </summary>
                  <div style={{
                    maxHeight: '300px',
                    overflow: 'auto',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    padding: '8px',
                    backgroundColor: '#f9fafb',
                    fontSize: '12px',
                    fontFamily: 'monospace'
                  }}>
                    {dryResults.results.map((result: any, index: number) => (
                      <div key={index} style={{
                        marginBottom: '8px',
                        padding: '4px',
                        borderBottom: '1px solid #e5e7eb',
                        color: result.status === 'success' ? '#059669' : '#dc2626'
                      }}>
                        <strong>{result.fileName}</strong><br />
                        Status: {result.status.toUpperCase()}<br />
                        {result.message && `Message: ${result.message}`}
                        {result.shopifyFileId && `Shopify ID: ${result.shopifyFileId}`}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </s-stack>
          </s-box>
        </s-section>
      )}

          </s-page>
  );
}