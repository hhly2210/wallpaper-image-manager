import { useUploadJobActions } from '../stores/uploadJobStore';

// Example hook for simulating an upload process
export const useUploadSimulation = () => {
  const { createJob, startJob, updateProgress, completeJob, failJob, setCurrentJob } = useUploadJobActions();

  const simulateUpload = async (jobName: string, totalFiles: number) => {
    // Create a new job
    const jobId = createJob(jobName, totalFiles);

    // Set as current job
    setCurrentJob(jobId);

    // Start the job
    startJob(jobId);

    try {
      // Simulate upload process
      for (let i = 1; i <= totalFiles; i++) {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

        // Update progress
        updateProgress(jobId, i);

        // Simulate random failure (10% chance)
        if (Math.random() < 0.1) {
          throw new Error(`Failed to upload file ${i}`);
        }
      }

      // Mark job as completed
      completeJob(jobId);
      console.log(`Upload completed successfully for job: ${jobName}`);

    } catch (error) {
      // Mark job as failed
      failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      console.error(`Upload failed for job: ${jobName}`, error);
    }

    return jobId;
  };

  return { simulateUpload };
};

// Example usage in a React component:
/*
import React from 'react';
import { useUploadSimulation } from './uploadExample';

const UploadExampleComponent: React.FC = () => {
  const { simulateUpload } = useUploadSimulation();

  const handleStartUpload = () => {
    simulateUpload('Wallpaper Upload', 10);
  };

  return (
    <button onClick={handleStartUpload}>
      Start Upload Simulation
    </button>
  );
};
*/