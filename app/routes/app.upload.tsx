import { useState, lazy, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
                variant="secondary"
                onClick={() => {
                  console.log("Dry upload - simulation mode");
                  // Just log the form data without actual upload logic
                  const formData = getValues();
                  console.log("Dry run with data:", formData);
                  alert("Dry upload completed! Check console for details.");
                }}
                disabled={isSubmitting}
              >
                🧪 Dry Upload
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

          </s-page>
  );
}