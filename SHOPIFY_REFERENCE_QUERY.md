# Shopify Metafield Reference Query Guide

## How to get CDN URLs from GID stored in metafields

Khi sử dụng metafield type `file.file_reference`, GIDs được lưu trong JSON sẽ tự động được chuyển thành CDN URLs khi query với `reference`.

## Query Structure

```graphql
{
  product(id: "gid://shopify/Product/YOUR_PRODUCT_ID") {
    metafield(namespace: "wallpaper", key: "color_images") {
      reference {
        ... on MediaImage {
          image {
            originalSrc
          }
        }
      }
    }
  }
}
```

## Response Example

```json
{
  "data": {
    "product": {
      "metafield": {
        "reference": {
          "image": {
            "originalSrc": "https://cdn.shopify.com/s/files/1/1026/6195/files/mobile-receipt-shopify.png?v=1613088523"
          }
        }
      }
    }
  }
}
```

## How it works

1. **Storage**: Metafield được lưu với type `file.file_reference` và JSON structure
2. **Automatic Conversion**: Shopify tự động chuyển GID → CDN URL khi query với `reference`
3. **Query Pattern**: Sử dụng `reference` field thay vì `value` field

## Implementation Notes

- JSON structure trong metafield vẫn giữ nguyên format cũ
- GID được lưu trong `url` field của images array
- Khi cần lấy CDN URL, query `reference` thay vì `value`
- `file.file_reference` type xử lý việc chuyển đổi tự động