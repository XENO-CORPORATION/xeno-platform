/**
 * File Conversion API Routes
 * Handles file format conversion operations with real database and queue integration
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  createConversionFile,
  getConversionFileById,
  createConversion,
  getConversionById,
  getConversionHistory,
  checkStorageLimit,
  updateStorageUsage,
  getStorageUsage,
  deleteConversion
} from '../models/conversionModels.js';
import { addConversionJob, getJobStatus } from '../services/conversionWorker.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * Helper function to convert snake_case database fields to camelCase for frontend
 */
function toCamelCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  
  const camelObj = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    camelObj[camelKey] = obj[key];
  }
  return camelObj;
}

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads/conversions');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = uuidv4();
    cb(null, `${uniquePrefix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit for conversions
  }
});

/**
 * Middleware to get user ID from JWT token or fallback to x-user-id header
 * Uses optional auth to support both JWT and legacy header-based auth
 */
const getUserId = (req, res, next) => {
  // Priority 1: JWT token (req.user is set by optionalAuthMiddleware)
  if (req.user && req.user.id) {
    req.userId = req.user.id;
    return next();
  }
  
  // Priority 2: x-user-id header (for backward compatibility during migration)
  const headerUserId = req.headers['x-user-id'];
  if (headerUserId) {
    req.userId = headerUserId;
    return next();
  }
  
  // Priority 3: Default for development/testing
  if (process.env.NODE_ENV === 'development') {
    req.userId = 'default-user';
    return next();
  }
  
  // In production without auth, return error
  return res.status(401).json({
    success: false,
    error: 'Authentication required. Please provide a valid JWT token or x-user-id header.'
  });
};

/**
 * POST /api/conversion/upload - Upload files for conversion
 */
router.post('/upload', optionalAuthMiddleware, getUserId, upload.array('files'), async (req, res) => {
  try {
    const files = req.files;
    const userId = req.userId;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    // Check storage limit for all files
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const storageCheck = await checkStorageLimit(userId, totalSize);

    if (!storageCheck.withinLimit) {
      // Delete uploaded files since we're rejecting them
      files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error('Error deleting rejected file:', err);
        }
      });

      return res.status(413).json({
        success: false,
        error: 'Storage limit exceeded',
        details: {
          currentSize: storageCheck.currentSize,
          requestedSize: totalSize,
          limit: storageCheck.limit,
          available: storageCheck.available
        }
      });
    }

    // Save files to database
    const uploadedFiles = [];
    for (const file of files) {
      const fileRecord = await createConversionFile(
        userId,
        file.originalname,
        file.filename,
        file.path,
        file.size,
        file.mimetype
      );
      uploadedFiles.push(toCamelCase(fileRecord));
    }

    // Update storage usage
    await updateStorageUsage(userId, totalSize, files.length);

    res.status(201).json({
      success: true,
      data: {
        files: uploadedFiles,
        count: uploadedFiles.length
      },
      message: `${uploadedFiles.length} file(s) uploaded successfully`
    });

  } catch (error) {
    console.error('Upload files for conversion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload files',
      message: error.message
    });
  }
});

/**
 * POST /api/conversion/convert - Start file conversion
 */
router.post('/convert', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const { fileId, outputFormat, settings = {} } = req.body;
    const userId = req.userId;

    if (!fileId || !outputFormat) {
      return res.status(400).json({
        success: false,
        error: 'fileId and outputFormat are required'
      });
    }

    // Verify file exists and belongs to user
    const file = await getConversionFileById(fileId, userId);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found or does not belong to user'
      });
    }

    // Determine input format from mime type
    const inputFormat = path.extname(file.original_name).substring(1).toLowerCase();

    // Create conversion record
    const conversion = await createConversion(
      fileId,
      userId,
      inputFormat,
      outputFormat,
      settings
    );

    // Add job to Bull queue
    const job = await addConversionJob({
      conversionId: conversion.id,
      fileId: file.id,
      inputPath: file.file_path,
      outputFormat,
      settings,
      userId
    });

    res.status(202).json({
      success: true,
      data: toCamelCase({
        ...conversion,
        jobId: job.id,
        originalName: file.original_name,
        inputFormat,
        outputFormat
      }),
      message: 'Conversion started'
    });

  } catch (error) {
    console.error('Convert file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start conversion',
      message: error.message
    });
  }
});

/**
 * POST /api/conversion/batch - Start batch file conversion
 * Converts multiple files at once with the same settings
 */
router.post('/batch', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const { fileIds, outputFormat, settings = {} } = req.body;
    const userId = req.userId;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'fileIds array is required and must not be empty'
      });
    }

    if (!outputFormat) {
      return res.status(400).json({
        success: false,
        error: 'outputFormat is required'
      });
    }

    const conversions = [];
    const errors = [];

    // Process each file
    for (const fileId of fileIds) {
      try {
        // Verify file exists and belongs to user
        const file = await getConversionFileById(fileId, userId);
        if (!file) {
          errors.push({
            fileId,
            error: 'File not found or does not belong to user'
          });
          continue;
        }

        // Determine input format from mime type
        const inputFormat = path.extname(file.original_name).substring(1).toLowerCase();

        // Create conversion record
        const conversion = await createConversion(
          fileId,
          userId,
          inputFormat,
          outputFormat,
          settings
        );

        // Add job to Bull queue
        const job = await addConversionJob({
          conversionId: conversion.id,
          fileId: file.id,
          inputPath: file.file_path,
          outputFormat,
          settings,
          userId
        });

        conversions.push(toCamelCase({
          ...conversion,
          jobId: job.id,
          originalName: file.original_name,
          inputFormat,
          outputFormat
        }));

      } catch (error) {
        errors.push({
          fileId,
          error: error.message
        });
      }
    }

    res.status(202).json({
      success: true,
      data: {
        conversions,
        total: fileIds.length,
        successful: conversions.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined
      },
      message: `Started ${conversions.length} of ${fileIds.length} conversions`
    });

  } catch (error) {
    console.error('Batch convert error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start batch conversion',
      message: error.message
    });
  }
});

/**
 * GET /api/conversion/status/:id - Get conversion status
 */
router.get('/status/:id', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Get conversion from database
    const conversion = await getConversionById(id, userId);

    if (!conversion) {
      return res.status(404).json({
        success: false,
        error: 'Conversion not found'
      });
    }

    // Format response
    const response = {
      id: conversion.id,
      fileId: conversion.file_id,
      originalName: conversion.original_name,
      inputFormat: conversion.input_format,
      outputFormat: conversion.output_format,
      status: conversion.status,
      progress: conversion.progress,
      startTime: conversion.started_at,
      endTime: conversion.completed_at,
      duration: conversion.completed_at && conversion.started_at
        ? Math.round((new Date(conversion.completed_at) - new Date(conversion.started_at)) / 1000)
        : null,
      error: conversion.error_message,
      resultUrl: conversion.status === 'completed' && conversion.output_path
        ? `/api/conversion/download/${conversion.id}`
        : null
    };

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Get conversion status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversion status',
      message: error.message
    });
  }
});

/**
 * GET /api/conversion/download/:id - Download converted file
 */
router.get('/download/:id', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Get conversion from database
    const conversion = await getConversionById(id, userId);

    if (!conversion) {
      return res.status(404).json({
        success: false,
        error: 'Conversion not found'
      });
    }

    if (conversion.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Conversion not completed yet',
        status: conversion.status
      });
    }

    if (!conversion.output_path || !fs.existsSync(conversion.output_path)) {
      return res.status(404).json({
        success: false,
        error: 'Converted file not found on disk'
      });
    }

    // Stream the file
    const filename = conversion.output_filename || path.basename(conversion.output_path);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = fs.createReadStream(conversion.output_path);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download converted file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download converted file',
      message: error.message
    });
  }
});

/**
 * GET /api/conversion/history - Get user's conversion history
 */
router.get('/history', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const conversions = await getConversionHistory(userId, limit, offset);

    // Format response
    const formattedConversions = conversions.map(conv => ({
      id: conv.id,
      originalName: conv.original_name,
      inputFormat: conv.input_format,
      outputFormat: conv.output_format,
      status: conv.status,
      progress: conv.progress,
      fileSize: conv.file_size,
      outputSize: conv.output_size,
      createdAt: conv.created_at,
      completedAt: conv.completed_at,
      downloadUrl: conv.status === 'completed' ? `/api/conversion/download/${conv.id}` : null
    }));

    res.json({
      success: true,
      data: {
        conversions: formattedConversions,
        count: formattedConversions.length,
        limit,
        offset
      }
    });

  } catch (error) {
    console.error('Get conversion history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversion history',
      message: error.message
    });
  }
});

/**
 * GET /api/conversion/storage - Get user's storage usage
 */
router.get('/storage', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const usage = await getStorageUsage(userId);

    res.json({
      success: true,
      data: {
        totalFiles: usage.total_files || 0,
        totalSize: usage.total_size || 0,
        limit: usage.limit,
        percentage: usage.limit > 0 ? Math.round((usage.total_size / usage.limit) * 100) : 0,
        available: Math.max(0, usage.limit - (usage.total_size || 0))
      }
    });

  } catch (error) {
    console.error('Get storage usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get storage usage',
      message: error.message
    });
  }
});

/**
 * DELETE /api/conversion/:id - Delete a conversion
 */
router.delete('/:id', optionalAuthMiddleware, getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Delete conversion and get files to remove
    const result = await deleteConversion(id, userId);

    // Delete physical files
    for (const filePath of result.filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Error deleting file ${filePath}:`, err);
      }
    }

    res.json({
      success: true,
      message: 'Conversion deleted successfully'
    });

  } catch (error) {
    console.error('Delete conversion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete conversion',
      message: error.message
    });
  }
});

