/**
 * Video Utilities Service
 * Handles thumbnail generation, metadata extraction, and other video utilities
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = promisify(exec);

// Storage directories
const THUMBNAILS_DIR = path.join(process.cwd(), 'storage', 'thumbnails');
const ASSETS_DIR = path.join(process.cwd(), 'storage', 'assets');

// Ensure directories exist
[THUMBNAILS_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

class VideoUtilsService {
  /**
   * Generate thumbnail from video file
   * @param {string} videoPath - Path to video file
   * @param {number} timestamp - Time in seconds to capture thumbnail (default: 1)
   * @returns {Promise<string>} - Path to generated thumbnail
   */
  async generateThumbnail(videoPath, timestamp = 1) {
    try {
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const thumbnailName = `${videoName}_thumb_${Date.now()}.jpg`;
      const thumbnailPath = path.join(THUMBNAILS_DIR, thumbnailName);

      console.log(`📸 Generating thumbnail for ${videoPath} at ${timestamp}s`);

      // Use FFmpeg to extract frame at specific timestamp
      const command = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${thumbnailPath}"`;

      await execPromise(command);

      if (fs.existsSync(thumbnailPath)) {
        console.log(`✅ Thumbnail generated: ${thumbnailName}`);
        return `/storage/thumbnails/${thumbnailName}`;
      } else {
        throw new Error('Thumbnail file was not created');
      }
    } catch (error) {
      console.error('❌ Thumbnail generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Extract metadata from video file
   * @param {string} videoPath - Path to video file
   * @returns {Promise<Object>} - Video metadata
   */
  async extractMetadata(videoPath) {
    try {
      console.log(`📊 Extracting metadata from ${videoPath}`);

      // Use ffprobe to get video information
      const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;

      const { stdout } = await execPromise(command);
      const metadata = JSON.parse(stdout);

      // Extract relevant information
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      const format = metadata.format;

      const result = {
        duration: parseFloat(format.duration) || 0,
        size: parseInt(format.size) || 0,
        bitrate: parseInt(format.bit_rate) || 0,
        format: format.format_name,

        // Video info
        video: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: this.calculateFPS(videoStream),
          pixelFormat: videoStream.pix_fmt,
          bitrate: parseInt(videoStream.bit_rate) || 0
        } : null,

        // Audio info
        audio: audioStream ? {
          codec: audioStream.codec_name,
          sampleRate: parseInt(audioStream.sample_rate) || 0,
          channels: audioStream.channels || 0,
          bitrate: parseInt(audioStream.bit_rate) || 0
        } : null
      };

      console.log(`✅ Metadata extracted: ${result.duration}s, ${result.video?.width}x${result.video?.height}`);
      return result;
    } catch (error) {
      console.error('❌ Metadata extraction failed:', error.message);
      throw error;
    }
  }

  /**
   * Calculate FPS from video stream data
   */
  calculateFPS(videoStream) {
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      return den ? Math.round((num / den) * 100) / 100 : 0;
    }
    if (videoStream.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      return den ? Math.round((num / den) * 100) / 100 : 0;
    }
    return 0;
  }

  /**
   * Generate waveform image from audio
   * @param {string} videoPath - Path to video/audio file
   * @returns {Promise<string>} - Path to generated waveform image
   */
  async generateWaveform(videoPath) {
    try {
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const waveformName = `${videoName}_wave_${Date.now()}.png`;
      const waveformPath = path.join(THUMBNAILS_DIR, waveformName);

      console.log(`🎵 Generating waveform for ${videoPath}`);

      // Use FFmpeg to generate waveform visualization
      const command = `ffmpeg -i "${videoPath}" -filter_complex "showwavespic=s=1200x240:colors=#ffffff" -frames:v 1 "${waveformPath}"`;

      await execPromise(command);

      if (fs.existsSync(waveformPath)) {
        console.log(`✅ Waveform generated: ${waveformName}`);
        return `/storage/thumbnails/${waveformName}`;
      } else {
        throw new Error('Waveform file was not created');
      }
    } catch (error) {
      console.error('❌ Waveform generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Process uploaded video asset
   * Generates thumbnail and extracts metadata if enabled in workflow settings
   * @param {string} videoPath - Path to uploaded video
   * @param {Object} workflowSettings - Workflow AI settings
   * @returns {Promise<Object>} - Processing results
   */
  async processUploadedAsset(videoPath, workflowSettings = {}) {
    const results = {
      thumbnailUrl: null,
      waveformUrl: null,
      metadata: null
    };

    try {
      const aiSettings = workflowSettings.ai || {};

      // Generate thumbnail if enabled
      if (aiSettings.thumbnailGeneration === 'auto') {
        try {
          results.thumbnailUrl = await this.generateThumbnail(videoPath);
        } catch (err) {
          console.warn('⚠️  Thumbnail generation skipped:', err.message);
        }
      }

      // Extract metadata if enabled
      if (aiSettings.metadataExtraction !== false) {
        try {
          results.metadata = await this.extractMetadata(videoPath);
        } catch (err) {
          console.warn('⚠️  Metadata extraction skipped:', err.message);
        }
      }

      // Generate waveform if enabled
      if (aiSettings.waveformGeneration) {
        try {
          results.waveformUrl = await this.generateWaveform(videoPath);
        } catch (err) {
          console.warn('⚠️  Waveform generation skipped:', err.message);
        }
      }

      return results;
    } catch (error) {
      console.error('❌ Asset processing failed:', error);
      return results;
    }
  }
}

export default new VideoUtilsService();
