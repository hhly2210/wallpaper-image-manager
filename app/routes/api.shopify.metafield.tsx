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
  console.log(`[${requestId}] API: Shopify metafield request started`);

  try {
    const body = await request.json();
    const { action = 'update', productId, color, imageUrl, imageType } = body;

    console.log(`[${requestId}] Request data:`, {
      action,
      productId,
      color,
      imageUrl,
      imageType,
      hasImageUrl: !!imageUrl
    });

    if (action === 'get') {
      if (!productId) {
        return new Response(JSON.stringify({
          error: "Missing required field: productId for get action",
          requestId
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Authenticate with Shopify
      const { admin, session } = await authenticate.admin(request);

      console.log(`[${requestId}] Getting metafield for product: ${productId}`);

      // Get current metafield value
      const getMetafieldQuery = `
        mutation getProductMetafield($productId: ID!) {
          product(id: $productId) {
            metafield(namespace: "wallpaper", key: "color_images") {
              id
              value
              type
            }
          }
        }
      `;

      const metafieldResponse = await admin.graphql(getMetafieldQuery, {
        variables: { productId }
      });

      const metafieldData = await metafieldResponse.json();
      console.log(`[${requestId}] Current metafield:`, metafieldData?.data?.product?.metafield);

      return new Response(JSON.stringify({
        success: true,
        action: 'get',
        productId,
        data: metafieldData?.data?.product?.metafield || null,
        requestId,
        timestamp: new Date().toISOString()
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Update action validation
    if (!productId || !color || !imageUrl || !imageType) {
      return new Response(JSON.stringify({
        error: "Missing required fields: productId, color, imageUrl, imageType",
        requestId
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Validate imageType
    if (!['room', 'hover'].includes(imageType)) {
      return new Response(JSON.stringify({
        error: "Invalid imageType. Must be 'room' or 'hover'",
        requestId
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Authenticate with Shopify
    const { admin, session } = await authenticate.admin(request);

    console.log(`[${requestId}] Updating metafield for product: ${productId}, color: ${color}, type: ${imageType}`);

    // First, get current metafield value
    const getMetafieldQuery = `
      mutation getProductMetafield($productId: ID!) {
        product(id: $productId) {
          metafield(namespace: "wallpaper", key: "color_images") {
            id
            value
            type
          }
        }
      }
    `;

    const metafieldResponse = await admin.graphql(getMetafieldQuery, {
      variables: { productId }
    });

    const metafieldData = await metafieldResponse.json();
    console.log(`[${requestId}] Current metafield:`, metafieldData?.data?.product?.metafield);

    let currentMetafieldValue = [];
    const existingMetafield = metafieldData?.data?.product?.metafield;

    if (existingMetafield && existingMetafield.value) {
      try {
        currentMetafieldValue = JSON.parse(existingMetafield.value);
        console.log(`[${requestId}] Parsed existing metafield value:`, currentMetafieldValue);
      } catch (error) {
        console.warn(`[${requestId}] Failed to parse existing metafield, starting fresh:`, error);
        currentMetafieldValue = [];
      }
    }

    // Find or create color entry
    let colorEntry = currentMetafieldValue.find((entry: any) => entry.color === color);

    if (!colorEntry) {
      // Create new color entry
      colorEntry = {
        color: color,
        images: []
      };
      currentMetafieldValue.push(colorEntry);
      console.log(`[${requestId}] Created new color entry for: ${color}`);
    }

    // Update or add image
    const imageIndex = colorEntry.images.findIndex((img: any) => img.type === imageType);
    const newImage = {
      type: imageType,
      url: imageUrl
    };

    if (imageIndex >= 0) {
      // Update existing image
      colorEntry.images[imageIndex] = newImage;
      console.log(`[${requestId}] Updated existing ${imageType} image for color: ${color}`);
    } else {
      // Add new image
      colorEntry.images.push(newImage);
      console.log(`[${requestId}] Added new ${imageType} image for color: ${color}`);
    }

    // Update metafield
    const updateMetafieldQuery = `
      mutation productUpdateMetafield($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            metafield(namespace: "wallpaper", key: "color_images") {
              id
              value
              type
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const updateResponse = await admin.graphql(updateMetafieldQuery, {
      variables: {
        input: {
          id: productId,
          metafields: [
            {
              namespace: "wallpaper",
              key: "color_images",
              type: "json",
              value: JSON.stringify(currentMetafieldValue)
            }
          ]
        }
      }
    });

    const updateData = await updateResponse.json();
    console.log(`[${requestId}] Update response:`, updateData);

    if (updateData?.data?.productUpdate?.userErrors?.length > 0) {
      const errors = updateData.data.productUpdate.userErrors;
      console.error(`[${requestId}] GraphQL errors:`, errors);
      return new Response(JSON.stringify({
        error: "Failed to update metafield",
        details: errors,
        requestId
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`[${requestId}] SUCCESS: Metafield updated for product ${productId}, color: ${color}, type: ${imageType}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully updated ${imageType} image for color: ${color}`,
      data: {
        productId,
        color,
        imageType,
        imageUrl,
        updatedMetafield: updateData?.data?.productUpdate?.product?.metafield
      },
      requestId,
      timestamp: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`[${requestId}] ERROR: Metafield update failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      requestId
    });

    return new Response(JSON.stringify({
      error: "Failed to update Shopify metafield",
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