/**
 * Render Queue Hook
 * Manages background rendering jobs with queue and progress tracking
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import videoStudioService from '../../../../../services/videoStudioService';

export interface RenderJob {
  id: string;
  projectId: string;
  projectTitle: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  currentFrame?: number;
  totalFrames?: number;
  outputUrl?: string;
  errorMessage?: string;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface RenderQueueOptions {
  maxConcurrentJobs?: number; // Maximum number of jobs to run simultaneously
  pollInterval?: number; // How often to check job status (ms)
  onJobComplete?: (job: RenderJob) => void;
  onJobFailed?: (job: RenderJob) => void;
  onQueueEmpty?: () => void;
}

/**
 * Hook for managing background rendering queue
 */
export function useRenderQueue(options: RenderQueueOptions = {}) {
  const {
    maxConcurrentJobs = 2,
    pollInterval = 2000,
    onJobComplete,
    onJobFailed,
    onQueueEmpty
  } = options;

  const [jobs, setJobs] = useState<Map<string, RenderJob>>(new Map());
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Add a render job to the queue
   */
  const queueRenderJob = useCallback(async (
    projectId: string,
    projectTitle: string,
    renderSettings?: any
  ): Promise<string> => {
    try {
      console.log(`📥 Queueing render job for project: ${projectTitle}`);

      // Start the render job via API
      const response = await videoStudioService.startRender(projectId, renderSettings);
      if (!response.success || !response.job) {
        throw new Error(response.error || 'Render service did not return a job');
      }

      const jobId = response.job.id;

      const newJob: RenderJob = {
        id: jobId,
        projectId,
        projectTitle,
        status: 'queued',
        progress: 0,
        totalFrames: response.job.total_frames,
        queuedAt: new Date()
      };

      setJobs((prev) => new Map(prev).set(jobId, newJob));

      console.log(`✅ Render job queued: ${jobId}`);

      return jobId;
    } catch (error) {
      console.error('❌ Failed to queue render job:', error);
      throw error;
    }
  }, []);

  /**
   * Cancel a render job
   */
  const cancelJob = useCallback(async (jobId: string) => {
    try {
      console.log(`🛑 Cancelling job: ${jobId}`);

      await videoStudioService.cancelRender(jobId);

      setJobs((prev) => {
        const newJobs = new Map(prev);
        const job = newJobs.get(jobId);
        if (job) {
          newJobs.set(jobId, { ...job, status: 'cancelled', completedAt: new Date() });
        }
        return newJobs;
      });

      setActiveJobs((prev) => {
        const newActive = new Set(prev);
        newActive.delete(jobId);
        return newActive;
      });

      console.log(`✅ Job cancelled: ${jobId}`);
    } catch (error) {
      console.error('❌ Failed to cancel job:', error);
      throw error;
    }
  }, []);

  /**
   * Remove a completed/failed job from the queue
   */
  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const newJobs = new Map(prev);
      newJobs.delete(jobId);
      return newJobs;
    });

    setActiveJobs((prev) => {
      const newActive = new Set(prev);
      newActive.delete(jobId);
      return newActive;
    });

    console.log(`🗑️  Removed job from queue: ${jobId}`);
  }, []);

  /**
   * Clear all completed/failed jobs
   */
  const clearCompleted = useCallback(() => {
    setJobs((prev) => {
      const newJobs = new Map(prev);
      for (const [id, job] of newJobs.entries()) {
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          newJobs.delete(id);
        }
      }
      return newJobs;
    });

    console.log('🧹 Cleared completed jobs');
  }, []);

  /**
   * Poll job status for active jobs
   */
  const pollJobStatus = useCallback(async () => {
    const activeJobArray = Array.from(activeJobs);

    if (activeJobArray.length === 0) {
      return;
    }

    for (const jobId of activeJobArray) {
      try {
        const status = await videoStudioService.getRenderStatus(jobId);
        if (!status.success || !status.job) {
          throw new Error(status.error || `Render job ${jobId} has no status payload`);
        }
        const remoteJob = status.job;

        setJobs((prev) => {
          const newJobs = new Map(prev);
          const existingJob = newJobs.get(jobId);

          if (!existingJob) return prev;

          const updatedJob: RenderJob = {
            ...existingJob,
            status: remoteJob.status,
            progress: remoteJob.progress || 0,
            currentFrame: remoteJob.current_frame,
            totalFrames: remoteJob.total_frames,
            outputUrl: remoteJob.output_url,
            errorMessage: remoteJob.error_message,
            startedAt: remoteJob.started_at ? new Date(remoteJob.started_at) : existingJob.startedAt,
            completedAt: remoteJob.completed_at ? new Date(remoteJob.completed_at) : undefined
          };

          newJobs.set(jobId, updatedJob);

          // Handle job completion
          if (updatedJob.status === 'completed') {
            console.log(`✅ Job completed: ${jobId}`);
            setActiveJobs((prev) => {
              const newActive = new Set(prev);
              newActive.delete(jobId);
              return newActive;
            });
            onJobComplete?.(updatedJob);
          }

          // Handle job failure
          if (updatedJob.status === 'failed') {
            console.error(`❌ Job failed: ${jobId} - ${updatedJob.errorMessage}`);
            setActiveJobs((prev) => {
              const newActive = new Set(prev);
              newActive.delete(jobId);
              return newActive;
            });
            onJobFailed?.(updatedJob);
          }

          return newJobs;
        });
      } catch (error) {
        console.error(`Failed to poll status for job ${jobId}:`, error);
      }
    }
  }, [activeJobs, onJobComplete, onJobFailed]);

  /**
   * Process queue - start jobs up to maxConcurrentJobs limit
   */
  const processQueue = useCallback(() => {
    const queuedJobs = Array.from(jobs.values()).filter(j => j.status === 'queued');
    const availableSlots = maxConcurrentJobs - activeJobs.size;

    if (availableSlots > 0 && queuedJobs.length > 0) {
      const jobsToStart = queuedJobs.slice(0, availableSlots);

      jobsToStart.forEach((job) => {
        console.log(`▶️  Starting job: ${job.id}`);
        setActiveJobs((prev) => new Set(prev).add(job.id));

        setJobs((prev) => {
          const newJobs = new Map(prev);
          newJobs.set(job.id, { ...job, status: 'processing', startedAt: new Date() });
          return newJobs;
        });
      });
    }
  }, [jobs, activeJobs, maxConcurrentJobs]);

  /**
   * Start polling when there are active jobs
   */
  useEffect(() => {
    if (activeJobs.size > 0) {
      pollIntervalRef.current = setInterval(() => {
        pollJobStatus();
      }, pollInterval);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // Check if queue is completely empty
      if (jobs.size === 0) {
        onQueueEmpty?.();
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [activeJobs, pollInterval, pollJobStatus, jobs.size, onQueueEmpty]);

  /**
   * Process queue when jobs or active jobs change
   */
  useEffect(() => {
    processQueue();
  }, [jobs, activeJobs, processQueue]);

  return {
    jobs: Array.from(jobs.values()),
    activeJobCount: activeJobs.size,
    queuedJobCount: Array.from(jobs.values()).filter(j => j.status === 'queued').length,
    completedJobCount: Array.from(jobs.values()).filter(j => j.status === 'completed').length,
    failedJobCount: Array.from(jobs.values()).filter(j => j.status === 'failed').length,
    queueRenderJob,
    cancelJob,
    removeJob,
    clearCompleted,
    getJob: (jobId: string) => jobs.get(jobId)
  };
}
