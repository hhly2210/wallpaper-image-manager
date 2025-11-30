import { authenticate } from "../shopify.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed",
      method: request.method
    }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] API: Shopify SKU fetch request started`);

  try {
    const { limit = 250, pageInfo = null, query = null } = await request.json();

    // Authenticate with Shopify to get session and admin client
    const { admin, session } = await authenticate.admin(request);

    console.log(`[${requestId}] Fetching SKUs with params:`, {
      limit,
      hasPageInfo: !!pageInfo,
      hasQuery: !!query,
      shop: session.shop,
      hasAdmin: !!admin
    });

    
    // Call Shopify GraphQL API using admin client
    console.log(`[${requestId}] Calling Shopify GraphQL API with query:`, buildWallpaperQuery());

    const response = await admin.graphql(
      `#graphql
      query getProductSKUs($first: Int!, $query: String) {
        products(first: $first, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              handle
              title
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
                    createdAt
                    updatedAt
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          first: Math.min(limit, 250), // Max 250 per request
          query: query || buildWallpaperQuery() // Default query to filter for Wallpaper products
        }
      }
    );

    const shopifyData = await response.json();

    // Extract and format SKU data (Shopify query already filtered for Wallpaper products)
    const products = shopifyData?.data?.products?.edges || [];
    const productsPageInfo = shopifyData?.data?.products?.pageInfo;

    const skuList = [];
    let totalVariants = 0;
    let totalProducts = products.length;

    // Debug: Log first few products to verify they are Wallpaper products
    console.log(`[${requestId}] DEBUG: Sample products (already filtered):`,
      products.slice(0, 3).map(p => ({
        title: p.node.title,
        productType: p.node.productType, // This should be "Wallpaper"
        tags: p.node.tags
      }))
    );

    products.forEach((productEdge: any) => {
      const product = productEdge.node;
      const variants = product.variants?.edges || [];

      console.log(`[${requestId}] Processing Wallpaper product: "${product.title}" (${product.productType})`);

      variants.forEach((variantEdge: any) => {
        const variant = variantEdge.node;

        // Only include variants with SKUs
        if (variant.sku && variant.sku.trim()) {
          skuList.push({
            id: variant.id,
            sku: variant.sku.trim(),
            title: variant.title,
            productId: product.id,
            productHandle: product.handle,
            productTitle: product.title,
            productStatus: product.status,
            productType: product.productType,
            productTags: product.tags,
            price: variant.price,
            inventoryQuantity: variant.inventoryQuantity,
            createdAt: variant.createdAt,
            updatedAt: variant.updatedAt,
            options: {
              selectedOptions: variant.selectedOptions || []
            },
            isWallpaper: true,
            productOrgType: product.productType // Store the Product Organization Type
          });
          totalVariants++;
        }
      });
    });

    console.log(`[${requestId}] Successfully fetched REAL SKUs from Shopify:`, {
      totalProducts,
      totalVariants,
      skusWithValidData: skuList.length,
      hasNextPage: productsPageInfo?.hasNextPage,
      queryUsed: query || buildWallpaperQuery(),
      shop: session.shop
    });

    return new Response(JSON.stringify({
      success: true,
      data: skuList,
      pageInfo: {
        hasNextPage: productsPageInfo?.hasNextPage || false,
        endCursor: productsPageInfo?.endCursor || null
      },
      summary: {
        totalProducts,
        wallpaperProducts: totalProducts, // All products are wallpaper due to query filter
        totalVariants,
        skusWithValidData: skuList.length,
        hasQuery: !!query,
        filterType: 'wallpaper-products',
        queryUsed: query || buildWallpaperQuery(),
        isRealData: true,
        shop: session.shop
      },
      requestId,
      timestamp: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`[${requestId}] ERROR: SKU fetch failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      requestId
    });

    return new Response(JSON.stringify({
      error: "Failed to fetch SKUs from Shopify",
      requestId,
      details: error instanceof Error ? {
        message: error.message,
        name: error.name
      } : error
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Helper functions for session/token extraction
function extractShopDomain(session: string | null): string {
  if (!session) return '';

  // If session is JSON format, extract shop domain
  try {
    const sessionData = JSON.parse(session);
    return sessionData.shop || sessionData.domain || '';
  } catch {
    // If session is just the shop domain
    return session;
  }
}

function extractAccessToken(session: string | null): string {
  if (!session) return '';

  try {
    const sessionData = JSON.parse(session);
    return sessionData.accessToken || sessionData.access_token || '';
  } catch {
    return '';
  }
}

// Helper function to build query for Wallpaper products
function buildWallpaperQuery(): string {
  // Based on official Shopify docs, "Product Organization Type" = productType field
  // Use official search syntax for product_type
  return 'product_type:"Wallpaper" OR product_type:wallpaper OR tag:wallpaper OR tag:Wallpaper';
}

// Helper function to check if a product is a Wallpaper product
function isProductWallpaper(product: any): boolean {
  // Based on official Shopify documentation, "Product Organization Type" = productType field

  // PRIMARY: Check productType (this is the official "Product Organization Type" field)
  if (product.productType &&
      (product.productType.toLowerCase().includes('wallpaper') ||
       product.productType === 'Wallpaper')) {
    console.log(`[DEBUG] Found Wallpaper in productType (Product Organization Type): "${product.productType}"`);
    return true;
  }

  // SECONDARY: Check tags as backup
  if (product.tags && Array.isArray(product.tags)) {
    const hasWallpaperTag = product.tags.some((tag: string) =>
      tag.toLowerCase().includes('wallpaper')
    );
    if (hasWallpaperTag) {
      console.log(`[DEBUG] Found Wallpaper in tags: ${product.tags}`);
      return true;
    }
  }

  // TERTIARY: Check title as fallback
  if (product.title &&
      product.title.toLowerCase().includes('wallpaper')) {
    console.log(`[DEBUG] Found Wallpaper in title: ${product.title}`);
    return true;
  }

  // FALLBACK: Check handle
  if (product.handle &&
      product.handle.toLowerCase().includes('wallpaper')) {
    console.log(`[DEBUG] Found Wallpaper in handle: ${product.handle}`);
    return true;
  }

  return false;
}