/**
 * POST /api/conversion/html-to-docx - Convert HTML to DOCX
 * Uses docx library with comprehensive HTML parsing for reliable output
 */
router.post('/html-to-docx', async (req, res) => {
  try {
    const { html, filename = 'document.docx' } = req.body;

    if (!html) {
      return res.status(400).json({
        success: false,
        error: 'HTML content is required'
      });
    }

    const cheerio = await import('cheerio');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
            WidthType, BorderStyle, AlignmentType, ShadingType, convertInchesToTwip } = await import('docx');

    const $ = cheerio.load(html);
    const children = [];

    // Helper: Parse inline elements and create TextRuns
    const parseInlineContent = (element, inheritBold = false, inheritItalic = false) => {
      const runs = [];

      const processNode = (node, bold = inheritBold, italic = inheritItalic) => {
        if (node.type === 'text') {
          const text = node.data;
          if (text) {
            runs.push(new TextRun({
              text: text,
              bold: bold,
              italics: italic,
              font: 'Calibri',
              size: 22
            }));
          }
        } else if (node.type === 'tag') {
          const tag = node.name.toLowerCase();
          const $node = $(node);

          if (tag === 'strong' || tag === 'b') {
            $node.contents().each((i, child) => processNode(child, true, italic));
          } else if (tag === 'em' || tag === 'i') {
            $node.contents().each((i, child) => processNode(child, bold, true));
          } else if (tag === 'br') {
            runs.push(new TextRun({ break: 1 }));
          } else if (tag === 'span' || tag === 'a') {
            $node.contents().each((i, child) => processNode(child, bold, italic));
          } else {
            // For other inline elements, just get text
            const text = $node.text();
            if (text) {
              runs.push(new TextRun({ text, bold, italics: italic, font: 'Calibri', size: 22 }));
            }
          }
        }
      };

      $(element).contents().each((i, node) => processNode(node));

      if (runs.length === 0) {
        const text = $(element).text();
        if (text) {
          runs.push(new TextRun({ text, bold: inheritBold, italics: inheritItalic, font: 'Calibri', size: 22 }));
        }
      }

      return runs;
    };

    // Helper: Create a paragraph with proper spacing
    const createParagraph = (textRuns, options = {}) => {
      return new Paragraph({
        children: textRuns,
        spacing: { after: 200, line: 276 },
        alignment: options.alignment || AlignmentType.JUSTIFIED,
        indent: options.indent,
        ...options
      });
    };

    // Process list items recursively
    const processListItems = ($list, level = 0) => {
      const bullet = level === 0 ? '•' : '◦';
      const indent = 720 + (level * 360);

      $list.children('li').each((i, li) => {
        const $li = $(li);
        // Get direct text content (not nested lists)
        const $clone = $li.clone();
        $clone.children('ul, ol').remove();
        const text = $clone.text().trim();

        if (text) {
          const runs = parseInlineContent($clone[0]);
          if (runs.length > 0) {
            runs.unshift(new TextRun({ text: `${bullet} `, font: 'Calibri', size: 22 }));
          } else {
            runs.push(new TextRun({ text: `${bullet} ${text}`, font: 'Calibri', size: 22 }));
          }
          children.push(new Paragraph({
            children: runs,
            spacing: { after: 120 },
            indent: { left: indent }
          }));
        }

        // Process nested lists
        $li.children('ul, ol').each((j, nestedList) => {
          processListItems($(nestedList), level + 1);
        });
      });
    };

    // Process table
    const processTable = ($table) => {
      const rows = [];
      let maxCols = 0;

      // First pass: determine max columns
      $table.find('tr').each((i, tr) => {
        let cols = 0;
        $(tr).find('th, td').each((j, cell) => {
          cols += parseInt($(cell).attr('colspan')) || 1;
        });
        maxCols = Math.max(maxCols, cols);
      });

      if (maxCols === 0) return null;

      $table.find('tr').each((i, tr) => {
        const cells = [];
        $(tr).find('th, td').each((j, cell) => {
          const $cell = $(cell);
          const isHeader = cell.name === 'th';
          const colspan = parseInt($cell.attr('colspan')) || 1;
          const text = $cell.text().trim();

          cells.push(new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: text,
                bold: isHeader,
                font: 'Calibri',
                size: 22
              })],
              spacing: { after: 0 }
            })],
            columnSpan: colspan,
            shading: isHeader ? { fill: 'E9ECEF', type: ShadingType.CLEAR } : undefined,
            margins: { top: 100, bottom: 100, left: 100, right: 100 }
          }));
        });

        // Pad with empty cells if needed
        while (cells.length < maxCols) {
          cells.push(new TableCell({
            children: [new Paragraph({ children: [] })]
          }));
        }

        if (cells.length > 0) {
          rows.push(new TableRow({ children: cells }));
        }
      });

      if (rows.length > 0) {
        return new Table({
          rows: rows,
          width: { size: 100, type: WidthType.PERCENTAGE }
        });
      }
      return null;
    };

    // Main element processor
    const processElement = (element) => {
      const tag = element.name?.toLowerCase();
      if (!tag) return;

      const $el = $(element);
      const className = $el.attr('class') || '';

      // Skip non-content tags
      if (['head', 'style', 'script', 'meta', 'link', 'title'].includes(tag)) {
        return;
      }

      switch (tag) {
        case 'h1':
          children.push(new Paragraph({
            children: [new TextRun({ text: $el.text().trim(), bold: true, size: 48, font: 'Calibri' })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
            alignment: AlignmentType.CENTER
          }));
          break;

        case 'h2':
          children.push(new Paragraph({
            children: [new TextRun({ text: $el.text().trim(), bold: true, size: 36, font: 'Calibri' })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } }
          }));
          break;

        case 'h3':
          children.push(new Paragraph({
            children: [new TextRun({ text: $el.text().trim(), bold: true, size: 28, font: 'Calibri' })],
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 280, after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333' } }
          }));
          break;

        case 'h4':
          children.push(new Paragraph({
            children: [new TextRun({ text: $el.text().trim(), bold: true, size: 24, font: 'Calibri' })],
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 240, after: 100 }
          }));
          break;

        case 'p': {
          const text = $el.text().trim();
          if (text) {
            const isQuote = className.includes('motto') || className.includes('quote');
            const isPlaceholder = className.includes('image-placeholder');
            const runs = parseInlineContent(element, false, isQuote);

            children.push(new Paragraph({
              children: runs.length > 0 ? runs : [new TextRun({ text, font: 'Calibri', size: 22, italics: isQuote })],
              spacing: { after: 200, line: 276 },
              alignment: AlignmentType.JUSTIFIED,
              indent: (isQuote || isPlaceholder) ? { left: 720 } : undefined,
              border: isQuote ? { left: { style: BorderStyle.SINGLE, size: 24, color: '333333' } } : undefined,
              shading: isPlaceholder ? { fill: 'EEEEEE', type: ShadingType.CLEAR } : undefined
            }));
          }
          break;
        }

        case 'div': {
          const isSpecial = className.includes('motto') || className.includes('quote') || className.includes('image-placeholder');

          if (isSpecial) {
            // For special divs, output the content with special formatting
            const text = $el.text().trim();
            if (text) {
              children.push(new Paragraph({
                children: [new TextRun({ text, italics: true, font: 'Calibri', size: 22 })],
                spacing: { before: 200, after: 200 },
                indent: { left: 720 },
                border: { left: { style: BorderStyle.SINGLE, size: 24, color: '666666' } },
                shading: { fill: 'F5F5F5', type: ShadingType.CLEAR }
              }));
            }
          } else {
            // For all other divs, process children
            $el.children().each((i, child) => processElement(child));
          }
          break;
        }

        case 'section':
        case 'article':
        case 'main':
        case 'header':
        case 'footer':
        case 'nav':
        case 'aside':
          // Container elements - just process children
          $el.children().each((i, child) => processElement(child));
          break;

        case 'ul':
        case 'ol':
          processListItems($el, 0);
          children.push(new Paragraph({ children: [], spacing: { after: 100 } }));
          break;

        case 'blockquote': {
          const text = $el.text().trim();
          if (text) {
            children.push(new Paragraph({
              children: [new TextRun({ text, italics: true, font: 'Calibri', size: 22, color: '555555' })],
              spacing: { before: 200, after: 200 },
              indent: { left: 720 },
              border: { left: { style: BorderStyle.SINGLE, size: 24, color: '333333' } }
            }));
          }
          break;
        }

        case 'table': {
          const table = processTable($el);
          if (table) {
            children.push(table);
            children.push(new Paragraph({ children: [], spacing: { after: 200 } }));
          }
          break;
        }

        case 'br':
          children.push(new Paragraph({ children: [], spacing: { after: 100 } }));
          break;

        case 'hr':
          children.push(new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
            spacing: { before: 200, after: 200 }
          }));
          break;

        case 'pre':
        case 'code': {
          const text = $el.text().trim();
          if (text) {
            children.push(new Paragraph({
              children: [new TextRun({ text, font: 'Courier New', size: 20 })],
              spacing: { after: 200 },
              shading: { fill: 'F5F5F5', type: ShadingType.CLEAR }
            }));
          }
          break;
        }

        case 'html':
        case 'body':
          $el.children().each((i, child) => processElement(child));
          break;

        default:
          // For any other element, check if it has children to process
          // or if it has direct text content
          if ($el.children().length > 0) {
            $el.children().each((i, child) => processElement(child));
          } else {
            const text = $el.text().trim();
            if (text) {
              children.push(new Paragraph({
                children: [new TextRun({ text, font: 'Calibri', size: 22 })],
                spacing: { after: 200 }
              }));
            }
          }
      }
    };

    // Start processing
    const $body = $('body');
    if ($body.length > 0) {
      $body.children().each((i, el) => processElement(el));
    } else {
      $.root().children().each((i, el) => processElement(el));
    }

    // Ensure document is not empty
    if (children.length === 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Document is empty', font: 'Calibri', size: 22 })]
      }));
    }

    // Create the document
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children: children
      }]
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (error) {
    console.error('HTML to DOCX conversion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to convert HTML to DOCX',
      message: error.message
    });
  }
});

