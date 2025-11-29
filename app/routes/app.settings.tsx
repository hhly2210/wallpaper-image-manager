export default function SettingsPage() {
  return (
    <s-page heading="Settings">
      <s-section heading="App Settings">
        <s-paragraph>
          Configure your wallpaper image manager settings here.
        </s-paragraph>
      </s-section>

      <s-section heading="Configuration Options">
        <s-unordered-list>
          <s-list-item>Image quality settings</s-list-item>
          <s-list-item>Storage preferences</s-list-item>
          <s-list-item>Display options</s-list-item>
          <s-list-item>Backup settings</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}