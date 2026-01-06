// Utility functions for VideoStudio

import { VideoFile, VideoProject, VideoStudioSettings } from './types';

/**
 * Format file size in human readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format duration in MM:SS format
 */
export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Generate unique ID
 */
export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

/**
 * Validate video file format
 */
export const isValidVideoFormat = (filename: string): boolean => {
  const validFormats = ['.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv'];
  const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return validFormats.includes(extension);
};

/**
 * Get video resolution string
 */
export const getResolutionString = (width: number, height: number): string => {
  const commonResolutions: Record<string, string> = {
    '1920x1080': '1080p (Full HD)',
    '1280x720': '720p (HD)',
    '3840x2160': '4K (Ultra HD)',
    '2560x1440': '1440p (2K)',
    '854x480': '480p (SD)',
    '640x360': '360p'
  };
  
  const key = `${width}x${height}`;
  return commonResolutions[key] || `${width}x${height}`;
};

/**
 * Calculate video aspect ratio
 */
export const getAspectRatio = (width: number, height: number): string => {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

/**
 * Default video studio settings
 */
export const getDefaultSettings = (): VideoStudioSettings => ({
  quality: 'high',
  format: 'mp4',
  resolution: '1920x1080',
  frameRate: 30
});

/**
 * Create new video project
 */
export const createNewProject = (name: string, description?: string): VideoProject => ({
  id: generateId(),
  name,
  description,
  videos: [],
  createdAt: new Date(),
  updatedAt: new Date()
});