/**
 * GET /api/conversion/formats - Get supported conversion formats
 */
router.get('/formats', async (req, res) => {
  try {
    const formats = {
      image: {
        input: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp', 'svg', 'ico'],
        output: ['jpg', 'png', 'gif', 'bmp', 'tiff', 'webp', 'svg', 'ico'],
        settings: {
          quality: { min: 1, max: 100, default: 85 },
          resolution: { options: ['original', '4k', '2k', '1080p', '720p', '480p'], default: 'original' }
        }
      },
      video: {
        input: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpeg'],
        output: ['mp4', 'avi', 'mov', 'mkv', 'webm'],
        settings: {
          quality: { min: 1, max: 100, default: 75 },
          resolution: { options: ['original', '4k', '2k', '1080p', '720p', '480p'], default: 'original' }
        }
      },
      audio: {
        input: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'opus'],
        output: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus'],
        settings: {
          quality: { min: 1, max: 100, default: 70 }
        }
      },
      document: {
        input: ['pdf', 'docx', 'txt', 'html', 'md'],
        output: ['pdf', 'docx', 'txt', 'html', 'md'],
        settings: {}
      }
    };

    res.json({
      success: true,
      data: formats
    });

  } catch (error) {
    console.error('Get supported formats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get supported formats',
      message: error.message
    });
  }
});

export default router;
