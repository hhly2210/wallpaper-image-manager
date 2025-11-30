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
  const [skuData, setSkuData] = useState<any[]>([]);
  const [flattenedSKUs, setFlattenedSKUs] = useState<any[]>([]); // For UI display
  const [isLoadingSKUs, setIsLoadingSKUs] = useState(false);
  const [skuError, setSkuError] = useState<string | null>(null);

  // Separate data store specifically for Dry Upload processing
  const [dryUploadSKUs, setDryUploadSKUs] = useState<any[]>([]);

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

        addProgressLog('📦 Shopify Cache', `Loaded ${cached.flattened.length} variants from cache (${Math.round((Date.now() - cached.timestamp) / 1000 / 60)} minutes old)`);
        return cached.flattened;
      }
    }

    setIsLoadingSKUs(true);
    setSkuError(null);

    try {
      addProgressLog('🛒 Shopify Sync', forceRefresh ? 'Refreshing SKU data from Shopify...' : 'Bắt đầu lấy danh sách SKU từ Shopify...');

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

        addProgressLog('✅ Shopify Sync', `Đã lấy ${flattened.length} variants từ ${data.data.length} products`);
        addProgressLog('📊 SKU Summary', `- Total Products: ${data.summary?.totalProducts || 0}- Products with SKUs: ${data.summary?.productsWithSKUs || 0}- Total Variants: ${data.summary?.totalVariants || 0}- Valid SKUs: ${flattened.length}`);
        addProgressLog('🎨 Color Filter', `Chỉ variants có Color option được bao gồm`);
        addProgressLog('🏷️ Product Type', `Product Organization = "Wallpaper"`);
        addProgressLog('💾 Cache', 'SKU data saved for 24 hours');

        return flattened;
      } else {
        throw new Error(data.error || 'Invalid response format');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setSkuError(errorMessage);
      addProgressLog('❌ Shopify Sync Error', `Không thể lấy SKU: ${errorMessage}`);
      console.error('Failed to fetch SKUs:', error);
      return [];
    } finally {
      setIsLoadingSKUs(false);
    }
  };

  // Function to load SKUs specifically for Dry Upload
  const loadSKUsForDryUpload = async () => {
    addProgressLog('🎯 DRY UPLOAD PREP', 'Loading SKUs for Dry Upload processing...');

    const skus = await fetchSKUsFromShopify();

    if (skus.length > 0) {
      setDryUploadSKUs(skus); // Load into separate Dry Upload store
      addProgressLog('✅ DRY UPLOAD READY', `Loaded ${skus.length} SKUs for Dry Upload processing`);
    } else {
      addProgressLog('❌ DRY UPLOAD FAILED', 'No SKUs available for Dry Upload');
    }

    return skus;
  };

  // Auto-check SKU data availability before dry upload
  const checkSKUDataAvailability = () => {
    console.log('🔍 SKU DATA CHECK:', {
      flattenedSKUs: flattenedSKUs.length, // UI data
      dryUploadSKUs: dryUploadSKUs.length, // Dry Upload data
      isLoadingSKUs,
      skuError,
      skuData: skuData.length,
      hasFlattenedSKUs: flattenedSKUs.length > 0,
      hasDryUploadSKUs: dryUploadSKUs.length > 0,
      hasSkuData: skuData.length > 0
    });

    // Log first few SKUs for debugging
    if (dryUploadSKUs.length > 0) {
      console.log('📋 SAMPLE DRY UPLOAD SKUs:', dryUploadSKUs.slice(0, 3).map(sku => ({
        sku: sku.sku,
        title: sku.title,
        color: sku.color
      })));
    }

    return dryUploadSKUs.length > 0; // Use dryUploadSKUs instead
  };

  // Client-side dry upload simulation
  const handleDryUpload = async () => {
    // Only run on client side
    if (typeof window === 'undefined') {
      console.error('Dry upload can only run on client side');
      return;
    }

    console.log('🚨 START DRY UPLOAD', {
      flattenedSKUs: flattenedSKUs.length, // UI data
      dryUploadSKUs: dryUploadSKUs.length, // Dry Upload data
      isLoadingSKUs,
      skuError,
      skuData: skuData.length
    });

    // Check if we have Dry Upload SKU data, if not suggest fetching
    if (dryUploadSKUs.length === 0 && !isLoadingSKUs) {
      addProgressLog('⚠️ WARNING', 'No SKU data available for Dry Upload! Click "Load SKUs for Dry Upload" first.');
      console.log('⚠️ No Dry Upload SKU data available - suggesting fetch to user');
    }

    setIsDryRunning(true);
    setDryResults(null);
    setDryUploadProgress([]); // Clear previous progress

    try {
      // BƯỚC 1: Validate input
      addProgressLog('BƯỚC 1', 'Kiểm tra đầu vào');

      // Check SKU data availability
      const hasSKUs = checkSKUDataAvailability();
      if (!hasSKUs) {
        addProgressLog('⚠️ SKU Warning', 'No SKU data available - files will be processed as general uploads');
      }

      // Critical Debug: Check SKU data states early
      console.log('🚨 DEBUG SKU STATES:', {
        flattenedSKUs: flattenedSKUs.length,
        isLoadingSKUs,
        skuError,
        skuData: skuData.length
      });

      addProgressLog('🔍 DEBUG SKU', `flattenedSKUs: ${flattenedSKUs.length} (UI), dryUploadSKUs: ${dryUploadSKUs.length} (Dry Upload), isLoading: ${isLoadingSKUs}, error: ${!!skuError}`);

      // Auto-load SKUs for Dry Upload if needed
      if (dryUploadSKUs.length === 0 && !isLoadingSKUs && !skuError) {
        addProgressLog('BƯỚC 1.5', 'Tải dữ liệu SKU cho Dry Upload');
        addProgressLog('🎯 Loading SKUs', 'Dry Upload chưa có SKU data - đang tải từ Shopify...');
        const autoLoadedSKUs = await loadSKUsForDryUpload();
        if (autoLoadedSKUs.length > 0) {
          addProgressLog('✅ SKUs Loaded', `Đã tải ${autoLoadedSKUs.length} SKUs cho Dry Upload processing`);
        }
      } else if (dryUploadSKUs.length > 0) {
        addProgressLog('✅ READY', `Using ${dryUploadSKUs.length} SKUs for Dry Upload`);
      } else if (isLoadingSKUs) {
        addProgressLog('⏳ LOADING', 'SKU data loading...');
      } else {
        addProgressLog('❌ ERROR', `SKU error: ${skuError}`);
      }

      const formData = getValues();
      const selectedFolderId = getSelectedFolder();

      // Early validation check
      if (!selectedFolderId) {
        addProgressLog('❌ EARLY STOP', 'Không có folder được chọn');
        throw new Error('Please select a Google Drive folder first');
      }

      addProgressLog('Form Data', JSON.stringify(formData, null, 2));
      addProgressLog('Selected Folder', selectedFolderId);

      // Critical: Check if we have SKU data before proceeding
      addProgressLog('🚨 PRE-PROCESS CHECK', `Will process with ${dryUploadSKUs.length} SKUs available for Dry Upload`);

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
        formData,
        dryUploadSKUs // Use separate Dry Upload SKU data
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

      // Step 3.3: Xử lý từng file với SKU matching
      addProgressLog('🔄 File Processing', `Bắt đầu xử lý ${files.length} files với ${availableSKUs.length} variants available...`);

      const processedFiles = [];
      let successCount = 0;
      let errorCount = 0;
      let matchedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileNumber = i + 1;

        addProgressLog(`🖼️ File ${fileNumber}/${files.length}`, `Processing: ${file.name}`);

        try {
          // Step 3.3.1: Validate file
          addProgressLog(`  🔍 Validation ${fileNumber}`, `Kiểm tra ${file.name} (${file.mimeType}, ${file.size} bytes)`);

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
            addProgressLog(`  ✅ Success ${fileNumber}`, `${file.name} → Product: "${simulatedResult.skuMatch.productTitle}"`);
            addProgressLog(`     📦 SKU: ${simulatedResult.skuMatch.sku}`, `• Variant: ${simulatedResult.skuMatch.color || 'Default'} • Price: $${simulatedResult.skuMatch.price} • Stock: ${simulatedResult.skuMatch.inventoryQuantity}`);
          } else {
            addProgressLog(`  ✅ Success ${fileNumber}`, `${file.name} → No SKU match (general upload)`);
          }
          } else if (simulatedResult.status === 'warning') {
            successCount++; // Warnings still count as success
            if (simulatedResult.skuMatch) {
              addProgressLog(`  ⚠️ Warning ${fileNumber}`, `${file.name} → Product: "${simulatedResult.skuMatch.productTitle}"`);
              addProgressLog(`     ⚠️ Issue: ${simulatedResult.message}`);
            } else {
              addProgressLog(`  ⚠️ Warning ${fileNumber}`, `${file.name} → ${simulatedResult.message}`);
            }
          } else {
            errorCount++;
            addProgressLog(`  ❌ Error ${fileNumber}`, `${file.name} → ${simulatedResult.message}`);
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
      addProgressLog('📈 Final Summary', `Đã xử lý xong: ${successCount} thành công, ${errorCount} lỗi, ${matchedCount} matched SKU trong ${processingTime}ms`);

      const results = {
        dryRun: true,
        folderId,
        config,
        totalFiles: files.length,
        successCount,
        errorCount,
        matchedCount, // NEW: Number of files with SKU matches
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
        // Exact match with SKU
        matchedSKU = availableSKUs.find(sku => {
          const skuClean = sku.sku.toLowerCase().replace(/[-_\s]/g, '');
          return skuClean === fileNameClean ||
                 sku.sku.toLowerCase() === fileNameWithoutExt ||
                 fileNameWithoutExt.includes(sku.sku.toLowerCase());
        });
        skuMatchType = matchedSKU ? 'exact' : 'none';

      } else if (config.skuTarget === 'contains-sku') {
        // Enhanced contains match with SKU and color
        const potentialMatches = availableSKUs.filter(sku => {
          const skuClean = sku.sku.toLowerCase().replace(/[-_\s]/g, '');
          return fileNameWithoutExt.includes(sku.sku.toLowerCase()) ||
                 sku.sku.toLowerCase().includes(fileNameWithoutExt) ||
                 fileNameClean.includes(skuClean) ||
                 skuClean.includes(fileNameClean);
        });

        // Smart matching strategy for multiple potential matches
        if (potentialMatches.length > 1) {
          // Strategy 1: Most specific match (longest matching string)
          const specificMatches = potentialMatches.map(sku => {
            const skuClean = sku.sku.toLowerCase().replace(/[-_\s]/g, '');
            const overlap = fileNameClean.length > skuClean.length ?
              fileNameClean.includes(skuClean) : skuClean.includes(fileNameClean);
            return {
              sku,
              score: overlap ? (fileNameClean.length + skuClean.length) : 0,
              exactMatch: fileNameClean === skuClean
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
                if (!sku.options?.selectedOptions) return false;
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
          if (matchedMatch) {
            addProgressLog(`  🎯 Smart Match`, `Selected SKU: ${matchedMatch.sku} → Product: ${matchedMatch.productTitle}`);
            if (matchedMatch.color) {
              addProgressLog(`     🎨 Color Variant`, `${matchedMatch.color} • Price: $${matchedMatch.price} • Stock: ${matchedMatch.inventoryQuantity}`);
            }
          } else {
            addProgressLog(`  🎲 Fallback Match`, `Using: ${matchedSKU.sku} → Product: ${matchedSKU.productTitle}`);
          }
        } else if (potentialMatches.length === 1) {
          matchedSKU = potentialMatches[0];
          addProgressLog(`  ✅ Unique Match`, `Found single match: ${matchedSKU.sku} → Product: ${matchedSKU.productTitle}`);
          if (matchedSKU.color) {
            addProgressLog(`     🎨 Only Variant`, `${matchedSKU.color} • Price: $${matchedSKU.price} • Stock: ${matchedSKU.inventoryQuantity}`);
          }
        }

        skuMatchType = matchedSKU ? 'contains' : 'none';
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

    // Determine success status
    let status = 'success';
    let message = matchedSKU
      ? `Would upload and associate with ${matchedSKU.color ? matchedSKU.color + ' variant' : 'variant'}: ${matchedSKU.sku} (${matchedSKU.productTitle})`
      : 'Would upload without SKU association';

    if (matchedSKU && matchedSKU.inventoryQuantity === 0) {
      status = 'warning';
      message += ` (Warning: SKU is out of stock)`;
    }

    return {
      googleFileId: file.id,
      fileName,
      fileSize,
      mimeType,
      status,
      shopifyFileId: simulatedShopifyFileId,
      shopifyUrl: simulatedUrl,
      message,
      skuMatch: matchDetails, // Enhanced SKU match details
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
                variant={dryUploadSKUs.length > 0 ? "secondary" : "plain"}
                onClick={async () => await handleDryUpload()}
                disabled={isSubmitting || !selectedFolder || !isValid}
                loading={isDryRunning}
                tone={dryUploadSKUs.length === 0 ? "critical" : undefined}
              >
                🧪 Dry Upload {dryUploadSKUs.length === 0 && "(No SKUs)"}
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

      {/* SKU Status Section */}
      <s-section heading="🛒 Shopify SKU Status">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="info-subdued">
          <s-stack direction="block" gap="small">
            <s-heading level="4">Wallpaper SKU Data Status</s-heading>

            {isLoadingSKUs ? (
              <s-stack direction="inline" alignment="center" gap="base">
                <s-box padding="base" background="surface" borderRadius="base">
                  <s-stack direction="inline" alignment="center" gap="small">
                    <s-text as="span">🔄 Loading Wallpaper SKU data from Shopify...</s-text>
                  </s-stack>
                </s-box>
              </s-stack>
            ) : skuError ? (
              <s-stack direction="block" gap="base">
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-paragraph tone="critical">
                    <strong>❌ SKU Fetch Error:</strong> {skuError}
                  </s-paragraph>
                </s-box>
                <s-button
                  variant="primary"
                  onClick={() => fetchSKUsFromShopify()}
                  disabled={isLoadingSKUs}
                >
                  🔄 Retry Fetching SKUs
                </s-button>
              </s-stack>
            ) : skuData.length > 0 ? (
              <s-stack direction="block" gap="base">
                <s-box padding="base" background="success-subdued" borderRadius="base">
                  <s-paragraph tone="success">
                    <strong>✅ Wallpaper SKU Data Available:</strong> {flattenedSKUs.length} variants from {skuData.length} products
                  </s-paragraph>
                </s-box>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="plain"
                    onClick={() => {
                      console.log('SKU Data:', skuData);
                      alert('SKU data logged to console');
                    }}
                  >
                    📊 View Wallpaper SKUs in Console
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => setSkuData([])}
                  >
                    🗑️ Clear Wallpaper SKU Data
                  </s-button>
                  <s-button
                    variant="primary"
                    onClick={() => fetchSKUsFromShopify()}
                    disabled={isLoadingSKUs}
                  >
                    🔄 Refresh Wallpaper SKUs
                  </s-button>
                </s-stack>
              </s-stack>
            ) : (
              <s-stack direction="block" gap="base">
                <s-box padding="base" background="surface" borderRadius="base">
                  <s-paragraph>
                    <strong>ℹ️ No Wallpaper SKU Data:</strong> Click the button below to fetch Wallpaper SKUs from Shopify
                  </s-paragraph>
                </s-box>
                <s-button
                  variant="primary"
                  onClick={() => fetchSKUsFromShopify()}
                  disabled={isLoadingSKUs}
                >
                  🛒 Fetch Wallpaper SKUs from Shopify
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* Dry Upload SKU Management Section */}
      <s-section heading="🎯 Dry Upload SKU Management">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="info-subdued">
          <s-stack direction="block" gap="small">
            <s-heading level="4">Dry Upload Processing Data</s-heading>
            <s-paragraph>
              <strong>💡 Separate from UI display - This data is used specifically for Dry Upload processing</strong>
            </s-paragraph>

            {dryUploadSKUs.length > 0 ? (
              <s-stack direction="block" gap="base">
                <s-box padding="base" background="success-subdued" borderRadius="base">
                  <s-paragraph tone="success">
                    <strong>✅ Dry Upload SKUs Ready:</strong> {dryUploadSKUs.length} variants available for processing
                  </s-paragraph>
                </s-box>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="plain"
                    onClick={() => {
                      console.log('Dry Upload SKUs:', dryUploadSKUs);
                      alert('Dry Upload SKU data logged to console');
                    }}
                  >
                    📊 View Dry Upload SKUs
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => setDryUploadSKUs([])}
                  >
                    🗑️ Clear Dry Upload SKUs
                  </s-button>
                  <s-button
                    variant="primary"
                    onClick={() => loadSKUsForDryUpload()}
                    disabled={isLoadingSKUs}
                  >
                    🔄 Refresh Dry Upload SKUs
                  </s-button>
                </s-stack>
              </s-stack>
            ) : (
              <s-stack direction="block" gap="base">
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-paragraph tone="critical">
                    <strong>❌ No Dry Upload SKUs:</strong> Dry Upload will process files as general uploads without SKU matching
                  </s-paragraph>
                </s-box>
                <s-button
                  variant="primary"
                  onClick={() => loadSKUsForDryUpload()}
                  disabled={isLoadingSKUs}
                >
                  🎯 Load SKUs for Dry Upload
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-box>
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
                        color: result.status === 'success' ? '#059669' :
       result.status === 'warning' ? '#d97706' : '#dc2626'
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

          </s-page>
  );
}