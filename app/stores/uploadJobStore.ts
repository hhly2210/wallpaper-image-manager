import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface UploadJob {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number; // 0-100
  totalFiles: number;
  uploadedFiles: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UploadJobStore {
  jobs: UploadJob[];
  currentJob: UploadJob | null;

  // Actions
  createJob: (name: string, totalFiles: number) => string;
  startJob: (jobId: string) => void;
  updateProgress: (jobId: string, uploadedFiles: number) => void;
  completeJob: (jobId: string) => void;
  failJob: (jobId: string, error: string) => void;
  getJob: (jobId: string) => UploadJob | undefined;
  getAllJobs: () => UploadJob[];
  clearCompletedJobs: () => void;
  setCurrentJob: (jobId: string | null) => void;
}

export const useUploadJobStore = create<UploadJobStore>()(
  devtools(
    (set, get) => ({
      jobs: [],
      currentJob: null,

      createJob: (name: string, totalFiles: number) => {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newJob: UploadJob = {
          id: jobId,
          name,
          status: 'pending',
          progress: 0,
          totalFiles,
          uploadedFiles: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set((state) => ({
          jobs: [...state.jobs, newJob],
        }));

        console.log(`Created job ${jobId}: ${name} (${totalFiles} files)`);
        return jobId;
      },

      startJob: (jobId: string) => {
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: 'uploading',
                  progress: 0,
                  updatedAt: new Date(),
                }
              : job
          ),
          currentJob: get().jobs.find((job) => job.id === jobId) || null,
        }));

        console.log(`Started job ${jobId}`);
      },

      updateProgress: (jobId: string, uploadedFiles: number) => {
        set((state) => {
          const updatedJobs = state.jobs.map((job) => {
            if (job.id === jobId) {
              const progress = Math.min(100, Math.round((uploadedFiles / job.totalFiles) * 100));
              return {
                ...job,
                uploadedFiles,
                progress,
                status: uploadedFiles >= job.totalFiles ? 'completed' : 'uploading',
                updatedAt: new Date(),
              };
            }
            return job;
          });

          const updatedJob = updatedJobs.find((job) => job.id === jobId);

          return {
            jobs: updatedJobs,
            currentJob: updatedJob || state.currentJob,
          };
        });

        const job = get().jobs.find((j) => j.id === jobId);
        if (job) {
          console.log(`Job ${jobId} progress: ${job.progress}% (${job.uploadedFiles}/${job.totalFiles})`);
        }
      },

      completeJob: (jobId: string) => {
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: 'completed',
                  progress: 100,
                  uploadedFiles: job.totalFiles,
                  updatedAt: new Date(),
                }
              : job
          ),
        }));

        console.log(`Completed job ${jobId}`);
      },

      failJob: (jobId: string, error: string) => {
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: 'failed',
                  error,
                  updatedAt: new Date(),
                }
              : job
          ),
        }));

        console.log(`Failed job ${jobId}: ${error}`);
      },

      getJob: (jobId: string) => {
        return get().jobs.find((job) => job.id === jobId);
      },

      getAllJobs: () => {
        return get().jobs;
      },

      clearCompletedJobs: () => {
        set((state) => ({
          jobs: state.jobs.filter((job) => job.status !== 'completed'),
          currentJob:
            state.currentJob?.status === 'completed' ? null : state.currentJob,
        }));
      },

      setCurrentJob: (jobId: string | null) => {
        set((state) => ({
          currentJob: jobId ? state.jobs.find((job) => job.id === jobId) || null : null,
        }));
      },
    }),
    {
      name: 'upload-job-store',
    }
  )
);

// Selectors for easier data access
export const useUploadJobs = () => useUploadJobStore((state) => state.jobs);
export const useCurrentUploadJob = () => useUploadJobStore((state) => state.currentJob);
export const useUploadJobActions = () => useUploadJobStore((state) => ({
  createJob: state.createJob,
  startJob: state.startJob,
  updateProgress: state.updateProgress,
  completeJob: state.completeJob,
  failJob: state.failJob,
  getJob: state.getJob,
  getAllJobs: state.getAllJobs,
  clearCompletedJobs: state.clearCompletedJobs,
  setCurrentJob: state.setCurrentJob,
}));