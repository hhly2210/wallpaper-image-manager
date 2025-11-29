import { useState, useEffect } from "react";

export default function DebugInfo() {
  const [debugInfo, setDebugInfo] = useState<any>({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDebugInfo({
        currentOrigin: window.location.origin,
        fullUrl: window.location.href,
        hostname: window.location.hostname,
        port: window.location.port,
        protocol: window.location.protocol,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      });
    }
  }, []);

  if (process.env.NODE_ENV === 'production') {
    return null; // Only show in development
  }

  return (
    <s-box padding="base" background="critical-subdued" borderColor="critical" borderRadius="base">
      <s-heading level="4">🐛 Debug Information</s-heading>
      <s-stack direction="block" gap="small">
        <s-text><strong>Current Origin:</strong> {debugInfo.currentOrigin}</s-text>
        <s-text><strong>Full URL:</strong> {debugInfo.fullUrl}</s-text>
        <s-text><strong>Hostname:</strong> {debugInfo.hostname}</s-text>
        <s-text><strong>Port:</strong> {debugInfo.port}</s-text>
        <s-text><strong>Protocol:</strong> {debugInfo.protocol}</s-text>
        <s-text><strong>User Agent:</strong> {debugInfo.userAgent}</s-text>
        <s-text><strong>Timestamp:</strong> {debugInfo.timestamp}</s-text>

        <s-divider />

        <s-heading level="5">🔧 Google Console Configuration Needed:</s-heading>
        <s-unordered-list>
          <s-list-item>Add <s-code>{debugInfo.currentOrigin}</s-code> to "Authorized JavaScript origins"</s-list-item>
          <s-list-item>Add <s-code>{debugInfo.currentOrigin}</s-code> to "Authorized redirect URIs"</s-list-item>
          <s-list-item>Make sure Client ID matches: <s-code>102268048218-vfh3qarg32itgf1urduv0ghls8ekpbdd.apps.googleusercontent.com</s-code></s-list-item>
        </s-unordered-list>
      </s-stack>
    </s-box>
  );
}