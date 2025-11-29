import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Zod schema for form validation
const uploadFormSchema = z.object({
  category: z.string().min(1, "Please select a category"),
  resolution: z.string().min(1, "Please select a resolution"),
  quality: z.string().min(1, "Please select a quality"),
});

type UploadFormData = z.infer<typeof uploadFormSchema>;

export default function UploadPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
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
      <s-section heading="Upload Configuration">
        <form onSubmit={handleSubmit(onSubmit)}>
          <s-stack direction="block" gap="large">
            <s-box>
              <s-label required>Category</s-label>
              <s-select
                {...register("category")}
                placeholder="Select a category"
                invalid={!!errors.category}
              >
                <s-option value="">Choose category...</s-option>
                <s-option value="nature">Nature</s-option>
                <s-option value="abstract">Abstract</s-option>
                <s-option value="architecture">Architecture</s-option>
                <s-option value="animals">Animals</s-option>
                <s-option value="technology">Technology</s-option>
                <s-option value="minimalist">Minimalist</s-option>
              </s-select>
              {errors.category && (
                <s-text-container tone="critical">
                  <s-text as="p" variant="bodySm">{errors.category.message}</s-text>
                </s-text-container>
              )}
            </s-box>

            <s-box>
              <s-label required>Resolution</s-label>
              <s-select
                {...register("resolution")}
                placeholder="Select resolution"
                invalid={!!errors.resolution}
              >
                <s-option value="">Choose resolution...</s-option>
                <s-option value="1920x1080">1920x1080 (Full HD)</s-option>
                <s-option value="2560x1440">2560x1440 (2K)</s-option>
                <s-option value="3840x2160">3840x2160 (4K)</s-option>
                <s-option value="7680x4320">7680x4320 (8K)</s-option>
                <s-option value="mobile">Mobile (1080x1920)</s-option>
                <s-option value="tablet">Tablet (2048x2732)</s-option>
              </s-select>
              {errors.resolution && (
                <s-text-container tone="critical">
                  <s-text as="p" variant="bodySm">{errors.resolution.message}</s-text>
                </s-text-container>
              )}
            </s-box>

            <s-box>
              <s-label required>Quality</s-label>
              <s-select
                {...register("quality")}
                placeholder="Select quality"
                invalid={!!errors.quality}
              >
                <s-option value="">Choose quality...</s-option>
                <s-option value="low">Low (Fast)</s-option>
                <s-option value="medium">Medium (Balanced)</s-option>
                <s-option value="high">High (Best)</s-option>
                <s-option value="ultra">Ultra (Maximum)</s-option>
              </s-select>
              {errors.quality && (
                <s-text-container tone="critical">
                  <s-text as="p" variant="bodySm">{errors.quality.message}</s-text>
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
                onClick={() => reset()}
                disabled={isSubmitting}
              >
                Reset
              </s-button>
            </s-stack>
          </div>
        </form>
      </s-section>

      <s-section slot="aside" heading="Upload Settings">
        <s-paragraph>
          Configure your upload settings before adding images to your collection.
        </s-paragraph>

        <s-badge status="info">Tip: Select appropriate settings for best results</s-badge>
      </s-section>
    </s-page>
  );
}