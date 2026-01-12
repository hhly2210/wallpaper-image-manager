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
  conflictResolution: z.string().default("rename"), // Default to rename, hidden from UI
});

type UploadFormData = z.infer<typeof uploadFormSchema>;

export default function UploadPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryResults, setDryResults] = useState<any>(null);
  const [uploadResults, setUploadResults] = useState<any>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [skuData, setSkuData] = useState<any[]>([]);
  const [flattenedSKUs, setFlattenedSKUs] = useState<any[]>([]); // For UI display
  const [isLoadingSKUs, setIsLoadingSKUs] = useState(false);
  const [skuError, setSkuError] = useState<string | null>(null);

  // Progress tracking states
  const [uploadProgress, setUploadProgress] = useState<{
    totalFiles: number;
    processedFiles: number;
    currentFile: string;
    status: 'idle' | 'connecting' | 'uploading' | 'processing' | 'completing' | 'error';
    message: string;
    percentage: number;
  }>({
    totalFiles: 0,
    processedFiles: 0,
    currentFile: '',
    status: 'idle',
    message: '',
    percentage: 0
  });


  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isValid },
    reset,
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadFormSchema),
    mode: "onChange",
    defaultValues: {
      skuTarget: "contains-sku", // Set default to Contains SKU
      conflictResolution: "rename" // Set default value
    },
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


  // Helper function for console logging only
  const logProgress = (step: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${step}${details ? `: ${details}` : ''}`;
    console.log(`🧪 DRY UPLOAD - ${logMessage}`);
  };

  const onSubmit = async (data: UploadFormData) => {
    setIsSubmitting(true);
    setUploadProgress({
      totalFiles: 0,
      processedFiles: 0,
      currentFile: '',
      status: 'connecting',
      message: 'Connecting to Google Drive...',
      percentage: 0
    });

    try {
      console.log("🚀 Starting real upload process with data:", data);

      const selectedFolderId = getSelectedFolder();
      const accessToken = await getGoogleDriveToken();

      if (!selectedFolderId) {
        alert('Please select a Google Drive folder first');
        setIsSubmitting(false);
        setUploadProgress(prev => ({ ...prev, status: 'error', message: 'No folder selected' }));
        return;
      }

      if (!accessToken) {
        alert('Not connected to Google Drive. Please connect first.');
        setIsSubmitting(false);
        setUploadProgress(prev => ({ ...prev, status: 'error', message: 'Not connected to Google Drive' }));
        return;
      }

      console.log("📤 Uploading to Shopify...", {
        folderId: selectedFolderId,
        skuTarget: data.skuTarget,
        conflictResolution: data.conflictResolution
      });

      setUploadProgress({
        totalFiles: 0,
        processedFiles: 0,
        currentFile: '',
        status: 'uploading',
        message: 'Starting upload to Shopify...',
        percentage: 5
      });

      const response = await fetch('/api/upload/shopify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'folder',
          folderId: selectedFolderId,
          accessToken,
          skuTarget: data.skuTarget,
          conflictResolution: data.conflictResolution
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      console.log("✅ Upload completed successfully:", result);

      setUploadProgress({
        totalFiles: result.totalFiles || 0,
        processedFiles: result.totalFiles || 0,
        currentFile: 'Upload complete',
        status: 'completing',
        message: 'Finalizing upload...',
        percentage: 100
      });

      // Save upload results
      setUploadResults(result);

      // Show success message
      const message = `🎉 Upload Complete!\n\n` +
        `📁 Total files: ${result.totalFiles}\n` +
        `✅ Successfully uploaded: ${result.uploadedFiles}\n` +
        `🔗 Products matched: ${result.matchedFiles || 0}\n` +
        `🖼️ Metafields updated: ${result.metafieldUpdates || 0}\n` +
        `${result.failedFiles > 0 ? `❌ Failed: ${result.failedFiles}\n` : ''}` +
        `\nYour images have been uploaded to Shopify and linked to the corresponding products!`;

      setTimeout(() => {
        alert(message);
        setUploadProgress({
          totalFiles: 0,
          processedFiles: 0,
          currentFile: '',
          status: 'idle',
          message: '',
          percentage: 0
        });
      }, 1000);

      setIsSubmitting(false);
      reset();

    } catch (error) {
      console.error("❌ Upload failed:", error);
      setUploadProgress(prev => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        percentage: 0
      }));

      alert(`Upload Failed\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your connection and try again.`);
      setIsSubmitting(false);

      // Reset progress after a delay
      setTimeout(() => {
        setUploadProgress({
          totalFiles: 0,
          processedFiles: 0,
          currentFile: '',
          status: 'idle',
          message: '',
          percentage: 0
        });
      }, 3000);
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

  // Save SKU data to localStorage for persistence
  const saveSKUDataToCache = (data: any, flattened: any[]) => {
    try {
      const cacheData = {
        data,
        flattened,
        timestamp: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      };
      localStorage.setItem('shopify-sku-cache', JSON.stringify(cacheData));
      console.log('💾 SKU data cached for 24 hours');
    } catch (error) {
      console.warn('Failed to cache SKU data:', error);
    }
  };

  // Load SKU data from localStorage cache
  const loadSKUDataFromCache = () => {
    try {
      const cached = localStorage.getItem('shopify-sku-cache');
      if (!cached) return null;

      const cacheData = JSON.parse(cached);

      // Check if cache is still valid (not expired)
      if (Date.now() > cacheData.expiresAt) {
        localStorage.removeItem('shopify-sku-cache');
        console.log('🗑️ SKU cache expired, removed');
        return null;
      }

      console.log('📦 Loaded SKU data from cache', {
        age: Math.round((Date.now() - cacheData.timestamp) / 1000 / 60) + ' minutes old',
        variants: cacheData.flattened.length,
        products: cacheData.data.length
      });

      return cacheData;
    } catch (error) {
      console.warn('Failed to load SKU cache:', error);
      return null;
    }
  };

  // Function to fetch SKU data from Shopify via server proxy
  const fetchSKUsFromShopify = async (query?: string, forceRefresh = false) => {
    // If not forcing refresh, try to load from cache first
    if (!forceRefresh) {
      const cached = loadSKUDataFromCache();
      if (cached) {
        setSkuData(cached.data);
        setFlattenedSKUs(cached.flattened);

        logProgress('📦 Shopify Cache', `Loaded ${cached.flattened.length} variants from cache (${Math.round((Date.now() - cached.timestamp) / 1000 / 60)} minutes old)`);
        return cached.flattened;
      }
    }

    setIsLoadingSKUs(true);
    setSkuError(null);

    try {
      logProgress('🛒 Shopify Sync', forceRefresh ? 'Refreshing SKU data from Shopify...' : 'Bắt đầu lấy danh sách SKU từ Shopify...');

      const response = await fetch('/api/shopify/skus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 250,
          query: query || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.data) {
        setSkuData(data.data);

        // Flatten SKU data for easier matching with files
        const flattened = data.data.flatMap((product: any) =>
          product.variants.map((variant: any) => ({
            ...variant,
            productId: product.id,
            productHandle: product.handle,
            productTitle: product.title,
            productType: product.productType,
            productTags: product.tags,
            productOrgType: product.productOrgType
          }))
        );

        setFlattenedSKUs(flattened);

        // Save to cache for future use
        saveSKUDataToCache(data.data, flattened);

        logProgress('✅ Shopify Sync', `Đã lấy ${flattened.length} variants từ ${data.data.length} products`);
        logProgress('📊 SKU Summary', `- Total Products: ${data.summary?.totalProducts || 0}- Products with SKUs: ${data.summary?.productsWithSKUs || 0}- Total Variants: ${data.summary?.totalVariants || 0}- Valid SKUs: ${flattened.length}`);
        logProgress('🎨 Color Filter', `Chỉ variants có Color option được bao gồm`);
        logProgress('🏷️ Product Type', `Product Organization = "Wallpaper"`);
        logProgress('💾 Cache', 'SKU data saved for 24 hours');

        return flattened;
      } else {
        throw new Error(data.error || 'Invalid response format');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setSkuError(errorMessage);
      logProgress('❌ Shopify Sync Error', `Không thể lấy SKU: ${errorMessage}`);
      console.error('Failed to fetch SKUs:', error);
      return [];
    } finally {
      setIsLoadingSKUs(false);
    }
  };


  // Auto-check SKU data availability before dry upload
  const checkSKUDataAvailability = () => {
    console.log('🔍 SKU DATA CHECK:', {
      flattenedSKUs: flattenedSKUs.length,
      isLoadingSKUs,
      skuError,
      skuData: skuData.length,
      hasSKUs: flattenedSKUs.length > 0
    });

    // Log first few SKUs for debugging
    if (flattenedSKUs.length > 0) {
      console.log('📋 SAMPLE SKUs:', flattenedSKUs.slice(0, 3).map(sku => ({
        sku: sku.sku,
        title: sku.title,
        color: sku.color
      })));
    }

    return flattenedSKUs.length > 0;
  };

  // Function to get current Shopify metafield
  const getShopifyMetafield = async (productId: string): Promise<any> => {
    try {
      console.log(`🔍 Getting current metafield: productId=${productId}`);

      const response = await fetch('/api/shopify/metafield', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get',
          productId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Metafield get failed:', errorData);
        return null;
      }

      const data = await response.json();
      console.log('✅ Metafield retrieved successfully:', data);
      return data.data || data.metafield || null;

    } catch (error) {
      console.error('Failed to get Shopify metafield:', error);
      return null;
    }
  };

  // Function to update Shopify metafield with wallpaper image
  const updateShopifyMetafield = async (
    productId: string,
    color: string,
    imageUrl: string,
    imageType: 'room' | 'hover'
  ): Promise<boolean> => {
    try {
      console.log(`🔗 Updating metafield: productId=${productId}, color=${color}, type=${imageType}`);

      const response = await fetch('/api/shopify/metafield', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId,
          color,
          imageUrl,
          imageType
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Metafield update failed:', errorData);
        return false;
      }

      const data = await response.json();
      console.log('✅ Metafield updated successfully:', data);
      return true;

    } catch (error) {
      console.error('Failed to update Shopify metafield:', error);
      return false;
    }
  };

  // Function to detect image type from filename
  const detectImageType = (fileName: string): 'room' | 'hover' | null => {
    const lowerFileName = fileName.toLowerCase();

    if (lowerFileName.includes('room') || lowerFileName.includes('roomset') || lowerFileName.includes('interior')) {
      return 'room';
    }

    if (lowerFileName.includes('hover') || lowerFileName.includes('zoom') || lowerFileName.includes('detail') || lowerFileName.includes('close')) {
      return 'hover';
    }

    return null; // Unknown type
  };

  // Client-side dry upload simulation
  const handleDryUpload = async () => {
    // Only run on client side
    if (typeof window === 'undefined') {
      console.error('Dry upload can only run on client side');
      return;
    }

    console.log('🚨 START DRY UPLOAD', {
      flattenedSKUs: flattenedSKUs.length,
      isLoadingSKUs,
      skuError,
      skuData: skuData.length
    });

    setIsDryRunning(true);
    setDryResults(null);

    try {
      // BƯỚC 1: Validate input
      logProgress('BƯỚC 1', 'Kiểm tra đầu vào');

      const formData = getValues();
      const selectedFolderId = getSelectedFolder();

      // Early validation check
      if (!selectedFolderId) {
        logProgress('❌ EARLY STOP', 'Không có folder được chọn');
        throw new Error('Please select a Google Drive folder first');
      }

      if (!formData.skuTarget || !formData.conflictResolution) {
        logProgress('❌ EARLY STOP', 'Vui lòng điền đầy đủ form configuration');
        throw new Error('Please fill in all form fields');
      }

      logProgress('✅ Input validation', 'Tất cả đầu vào hợp lệ');

      // BƯỚC 1.5: Fetch SKUs for processing (local variable, no hook)
      logProgress('BƯỚC 1.5', 'Tải dữ liệu SKU cho xử lý');

      let processingSKUs = [];

      if (flattenedSKUs.length > 0) {
        processingSKUs = flattenedSKUs;
        logProgress('✅ SKUs Ready', `Sử dụng ${processingSKUs.length} SKUs có sẵn`);
      } else {
        logProgress('🎯 Fetching SKUs', 'Đang tải SKU từ Shopify...');
        processingSKUs = await fetchSKUsFromShopify();

        if (processingSKUs.length > 0) {
          logProgress('✅ SKUs Loaded', `Đã tải ${processingSKUs.length} SKUs cho xử lý`);
        } else {
          logProgress('⚠️ No SKUs', 'Không tải được SKU nào - sẽ xử lý như general upload');
        }
      }

      logProgress('📊 Processing Summary', `Sử dụng ${processingSKUs.length} SKUs cho processing`);
      logProgress('Form Data', JSON.stringify(formData, null, 2));
      logProgress('Selected Folder', selectedFolderId);

      // Critical: Check if we have SKU data before proceeding
      logProgress('🚨 PRE-PROCESS CHECK', `Will process with ${processingSKUs.length} SKUs available for processing`);

      if (!selectedFolderId) {
        logProgress('❌ LỖI', 'Vui lòng chọn thư mục Google Drive trước');
        alert('Please select a Google Drive folder first');
        setIsDryRunning(false);
        return;
      }

      if (!formData.skuTarget || !formData.conflictResolution) {
        logProgress('❌ LỖI', 'Vui lòng điền đầy đủ form configuration');
        alert('Please fill in all form fields');
        setIsDryRunning(false);
        return;
      }

      logProgress('✅ Input validation', 'Tất cả đầu vào hợp lệ');

      // Bước 2: Kiểm tra kết nối Google Drive
      logProgress('BƯỚC 2', 'Kiểm tra kết nối Google Drive');

      const accessToken = await getGoogleDriveToken();

      if (!accessToken) {
        logProgress('❌ LỖI', 'Không thể lấy access token từ Google Drive');
        throw new Error('Not connected to Google Drive. Please connect first.');
      }

      logProgress('✅ Google Drive Connected', `Access token length: ${accessToken.length}`);
      logProgress('Token Preview', `${accessToken.substring(0, 20)}...`);

      // Bước 3: Kết nối đến Google Drive API
      logProgress('BƯỚC 3', 'Kết nối đến Google Drive API');

      const dryUploadResults = await simulateFolderUpload(
        selectedFolderId,
        accessToken,
        formData,
        processingSKUs // Use local processing SKUs
      );

      logProgress('✅ API Connection', 'Đã kết nối thành công đến Google Drive API');

      // Bước 4: Xử lý kết quả
      logProgress('BƯỚC 4', 'Xử lý kết quả và tạo báo cáo');

      setDryResults(dryUploadResults);

      const { totalFiles, successCount, errorCount, processingTime, results } = dryUploadResults;

      logProgress('📊 Summary', `Tổng: ${totalFiles}, Thành công: ${successCount}, Lỗi: ${errorCount}`);
      logProgress('⏱️ Performance', `Processing time: ${processingTime}ms`);

      if (results && results.length > 0) {
        logProgress('📋 File Details', `Đã xử lý ${results.length} files`);
        results.slice(0, 5).forEach((result: any, index: number) => {
          logProgress(`File ${index + 1}`, `${result.fileName} - ${result.status.toUpperCase()}`);
        });
        if (results.length > 5) {
          logProgress('...', `và ${results.length - 5} files nữa`);
        }
      }

      // Bước 5: Hiển thị kết quả
      logProgress('BƯỚC 5', 'Hiển thị kết quả cho người dùng');

      const realTests = dryUploadResults.realMetafieldTests || {};
      const message = `🧪 Dry Upload Complete!\n\n` +
        `📁 Total files found: ${dryUploadResults.totalFiles}\n` +
        `✅ Will upload: ${dryUploadResults.successCount}\n` +
        `⏭️ Skipped (no SKU match): ${dryUploadResults.skippedCount}\n` +
        `❌ Would fail: ${dryUploadResults.errorCount}\n` +
        `🎯 SKU matched: ${dryUploadResults.matchedCount}\n` +
        `🔗 Metafield updates: ${dryUploadResults.metafieldUpdates}\n` +
        `🔍 Metafield fetched: ${realTests.fetched || 0}/${realTests.tested || 0} retrieved\n` +
        `⏱️ Processing time: ${dryUploadResults.processingTime}ms\n\n` +
        `📋 Configuration:\n` +
        `• SKU Target: ${dryUploadResults.config.skuTarget}\n` +
        `• Conflict Resolution: ${dryUploadResults.config.conflictResolution}\n\n` +
        `💡 Files with SKU matches were checked for current metafield values.\n` +
        `This was a simulation - no files were uploaded, no metafields were updated.`;

      alert(message);
      logProgress('✅ HOÀN TẤT', 'Dry upload simulation hoàn tất');

    } catch (error) {
      console.error('Dry upload failed:', error);
      logProgress('❌ FATAL ERROR', error instanceof Error ? error.message : 'Unknown error');
      console.error('🚨 ERROR STACK:', error.stack);
      alert(`❌ Dry Upload Failed\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your Google Drive connection.`);
    } finally {
      console.log('🔚 FINALLY - Cleaning up');
      setIsDryRunning(false);
    }
  };

  // Client-side simulation of folder upload
  const simulateFolderUpload = async (
    folderId: string,
    accessToken: string,
    config: UploadFormData,
    availableSKUs: any[] = []
  ) => {
    const startTime = Date.now();
    logProgress('🔍 API Request', `Bắt đầu gọi Google Drive API cho folder: ${folderId}`);

    try {
      // Step 3.1: Tạo query và gọi API
      logProgress('📝 Building Query', `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`);

      const query = `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`;
      const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,createdTime,webViewLink)&pageSize=1000`;

      logProgress('🌐 API Call', `Gọi API: ${apiUrl.substring(0, 100)}...`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      logProgress('📡 API Response', `Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        logProgress('❌ API Error', `Status: ${response.status}, Body: ${errorText.substring(0, 200)}...`);
        throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
      }

      // Step 3.2: Parse response
      logProgress('📊 Parsing Response', 'Đang parse JSON response...');
      const data = await response.json();
      const files = data.files || [];

      logProgress('📁 Files Found', `Tìm thấy ${files.length} image files trong folder`);

      if (files.length === 0) {
        logProgress('ℹ️ Empty Folder', 'Folder không chứa image files nào');
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

      // Step 3.3: Xử lý từng file với SKU matching
      logProgress('🔄 File Processing', `Bắt đầu xử lý ${files.length} files với ${availableSKUs.length} variants available...`);

      const processedFiles = [];
      let successCount = 0;
      let errorCount = 0;
      let matchedCount = 0;
      let skippedCount = 0;
      let metafieldUpdates = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileNumber = i + 1;

        logProgress(`🖼️ File ${fileNumber}/${files.length}`, `Processing: ${file.name}`);

        try {
          // Step 3.3.1: Validate file
          logProgress(`  🔍 Validation ${fileNumber}`, `Kiểm tra ${file.name} (${file.mimeType}, ${file.size} bytes)`);

          // Step 3.3.2: Simulate file processing with enhanced SKU matching
          const simulatedResult = await simulateFileProcessing(file, config, availableSKUs);
          processedFiles.push(simulatedResult);

          if (simulatedResult.status === 'success') {
            successCount++;
            if (simulatedResult.skuMatch) {
              matchedCount++;
            }
            // Enhanced success log with detailed product matching
            if (simulatedResult.skuMatch) {
              logProgress(`  ✅ Success ${fileNumber}`, `${file.name} → Product: "${simulatedResult.skuMatch.productTitle}"`);
              logProgress(`     📦 SKU: ${simulatedResult.skuMatch.sku}`, `• Variant: ${simulatedResult.skuMatch.color || 'Default'} • Price: $${simulatedResult.skuMatch.price} • Stock: ${simulatedResult.skuMatch.inventoryQuantity}`);
            } else {
              logProgress(`  ✅ Success ${fileNumber}`, `${file.name} → No SKU match (general upload)`);
            }

            // Log metafield update simulation
            if (simulatedResult.metafieldUpdate) {
              const mf = simulatedResult.metafieldUpdate;
              if (mf.wouldUpdate) {
                metafieldUpdates++;
                logProgress(`  🔗 Metafield Update ${fileNumber}`, `${file.name} → ${mf.imageType} image for "${mf.color}"`);
                logProgress(`     📝 Target`, `Product ID: ${mf.productId}`);
              } else {
                logProgress(`  ⏸️ Metafield Skipped ${fileNumber}`, `${file.name} → Unknown image type`);
              }
            }
          } else if (simulatedResult.status === 'warning') {
            successCount++; // Warnings still count as success
            // FIX: Count matched SKUs even for warning status
            if (simulatedResult.skuMatch) {
              matchedCount++;
            }
            // Enhanced warning log with detailed product matching
            if (simulatedResult.skuMatch) {
              logProgress(`  ⚠️ Warning ${fileNumber}`, `${file.name} → Product: "${simulatedResult.skuMatch.productTitle}"`);
              logProgress(`     📦 SKU: ${simulatedResult.skuMatch.sku}`, `• Variant: ${simulatedResult.skuMatch.color || 'Default'} • Price: $${simulatedResult.skuMatch.price} • Stock: ${simulatedResult.skuMatch.inventoryQuantity}`);
              logProgress(`     ⚠️ Warning Reason`, simulatedResult.message);
            }

            // Log metafield update simulation for warnings too
            if (simulatedResult.metafieldUpdate) {
              const mf = simulatedResult.metafieldUpdate;
              if (mf.wouldUpdate) {
                metafieldUpdates++;
                logProgress(`  🔗 Metafield Update ${fileNumber}`, `${file.name} → ${mf.imageType} image for "${mf.color}"`);
                logProgress(`     📝 Target`, `Product ID: ${mf.productId}`);
              } else {
                logProgress(`  ⏸️ Metafield Skipped ${fileNumber}`, `${file.name} → Unknown image type`);
              }
            }
          } else if (simulatedResult.status === 'skipped') {
            skippedCount++;
            logProgress(`  ⏭️ Skipped ${fileNumber}`, `${file.name} → ${simulatedResult.message}`);
            // Skipped files don't count as success or error
            if (simulatedResult.skuMatch) {
              logProgress(`  ⚠️ Warning ${fileNumber}`, `${file.name} → Product: "${simulatedResult.skuMatch.productTitle}"`);
              logProgress(`     ⚠️ Issue: ${simulatedResult.message}`);
            } else {
              logProgress(`  ⚠️ Warning ${fileNumber}`, `${file.name} → ${simulatedResult.message}`);
            }
          } else {
            errorCount++;
            logProgress(`  ❌ Error ${fileNumber}`, `${file.name} → ${simulatedResult.message}`);
          }

          // Add small delay to simulate processing time
          await new Promise(resolve => setTimeout(resolve, 10));

        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logProgress(`  💥 Exception ${fileNumber}`, `${file.name} -> ${errorMessage}`);
          processedFiles.push({
            googleFileId: file.id,
            fileName: file.name,
            status: 'error',
            message: `Processing error: ${errorMessage}`
          });
        }
      }

      // Step 3.4: Get current metafield data for testing
      logProgress('🔍 Getting Metafield Data', `Fetching current metafields for ${matchedCount} files with SKU matches...`);

      let realMetafieldTestCount = 0;
      let realMetafieldFetchCount = 0;
      let realMetafieldErrorCount = 0;

      for (const result of processedFiles) {
        if (result.status === 'success' && result.skuMatch && result.metafieldUpdate && result.metafieldUpdate.wouldUpdate) {
          realMetafieldTestCount++;
          const mf = result.metafieldUpdate;

          logProgress(`🔍 Getting Metafield ${realMetafieldTestCount}/${matchedCount}`,
            `${result.fileName} -> ${mf.imageType} image for "${mf.color}"`);

          try {
            // Get current metafield data instead of updating
            const currentMetafield = await getShopifyMetafield(mf.productId);

            if (currentMetafield) {
              realMetafieldFetchCount++;
              logProgress(`✅ Metafield Retrieved ${realMetafieldTestCount}`,
                `Product ID: ${mf.productId}, Current value:`, currentMetafield);

              // Log what would be updated
              logProgress(`📝 Would Update`,
                `Color: "${mf.color}", Type: ${mf.imageType}, URL: ${mf.imageUrl}`);
            } else {
              realMetafieldErrorCount++;
              logProgress(`❌ Metafield Not Found ${realMetafieldTestCount}`,
                `No metafield found for product ${mf.productId}`);
            }
          } catch (error) {
            realMetafieldErrorCount++;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logProgress(`💥 Metafield Error ${realMetafieldTestCount}`,
              `${mf.color} ${mf.imageType}: ${errorMessage}`);
          }
        }
      }

      const processingTime = Date.now() - startTime;

      // Step 3.5: Create final results
      logProgress('📈 Final Summary', `Đã xử lý xong: ${successCount} sẽ upload, ${skippedCount} bị skip, ${errorCount} lỗi, ${matchedCount} matched SKU, ${metafieldUpdates} metafield updates, ${realMetafieldFetchCount} metafield fetched trong ${processingTime}ms`);

      const results = {
        dryRun: true,
        folderId,
        config,
        totalFiles: files.length,
        successCount,
        skippedCount, // Number of files skipped (no SKU match)
        errorCount,
        matchedCount, // Number of files with SKU matches
        metafieldUpdates, // Number of metafield updates that would happen
        realMetafieldTests: {
          tested: realMetafieldTestCount,
          fetched: realMetafieldFetchCount,
          failed: realMetafieldErrorCount
        },
        processingTime,
        results: processedFiles,
        timestamp: new Date().toISOString()
      };

      logProgress('✅ Simulation Complete', `Tạo kết quả thành công với ${processedFiles.length} file records`);
      return results;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logProgress('❌ SIMULATION FAILED', `${errorMessage} (sau ${processingTime}ms)`);
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

  // Helper function to extract SKU base (cut at 3rd dash)
  // Must match server-side logic in api.upload.shopify.ts
  const extractSKUBase = (sku: string): string => {
    if (!sku) return "";
    const parts = sku.split("-");
    if (parts.length < 4) return sku; // Return original if less than 4 parts
    // Join first 3 parts (WP, SCALLOPS, SKY) and ignore the rest (size codes)
    return parts.slice(0, 3).join("-");
  };

  // Simulate individual file processing with enhanced SKU matching
  const simulateFileProcessing = async (file: any, config: UploadFormData, availableSKUs: any[] = []) => {
    const fileName = file.name || '';
    const fileSize = parseInt(file.size) || 0;
    const mimeType = file.mimeType || '';

    // Step: File validation
    const isValidImage = mimeType.startsWith('image/');
    if (!isValidImage) {
      return {
        googleFileId: file.id,
        fileName,
        fileSize,
        mimeType,
        status: 'error',
        message: 'Invalid image format'
      };
    }

    const isReasonableSize = fileSize > 0 && fileSize < 50 * 1024 * 1024;
    if (!isReasonableSize) {
      return {
        googleFileId: file.id,
        fileName,
        fileSize,
        mimeType,
        status: 'error',
        message: 'File size too large or too small'
      };
    }

    const hasValidName = fileName.length > 0 && fileName.length < 255;
    if (!hasValidName) {
      return {
        googleFileId: file.id,
        fileName,
        fileSize,
        mimeType,
        status: 'error',
        message: 'Invalid file name'
      };
    }

    // Step: Enhanced SKU matching logic
    let matchedSKU = null;
    let skuMatchType = 'none';
    let matchDetails = null;

    if (availableSKUs.length > 0) {
      const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '').toLowerCase();
      const fileNameClean = fileNameWithoutExt.replace(/[-_\s]/g, ''); // Remove separators

      if (config.skuTarget === 'exact-sku') {
        // Exact match with SKU base - check if filename starts with SKU base (handles WP-SCALLOPS-SKY-HOVER format)
        matchedSKU = availableSKUs.find(sku => {
          // Extract SKU base (without size code)
          const skuBase = extractSKUBase(sku.sku);
          const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, '');

          // Check if filename starts with SKU base (prefix match)
          // This handles cases like: WP-SCALLOPS-SKY-HOVER matches WP-SCALLOPS-SKY-2424
          const isPrefixMatch = fileNameClean.startsWith(skuBaseClean) ||
            fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());

          // Keep existing exact matches as fallback
          const isExactMatch = skuBaseClean === fileNameClean ||
            skuBase.toLowerCase() === fileNameWithoutExt;

          return isPrefixMatch || isExactMatch;
        });

        skuMatchType = matchedSKU ? 'exact' : 'none';

        // Add detailed logging for exact matches
        if (matchedSKU) {
          const skuBase = extractSKUBase(matchedSKU.sku);
          const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, '');

          const isPrefixMatch = fileNameClean.startsWith(skuBaseClean) ||
            fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());
          const isExactMatch = skuBaseClean === fileNameClean ||
            skuBase.toLowerCase() === fileNameWithoutExt;

          const matchType = isPrefixMatch ? 'PREFIX' :
            isExactMatch ? 'EXACT' : 'CONTAINS';

          logProgress(`  ✅ Exact Match`, `${fileName} → SKU Base: ${skuBase} (from ${matchedSKU.sku}) (${matchType}) → Product: ${matchedSKU.productTitle}`);
          if (matchedSKU.color) {
            logProgress(`     🎨 Variant Details`, `Color: ${matchedSKU.color} • Price: $${matchedSKU.price} • Stock: ${matchedSKU.inventoryQuantity}`);
          }
        } else {
          // Log when no SKU match is found for debugging
          logProgress(`  ❌ No Match`, `${fileName} → No matching SKU found`);
          logProgress(`     📝 Debug Info`, `Clean filename: ${fileNameClean}`);
          if (availableSKUs.length > 0) {
            logProgress(`     📦 Available SKUs`, `${availableSKUs.length} SKUs available for matching`);
            // Show first few SKUs for debugging
            const sampleSKUs = availableSKUs.slice(0, 3).map(s => {
              const skuBase = extractSKUBase(s.sku);
              return `${s.sku} → ${skuBase}`;
            }).join(', ');
            logProgress(`     🔍 Sample SKUs`, sampleSKUs + (availableSKUs.length > 3 ? '...' : ''));
          }
        }

      } else if (config.skuTarget === 'contains-sku') {
        // Enhanced contains match with SKU base - improved logic for WP-SCALLOPS-SKY-XXX format
        const potentialMatches = availableSKUs.filter(sku => {
          // Extract SKU base (without size code)
          const skuBase = extractSKUBase(sku.sku);
          const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, '');

          // Priority 1: Prefix match - filename starts with SKU base (WP-SCALLOPS-SKY-HOVER starts with WP-SCALLOPS-SKY)
          const isPrefixMatch = fileNameClean.startsWith(skuBaseClean) ||
            fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());

          // Priority 2: Contains match - filename contains SKU base somewhere
          const isContainsMatch = fileNameWithoutExt.includes(skuBase.toLowerCase()) ||
            fileNameClean.includes(skuBaseClean);

          return isPrefixMatch || isContainsMatch;
        });

        // Smart matching strategy for multiple potential matches
        if (potentialMatches.length > 1) {
          // Strategy 1: Most specific match (prioritize prefix matches with SKU base)
          const specificMatches = potentialMatches.map(sku => {
            // Extract SKU base (without size code)
            const skuBase = extractSKUBase(sku.sku);
            const skuBaseClean = skuBase.toLowerCase().replace(/[-_\s]/g, '');

            // Check if it's a prefix match (highest priority)
            const isPrefixMatch = fileNameClean.startsWith(skuBaseClean) ||
              fileNameWithoutExt.toLowerCase().startsWith(skuBase.toLowerCase());

            // Check if it's an exact match (medium priority)
            const isExactMatch = fileNameClean === skuBaseClean;

            // Check if it's a contains match (lowest priority)
            const isContainsMatch = fileNameClean.includes(skuBaseClean) ||
              fileNameWithoutExt.includes(skuBase.toLowerCase());

            // Calculate score with priority weighting
            let score = 0;
            if (isPrefixMatch) {
              score = (fileNameClean.length + skuBaseClean.length) * 3; // Highest weight
            } else if (isExactMatch) {
              score = (fileNameClean.length + skuBaseClean.length) * 2; // Medium weight
            } else if (isContainsMatch) {
              score = fileNameClean.length + skuBaseClean.length; // Lowest weight
            }

            return {
              sku,
              score,
              isPrefixMatch,
              isExactMatch,
              isContainsMatch
            };
          });

          // Sort by score (longer overlap = better match)
          specificMatches.sort((a, b) => b.score - a.score);

          // Strategy 2: Check for variant options matching in filename
          const fileNameTokens = fileNameWithoutExt.split(/[-_\s]/).filter(Boolean);
          let bestMatch = specificMatches[0]?.sku;

          // Strategy 3: Try to match any variant option value
          if (fileNameTokens.length > 1) {
            for (const token of fileNameTokens) {
              const optionMatch = potentialMatches.find(sku => {
                if (!sku.selectedOptions) return false;
                return sku.options.selectedOptions.some((opt: any) =>
                  opt.value.toLowerCase().includes(token.toLowerCase()) ||
                  token.toLowerCase().includes(opt.value.toLowerCase())
                );
              });
              if (optionMatch) {
                bestMatch = optionMatch;
                break;
              }
            }
          }

          matchedSKU = bestMatch || specificMatches[0]?.sku || potentialMatches[0];

          // Log matching details
          if (bestMatch) {
            const matchInfo = specificMatches.find(m => m.sku === bestMatch);
            const matchType = matchInfo?.isPrefixMatch ? 'PREFIX' :
              matchInfo?.isExactMatch ? 'EXACT' :
                matchInfo?.isContainsMatch ? 'CONTAINS' : 'UNKNOWN';

            const skuBase = extractSKUBase(bestMatch.sku);
            logProgress(`  🎯 Smart Match`, `Selected SKU Base: ${skuBase} (from ${bestMatch.sku}) → Product: ${bestMatch.productTitle} (${matchType})`);
            if (bestMatch.color) {
              logProgress(`     🎨 Color Variant`, `${bestMatch.color} • Price: $${bestMatch.price} • Stock: ${bestMatch.inventoryQuantity}`);
            }
          } else {
            const skuBase = extractSKUBase(matchedSKU.sku);
            logProgress(`  🎲 Fallback Match`, `Using SKU Base: ${skuBase} (from ${matchedSKU.sku}) → Product: ${matchedSKU.productTitle}`);
          }
        } else if (potentialMatches.length === 1) {
          matchedSKU = potentialMatches[0];
          const skuBase = extractSKUBase(matchedSKU.sku);
          logProgress(`  ✅ Unique Match`, `Found single match: SKU Base: ${skuBase} (from ${matchedSKU.sku}) → Product: ${matchedSKU.productTitle}`);
          if (matchedSKU.color) {
            logProgress(`     🎨 Only Variant`, `${matchedSKU.color} • Price: $${matchedSKU.price} • Stock: ${matchedSKU.inventoryQuantity}`);
          }
        }

        skuMatchType = matchedSKU ? 'contains' : 'none';

        // Log when no SKU match is found for contains mode debugging
        if (!matchedSKU) {
          logProgress(`  ❌ No Contains Match`, `${fileName} → No matching SKU found in contains mode`);
          logProgress(`     📝 Debug Info`, `Clean filename: ${fileNameClean}`);
          if (availableSKUs.length > 0) {
            logProgress(`     📦 Available SKUs`, `${availableSKUs.length} SKUs available for matching`);
            // Show first few SKUs for debugging
            const sampleSKUs = availableSKUs.slice(0, 3).map(s => {
              const skuBase = extractSKUBase(s.sku);
              return `${s.sku} → ${skuBase}`;
            }).join(', ');
            logProgress(`     🔍 Sample SKUs`, sampleSKUs + (availableSKUs.length > 3 ? '...' : ''));
          }
        }
      }

      // Build match details
      if (matchedSKU) {
        matchDetails = {
          sku: matchedSKU.sku,
          productTitle: matchedSKU.productTitle,
          color: matchedSKU.color,
          productId: matchedSKU.productId,
          variantId: matchedSKU.id,
          price: matchedSKU.price,
          inventoryQuantity: matchedSKU.inventoryQuantity
        };
      }
    }

    // Step: Simulate Shopify upload processing with enhanced results
    const simulatedShopifyFileId = matchedSKU
      ? `shopify_${matchedSKU.id}_${file.id}_${Date.now()}`
      : `shopify_dry_${file.id}_${Date.now()}`;

    const simulatedUrl = matchedSKU
      ? `https://cdn.shopify.com/s/files/1/0000/0000/files/${encodeURIComponent(fileName)}?v=${Date.now()}&sku=${matchedSKU.sku}`
      : `https://cdn.shopify.com/s/files/1/0000/0000/files/${encodeURIComponent(fileName)}?v=${Date.now()}`;

    const estimatedUploadTime = Math.round(fileSize / (1024 * 1024) * 2);
    const wouldOverwrite = config.conflictResolution === 'overwrite';

    // Determine success status - SKIP if no SKU match OR no valid image type
    let status = 'success';
    let message = '';
    let shouldUpload = true;

    const imageType = detectImageType(fileName);
    const hasValidSKU = !!matchedSKU;
    const hasValidImageType = !!imageType;

    if (!hasValidSKU || !hasValidImageType) {
      status = 'skipped';

      if (!hasValidSKU) {
        message = 'Skipped: No SKU match found';
      } else {
        message = 'Skipped: Invalid or missing image type (room/hover required)';
      }

      shouldUpload = false;
    } else {
      message = `Would upload and associate with ${matchedSKU.color ? matchedSKU.color + ' variant' : 'variant'}: ${matchedSKU.sku} (${matchedSKU.productTitle})`;

      // Simulate metafield update
      message += ` | Metafield Update: ${imageType} image for color "${matchedSKU.color}"`;

      if (matchedSKU.inventoryQuantity === 0) {
        status = 'warning';
        message += ` (Warning: SKU is out of stock)`;
      }
    }

    return {
      googleFileId: file.id,
      fileName,
      fileSize,
      mimeType,
      status,
      shopifyFileId: shouldUpload ? simulatedShopifyFileId : null,
      shopifyUrl: shouldUpload ? simulatedUrl : null,
      message,
      shouldUpload, // New field to indicate if file should be uploaded
      skuMatch: matchDetails, // Enhanced SKU match details
      metafieldUpdate: shouldUpload && matchedSKU ? {
        productId: matchedSKU.productId,
        color: matchedSKU.color,
        imageType: detectImageType(fileName),
        imageUrl: shouldUpload ? simulatedUrl : null,
        wouldUpdate: !!detectImageType(fileName)
      } : null,
      processingDetails: {
        skuTarget: config.skuTarget,
        conflictResolution: config.conflictResolution,
        estimatedUploadTime,
        wouldOverwrite,
        matchType: skuMatchType,
        simulatedProcessing: {
          validation: 'PASSED',
          sizeCheck: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
          formatCheck: mimeType,
          nameCheck: `${fileName.length} characters`,
          shopifyDestination: matchedSKU ?
            `Product: ${matchedSKU.productTitle} - ${matchedSKU.color || 'Default'}` :
            'CDN upload simulation'
        }
      }
    };
  };

  return (
    <s-page heading="Upload Image">
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
                <s-option value="exact-sku">Exact SKU Match</s-option>
                <s-option value="contains-sku">Contains SKU</s-option>
              </s-select>
              {errors.skuTarget && (
                <s-text-container tone="critical">
                  <s-text as="p" variant="bodySm">{errors.skuTarget.message}</s-text>
                </s-text-container>
              )}
            </s-box>

            {/* Conflict Resolution - Hidden field with default value "rename" */}
            <input
              type="hidden"
              {...register("conflictResolution")}
              value="rename"
            />
          </s-stack>

          <div style={{ marginTop: '32px' }}>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                type="submit"
                disabled={!isValid || isSubmitting || uploadProgress.status !== 'idle'}
                loading={isSubmitting}
              >
                {uploadProgress.status === 'connecting' && 'Connecting...'}
                {uploadProgress.status === 'uploading' && 'Uploading...'}
                {uploadProgress.status === 'processing' && 'Processing...'}
                {uploadProgress.status === 'completing' && 'Completing...'}
                {uploadProgress.status === 'error' && 'Upload Failed'}
                {!isSubmitting && uploadProgress.status === 'idle' && "Start Upload"}
              </s-button>
              <s-button
                variant="secondary"
                onClick={async () => await handleDryUpload()}
                disabled={isSubmitting || uploadProgress.status !== 'idle' || !selectedFolder || !isValid}
                loading={isDryRunning}
              >
                🧪 Dry Upload
              </s-button>
              <s-button
                variant="plain"
                onClick={() => {
                  reset();
                  setUploadResults(null);
                  setDryResults(null);
                  setUploadProgress({
                    totalFiles: 0,
                    processedFiles: 0,
                    currentFile: '',
                    status: 'idle',
                    message: '',
                    percentage: 0
                  });
                }}
                disabled={isSubmitting || uploadProgress.status !== 'idle'}
              >
                Reset
              </s-button>
            </s-stack>
          </div>
        </form>
      </s-section>

      {/* Upload Progress Section */}
      {uploadProgress.status !== 'idle' && (
        <s-section heading="Upload Progress">
          <s-box padding="base" borderWidth="base" borderRadius="base" background={
            uploadProgress.status === 'error' ? 'critical-subdued' :
              uploadProgress.status === 'completing' ? 'success-subdued' : 'info-subdued'
          }>
            <s-stack direction="block" gap="base">
              <s-heading level="4">
                {uploadProgress.status === 'connecting' && '🔄 Connecting...'}
                {uploadProgress.status === 'uploading' && '📤 Uploading...'}
                {uploadProgress.status === 'processing' && '⚙️ Processing...'}
                {uploadProgress.status === 'completing' && '✅ Completing...'}
                {uploadProgress.status === 'error' && '❌ Upload Failed'}
              </s-heading>

              {/* Progress Bar */}
              <s-box padding="base" background="surface" borderRadius="base">
                <s-paragraph>
                  <strong>{uploadProgress.message}</strong>
                  {uploadProgress.currentFile && (
                    <span><br />Current file: {uploadProgress.currentFile}</span>
                  )}
                </s-paragraph>

                {/* Custom Progress Bar */}
                <div style={{
                  width: '100%',
                  height: '20px',
                  backgroundColor: '#e5e7eb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginTop: '8px'
                }}>
                  <div style={{
                    width: `${uploadProgress.percentage}%`,
                    height: '100%',
                    backgroundColor: uploadProgress.status === 'error' ? '#dc2626' :
                      uploadProgress.status === 'completing' ? '#059669' : '#2563eb',
                    transition: 'width 0.3s ease-in-out',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {uploadProgress.percentage > 10 && `${uploadProgress.percentage}%`}
                  </div>
                </div>

                {uploadProgress.totalFiles > 0 && (
                  <s-paragraph style={{ marginTop: '8px' }}>
                    Progress: {uploadProgress.processedFiles} / {uploadProgress.totalFiles} files
                  </s-paragraph>
                )}
              </s-box>

              {/* Warning Message */}
              {uploadProgress.status === 'uploading' || uploadProgress.status === 'processing' ? (
                <s-box padding="base" background="warning-subdued" borderRadius="base">
                  <s-heading level="5" tone="warning">⚠️ Important Notice</s-heading>
                  <s-paragraph>
                    Please <strong>DO NOT CLOSE</strong> this browser window or navigate away from this page while the upload is in progress.
                    Doing so may interrupt the upload process and cause file corruption or incomplete uploads.
                  </s-paragraph>
                  <s-paragraph>
                    The upload may take several minutes depending on the number and size of your files.
                    You will see a progress bar above showing the current status.
                  </s-paragraph>
                </s-box>
              ) : null}

              {/* Error Details */}
              {uploadProgress.status === 'error' && (
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-heading level="5" tone="critical">Error Details</s-heading>
                  <s-paragraph>{uploadProgress.message}</s-paragraph>
                  <s-paragraph>
                    Please check your internet connection and try again. If the problem persists, contact support.
                  </s-paragraph>
                </s-box>
              )}

              {/* Success Message */}
              {uploadProgress.status === 'completing' && (
                <s-box padding="base" background="success-subdued" borderRadius="base">
                  <s-heading level="5" tone="success">🎉 Upload Almost Complete!</s-heading>
                  <s-paragraph>
                    Your files have been successfully uploaded to Shopify. Finalizing the results...
                  </s-paragraph>
                </s-box>
              )}
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
                    <strong>✅ Will Upload:</strong> {dryResults.successCount}
                  </s-paragraph>
                </s-box>
                {dryResults.skippedCount > 0 && (
                  <s-box padding="base" background="warning-subdued" borderRadius="base">
                    <s-paragraph>
                      <strong>⏭️ Skipped:</strong> {dryResults.skippedCount}
                    </s-paragraph>
                  </s-box>
                )}
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-paragraph>
                    <strong>❌ Would Fail:</strong> {dryResults.errorCount}
                  </s-paragraph>
                </s-box>
                <s-box padding="base" background="surface" borderRadius="base">
                  <s-paragraph>
                    <strong>🎯 SKU Matched:</strong> {dryResults.matchedCount}
                  </s-paragraph>
                </s-box>
                {dryResults.metafieldUpdates > 0 && (
                  <s-box padding="base" background="info-subdued" borderRadius="base">
                    <s-paragraph>
                      <strong>🔗 Metafield Updates:</strong> {dryResults.metafieldUpdates}
                    </s-paragraph>
                  </s-box>
                )}
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
                        color: result.status === 'success' ? '#059669' :
                          result.status === 'warning' ? '#d97706' :
                            result.status === 'skipped' ? '#6b7280' : '#dc2626'
                      }}>
                        <strong>{result.fileName}</strong><br />
                        Status: {result.status.toUpperCase()}<br />
                        {result.message && `Message: ${result.message}`}
                        {result.shopifyFileId && `Shopify ID: ${result.shopifyFileId}`}
                        {result.processingDetails?.skuMatch?.matchedSKU && (
                          <span><br />SKU Match: {result.processingDetails.skuMatch.matchedSKU.sku} ({result.processingDetails.skuMatch.matchedSKU.productTitle})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Upload Results Section */}
      {uploadResults && (
        <s-section heading="Upload Results">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="success-subdued">
            <s-stack direction="block" gap="base">
              <s-heading level="4">🎉 Upload Complete!</s-heading>

              <s-stack direction="inline" gap="large" alignment="center">
                <s-box padding="base" background="surface" borderRadius="base">
                  <s-paragraph>
                    <strong>📁 Total Files:</strong> {uploadResults.totalFiles}
                  </s-paragraph>
                </s-box>
                <s-box padding="base" background="success-subdued" borderRadius="base">
                  <s-paragraph>
                    <strong>✅ Uploaded:</strong> {uploadResults.uploadedFiles}
                  </s-paragraph>
                </s-box>
                {uploadResults.matchedFiles > 0 && (
                  <s-box padding="base" background="info-subdued" borderRadius="base">
                    <s-paragraph>
                      <strong>🔗 Products Matched:</strong> {uploadResults.matchedFiles}
                    </s-paragraph>
                  </s-box>
                )}
                {uploadResults.metafieldUpdates > 0 && (
                  <s-box padding="base" background="info-subdued" borderRadius="base">
                    <s-paragraph>
                      <strong>🖼️ Metafields Updated:</strong> {uploadResults.metafieldUpdates}
                    </s-paragraph>
                  </s-box>
                )}
                {uploadResults.failedFiles > 0 && (
                  <s-box padding="base" background="critical-subdued" borderRadius="base">
                    <s-paragraph>
                      <strong>❌ Failed:</strong> {uploadResults.failedFiles}
                    </s-paragraph>
                  </s-box>
                )}
              </s-stack>

              <s-box padding="base" background="surface" borderRadius="base">
                <s-paragraph>
                  Your images have been successfully uploaded to Shopify and linked to the corresponding products!<br />
                  <strong>Request ID:</strong> {uploadResults.requestId}<br />
                  <strong>Completed at:</strong> {new Date(uploadResults.timestamp).toLocaleString()}
                </s-paragraph>
              </s-box>

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="plain"
                  onClick={() => {
                    console.log('Upload results:', uploadResults);
                  }}
                >
                  📊 View Details in Console
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={() => setUploadResults(null)}
                >
                  Clear Results
                </s-button>
              </s-stack>

              {uploadResults.results && uploadResults.results.length > 0 && (
                <details style={{ marginTop: '16px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px' }}>
                    📋 File Upload Details ({uploadResults.results.length} files)
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
                    {uploadResults.results.map((result: any, index: number) => (
                      <div key={index} style={{
                        marginBottom: '8px',
                        padding: '4px',
                        borderBottom: '1px solid #e5e7eb',
                        color: result.status === 'success' ? '#059669' : '#dc2626'
                      }}>
                        <strong>{result.fileName}</strong><br />
                        Status: {result.status.toUpperCase()}<br />
                        {result.shopifyUrl && (
                          <span>
                            Shopify URL: <a href={result.shopifyUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                              {result.shopifyUrl.substring(0, 50)}...
                            </a><br />
                          </span>
                        )}
                        {result.skuMatch && (
                          <span>
                            Product: <strong>{result.skuMatch.productTitle}</strong><br />
                            SKU: {result.skuMatch.sku}<br />
                            Color: {result.skuMatch.color}<br />
                            Type: {result.imageType}<br />
                          </span>
                        )}
                        Message: {result.message}
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