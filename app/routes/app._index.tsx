import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="Wallpaper Image Manager">
      <s-section heading="Welcome to Wallpaper Image Manager">
        <s-paragraph>
          This app helps you manage your store's wallpaper images efficiently.
          Upload, organize, and manage your image collections with ease.
        </s-paragraph>
      </s-section>

      <s-section heading="Getting Started">
        <s-paragraph>
          Start building your wallpaper management features here. You can add image upload functionality,
          create galleries, and organize your wallpapers by categories.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Features">
        <s-unordered-list>
          <s-list-item>Image upload and storage</s-list-item>
          <s-list-item>Gallery management</s-list-item>
          <s-list-item>Category organization</s-list-item>
          <s-list-item>Bulk operations</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Development">
        <s-paragraph>
          <s-text>Framework: </s-text>
          <s-link href="https://reactrouter.com/" target="_blank">
            React Router
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Interface: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/app-home/using-polaris-components"
            target="_blank"
          >
            Polaris web components
          </s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
