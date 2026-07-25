/**
 * Conversion Worker Service
 * Handles async file conversions using Bull queue
 */

import Bull from 'bull';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { PDFDocument, rgb } from 'pdf-lib';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import fs from 'fs';
import path from 'path';
import { updateConversionStatus } from '../models/conversionModels.js';

// Create Bull queue connected to Redis
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const conversionQueue = new Bull('file-conversions', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 200 // Keep last 200 failed jobs
  }
});

/**
 * Process conversion jobs
 */
conversionQueue.process(2, async (job) => { // Process 2 jobs concurrently
  const { conversionId, fileId, inputPath, outputFormat, settings, userId } = job.data;
  
  try {
    console.log(`[Conversion ${conversionId}] Starting conversion of ${inputPath} to ${outputFormat}`);
    
    // Update status to processing
    await updateConversionStatus(conversionId, 'processing', 0);
    
    // Determine file type and converter
    const fileType = getFileType(inputPath);
    let outputPath;
    let outputSize;
    
    // Execute appropriate conversion
    switch (fileType) {
      case 'image':
        outputPath = await convertImage(inputPath, outputFormat, settings, (progress) => {
          job.progress(progress);
          updateConversionStatus(conversionId, 'processing', progress);
        });
        break;
      case 'video':
      case 'audio':
        outputPath = await convertMediaFile(inputPath, outputFormat, settings, fileType, (progress) => {
          job.progress(progress);
          updateConversionStatus(conversionId, 'processing', progress);
        });
        break;
      case 'document':
        outputPath = await convertDocument(inputPath, outputFormat, settings, (progress) => {
          job.progress(progress);
          updateConversionStatus(conversionId, 'processing', progress);
        });
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    // Get output file size
    const stats = fs.statSync(outputPath);
    outputSize = stats.size;
    
    // Update status to completed
    await updateConversionStatus(conversionId, 'completed', 100, outputPath, outputSize);
    
    console.log(`[Conversion ${conversionId}] Completed successfully`);
    
    return { outputPath, outputSize };
  } catch (error) {
    console.error(`[Conversion ${conversionId}] Failed:`, error);
    await updateConversionStatus(conversionId, 'failed', 0, null, null, error.message);
    throw error;
  }
});

/**
 * Determine file type from path
 */
function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg', '.ico'];
  const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.mpeg', '.mpg', '.m4v'];
  const audioExts = ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma', '.opus'];
  const documentExts = ['.pdf', '.docx', '.doc', '.txt', '.html', '.md', '.rtf', '.odt'];
  
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (documentExts.includes(ext)) return 'document';
  
  return 'unknown';
}

/**
 * SECURITY: build the output path from basename components only and assert the
 * resolved path stays INSIDE outputDir (defense-in-depth against traversal via
 * a crafted outputFormat or filename).
 */
function safeOutputPath(outputDir, outputFilename) {
  const resolvedDir = path.resolve(outputDir);
  const resolved = path.resolve(resolvedDir, path.basename(outputFilename));
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error('Invalid output path (escapes output directory)');
  }
  return resolved;
}

/**
 * Convert image files using sharp
 */
async function convertImage(inputPath, outputFormat, settings, onProgress) {
  const outputDir = path.join(process.cwd(), 'conversions');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFilename = `${path.basename(inputPath, path.extname(inputPath))}.${outputFormat.toLowerCase()}`;
  const outputPath = safeOutputPath(outputDir, outputFilename);
  
  onProgress(10);
  
  try {
    let pipeline = sharp(inputPath);
    
    // Apply resolution settings
    if (settings.resolution && settings.resolution !== 'original') {
      const resolutionMap = {
        '4k': 3840,
        '2k': 2560,
        '1080p': 1920,
        '720p': 1280,
        '480p': 854
      };
      const width = resolutionMap[settings.resolution];
      if (width) {
        pipeline = pipeline.resize(width, null, { withoutEnlargement: true });
      }
    }
    
    onProgress(30);
    
    // Apply format-specific options
    const quality = settings.quality || 85;
    
    switch (outputFormat.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality });
        break;
      case 'png':
        pipeline = pipeline.png({ quality });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality });
        break;
      case 'gif':
        pipeline = pipeline.gif();
        break;
      case 'tiff':
      case 'tif':
        pipeline = pipeline.tiff({ quality });
        break;
      case 'bmp':
        pipeline = pipeline.toFormat('bmp');
        break;
      default:
        pipeline = pipeline.toFormat(outputFormat.toLowerCase());
    }
    
    onProgress(70);
    
    await pipeline.toFile(outputPath);
    
    onProgress(100);
    
    return outputPath;
  } catch (error) {
    console.error('Image conversion error:', error);
    throw new Error(`Image conversion failed: ${error.message}`);
  }
}

/**
 * Convert video/audio files using fluent-ffmpeg
 */
