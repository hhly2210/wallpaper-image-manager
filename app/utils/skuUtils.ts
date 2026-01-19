import { authenticate } from "../shopify.server";

/**
 * Shared utility functions for SKU fetching and matching
 * Used by both Dry Upload (client-side via API) and Start Upload (server-side)
 */

// Interface for SKU data structure
export interface SKUVariant {
  id: string;
  sku: string;
  title: string;
  price: string;
  inventoryQuantity: number;
  color: string | null;
  productId: string;
  productHandle: string;
  productTitle: string;
  productType: string;
  productTags: string[];
  selectedOptions?: Array<{ name: string; value: string }>;
}

// Interface for Product data structure
export interface ProductWithVariants {
  id: string;
  handle: string;
  title: string;
  status: string;
  productType: string;
  tags: string[];
  variants: SKUVariant[];
}

// Result interface for SKU fetch
export interface SKUFetchResult {
  success: boolean;
  data: ProductWithVariants[];
  flattenedSKUs: SKUVariant[];
  summary: {
    totalProducts: number;
    productsWithSKUs: number;
    totalVariants: number;
    wallpaperProducts: number;
  };
}

/**
 * Build query string for filtering Wallpaper products
 * Matches the logic in /api/shopify/skus
 */
export function buildWallpaperQuery(): string {
  return 'product_type:"Wallpaper" OR product_type:wallpaper OR tag:wallpaper OR tag:Wallpaper';
}

/**
 * Fetch SKU data from Shopify with consistent filtering
 * Used by both Dry Upload (via API) and Start Upload (direct call)
 *
 * @param admin - Shopify admin GraphQL client
 * @param maxProducts - Maximum number of products to fetch (default: 250)
 * @returns SKU fetch result with products and flattened variants
 */
