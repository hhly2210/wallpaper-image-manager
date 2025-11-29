import { useState, useEffect } from "react";
import { initGoogleAuth, signInWithGoogle, signOutFromGoogle, isSignedIn, getCurrentUser } from "../services/googleAuth";
import DebugInfo from "./DebugInfo.client";

// Helper to get current origin for user guidance
const getCurrentOrigin = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'unknown';
};

export default function GoogleDriveConnection() {
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [googleAccount, setGoogleAccount] = useState<string | null>(null);
  const [isGoogleApiLoaded, setIsGoogleApiLoaded] = useState(false);
  const [originError, setOriginError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Set client-side flag to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize Google Auth on client side
  useEffect(() => {
    if (!isClient) return;

    const initializeGoogleAuth = async () => {
      try {
        await initGoogleAuth();
        setIsGoogleApiLoaded(true);

        // Check if user is already signed in
        if (isSignedIn()) {
          const currentUser = getCurrentUser();
          if (currentUser) {
            setIsGoogleConnected(true);
            setGoogleAccount(currentUser.profile.name);
          }
        }
      } catch (error: any) {
        console.error('Error initializing Google Auth:', error);
        // Don't show errors for missing APIs during initialization
      }
    };

    // Initialize immediately on client mount
    initializeGoogleAuth();
  }, [isClient]);

  const handleGoogleConnect = async () => {
    if (!isClient) {
      alert('Please wait for the page to finish loading...');
      return;
    }

    try {
      const result = await signInWithGoogle();
      setIsGoogleConnected(true);
      setGoogleAccount(result.profile.name);
      console.log('Google connected successfully:', result);
    } catch (error: any) {
      console.error('Google connection failed:', error);

      if (error.message.includes('Popup blocked')) {
        alert('Please allow popups for this site to connect to Google Drive.');
      } else if (error.message.includes('cancelled')) {
        console.log('Google sign-in was cancelled');
      } else {
        alert(`Failed to connect to Google Drive: ${error.message}`);
      }
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      await signOutFromGoogle();
      setIsGoogleConnected(false);
      setGoogleAccount(null);
    } catch (error) {
      console.error('Google disconnection failed:', error);
    }
  };

  return (
    <s-section heading="Google Drive Connection">
      {process.env.NODE_ENV !== 'production' && <DebugInfo />}
      <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" alignment="center" gap="base">
            <s-icon source="https://www.gstatic.com/images/icons/material/system/1x/drive_cloud_24dp.png" />
            <s-heading level="3">Google Drive Integration</s-heading>
          </s-stack>

          {!isGoogleConnected ? (
            <s-stack direction="block" gap="base">
              {!isClient ? (
                // Show loading skeleton on server render to prevent hydration mismatch
                <s-paragraph>Loading Google Drive connection...</s-paragraph>
              ) : originError ? (
                <s-box padding="base" background="critical-subdued" borderColor="critical" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" alignment="center" gap="base">
                      <s-icon source="⚠️" />
                      <s-heading level="4">OAuth Configuration Required</s-heading>
                    </s-stack>
                    <s-paragraph>
                      Your current domain (<s-code>{originError}</s-code>) is not registered in Google OAuth for redirect URIs.
                    </s-paragraph>
                    <s-stack direction="block" gap="small">
                      <s-text>To fix this issue:</s-text>
                      <s-unordered-list>
                        <s-list-item>Go to <s-link href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</s-link></s-list-item>
                        <s-list-item>Select your OAuth client ID</s-list-item>
                        <s-list-item>Add <s-code>{originError}</s-code> to both "Authorized JavaScript origins" AND "Authorized redirect URIs"</s-list-item>
                        <s-list-item>Save and refresh this page</s-list-item>
                      </s-unordered-list>
                    </s-stack>
                  </s-stack>
                </s-box>
              ) : (
                <s-paragraph>
                  Connect your Google Drive account to access and manage your wallpaper images directly from Drive.
                </s-paragraph>
              )}
              <s-button
                variant="primary"
                onClick={handleGoogleConnect}
                disabled={!isClient || !!originError}
                loading={!isClient}
              >
                {!isClient ? "Loading..." : "Connect Google Drive"}
              </s-button>
            </s-stack>
          ) : (
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" alignment="center" gap="base">
                <s-badge status="success">Connected</s-badge>
                <s-text weight="medium">{googleAccount}</s-text>
              </s-stack>
              <s-paragraph>
                Your Google Drive is connected and ready to sync wallpaper images.
              </s-paragraph>
              <s-button variant="secondary" onClick={handleGoogleDisconnect}>
                Disconnect
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}