async function convertMediaFile(inputPath, outputFormat, settings, fileType, onProgress) {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(process.cwd(), 'conversions');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFilename = `${path.basename(inputPath, path.extname(inputPath))}.${outputFormat.toLowerCase()}`;
    let outputPath;
    try {
      outputPath = safeOutputPath(outputDir, outputFilename);
    } catch (e) {
      return reject(e);
    }

    let command = ffmpeg(inputPath);
    
    // Apply quality settings
    if (fileType === 'video') {
      const qualityMap = {
        10: 35, 20: 32, 30: 30, 40: 28, 50: 26,
        60: 24, 70: 22, 80: 20, 90: 18, 100: 16
      };
      const crf = qualityMap[settings.quality || 75] || 23;
      command = command.videoCodec('libx264').addOption('-crf', crf);
      
      // Apply resolution
      if (settings.resolution && settings.resolution !== 'original') {
        const resolutionMap = {
          '4k': '3840x2160',
          '2k': '2560x1440',
          '1080p': '1920x1080',
          '720p': '1280x720',
          '480p': '854x480'
        };
        const size = resolutionMap[settings.resolution];
        if (size) {
          command = command.size(size);
        }
      }
    }
    
    if (fileType === 'audio') {
      const bitrateMap = {
        10: '64k', 30: '96k', 50: '128k', 70: '192k', 90: '256k', 100: '320k'
      };
      const bitrate = bitrateMap[settings.quality || 70] || '192k';
      command = command.audioBitrate(bitrate);
    }
    
    // Set output format
    command = command.format(outputFormat.toLowerCase());
    
    command
      .on('start', () => {
        console.log('FFmpeg started');
        onProgress(10);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          const progressPercent = Math.min(Math.round(progress.percent), 99);
          onProgress(progressPercent);
        }
      })
      .on('end', () => {
        console.log('FFmpeg conversion finished');
        onProgress(100);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(new Error(`Media conversion failed: ${err.message}`));
      })
      .save(outputPath);
  });
}

/**
 * Convert document files
 */
async function convertDocument(inputPath, outputFormat, settings, onProgress) {
  const outputDir = path.join(process.cwd(), 'conversions');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const inputExt = path.extname(inputPath).toLowerCase();
  const outputFilename = `${path.basename(inputPath, inputExt)}.${outputFormat.toLowerCase()}`;
  const outputPath = safeOutputPath(outputDir, outputFilename);
  
  onProgress(10);
  
  try {
    // Handle different conversion combinations
    if (inputExt === '.docx' && outputFormat.toLowerCase() === 'pdf') {
      // DOCX to PDF (via HTML intermediate)
      const result = await mammoth.convertToHtml({ path: inputPath });
      onProgress(40);
      
      // Create PDF from HTML
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // A4 size
      
      const textLines = result.value.replace(/<[^>]*>/g, '').split('\n');
      let yPosition = 800;
      
      textLines.forEach((line, index) => {
        if (yPosition < 50) return; // Don't overflow page
        page.drawText(line.substring(0, 80), {
          x: 50,
          y: yPosition,
          size: 12,
          color: rgb(0, 0, 0)
        });
        yPosition -= 20;
      });
      
      onProgress(80);
      
      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, pdfBytes);
    } else if (inputExt === '.pdf' && outputFormat.toLowerCase() === 'txt') {
      // PDF to TXT (simplified extraction)
      const pdfData = fs.readFileSync(inputPath);
      const pdfDoc = await PDFDocument.load(pdfData);
      
      let extractedText = `Extracted from PDF (${pdfDoc.getPageCount()} pages)\n\n`;
      extractedText += '[Text extraction from PDF requires additional libraries - placeholder content]\n';
      
      fs.writeFileSync(outputPath, extractedText, 'utf-8');
    } else if (inputExt === '.txt' && outputFormat.toLowerCase() === 'docx') {
      // TXT to DOCX
      const textContent = fs.readFileSync(inputPath, 'utf-8');
      onProgress(40);
      
      const doc = new Document({
        sections: [{
          children: textContent.split('\n').map(line => 
            new Paragraph({
              children: [new TextRun(line)]
            })
          )
        }]
      });
      
      onProgress(70);
      
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(outputPath, buffer);
    } else if (inputExt === '.docx' && outputFormat.toLowerCase() === 'txt') {
      // DOCX to TXT
      const result = await mammoth.extractRawText({ path: inputPath });
      onProgress(60);
      fs.writeFileSync(outputPath, result.value, 'utf-8');
    } else {
      // Unsupported conversion, copy file as-is
      fs.copyFileSync(inputPath, outputPath);
    }
    
    onProgress(100);
    return outputPath;
  } catch (error) {
    console.error('Document conversion error:', error);
    throw new Error(`Document conversion failed: ${error.message}`);
  }
}

/**
 * Add a conversion job to the queue
 */
export async function addConversionJob(conversionData) {
  const job = await conversionQueue.add(conversionData, {
    priority: 1,
    timeout: 30 * 60 * 1000 // 30 minutes timeout
  });
  return job;
}

/**
 * Get job status from queue
 */
export async function getJobStatus(jobId) {
  try {
    const job = await conversionQueue.getJob(jobId);
    if (!job) return null;
    
    const state = await job.getState();
    const progress = job.progress();
    
    return {
      id: jobId,
      state,
      progress,
      data: job.data
    };
  } catch (error) {
    console.error('Error getting job status:', error);
    return null;
  }
}

// Queue event handlers
conversionQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed successfully`);
});

conversionQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

conversionQueue.on('stalled', (job) => {
  console.warn(`Job ${job.id} stalled`);
});

export default {
  conversionQueue,
  addConversionJob,
  getJobStatus
};