export async function fetchSKUDataFromShopify(
  admin: any,
  maxProducts: number = 250
): Promise<SKUFetchResult> {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] [SKU UTILS] Fetching SKU data from Shopify...`);

  // GraphQL query to fetch products
  const skuQuery = `
    query getProducts($first: Int!, $query: String) {
      products(first: $first, query: $query) {
        edges {
          node {
            id
            title
            handle
            status
            productType
            tags
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  title
                  price
                  inventoryQuantity
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  // Fetch all products using pagination
  let hasNextPage = true;
  let endCursor: string | null = null;
  let fetchedProducts = 0;
  const allProducts: any[] = [];
  let totalVariants = 0;

  while (hasNextPage && fetchedProducts < maxProducts) {
    const response = await admin.graphql(skuQuery, {
      variables: {
        first: Math.min(50, maxProducts - fetchedProducts),
        query: buildWallpaperQuery(),
        ...(endCursor ? { after: endCursor } : {})
      },
    });

    const data = await response.json();

    if (data?.data?.products?.edges) {
      const products = data.data.products.edges;
      allProducts.push(...products);
      fetchedProducts += products.length;

      // Check for more pages
      hasNextPage = data.data.products.pageInfo.hasNextPage;
      endCursor = data.data.products.pageInfo.endCursor;

      console.log(
        `[${requestId}] [SKU UTILS] Fetched ${products.length} products (total: ${fetchedProducts}, hasMore: ${hasNextPage})`,
      );
    } else {
      hasNextPage = false;
    }
  }

  console.log(
    `[${requestId}] [SKU UTILS] Total products fetched: ${fetchedProducts}`,
  );

  // Process products and extract variants with SKUs and Color option
  const productList: ProductWithVariants[] = [];
  const flattenedSKUs: SKUVariant[] = [];

  allProducts.forEach((productEdge: any) => {
    const product = productEdge.node;
    const variants = product.variants?.edges || [];

    // Filter variants with SKUs and Color option
    const variantsWithSKUs: SKUVariant[] = [];

    variants.forEach((variantEdge: any) => {
      const variant = variantEdge.node;

      // Only include variants with SKUs
      if (variant.sku && variant.sku.trim()) {
        // Check if variant has "Color" option
        const hasColorOption = variant.selectedOptions?.some((option: any) =>
          option.name.toLowerCase() === 'color'
        );

        // Only include variants that have a Color option
        if (hasColorOption) {
          const colorOption = variant.selectedOptions?.find((option: any) =>
            option.name.toLowerCase() === 'color'
          );

          const skuVariant: SKUVariant = {
            id: variant.id,
            sku: variant.sku.trim(),
            title: variant.title,
            price: variant.price,
            inventoryQuantity: variant.inventoryQuantity,
            color: colorOption?.value || null,
            selectedOptions: variant.selectedOptions,
            productId: product.id,
            productHandle: product.handle,
            productTitle: product.title,
            productType: product.productType,
            productTags: product.tags || [],
          };

          variantsWithSKUs.push(skuVariant);
          flattenedSKUs.push(skuVariant);
          totalVariants++;
        }
      }
    });

    // Only add product if it has variants with SKUs
    if (variantsWithSKUs.length > 0) {
      productList.push({
        id: product.id,
        handle: product.handle,
        title: product.title,
        status: product.status,
        productType: product.productType,
        tags: product.tags || [],
        variants: variantsWithSKUs,
      });
    }
  });

  // Log summary
  console.log(`[${requestId}] [SKU UTILS] SKU fetch summary:`, {
    totalProducts: fetchedProducts,
    productsWithSKUs: productList.length,
    totalVariants,
    wallpaperProducts: fetchedProducts, // All products are wallpaper due to query filter
  });

  // Log sample SKUs for debugging
  if (flattenedSKUs.length > 0) {
    const sampleSKUs = flattenedSKUs.slice(0, 5).map(s => s.sku);
    console.log(`[${requestId}] [SKU UTILS] Sample SKUs: ${sampleSKUs.join(', ')}...`);
  }

  return {
    success: true,
    data: productList,
    flattenedSKUs,
    summary: {
      totalProducts: fetchedProducts,
      productsWithSKUs: productList.length,
      totalVariants,
      wallpaperProducts: fetchedProducts,
    },
  };
}

/**
 * Extract base name from PDF filename (remove _SPEC.pdf or _spec.pdf suffix)
 * Supports both uppercase and lowercase _SPEC
 */
export function extractPDFBaseName(fileName: string): string {
  // Try _SPEC first (uppercase), then _spec (lowercase)
  let baseName = fileName.replace(/_SPEC\.pdf$/i, "");
  if (baseName === fileName) {
    // If _SPEC didn't match, try _spec
    baseName = fileName.replace(/_spec\.pdf$/i, "");
  }
  return baseName;
}

/**
 * Extract SKU base (cut at 3rd dash)
 * Input: "WP-SCALLOPS-SKY-2748" -> Output: "WP-SCALLOPS-SKY"
 */
export function extractSKUBase(sku: string): string {
  if (!sku) return "";

  const parts = sku.split("-");
  if (parts.length < 4) return sku; // Return original if less than 4 parts

  // Join first 3 parts (WP, SCALLOPS, SKY) and ignore the rest (size codes)
  return parts.slice(0, 3).join("-");
}

/**
 * Extract 3-char color code from SKU
 * Input: "WP-SCALLOPS-SKY-2748" -> Output: "SKY"
 */
export function getColorCodeFromSKU(sku: string): string {
  if (!sku) return "";

  const parts = sku.split("-");
  if (parts.length < 3) return "";

  // The 3rd part is the color code (index 2)
  return parts[2].toUpperCase();
}

/**
 * Validate color code in filename (for both images and PDFs)
 * STRICT FORMAT: Must follow WP-XXX-CCC[_type].ext where:
 * - CCC is exactly 3 characters (color code)
 * - For images: ends with _1.png or _2.png
 * - For PDF: ends with _SPEC.pdf or _spec.pdf
 * - NO extra parts like size codes allowed
 *
 * Valid examples:
 * - WP-SCALLOPS-DUS_1.png → Color: DUS ✓
 * - WP-SCALLOPS-DUS_2.png → Color: DUS ✓
 * - WP-SCALLOPS-DUS_SPEC.pdf → Color: DUS ✓
 *
 * Invalid examples:
 * - WP-SCALLOPS-DUSTY_ROSE-2748-1.png → Too many parts ✗
 * - WP-SCALLOPS-DUS-HOVER.png → Wrong suffix ✗
 */
export function validatePDFColorCode(
  fileName: string
): { valid: boolean; colorCode: string; baseName: string; reason?: string } {
  if (!fileName) {
    return { valid: false, colorCode: "", baseName: "", reason: "No filename provided" };
  }

  // Remove file extension
  const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, "");

  // Remove image type suffix from the end (_1, _2, _SPEC, _spec, _specs)
  let baseName = fileNameWithoutExt;
  const typeSuffixes = ['_1', '_2', '_SPEC', '_spec', '_specs'];

  let foundSuffix = '';
  for (const suffix of typeSuffixes) {
    if (baseName.endsWith(suffix)) {
      baseName = baseName.slice(0, -suffix.length);
      foundSuffix = suffix;
      break;
    }
  }

  // Split by "-" and validate structure
  const parts = baseName.split("-");

  // Must have exactly 3 parts: WP, product, color
  // Extra parts like size codes are NOT allowed
  if (parts.length !== 3) {
    return {
      valid: false,
      colorCode: "",
      baseName,
      reason: `Filename must have exactly 3 parts (WP-PRODUCT-COLOR), got ${parts.length} parts in "${fileName}"`,
    };
  }

  const colorCode = parts[2]; // 3rd part is the color code (index 2)

  if (colorCode.length !== 3) {
    return {
      valid: false,
      colorCode,
      baseName,
      reason: `Color code "${colorCode}" has ${colorCode.length} characters (must be exactly 3)`,
    };
  }

  return { valid: true, colorCode, baseName };
}

/**
 * Match PDF file with product SKU using improved 3-tier matching strategy
 * This function is used by both Dry Upload and Start Upload
 *
 * Strategy (UPDATED):
 * Tier 1: SKU Base Exact Match (highest priority) - Direct string comparison without removing dashes
 *   - PDF base name: WP-SCAL-DUS (from WP-SCAL-DUS_spec.pdf)
 *   - SKU base: WP-SCAL-DUS (from WP-SCAL-DUS-2424)
 *   - Match: WP-SCAL-DUS === WP-SCAL-DUS ✓
 *
 * Tier 2: Product Base Match (fallback if Tier 1 fails)
 *   - Try to match by extracting product base and comparing with available SKUs
 *   - Allows for partial matches and size variations
 *
 * Tier 3: Color-first Flexible Match (last resort)
 *   - Find SKUs with matching color code
 *   - Apply flexible product matching strategies
 *   - Log warning for manual verification
 *
 * @param fileName - PDF filename (e.g., "WP-SCAL-DUS_spec.pdf")
 * @param availableSKUs - Array of SKU variants to match against
 * @param skuTarget - Matching strategy ("exact-sku" or "contains-sku")
 * @returns Matched SKU variant or null
 */
export function matchPDFFileWithSKU(
  fileName: string,
  availableSKUs: SKUVariant[],
  skuTarget: string
): SKUVariant | null {
  // Add null/undefined checks
  if (!fileName || !availableSKUs || availableSKUs.length === 0) {
    return null;
  }

  // Validate PDF filename format and extract color code
  const colorValidation = validatePDFColorCode(fileName);
  if (!colorValidation.valid) {
    console.log(`[PDF MATCH] ❌ Invalid PDF filename: ${fileName} - ${colorValidation.reason}`);
    return null;
  }

  const { baseName, colorCode } = colorValidation;

  console.log(`[PDF MATCH] Processing: ${fileName}`);
  console.log(`[PDF MATCH] Base name: ${baseName}, Color code: ${colorCode}`);

  // Extract product base from file name (remove color code)
  // WP-SCAL-DUS → WP-SCAL
  const baseParts = baseName.split("-");
  if (baseParts.length < 3) {
    console.log(`[PDF MATCH] ❌ Invalid base name format: ${baseName}`);
    return null;
  }

  // Product base is everything except the last part (color code)
  const productBase = baseParts.slice(0, -1).join("-");
  console.log(`[PDF MATCH] Product base: ${productBase}, Color: ${colorCode}`);

  // ========== TIER 1: SKU BASE EXACT MATCH (HIGHEST PRIORITY) ==========
  console.log(`[PDF MATCH] Tier 1: Trying SKU base exact match...`);

  const exactMatch = availableSKUs.find((sku) => {
    if (!sku || !sku.sku) return false;

    // Extract SKU base (remove size codes)
    // WP-SCAL-DUS-2424 → WP-SCAL-DUS
    const skuBase = extractSKUBase(sku.sku);

    // Direct string comparison WITHOUT removing dashes
    // This ensures WP-SCAL-DUS matches WP-SCAL-DUS but NOT WP-SCALLOPS-DUS
    const skuBaseLower = skuBase.toLowerCase();
    const baseNameLower = baseName.toLowerCase();

    console.log(`[PDF MATCH] Tier 1: Comparing:`, {
      pdfBaseName: baseNameLower,
      skuBase: skuBaseLower,
      fullSku: sku.sku,
      match: skuBaseLower === baseNameLower,
    });

    return skuBaseLower === baseNameLower;
  });

  if (exactMatch) {
    const skuBase = extractSKUBase(exactMatch.sku);
    console.log(`[PDF MATCH] ✓✓✓ Tier 1 MATCH (EXACT): ${baseName} matches ${skuBase} (from ${exactMatch.sku})`);
    console.log(`[PDF MATCH] Product: ${exactMatch.productTitle}, Color: ${exactMatch.color}`);
    return exactMatch;
  }

  console.log(`[PDF MATCH] Tier 1: No exact match found`);

  // ========== TIER 2: PRODUCT BASE MATCH (FALLBACK) ==========
  console.log(`[PDF MATCH] Tier 2: Trying product base match...`);

  const productBaseMatch = availableSKUs.find((sku) => {
    if (!sku || !sku.sku) return false;

    const skuBase = extractSKUBase(sku.sku);
    const skuBaseLower = skuBase.toLowerCase();
    const baseNameLower = baseName.toLowerCase();

    // Extract product part from SKU (remove color code)
    // WP-SCAL-DUS → WP-SCAL
    const skuParts = skuBase.split("-");
    if (skuParts.length < 3) return false;

    const skuProductPart = skuParts.slice(0, -1).join("-").toLowerCase();

    // Extract product part from base name
    // WP-SCAL-DUS → WP-SCAL
    const fileProductPart = productBase.toLowerCase();

    console.log(`[PDF MATCH] Tier 2: Comparing product parts:`, {
      fileProductPart,
      skuProductPart,
      fileBaseName: baseNameLower,
      skuBase,
    });

    // Check if product parts match exactly
    if (fileProductPart === skuProductPart) {
      console.log(`[PDF MATCH] Tier 2: ✓ Product base match found`);
      return true;
    }

    // Check if base name starts with or contains SKU product part
    if (baseNameLower.startsWith(skuProductPart + "-") || skuBaseLower.startsWith(fileProductPart + "-")) {
      console.log(`[PDF MATCH] Tier 2: ✓ Partial product base match found`);
      return true;
    }

    return false;
  });

  if (productBaseMatch) {
    const skuBase = extractSKUBase(productBaseMatch.sku);
    console.log(`[PDF MATCH] ✓✓ Tier 2 MATCH (PRODUCT BASE): ${baseName} matched with ${skuBase} (from ${productBaseMatch.sku})`);
    console.log(`[PDF MATCH] Product: ${productBaseMatch.productTitle}, Color: ${productBaseMatch.color}`);
    return productBaseMatch;
  }

  console.log(`[PDF MATCH] Tier 2: No product base match found`);

  // ========== TIER 3: COLOR-FIRST FLEXIBLE MATCH (LAST RESORT) ==========
  console.log(`[PDF MATCH] Tier 3: Trying color-first flexible match...`);

  // Step 3a: Find SKUs with matching color code
  const colorMatches = availableSKUs.filter((sku) => {
    if (!sku || !sku.sku) return false;
    const skuColorCode = getColorCodeFromSKU(sku.sku);
    return skuColorCode === colorCode;
  });

  console.log(`[PDF MATCH] Tier 3a: Found ${colorMatches.length} SKUs with color ${colorCode}`);

  if (colorMatches.length === 0) {
    console.log(`[PDF MATCH] ❌ No SKUs found with color ${colorCode}`);
    return null;
  }

  // Step 3b: Among SKUs with matching color, find flexible product match
  const flexibleProductMatch = colorMatches.find((sku) => {
    if (!sku || !sku.sku) return false;

    // Extract product from SKU (remove color and size)
    // WP-SCAL-DUS-2424 → WP-SCAL
    const skuParts = sku.sku.split("-");
    if (skuParts.length < 3) return false;

    const skuProduct = skuParts.slice(0, -1).join("-");
    const skuProductClean = skuProduct.toLowerCase().replace(/[-_\s]/g, "");
    const productBaseClean = productBase.toLowerCase().replace(/[-_\s]/g, "");

    console.log(`[PDF MATCH] Tier 3b: Comparing products:`, {
      fileProduct: productBase,
      fileProductClean: productBaseClean,
      skuProduct: skuProduct,
      skuProductClean: skuProductClean,
    });

    // Check flexible match:
    // 1. Exact match
    if (productBaseClean === skuProductClean) {
      console.log(`[PDF MATCH] Tier 3b: ✓ Exact product match`);
      return true;
    }

    // 2. Contains match (file contains SKU product OR SKU product contains file)
    if (productBaseClean.includes(skuProductClean) || skuProductClean.includes(productBaseClean)) {
      console.log(`[PDF MATCH] Tier 3b: ✓ Contains product match`);
      return true;
    }

    // 3. Word-by-word match (check if words match)
    const fileWords = productBaseClean.split("-");
    const skuWords = skuProductClean.split("-");

    const commonWords = fileWords.filter((word) => skuWords.includes(word));
    const matchRatio = commonWords.length / Math.max(fileWords.length, skuWords.length);

    if (matchRatio >= 0.5) {
      console.log(`[PDF MATCH] Tier 3b: ✓ Word match (ratio: ${matchRatio})`);
      return true;
    }

    return false;
  });

  if (flexibleProductMatch) {
    const skuBase = extractSKUBase(flexibleProductMatch.sku);
    console.log(`[PDF MATCH] ⚠️⚠️ Tier 3 MATCH (FLEXIBLE): ${baseName} matched with ${skuBase} (from ${flexibleProductMatch.sku})`);
    console.log(`[PDF MATCH] ⚠️ WARNING: This is a flexible match - please verify the result manually`);
    console.log(`[PDF MATCH] Product: ${flexibleProductMatch.productTitle}, Color: ${flexibleProductMatch.color}`);
    return flexibleProductMatch;
  }

  // ========== TIER 4: NO MATCH ==========
  console.log(`[PDF MATCH] ❌❌❌ NO MATCH FOUND for ${baseName}`);
  console.log(`[PDF MATCH] Searched for:`, {
    productBase,
    colorCode,
    baseName,
    availableColors: [...new Set(availableSKUs.map((s) => getColorCodeFromSKU(s.sku)))],
    availableProducts: [
      ...new Set(
        availableSKUs
          .slice(0, 5)
          .map((s) => extractSKUBase(s.sku).split("-").slice(0, -1).join("-"))
      ),
    ],
  });

  return null;
}
