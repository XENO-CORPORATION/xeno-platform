/**
 * Video Processing Service
 * Handles video rendering using Docker containers with FFmpeg
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execPromise = promisify(exec);

// Storage directories
const VIDEOS_DIR = path.join(process.cwd(), 'storage', 'videos');
const TEMP_DIR = path.join(process.cwd(), 'storage', 'temp');
const ASSETS_DIR = path.join(process.cwd(), 'storage', 'assets');

// Ensure directories exist
[VIDEOS_DIR, TEMP_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Video Processing Service Class
 */
class VideoProcessingService {
  constructor(db) {
    this.db = db;
    this.activeJobs = new Map(); // jobId -> { containerId, process }
  }

  /**
   * Start a rendering job
   * @param {string} jobId - The render job ID
   * @param {Object} project - The video project data
   * @param {Object} timeline - Timeline data with clips and effects
   */
  async startRenderJob(jobId, project, timeline) {
    try {
      console.log(`🎬 Starting render job ${jobId} for project ${project.id}`);

      // Update job status to processing
      await this.db.query(
        'UPDATE video_render_jobs SET status = $1, started_at = NOW() WHERE id = $2',
        ['processing', jobId]
      );

      // Get output destination from workflow settings (if set)
      const workflowSettings = project.project_metadata || {};
      const outputDestination = workflowSettings.export?.outputDestination;

      // Generate output filename
      const outputFileName = `${project.id}_${Date.now()}.${project.output_format}`;

      // Use custom output destination if specified, otherwise use default
      let outputDir = VIDEOS_DIR;
      if (outputDestination && outputDestination !== '/renders') {
        // Create custom directory if it doesn't exist
        const customDir = path.join(process.cwd(), 'storage', outputDestination.replace(/^\//, ''));
        if (!fs.existsSync(customDir)) {
          fs.mkdirSync(customDir, { recursive: true });
        }
        outputDir = customDir;
        console.log(`📁 Using custom output destination: ${outputDestination}`);
      }

      const outputPath = path.join(outputDir, outputFileName);

      // Build FFmpeg command based on timeline
      const ffmpegCommand = this.buildFFmpegCommand(project, timeline, outputPath);

      console.log(`🔨 FFmpeg command: ${ffmpegCommand.substring(0, 200)}...`);

      // Execute rendering (can be in Docker container or directly)
      const useDocker = process.env.USE_DOCKER_RENDERING === 'true';

      if (useDocker) {
        await this.renderInDocker(jobId, ffmpegCommand, project);
      } else {
        await this.renderDirectly(jobId, ffmpegCommand, project);
      }

      // Get file size
      const stats = fs.statSync(outputPath);
      const fileSize = stats.size;

      // Update project and job with results
      const outputUrl = `/storage/videos/${outputFileName}`;
      
      await this.db.query(
        'UPDATE video_projects SET output_video_url = $1, file_size = $2, status = $3 WHERE id = $4',
        [outputUrl, fileSize, 'completed', project.id]
      );

      await this.db.query(`
        UPDATE video_render_jobs 
        SET status = $1, progress = 100, output_url = $2, completed_at = NOW(),
            processing_time = EXTRACT(EPOCH FROM (NOW() - started_at))
        WHERE id = $3
      `, ['completed', outputUrl, jobId]);

      console.log(`✅ Render job ${jobId} completed successfully`);

      return {
        success: true,
        output_url: outputUrl,
        file_size: fileSize
      };

    } catch (error) {
      console.error(`❌ Render job ${jobId} failed:`, error);

      // Update job status to failed
      await this.db.query(
        'UPDATE video_render_jobs SET status = $1, error_message = $2, completed_at = NOW() WHERE id = $3',
        ['failed', error.message, jobId]
      );

      await this.db.query(
        'UPDATE video_projects SET status = $1 WHERE id = $2',
        ['failed', project.id]
      );

      throw error;
    }
  }

  /**
   * Build FFmpeg command from project and timeline data
   */
  buildFFmpegCommand(project, timeline, outputPath) {
    const { width, height, fps, quality, project_metadata } = project;

    // Extract workflow settings from metadata
    const workflowSettings = project_metadata || {};
    const renderPreset = workflowSettings.export?.defaultRenderPreset || 'h264-high';
    const hardwareAccel = workflowSettings.ai?.hardwareAcceleration || 'auto';

    // Render preset configurations (matching workflow presets)
    const renderPresets = {
      'h264-high': {
        codec: 'libx264',
        crf: 18,
        preset: 'slow',
        profile: 'high',
        pixelFormat: 'yuv420p'
      },
      'h264-medium': {
        codec: 'libx264',
        crf: 23,
        preset: 'medium',
        profile: 'main',
        pixelFormat: 'yuv420p'
      },
      'h265-high': {
        codec: 'libx265',
        crf: 20,
        preset: 'medium',
        profile: 'main',
        pixelFormat: 'yuv420p'
      },
      'prores-422': {
        codec: 'prores_ks',
        profile: '2',  // ProRes 422
        pixelFormat: 'yuv422p10le'
      },
      'prores-422hq': {
        codec: 'prores_ks',
        profile: '3',  // ProRes 422 HQ
        pixelFormat: 'yuv422p10le'
      },
      'dnxhd': {
        codec: 'dnxhd',
        profile: 'dnxhd_1080p_36_23.97',
        bitrate: '36M',
        pixelFormat: 'yuv422p'
      }
    };

    // Fallback to quality presets if render preset not found
    const qualityPresets = {
      low: { codec: 'libx264', crf: 28, preset: 'veryfast', pixelFormat: 'yuv420p' },
      medium: { codec: 'libx264', crf: 23, preset: 'medium', pixelFormat: 'yuv420p' },
      high: { codec: 'libx264', crf: 18, preset: 'slow', pixelFormat: 'yuv420p' },
      ultra: { codec: 'libx264', crf: 15, preset: 'slower', pixelFormat: 'yuv420p' }
    };

    const preset = renderPresets[renderPreset] || qualityPresets[quality] || qualityPresets.medium;

    // Extract project fundamentals settings from metadata
    const projectSettings = project_metadata || {};
    const colorSpace = projectSettings.colorSpace || 'rec709';
    const workingColorDepth = projectSettings.workingColorDepth || '8bit';
    const masterSampleRate = projectSettings.masterSampleRate || 48000;
    const masterBitDepth = projectSettings.masterBitDepth || 16;

    // Color space mappings
    const colorSpaceMap = {
      'rec709': { colorspace: 'bt709', color_primaries: 'bt709', color_trc: 'bt709' },
      'rec2020': { colorspace: 'bt2020nc', color_primaries: 'bt2020', color_trc: 'smpte2084' },
      'dci-p3': { colorspace: 'bt2020nc', color_primaries: 'bt2020', color_trc: 'bt709' },
      'srgb': { colorspace: 'bt709', color_primaries: 'bt709', color_trc: 'iec61966-2-1' }
    };

    // Pixel format based on color depth (override preset if necessary)
    const colorDepthPixelFormats = {
      '8bit': 'yuv420p',
      '10bit': 'yuv420p10le',
      '16bit': 'yuv444p16le'
    };

    // Override pixel format based on color depth
    const finalPixelFormat = colorDepthPixelFormats[workingColorDepth] || preset.pixelFormat;
    const colorSettings = colorSpaceMap[colorSpace] || colorSpaceMap['rec709'];

    console.log(`🎨 Color Management: ${colorSpace} (${workingColorDepth})`);
    console.log(`🔊 Audio Engine: ${masterSampleRate}Hz @ ${masterBitDepth}-bit`);

    // Start building command
    let command = 'ffmpeg -y';

    // Hardware acceleration (if enabled)
    if (hardwareAccel === 'nvidia' || (hardwareAccel === 'auto' && this.isNvidiaAvailable())) {
      command += ' -hwaccel cuda -hwaccel_output_format cuda';
      console.log('🚀 Using NVIDIA GPU acceleration');
    } else if (hardwareAccel === 'auto') {
      console.log('🖥️  Using CPU rendering (no GPU detected)');
    }

    // Input files from timeline
    if (timeline && timeline.tracks) {
      const videoTracks = timeline.tracks.filter(t => t.type === 'video');
      const audioTracks = timeline.tracks.filter(t => t.type === 'audio');

      // Add video inputs
      videoTracks.forEach((track, idx) => {
        if (track.clips && track.clips.length > 0) {
          track.clips.forEach(clip => {
            if (clip.assetUrl) {
              command += ` -i "${clip.assetUrl}"`;
            }
          });
        }
      });

      // Add audio inputs
      audioTracks.forEach(track => {
        if (track.clips && track.clips.length > 0) {
          track.clips.forEach(clip => {
            if (clip.assetUrl) {
              command += ` -i "${clip.assetUrl}"`;
            }
          });
        }
      });
    }

    // Filter complex for timeline assembly (simplified version)
    // In production, you'd want to properly handle transitions, effects, etc.
    let filterComplex = '';
    
    if (timeline && timeline.tracks && timeline.tracks.length > 0) {
      // For simplicity, concatenate video clips
      const videoTrack = timeline.tracks.find(t => t.type === 'video');
      if (videoTrack && videoTrack.clips && videoTrack.clips.length > 1) {
        const clipCount = videoTrack.clips.length;
        for (let i = 0; i < clipCount; i++) {
          filterComplex += `[${i}:v]scale=${width}:${height},setsar=1[v${i}];`;
        }
        for (let i = 0; i < clipCount; i++) {
          filterComplex += `[v${i}]`;
        }
        filterComplex += `concat=n=${clipCount}:v=1:a=0[outv]`;
      } else if (videoTrack && videoTrack.clips && videoTrack.clips.length === 1) {
        filterComplex = `[0:v]scale=${width}:${height},setsar=1[outv]`;
      }
    }

    // Output settings
    if (filterComplex) {
      command += ` -filter_complex "${filterComplex}"`;
      command += ` -map "[outv]"`;
    } else {
      command += ` -vf "scale=${width}:${height}"`;
    }

    // Encoding parameters
    command += ` -c:v ${preset.codec}`;

    // Add codec-specific parameters
    if (preset.crf !== undefined) {
      command += ` -crf ${preset.crf}`;
    }
    if (preset.preset) {
      command += ` -preset ${preset.preset}`;
    }
    if (preset.profile) {
      if (preset.codec === 'prores_ks') {
        command += ` -profile:v ${preset.profile}`;
      } else {
        command += ` -profile:v ${preset.profile}`;
      }
    }
    if (preset.bitrate) {
      command += ` -b:v ${preset.bitrate}`;
    }

    command += ` -r ${fps}`;
    command += ` -pix_fmt ${finalPixelFormat}`;

    // Color management settings
    command += ` -colorspace ${colorSettings.colorspace}`;
    command += ` -color_primaries ${colorSettings.color_primaries}`;
    command += ` -color_trc ${colorSettings.color_trc}`;

    // Audio encoding settings
    const audioSampleFormat = masterBitDepth === 24 ? 's32' : 's16';
    const audioCodec = masterBitDepth === 24 ? 'pcm_s24le' : 'aac';

    command += ` -c:a ${audioCodec}`;
    command += ` -ar ${masterSampleRate}`;
    if (audioCodec === 'aac') {
      command += ` -b:a 192k`; // AAC bitrate for 16-bit
    }

    // Output file
    command += ` "${outputPath}"`;

    return command;
  }

  /**
   * Render video directly using FFmpeg (without Docker)
   */
  async renderDirectly(jobId, ffmpegCommand, project) {
    const totalFrames = Math.ceil(project.duration * project.fps);
    
    return new Promise((resolve, reject) => {
      const process = exec(ffmpegCommand);
      
      this.activeJobs.set(jobId, { process });

      let currentFrame = 0;

      // Parse FFmpeg progress from stderr
      process.stderr.on('data', async (data) => {
        const output = data.toString();
        
        // Extract frame number
        const frameMatch = output.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          currentFrame = parseInt(frameMatch[1]);
          const progress = Math.min((currentFrame / totalFrames) * 100, 99);

          // Update progress in database
          try {
            await this.db.query(
              'UPDATE video_render_jobs SET progress = $1, current_frame = $2 WHERE id = $3',
              [Math.floor(progress), currentFrame, jobId]
            );
          } catch (err) {
            console.error('Failed to update progress:', err);
          }
        }
      });

      process.on('close', (code) => {
        this.activeJobs.delete(jobId);
        
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      process.on('error', (error) => {
        this.activeJobs.delete(jobId);
        reject(error);
      });
    });
  }

  /**
   * Render video in Docker container
   */
  async renderInDocker(jobId, ffmpegCommand, project) {
    const containerName = `xenostudio-render-${jobId}`;
    
    try {
      // Build Docker command
      const dockerCommand = `docker run --name ${containerName} ` +
        `-v "${VIDEOS_DIR}:/videos" ` +
        `-v "${ASSETS_DIR}:/assets" ` +
        `jrottenberg/ffmpeg:latest ` +
        ffmpegCommand.replace(VIDEOS_DIR, '/videos').replace(ASSETS_DIR, '/assets');

      console.log(`🐳 Starting Docker container: ${containerName}`);

      // Execute in Docker
      const totalFrames = Math.ceil(project.duration * project.fps);
      
      return new Promise((resolve, reject) => {
        const process = exec(dockerCommand);
        
        this.activeJobs.set(jobId, { containerId: containerName, process });

        let currentFrame = 0;

        process.stderr.on('data', async (data) => {
          const output = data.toString();
          
          const frameMatch = output.match(/frame=\s*(\d+)/);
          if (frameMatch) {
            currentFrame = parseInt(frameMatch[1]);
            const progress = Math.min((currentFrame / totalFrames) * 100, 99);

            try {
              await this.db.query(
                'UPDATE video_render_jobs SET progress = $1, current_frame = $2, container_id = $3 WHERE id = $4',
                [Math.floor(progress), currentFrame, containerName, jobId]
              );
            } catch (err) {
              console.error('Failed to update progress:', err);
            }
          }
        });

        process.on('close', async (code) => {
          // Cleanup container
          try {
            await execPromise(`docker rm -f ${containerName}`);
          } catch (err) {
            console.error('Failed to cleanup container:', err);
          }

          this.activeJobs.delete(jobId);
          
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Docker container exited with code ${code}`));
          }
        });

        process.on('error', (error) => {
          this.activeJobs.delete(jobId);
          reject(error);
        });
      });

    } catch (error) {
      // Cleanup on error
      try {
        await execPromise(`docker rm -f ${containerName}`);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Cancel a rendering job
   */
  async cancelJob(jobId) {
    const job = this.activeJobs.get(jobId);
    
    if (!job) {
      throw new Error('Job not found or not running');
    }

    // Kill the process
    if (job.process) {
      job.process.kill('SIGTERM');
    }

    // Stop Docker container if present
    if (job.containerId) {
      try {
        await execPromise(`docker rm -f ${job.containerId}`);
      } catch (err) {
        console.error('Failed to stop container:', err);
      }
    }

    this.activeJobs.delete(jobId);
  }

  /**
   * Get status of active jobs
   */
  getActiveJobs() {
    return Array.from(this.activeJobs.keys());
  }

  /**
   * Check if NVIDIA GPU is available for hardware acceleration
   */
  isNvidiaAvailable() {
    try {
      // Try to detect NVIDIA GPU
      const { execSync } = require('child_process');
      execSync('nvidia-smi', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default VideoProcessingService;
