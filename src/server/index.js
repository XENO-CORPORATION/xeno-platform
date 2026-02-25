import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import http from 'http';

// Determine the directory name for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly configure dotenv to load the .env file from the project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import OpenAI, { toFile } from 'openai';
import util from 'util';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { createProxyMiddleware } from 'http-proxy-middleware';
import FormData from 'form-data';
import pg from 'pg';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { WebSocketServer as WebSocket } from 'ws';
import chokidar from 'chokidar';
import zlib from 'zlib';
import tar from 'tar-stream';
import { promisify } from 'util';
const gzipAsync = promisify(zlib.gzip);

// Import custom routes
import { integrateContainerProvisioning } from './containerIntegration.js';
import fileSystemRoutes from './routes/fileSystemRoutes.js';
import authRoutes from './routes/authRoutes.js';
import conversionRoutes from './routes/conversionRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import imageRoutes, { imagePublicRoutes } from './routes/imageRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import tokenizerRoutes from './routes/tokenizerRoutes.js';
import userDataRoutes from './routes/userDataRoutes.js';
import browserRoutes from './routes/browserRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import youtubeRoutes, { youtubePublicRoutes } from './routes/youtubeRoutes.js';
import collaborationRoutes from './routes/collaborationRoutes.js';
import officeCanvasRoutes from './routes/officeCanvasRoutes.js';
import downloadRoutes from './routes/downloadRoutes.js';
import xenoRoutes from './routes/xenoRoutes.js';
import { databaseMiddleware } from './middleware/database.js';
import { authMiddleware } from './middleware/auth.js';
import { initCleanupService } from './services/cleanupService.js';
import { runMigrations } from './services/migrationService.js';

// PostgreSQL connection
const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'xenostudio',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'xenostudio_password',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = uuidv4();
    cb(null, `${uniquePrefix}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Create Express app with increased limits for image processing
const app = express();
const PORT = process.env.BACKEND_PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';

// CRITICAL FIX: Increase server limits for large image data
// This prevents 431 "Request Header Fields Too Large" errors when processing images
app.use((req, res, next) => {
  // Set timeout for large image processing requests
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000); // 5 minutes
  next();
});

// Middleware with enhanced limits for image processing
app.use(cors({
  maxAge: 86400, // 24 hours
  credentials: true
}));

// Cookie parser for tracking proxy context
app.use(cookieParser());

// IMPORTANT: Mount browser proxy routes BEFORE JSON body parser
// This allows browser proxy to handle raw POST bodies from proxied pages
// The browserRoutes handles its own body parsing
app.use('/api/browser', express.raw({ type: '*/*', limit: '10mb' }), browserRoutes);
console.log('🌐 Browser routes integrated: /api/browser/* (mounted early for raw body handling)');

// ULTRA HIGH LIMITS for base64 image data processing
app.use(express.json({ 
  limit: '100mb',
  parameterLimit: 50000,
  type: ['application/json', 'text/plain']
}));

app.use(express.urlencoded({ 
  limit: '100mb', 
  extended: true,
  parameterLimit: 50000
}));

// Increase raw body limit for any other body parsers
app.use(express.raw({ limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));

app.use('/uploads', express.static(uploadsDir));

// FAL.ai Proxy Middleware - Add this before other routes
const falProxy = createProxyMiddleware({
  target: 'https://queue.fal.run',
  changeOrigin: true,
  secure: true,
  timeout: 30000, // 30 second timeout
  proxyTimeout: 30000,
  ws: false, // Disable websocket proxying
  followRedirects: true,
  pathRewrite: function(path, req) {
    console.log(`FAL.ai Original path: ${path}`);
    // Remove /api/fal from the beginning of the path
    const rewrittenPath = path.replace(/^\/api\/fal/, '');
    console.log(`FAL.ai Rewritten path: ${rewrittenPath}`);
    return rewrittenPath;
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying FAL.ai request: ${req.method} ${proxyReq.protocol}//${proxyReq.host}${proxyReq.path}`);
    console.log('FAL.ai request headers:', Object.keys(req.headers));
    
    // Set additional headers for better connection handling
    proxyReq.setHeader('Connection', 'keep-alive');
    proxyReq.setHeader('Keep-Alive', 'timeout=30, max=100');
    
    // Log if Authorization header is present (but not the full value for security)
    if (req.headers.authorization) {
      console.log('Authorization header present:', req.headers.authorization.substring(0, 20) + '...');
    } else {
      console.log('WARNING: No Authorization header found in request!');
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Add CORS headers to the proxied response
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    console.log(`FAL.ai response: ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
  },
  onError: (err, req, res) => {
    console.error('FAL.ai Proxy error:', err);
    res.status(500).json({
      error: 'FAL.ai Proxy Error',
      message: err.message
    });
  },
  logLevel: 'debug'
});

// Apply FAL.ai proxy middleware
app.use('/api/fal', falProxy);

// Note: SAM 2 segmentation is now handled via FAL.ai integration in the chat generation route

// Direct FAL.ai API endpoint as fallback - handle all HTTP methods
app.all('/api/fal-direct/*', async (req, res) => {
  try {
    const falPath = req.path.replace('/api/fal-direct', '');
    const falUrl = `https://queue.fal.run${falPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    
    console.log(`Direct FAL.ai request: ${req.method} ${falUrl}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
    
    // Get API key from environment
    const apiKey = process.env.VITE_FAL_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: 'FAL API key not configured' });
    }
    
    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Key ${apiKey}`,
        'User-Agent': 'XenoStudio/1.0'
      }
    };
    
    // Only add Content-Type and body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      if (req.body && Object.keys(req.body).length > 0) {
        fetchOptions.body = JSON.stringify(req.body);
      }
    }
    
    const response = await fetch(falUrl, fetchOptions);
    
    const result = await response.text();
    console.log(`Direct FAL.ai response: ${response.status} ${response.statusText}`);
    
    // Only log response body for non-success or if it's short
    if (!response.ok || result.length < 500) {
      console.log('Response body:', result);
    } else {
      console.log('Response body length:', result.length, 'characters');
    }
    
    // Set appropriate response headers
    res.status(response.status);
    if (response.headers.get('content-type')?.includes('application/json')) {
      res.json(JSON.parse(result));
    } else {
      res.send(result);
    }
    
  } catch (error) {
    console.error('Direct FAL.ai API error:', error);
    res.status(500).json({
      error: 'Direct FAL.ai API Error',
      message: error.message
    });
  }
});

// Add OpenRouter Key retrieval & Log Check
const openRouterApiKey = process.env.OPENROUTER_API_KEY;
console.log('Checking OPENROUTER_API_KEY: Starts with ->', openRouterApiKey?.substring(0, 5) || 'Not Found!'); // Log first 5 chars or 'Not Found!'
if (!openRouterApiKey) {
    console.warn('OpenRouter API key (OPENROUTER_API_KEY) not found in .env. API calls will fail.');
}
// Optional: Add Referer/Title from .env if needed
const siteUrl = process.env.YOUR_SITE_URL || ''; // Optional
const siteTitle = process.env.YOUR_SITE_NAME || ''; // Optional

// Utility function to parse AI response text (FOR HISTORY CLEANING - Make Regex more robust)
const parseResponseBackend = (fullText) => {
    // More flexible regexes for cleaning history - allow optional colon, flexible markdown
    const thinkingRegex = /^\s*(?:#{1,6}[\s]*)?\**?Thinking Process[:]?\**?\s*/im;
    const answerRegex = /^\s*(?:#{1,6}[\s]*)?\**?Final Answer[:]?\**?\s*/im;

    const trimmedText = fullText.trim();
    // Find markers using search
    const thinkingMatchIndex = trimmedText.search(thinkingRegex);
    const answerMatchIndex = trimmedText.search(answerRegex);

    let finalAnswerContent = trimmedText; // Default to original text

    // Prioritize finding the Final Answer marker for history cleaning
    if (answerMatchIndex !== -1) {
        // Found "Final Answer:" marker
        const answerMarkerMatch = trimmedText.substring(answerMatchIndex).match(answerRegex);
        const answerStartIndex = answerMatchIndex + (answerMarkerMatch ? answerMarkerMatch[0].length : 0);
        finalAnswerContent = trimmedText.substring(answerStartIndex).trim();
        console.log(` -> [HistoryClean] Found 'Final Answer:', extracting content.`);
    } else if (thinkingMatchIndex !== -1) {
        // Found "Thinking Process:" but NO "Final Answer:"
        // Discard this content for history purposes.
        finalAnswerContent = "";
        console.warn(` -> [HistoryClean] Found 'Thinking Process:' but no 'Final Answer:', stripping content.`);
    } else {
        // Neither marker found, keep the original text
        // console.log(` -> [HistoryClean] No markers found, keeping original text.`);
        finalAnswerContent = trimmedText;
    }

    // Clean excessive newlines and leading/trailing markdown emphasis from the determined answer
    // const clean = (text) => text ? text.replace(/\n{3,}/g, '\n\n').replace(/^\s*([*_]{1,2})\s*|\s*([*_]{1,2})\s*$/g, '').trim() : '';
    
    // For history cleaning, we ONLY care about the cleaned final answer.
    return { answer: cleanTextContent(finalAnswerContent) }; 
};

// Utility function to clean text content (collapse newlines, remove leading/trailing markdown emphasis)
// const cleanTextContentHelper = (text) => text ? text.replace(/\n{3,}/g, '\n\n').replace(/^\s*([*_]{1,2})\s*|\s*([*_]{1,2})\s*$/g, '').trim() : '';

// NEW Consolidated utility function to clean text content
const cleanTextContent = (text) => {
    if (!text) return '';
    // 1. Normalize newlines (reduce 3+ newlines to 2)
    let cleaned = text.replace(/\n{3,}/g, '\n\n');
    // 2. Remove leading/trailing markdown emphasis (asterisks, underscores) from the whole string
    cleaned = cleaned.replace(/^\s*([*_]{1,2})\s*|\s*([*_]{1,2})\s*$/g, '');
    // 3. Final trim
    return cleaned.trim();
};

// Integrate custom routes
console.log('🔧 Integrating custom routes...');

// Authentication routes with database middleware
app.use('/api/auth', databaseMiddleware, authRoutes);
console.log('🔐 Authentication routes integrated: /api/auth/*');

// Container provisioning routes
integrateContainerProvisioning(app);

// File system routes with database middleware
app.use('/api/filesystem', (req, res, next) => {
  req.db = pool;
  next();
}, fileSystemRoutes);

// Conversion routes
app.use('/api/conversion', conversionRoutes);

// Video Studio routes (with auth and database middleware)
app.use('/api/video', databaseMiddleware, authMiddleware, videoRoutes);
console.log('🎬 Video Studio routes integrated: /api/video/*');

// Replicate API Proxy routes (NO auth required - uses server-side API token)
// Must be defined BEFORE the authenticated image routes
app.post('/api/image/replicate/predictions', async (req, res) => {
  try {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ success: false, error: 'Replicate API token is not configured on the server' });
    }
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${REPLICATE_API_TOKEN}` },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('❌ Replicate API error:', data);
      return res.status(response.status).json(data);
    }
    console.log(`🎨 Created Replicate prediction: ${data.id}`);
    res.json(data);
  } catch (error) {
    console.error('❌ Replicate proxy error:', error);
    res.status(500).json({ success: false, error: 'Failed to create prediction' });
  }
});

app.get('/api/image/replicate/predictions/:predictionId', async (req, res) => {
  try {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    const { predictionId } = req.params;
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ success: false, error: 'Replicate API token is not configured on the server' });
    }
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      method: 'GET',
      headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (error) {
    console.error('❌ Replicate proxy error:', error);
    res.status(500).json({ success: false, error: 'Failed to get prediction status' });
  }
});

app.post('/api/image/replicate/predictions/:predictionId/cancel', async (req, res) => {
  try {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    const { predictionId } = req.params;
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ success: false, error: 'Replicate API token is not configured on the server' });
    }
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    console.log(`🛑 Cancelled Replicate prediction: ${predictionId}`);
    res.json(data);
  } catch (error) {
    console.error('❌ Replicate proxy error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel prediction' });
  }
});
console.log('🔄 Replicate API proxy available at: /api/image/replicate/*');

// Xeno AI proxy routes (credit-tracked generation)
app.use('/api/xeno', databaseMiddleware, authMiddleware, xenoRoutes);
console.log('🎯 Xeno AI proxy routes integrated: /api/xeno/*');

// Image Studio public routes (no auth required for xeno-flow)
app.use('/api/image', databaseMiddleware, imagePublicRoutes);
console.log('🎨 Image Studio public routes integrated: /api/image/xeno-flow/*');

// Image Studio routes (with auth and database middleware)
app.use('/api/image', databaseMiddleware, authMiddleware, imageRoutes);
console.log('🎨 Image Studio routes integrated: /api/image/*');

// Chat routes - init and generate endpoints don't require auth, others do
// Create a conditional auth middleware that skips auth for public paths
const chatAuthMiddleware = (req, res, next) => {
  console.log('[ChatAuth] Path:', req.path, 'Original URL:', req.originalUrl);
  // Skip auth for public endpoints
  const publicPaths = ['/init', '/generate'];
  if (publicPaths.some(path => req.path === path || req.path.startsWith(path))) {
    console.log('[ChatAuth] Skipping auth for public path:', req.path);
    return next();
  }
  // Apply auth middleware for all other chat routes
  console.log('[ChatAuth] Applying auth for path:', req.path);
  return authMiddleware(req, res, next);
};
app.use('/api/chat', databaseMiddleware, chatAuthMiddleware, chatRoutes);
console.log('💬 Chat routes integrated: /api/chat/*');

// Tokenizer routes - no auth required (public utility)
app.use('/api/tokenize', tokenizerRoutes);
console.log('🔢 Tokenizer routes integrated: /api/tokenize/*');

// User data routes - settings, files, usage tracking (requires auth)
app.use('/api/user-data', databaseMiddleware, authMiddleware, userDataRoutes);
console.log('👤 User data routes integrated: /api/user-data/*');

// Browser routes are mounted early in the middleware chain (before JSON body parser)
// to handle raw POST bodies from proxied pages. See line ~105.

// AI Routes (for chat completion with multiple providers)
app.use('/api/ai', aiRoutes);

// YouTube Routes (channel management and analytics)
// Public routes first (OAuth callback - no auth needed, Google redirects here)
app.use('/api/youtube', databaseMiddleware, youtubePublicRoutes);
// Authenticated routes
app.use('/api/youtube', databaseMiddleware, authMiddleware, youtubeRoutes);
console.log('📺 YouTube routes integrated: /api/youtube/*');

// Collaboration API routes (Figma-style real-time collaboration)
app.use('/api/collaboration', databaseMiddleware, collaborationRoutes);
console.log('🤝 Collaboration routes integrated: /api/collaboration/*');

// Office Canvas routes (multi-canvas + sharing)
app.use('/api/office-canvas', databaseMiddleware, officeCanvasRoutes);
console.log('🖼️ Office Canvas routes integrated: /api/office-canvas/*');

// Download API routes (YouTube, Twitter, Instagram, TikTok downloads)
app.use('/api/download', downloadRoutes);
console.log('⬇️ Download routes integrated: /api/download/*');

console.log('✅ Custom routes integrated successfully');

// Routes
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// OpenRouter Models API - Fetch available models grouped by company
// Cache for models (refresh every 30 minutes)
let modelsCache = null;
let modelsCacheTimestamp = 0;
const MODELS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Companies to include and their prefixes
const COMPANY_PREFIXES = {
  'OpenAI': 'openai/',
  'Anthropic': 'anthropic/',
  'Google': 'google/',
  'Meta': 'meta-llama/',
  'Mistral': 'mistralai/',
  'DeepSeek': 'deepseek/',
  'Alibaba': 'qwen/',
  'xAI': 'x-ai/',
};

app.get('/api/models', async (req, res) => {
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (modelsCache && (now - modelsCacheTimestamp) < MODELS_CACHE_DURATION) {
      console.log('📦 Returning cached models data');
      return res.json(modelsCache);
    }

    console.log('🔄 Fetching fresh models from OpenRouter...');

    // Fetch models from OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'HTTP-Referer': siteUrl || 'https://xeno-studio.com',
        'X-Title': siteTitle || 'Xeno Studio'
      }
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const allModels = data.data || [];

    console.log(`📊 Received ${allModels.length} total models from OpenRouter`);

    // Group models by company and get latest 4 from each
    const groupedModels = {};

    for (const [companyName, prefix] of Object.entries(COMPANY_PREFIXES)) {
      // Filter models for this company - only LLMs (text output), exclude image generation models
      const companyModels = allModels.filter(model => {
        // Must start with company prefix
        if (!model.id.startsWith(prefix)) return false;

        // Exclude variant models
        if (model.id.includes(':free') ||
            model.id.includes(':extended') ||
            model.id.includes(':thinking') ||
            model.id.includes(':nitro') ||
            model.id.includes(':floor') ||
            model.id.includes(':online')) return false;

        // Must be a language model - output must include text, exclude image-only generators
        const outputModalities = model.architecture?.output_modalities || [];
        const inputModalities = model.architecture?.input_modalities || [];

        // Exclude if output includes 'image' (image generation models)
        if (outputModalities.includes('image')) return false;

        // Must output text
        if (!outputModalities.includes('text')) return false;

        // Exclude guard/safety models
        if (model.id.includes('guard') || model.id.includes('safety')) return false;

        return true;
      });

      // Sort by created date (newest first)
      companyModels.sort((a, b) => (b.created || 0) - (a.created || 0));

      // Take the latest 4 models
      const latestModels = companyModels.slice(0, 4).map(model => {
        const id = model.id.toLowerCase();
        const inputMods = model.architecture?.input_modalities || ['text'];
        const outputMods = model.architecture?.output_modalities || ['text'];

        // Detect reasoning capability dynamically
        let supportsReasoning = 'disabled';
        // Always-on reasoning models
        if (id.includes('deepseek') && (id.includes('r1') || id.includes('v3'))) {
          supportsReasoning = 'alwaysOn';
        } else if (id.includes('openai/o1') || id.includes('openai/o3') || id.includes('openai/o4')) {
          supportsReasoning = 'alwaysOn';
        } else if (id.includes('qwen') && id.includes('thinking')) {
          supportsReasoning = 'alwaysOn';
        } else if (id.includes(':thinking')) {
          supportsReasoning = 'alwaysOn';
        }
        // Toggleable reasoning models
        else if (id.includes('gemini-2.5') || id.includes('gemini-3')) {
          supportsReasoning = 'toggleable';
        } else if (id.includes('grok-3') || id.includes('grok-4')) {
          supportsReasoning = 'toggleable';
        } else if (id.includes('claude-sonnet-4') || id.includes('claude-opus-4') || id.includes('claude-haiku-4')) {
          supportsReasoning = 'toggleable';
        } else if (id.includes('claude-3.7-sonnet')) {
          supportsReasoning = 'toggleable';
        } else if (id.includes('deepseek/')) {
          supportsReasoning = 'toggleable'; // Other deepseek models
        } else if (id.includes('qwen/')) {
          supportsReasoning = 'toggleable'; // Other qwen models
        }

        // Detect vision/file upload capability from input modalities
        const supportsVision = inputMods.includes('image');
        const supportsFileUpload = inputMods.includes('file') || inputMods.includes('image');

        return {
          id: model.id,
          name: model.name.replace(/^[^:]+:\s*/, ''), // Remove company prefix from display name
          maxTokens: model.context_length || 128000,
          created: model.created,
          description: model.description,
          pricing: model.pricing,
          inputModalities: inputMods,
          outputModalities: outputMods,
          supportsReasoning,
          supportsVision,
          supportsFileUpload,
        };
      });

      if (latestModels.length > 0) {
        groupedModels[companyName] = latestModels;
      }
    }

    // Build response
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      totalCompanies: Object.keys(groupedModels).length,
      companies: groupedModels
    };

    // Cache the result
    modelsCache = result;
    modelsCacheTimestamp = now;

    console.log(`✅ Models cached: ${Object.keys(groupedModels).length} companies`);

    res.json(result);

  } catch (error) {
    console.error('❌ Error fetching models:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch models',
      message: error.message
    });
  }
});

// Test database connection
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({
      success: true,
      message: 'Database connection successful',
      time: result.rows[0].current_time
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      success: false,
      error: 'Database connection failed',
      details: error.message
    });
  }
});

// Authentication Routes
app.post('/api/auth/init', async (req, res) => {
  try {
    // Check database connection and return auth system status
    const dbTest = await pool.query('SELECT 1');
    res.json({
      success: true,
      message: 'Auth system initialized',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Auth init error:', error);
    res.status(500).json({
      success: false,
      error: 'Auth system initialization failed',
      details: error.message
    });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    console.log('Registration request:', req.body);
    // Write to log file
    fs.appendFileSync('/tmp/auth.log', `Registration request: ${JSON.stringify(req.body)}\n`);
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password || !display_name) {
      console.log('Missing required fields');
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    // Hash password
    const passwordHash = createHash('sha256').update(password).digest('hex');

    // Check if user already exists
    console.log('Checking for existing user:', email, username);
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    console.log('Existing user query result:', existingUser.rows);

    if (existingUser.rows && existingUser.rows.length > 0) {
      console.log('User already exists');
      return res.status(400).json({
        success: false,
        error: 'User already exists with this email or username'
      });
    }

    // Create new user
    const userId = uuidv4();
    console.log('Creating user with ID:', userId);
    await pool.query(
      'INSERT INTO users (id, username, email, password_hash, display_name, email_verified, is_active, credits) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [userId, username, email, passwordHash, display_name, true, true, 2000]
    );
    console.log('User created successfully');

    // Create session token
    const sessionToken = randomBytes(32).toString('hex');
    console.log('Creating session token');

    // Store session
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await pool.query(
      'INSERT INTO user_sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)',
      [userId, sessionToken, expiresAt.toISOString()]
    );
    console.log('Session created successfully');

    res.json({
      success: true,
      user: {
        id: userId,
        username,
        email,
        display_name,
        email_verified: true,
        is_active: true,
        credits: 2000,
        bonus_credits_claimed: false,
        created_at: new Date().toISOString()
      },
      token: sessionToken
    });

  } catch (error) {
    console.error('Registration error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    // Write to log file
    fs.appendFileSync('/tmp/auth.log', `Registration error: ${error.message}\nStack: ${error.stack}\n`);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Hash password for comparison
    const passwordHash = createHash('sha256').update(password).digest('hex');

    // Find user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check password
    if (user.password_hash !== passwordHash) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Create session token
    const sessionToken = randomBytes(32).toString('hex');

    // Store session
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await pool.query(
      'INSERT INTO user_sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)',
      [user.id, sessionToken, expiresAt.toISOString()]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        email_verified: user.email_verified,
        is_active: user.is_active,
        credits: user.credits,
        bonus_credits_claimed: user.bonus_credits_claimed,
        created_at: user.created_at
      },
      token: sessionToken
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

app.get('/api/auth/validate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    // Validate session
    const sessionResult = await pool.query(
      'SELECT u.* FROM users u JOIN user_sessions s ON u.id = s.user_id WHERE s.session_token = $1 AND s.expires_at > $2',
      [token, new Date().toISOString()]
    );
    const session = sessionResult.rows[0];

    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    res.json({ success: true, user: session });

  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ success: false, error: 'Validation failed' });
  }
});


// File upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const filePath = req.file.path;
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${path.basename(filePath)}`;
  
  res.json({ 
    success: true, 
    message: 'File uploaded successfully',
    file: {
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      url: fileUrl
    }
  });
});

// Define a list of models that use the standard chat completions endpoint
const chatCompletionModels = [
    "gpt-4o", 
    "gpt-4o-2024-11-20", 
    "o3-2025-04-16", 
    "o4-mini-2025-04-16"
    // Add other standard OpenAI chat models here if needed
];

// Enhanced error handling for large image requests
app.use('/api/chat/generate', (err, req, res, next) => {
  if (err) {
    if (err.type === 'entity.too.large' || err.status === 413) {
      return res.status(413).json({
        error: 'Request Too Large',
        message: 'The image data is too large. Please use a smaller image or reduce the resolution.',
        code: 'IMAGE_TOO_LARGE'
      });
    }
    if (err.status === 431) {
      return res.status(431).json({
        error: 'Request Header Fields Too Large',
        message: 'The request headers are too large. This issue has been addressed - please restart the server and try again.',
        code: 'HEADERS_TOO_LARGE'
      });
    }
    return res.status(500).json({
      error: 'Server Error',
      message: err.message || 'An unexpected error occurred',
      code: 'INTERNAL_ERROR'
    });
  }
  next();
});

// --- Chat Generation Route (Refactored for OpenRouter) ---
app.post('/api/chat/generate', async (req, res) => {
    // --- LOG REQUEST INFO FOR DEBUGGING (with size monitoring) ---
    const requestSize = JSON.stringify(req.body).length;
    console.log('>>> REQUEST INFO:', {
        timestamp: new Date().toISOString(),
        task: req.body.task,
        requestSizeMB: (requestSize / (1024 * 1024)).toFixed(2),
        hasImageData: !!req.body.imageData,
        imageDataSizeMB: req.body.imageData ? (req.body.imageData.length / (1024 * 1024)).toFixed(2) : 'N/A'
    });
    
    // Only log full body for small requests to avoid overwhelming logs
    if (requestSize < 10000) { // Less than 10KB
        console.log('>>> SMALL REQUEST BODY:', JSON.stringify(req.body, null, 2));
    } else {
        console.log('>>> LARGE REQUEST DETECTED - Body logging skipped for performance');
    }
    if (req.body.task === 'image') {
        console.log('Handling conversational image generation task with Responses API');
        try {
            const { messages, previousResponseId, previousImageGenerationCallId, imageContexts } = req.body;

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({ error: 'Invalid request: messages array is required for image generation.' });
            }

            // Extract prompt from the last user message
            let imagePrompt = '';
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();

            if (lastUserMessage) {
                if (typeof lastUserMessage.content === 'string') {
                    imagePrompt = lastUserMessage.content;
                } else if (Array.isArray(lastUserMessage.content)) {
                    const textPart = lastUserMessage.content.find(p => p.type === 'text');
                    if (textPart && typeof textPart.text === 'string') {
                        imagePrompt = textPart.text;
                    }
                }
            }

            if (!imagePrompt) {
                // Fallback: check original messages structure from frontend if specific parsing above fails
                const firstMessage = req.body.messages[0];
                if (firstMessage && firstMessage.role === 'user' && Array.isArray(firstMessage.parts) && firstMessage.parts[0] && firstMessage.parts[0].type === 'text') {
                    imagePrompt = firstMessage.parts[0].text;
                }
            }
            
            if (!imagePrompt) {
                 console.error('Could not extract a valid prompt from messages:', messages);
                 return res.status(400).json({ error: 'Image prompt could not be extracted from messages.' });
            }

            console.log(`Extracted image prompt (truncated): "${imagePrompt.substring(0, 50)}${imagePrompt.length > 50 ? '... [image prompt truncated for logging]' : ''}"`);

            const openaiApiKey = process.env.OPENAI_API_KEY;
            if (!openaiApiKey) {
                console.error('OPENAI_API_KEY is missing or empty in .env file for image generation.');
                return res.status(500).json({ error: 'Server configuration error: OpenAI API key is not configured.' });
            }

            const openai = new OpenAI({ apiKey: openaiApiKey });

            // Prepare the request for Responses API
            let requestPayload = {
                model: "gpt-4.1-mini", // Use gpt-4.1-mini for Responses API
                tools: [{ type: "image_generation" }]
            };

            // Check if this is a multi-context combination request
            const { combinationImages } = req.body;
            const hasCombinationImages = combinationImages && Array.isArray(combinationImages) && combinationImages.length > 0;
            
            if (hasCombinationImages) {
                console.log('🎨 Processing combination request with', combinationImages.length, 'images');
                console.log('🎨 Combination images:', combinationImages.map(img => ({
                    contextId: img.contextId,
                    description: img.description,
                    isLatestVersion: img.isLatestVersion
                })));
                
                // For combinations, we use direct image inputs with the LATEST versions
                const inputArray = [
                    {
                        role: "user",
                        content: [{ type: "input_text", text: imagePrompt }]
                    }
                ];
                
                // CRITICAL FIX: OpenAI Responses API doesn't support direct 'image' type
                // For combinations with edited images, we need to use the image editing endpoint instead
                const hasEditedImages = combinationImages.some(img => img.isLatestVersion && img.imageData);
                
                if (hasEditedImages) {
                    console.log('🎨 Combination includes edited images, switching to image editing approach');
                    
                    // For combinations with edited images, we'll use a different strategy:
                    // 1. Find the primary image (usually the background/scene)
                    // 2. Use image editing to add the other elements to it
                    
                    // Sort by context ID to get consistent primary image (A comes before B)
                    const sortedImages = [...combinationImages].sort((a, b) => a.contextId.localeCompare(b.contextId));
                    const primaryImage = sortedImages[0];
                    const secondaryImages = sortedImages.slice(1);
                    
                    if (primaryImage.imageData) {
                        console.log(`🎨 Using ${primaryImage.contextId} (${primaryImage.description}) as primary image`);
                        console.log(`🎨 Adding ${secondaryImages.length} secondary images to it`);
                        
                        // Create a detailed prompt that describes the combination
                        const combinationPrompt = `${imagePrompt}. Primary scene: ${primaryImage.description}. Add to this scene: ${secondaryImages.map(img => img.description).join(', ')}.`;
                        
                        // Use the image editing endpoint with the primary image
                        console.log('🎨 Switching to image editing for combination...');
                        
                        // Extract base64 data from primary image
                        let primaryImageData = primaryImage.imageData;
                        if (primaryImageData.startsWith('data:image/')) {
                            const base64Match = primaryImageData.match(/data:image\/[^;]+;base64,(.+)/);
                            if (base64Match && base64Match[1]) {
                                primaryImageData = base64Match[1];
                            }
                        }
                        
                        // Call image editing endpoint with proper MIME type
                        const { toFile } = await import('openai/uploads');
                        
                        const editResponse = await openai.images.edit({
                            image: await toFile(Buffer.from(primaryImageData, 'base64'), 'image.png', { type: 'image/png' }),
                            prompt: combinationPrompt,
                            n: 1,
                            size: "1024x1024",
                            response_format: "b64_json"
                        });
                        
                        if (editResponse.data && editResponse.data[0] && editResponse.data[0].b64_json) {
                            console.log('🎨 Image combination via editing successful');
                            return res.json({
                                imageData: editResponse.data[0].b64_json,
                                modelIdUsed: "gpt-image-1-edit",
                                responseId: `combination_${Date.now()}`,
                                imageGenerationCallId: `combination_${Date.now()}`
                            });
                        } else {
                            throw new Error('Image editing for combination failed to return data');
                        }
                    }
                } else {
                    // All images are original (have generation call IDs), use normal approach
                    combinationImages.forEach(combImg => {
                        if (combImg.imageGenerationCallId && !combImg.imageGenerationCallId.startsWith('edited_img_')) {
                            inputArray.push({
                                type: "image_generation_call",
                                id: combImg.imageGenerationCallId
                            });
                            console.log(`🎨 Added original context: ${combImg.contextId} - ${combImg.description}`);
                        }
                    });
                }
                
                requestPayload.input = inputArray;
                console.log('🎨 Combination input structure with', inputArray.length - 1, 'images');
                
                // DO NOT use previous_response_id for combinations to avoid duplicates
                
            } else if (previousResponseId) {
                console.log('🔄 Using previous_response_id for follow-up image generation:', previousResponseId);
                requestPayload.previous_response_id = previousResponseId;
                requestPayload.input = imagePrompt;
            } else if (previousImageGenerationCallId) {
                // Check if this is an edited image (temporary ID)
                if (previousImageGenerationCallId.startsWith('edited_img_')) {
                    console.log('🎨 Detected edited image context, switching to image editing approach');
                    
                    // For edited images, we need to get the current image data from the frontend
                    // and use the image editing endpoint instead of conversational generation
                    // This will be handled by a separate task type 'edit_image_from_context'
                    console.log('⚠️ Edited image context detected but image data not provided. This should be handled by edit_image task.');
                    return res.status(400).json({ 
                        error: 'Edited image context requires image data. Please use edit_image task instead.',
                        requiresImageData: true,
                        contextType: 'edited_image'
                    });
                } else {
                    console.log('🔄 Using previous image generation call ID for context:', previousImageGenerationCallId);
                    requestPayload.input = [
                        {
                            role: "user",
                            content: [{ type: "input_text", text: imagePrompt }]
                        },
                        {
                            type: "image_generation_call",
                            id: previousImageGenerationCallId
                        }
                    ];
                }
            } else {
                console.log('🆕 Creating new image generation conversation');
                requestPayload.input = imagePrompt;
            }

            console.log('Calling OpenAI Responses API for conversational image generation...');
            const response = await openai.responses.create(requestPayload);

            // Extract image generation results
            const imageGenerationCalls = response.output.filter(
                (output) => output.type === "image_generation_call"
            );

            if (imageGenerationCalls.length === 0) {
                console.error('No image generation calls found in response:', response);
                return res.status(500).json({ error: 'Image generation failed: No image data returned.' });
            }

            const imageCall = imageGenerationCalls[0];
            const imageBase64 = imageCall.result;

            if (!imageBase64) {
                console.error('Image generation failed, no result data in response:', imageCall);
                return res.status(500).json({ error: 'Image generation failed to return image data.' });
            }

            // Process the imageBase64 to handle malformed nested data URIs from GPT Image 1
            let processedImageData = imageBase64;
            
            // Check for malformed nested data URI pattern
            if (imageBase64.includes('data:image/svg+xml;base64,data:image/png;base64,')) {
                console.warn('⚠️ Detected malformed nested data URI from GPT Image 1, extracting PNG data...');
                console.log('🔍 Raw data preview:', imageBase64.substring(0, 200));
                
                // Extract the PNG data from the nested structure
                const pngMatch = imageBase64.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
                if (pngMatch && pngMatch[1]) {
                    const pngBase64 = pngMatch[1].split('data:')[0]; // Remove any trailing nested data
                    console.log('✅ Successfully extracted PNG data, length:', pngBase64.length);
                    processedImageData = pngBase64; // Return just the base64 string
                } else {
                    console.warn('❌ Could not extract PNG data from nested structure, returning original');
                }
            } else if (imageBase64.startsWith('data:')) {
                // If it's already a data URI, extract just the base64 part
                const base64Match = imageBase64.match(/data:image\/[^;]+;base64,(.+)/);
                if (base64Match && base64Match[1]) {
                    processedImageData = base64Match[1];
                    console.log('✅ Extracted base64 from data URI');
                }
            }

            console.log('Conversational image generation successful, returning processed base64 data (first 50 chars):', processedImageData.substring(0, 50) + '...');
            
            return res.json({
                imageData: processedImageData,
                modelIdUsed: "gpt-image-1",
                responseId: response.id, // Return response ID for follow-up requests
                imageGenerationCallId: imageCall.id // Return image generation call ID for context
            });

        } catch (error) {
            console.error('Error in conversational image generation task:', error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during image generation.';
            return res.status(500).json({ error: `Failed to generate image: ${message}` });
        }
    }
    // <<< END: Image Generation Task Handling >>>

    // <<< ADDED: Prompt Refinement Task Handling >>>
    else if (req.body.task === 'refine_image_prompt') {
        console.log('Handling prompt refinement task for model:', req.body.selectedModelId);
        try {
            const { messages, systemPrompt, selectedModelId } = req.body;

            if (!messages || !Array.isArray(messages) || messages.length === 0 || !selectedModelId) {
                return res.status(400).json({ error: 'Invalid request: messages array and selectedModelId are required for prompt refinement.' });
            }
            if (!openRouterApiKey) {
                return res.status(500).json({ error: 'Server configuration error: OpenRouter API key not configured.' });
            }

            // 1. Construct a new system prompt or append to the existing one to guide the LLM.
            const refinementInstruction = "Based on the last user message in the following conversation, generate a concise and descriptive image prompt. The image prompt should be suitable for an AI image generation model like DALL-E. Output ONLY the refined image prompt itself, with no other text, titles, or conversational filler. For example, if the user says 'draw that cool car we were talking about', and the context was a red Ferrari, you should output something like 'A vibrant red Ferrari sports car on a scenic coastal road at sunset'.";
            
            let finalSystemPromptContent = systemPrompt ? `${systemPrompt}\n\nIMAGE PROMPT REFINEMENT TASK:\n${refinementInstruction}` : `IMAGE PROMPT REFINEMENT TASK:\n${refinementInstruction}`;

            // 2. Format messages (similar to the main chat logic, but the system prompt is key here)
            let apiMessages = [];
            if (finalSystemPromptContent) {
                apiMessages.push({ role: "system", content: finalSystemPromptContent });
            }

            // Add user/assistant messages for context. No need to clean history aggressively here as the LLM needs full context.
            messages.forEach(msg => {
                const role = msg.role === 'model' ? 'assistant' : msg.role;
                let contentParts = [];
                if (msg.parts && Array.isArray(msg.parts)) {
                    msg.parts.forEach(part => {
                        if (part.type === 'text' && part.text && part.text.trim() !== '') {
                            contentParts.push({ type: 'text', text: part.text });
                        } else if (part.type === 'image') {
                            // For prompt refinement, we don't send actual image data or malformed URLs.
                            // Add a textual placeholder indicating an image was present.
                            const imagePlaceholderText = (msg.role === 'user') ? '[Image uploaded by user]' : '[Image generated by AI]';
                            contentParts.push({ type: 'text', text: imagePlaceholderText });
                        }
                        // Other part types (like files) can be omitted or summarized if too verbose for prompt refinement
                    });
                } else if (msg.text && msg.text.trim() !== '') { // Legacy
                    contentParts.push({ type: 'text', text: msg.text });
                }

                if (contentParts.length > 0) {
                    if (contentParts.length === 1 && contentParts[0].type === 'text') {
                        apiMessages.push({ role: role, content: contentParts[0].text });
                    } else {
                        apiMessages.push({ role: role, content: contentParts });
                    }
                }
            });
            
            // Create a deep copy for logging to avoid altering original apiMessages if complex objects are involved.
            const messagesForLoggingRefinement = JSON.parse(JSON.stringify(apiMessages));
            messagesForLoggingRefinement.forEach(logMsg => {
                if (Array.isArray(logMsg.content)) {
                    logMsg.content.forEach(part => {
                        if (part.type === 'image_url' && part.image_url && typeof part.image_url.url === 'string' && part.image_url.url.startsWith('data:')) {
                            part.image_url.url = part.image_url.url.substring(0, 50) + '... [truncated for logging]';
                        }
                    });
                }
            });
            console.log("[Prompt Refinement] Final apiMessages for refinement (images truncated):", JSON.stringify(messagesForLoggingRefinement).substring(0,500));

            const headers = {
                "Authorization": `Bearer ${openRouterApiKey}`,
                "Content-Type": "application/json",
                ...(siteUrl && { "HTTP-Referer": siteUrl }),
                ...(siteTitle && { "X-Title": siteTitle }),
            };
            const bodyPayload = {
                "model": selectedModelId, // Use the chat model selected by the user for refinement
                "messages": apiMessages,
                // "temperature": 0.7, // Optional: adjust temperature for creativity
                // "max_tokens": 150,  // Limit output length for a prompt
            };

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: headers,
                body: JSON.stringify(bodyPayload)
            });

            const responseBody = await response.text();
            if (!response.ok) {
                // ... (error handling as in main chat logic) ...
                let errorData = {}; try { errorData = JSON.parse(responseBody); } catch(e) { /* ignore */ }
                console.error('Error calling OpenRouter for prompt refinement:', response.status, errorData);
                return res.status(response.status || 500).json({ error: `Failed to refine prompt: ${errorData.error?.message || responseBody}` });
            }

            let data = {}; try { data = JSON.parse(responseBody); } catch(e) { /* ... */ }
            const refinedPromptText = (data.choices?.[0]?.message?.content || '').trim();

            if (!refinedPromptText) {
                console.error('Prompt refinement failed, LLM returned empty content:', data);
                return res.status(500).json({ error: 'Prompt refinement failed: LLM returned empty content.' });
            }

            console.log('Prompt refinement successful. Refined Prompt (truncated):', refinedPromptText.substring(0, 50) + (refinedPromptText.length > 50 ? '... [refined prompt truncated for logging]' : ''));
            return res.json({
                refinedPromptText: refinedPromptText,
                modelIdUsed: selectedModelId // The chat model ID that did the refinement
            });

        } catch (error) {
            console.error('Error in prompt refinement task:', error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during prompt refinement.';
            return res.status(500).json({ error: `Failed to refine prompt: ${message}` });
        }
    }
    // <<< END: Prompt Refinement Task Handling >>>

    // <<< ADDED: Image Edit Task Handling >>>
    else if (req.body.task === 'edit_image') {
        console.log('Handling image edit task with OpenAI Image Edits API');
        try {
            const { imageData, prompt, model = 'gpt-image-1', mask, background, outputFormat = 'png', quality = 'auto', size = 'auto' } = req.body;

            if (!imageData || !prompt) {
                return res.status(400).json({ error: 'Invalid request: imageData and prompt are required for image editing.' });
            }

            const openaiApiKey = process.env.OPENAI_API_KEY;
            if (!openaiApiKey) {
                console.error('OPENAI_API_KEY is missing or empty in .env file for image editing.');
                return res.status(500).json({ error: 'Server configuration error: OpenAI API key is not configured.' });
            }

            const openai = new OpenAI({ apiKey: openaiApiKey });

            // Convert base64 image data to buffer for OpenAI API
            let imageBuffer;
            if (imageData.startsWith('data:')) {
                // Extract base64 from data URI
                const base64Data = imageData.split(',')[1];
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
                // Assume it's already base64
                imageBuffer = Buffer.from(imageData, 'base64');
            }

            // Determine the correct file extension from the data URI or default to PNG
            let fileExtension = 'png';
            let mimeType = 'image/png';
            
            if (imageData.startsWith('data:image/jpeg')) {
                fileExtension = 'jpg';
                mimeType = 'image/jpeg';
            } else if (imageData.startsWith('data:image/webp')) {
                fileExtension = 'webp';
                mimeType = 'image/webp';
            } else if (imageData.startsWith('data:image/png')) {
                fileExtension = 'png';
                mimeType = 'image/png';
            }

            console.log('🎨 Detected MIME type:', mimeType);
            console.log('🎨 File extension:', fileExtension);
            console.log('🎨 Data URI prefix:', imageData.substring(0, 30));

            // Create a temporary file for the image with correct extension
            const tempImagePath = path.join(uploadsDir, `temp-edit-${Date.now()}.${fileExtension}`);
            fs.writeFileSync(tempImagePath, imageBuffer);
            
            // Verify the file was created correctly
            const fileStats = fs.statSync(tempImagePath);
            console.log('🎨 Temporary file created:', tempImagePath);
            console.log('🎨 File size:', fileStats.size, 'bytes');

            console.log('🎨 Calling OpenAI Image Edits API...');
            console.log('🎨 Prompt:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
            console.log('🎨 Model:', model);
            console.log('🎨 Output format:', outputFormat);

            // Prepare mask file stream if provided
            let tempMaskPath = null;
            let maskFileStream = null;
            if (mask) {
                let maskBuffer;
                if (mask.startsWith('data:')) {
                    const base64Mask = mask.split(',')[1];
                    maskBuffer = Buffer.from(base64Mask, 'base64');
                } else {
                    maskBuffer = Buffer.from(mask, 'base64');
                }
                
                // Determine mask file extension and MIME type
                let maskExtension = 'png';
                if (mask.startsWith('data:image/jpeg')) {
                    maskExtension = 'jpg';
                } else if (mask.startsWith('data:image/webp')) {
                    maskExtension = 'webp';
                }
                
                tempMaskPath = path.join(uploadsDir, `temp-mask-${Date.now()}.${maskExtension}`);
                fs.writeFileSync(tempMaskPath, maskBuffer);
                maskFileStream = fs.createReadStream(tempMaskPath);
            }

            // Prepare the request parameters based on the OpenAI Node.js library format
            // Use toFile helper to ensure proper MIME type handling
            const requestParams = {
                model: model,
                image: await toFile(fs.createReadStream(tempImagePath), `image.${fileExtension}`, { type: mimeType }),
                prompt: prompt,
                n: 1
            };

            // Add mask if provided
            if (maskFileStream) {
                // Determine mask MIME type
                let maskMimeType = 'image/png';
                if (tempMaskPath.endsWith('.jpg') || tempMaskPath.endsWith('.jpeg')) {
                    maskMimeType = 'image/jpeg';
                } else if (tempMaskPath.endsWith('.webp')) {
                    maskMimeType = 'image/webp';
                }
                
                const maskExtension = tempMaskPath.split('.').pop();
                requestParams.mask = await toFile(maskFileStream, `mask.${maskExtension}`, { type: maskMimeType });
            }

            // Only add response_format for dall-e-2, not gpt-image-1
            if (model === 'dall-e-2') {
                requestParams.response_format = 'b64_json';
            }

            // Add optional parameters for gpt-image-1
            if (model === 'gpt-image-1') {
                if (background) requestParams.background = background;
                if (outputFormat) requestParams.output_format = outputFormat;
                if (quality) requestParams.quality = quality;
                if (size) requestParams.size = size;
            }

            // Make the API call with correct parameters
            const response = await openai.images.edit(requestParams);

            // Clean up temporary files
            fs.unlinkSync(tempImagePath);
            if (tempMaskPath && fs.existsSync(tempMaskPath)) {
                fs.unlinkSync(tempMaskPath);
            }

            if (!response.data || response.data.length === 0) {
                console.error('No image data returned from OpenAI Image Edits API');
                return res.status(500).json({ error: 'Image editing failed: No image data returned.' });
            }

            // Handle different response formats for different models
            let editedImageData;
            if (model === 'gpt-image-1') {
                // gpt-image-1 returns base64 directly in the data field
                editedImageData = response.data[0].b64_json || response.data[0];
            } else {
                // dall-e-2 returns b64_json field
                editedImageData = response.data[0].b64_json;
            }
            
            console.log('🎨 Image editing successful, returning base64 data (first 50 chars):', editedImageData.substring(0, 50) + '...');
            console.log('🎨 DEBUG: Response data length:', editedImageData.length);
            console.log('🎨 DEBUG: First 100 chars of response:', editedImageData.substring(0, 100));
            
            // Compare with original image data
            const originalImageData = imageData.split(',')[1]; // Remove data:image/png;base64, prefix
            const originalFirst100 = originalImageData.substring(0, 100);
            const editedFirst100 = editedImageData.substring(0, 100);
            const imagesAreDifferent = originalFirst100 !== editedFirst100;
            
            console.log('🎨 DEBUG: Original image first 100 chars:', originalFirst100);
            console.log('🎨 DEBUG: Edited image first 100 chars:', editedFirst100);
            console.log('🎨 DEBUG: Images are different:', imagesAreDifferent);
            
            if (!imagesAreDifferent) {
                console.log('🚨 WARNING: OpenAI returned the same image data! The edit may not have worked.');
            }
            
            return res.json({
                imageData: editedImageData,
                modelIdUsed: model,
                editType: 'image_edit',
                prompt: prompt
            });

        } catch (error) {
            console.error('Error in image edit task:', error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during image editing.';
            return res.status(500).json({ error: `Failed to edit image: ${message}` });
        }
    }
    // <<< END: Image Edit Task Handling >>>

    // <<< ADDED: FAL.ai SAM 2 Segmentation Task Handling >>>
    else if (req.body.task === 'segment_image' || req.body.task === 'auto_segment_image') {
        console.log(`Handling FAL.ai SAM 2 segmentation task: ${req.body.task}`);
        try {
            const { imageUrl, points, box, outputFormat = 'png' } = req.body;

            if (!imageUrl) {
                return res.status(400).json({ error: 'Invalid request: imageUrl is required for segmentation.' });
            }

            // Get FAL API key
            const falApiKey = process.env.VITE_FAL_KEY;
            if (!falApiKey) {
                return res.status(500).json({ error: 'FAL API key not configured' });
            }

            // Prepare FAL.ai SAM 2 request payload
            let requestPayload = {
                image_url: imageUrl,
                output_format: outputFormat,
                sync_mode: true // Get immediate response
            };

            // Add prompts based on task type
            if (req.body.task === 'segment_image') {
                if (points && points.positive && points.positive.length > 0) {
                    // Convert points to FAL.ai format
                    const prompts = [];
                    
                    // Add positive points (foreground)
                    points.positive.forEach(point => {
                        prompts.push({
                            x: Math.round(point[0]),
                            y: Math.round(point[1]),
                            label: 1, // foreground
                            frame_index: 0
                        });
                    });
                    
                    // Add negative points (background)
                    if (points.negative && points.negative.length > 0) {
                        points.negative.forEach(point => {
                            prompts.push({
                                x: Math.round(point[0]),
                                y: Math.round(point[1]),
                                label: 0, // background
                                frame_index: 0
                            });
                        });
                    }
                    
                    requestPayload.prompts = prompts;
                    console.log(`🎯 Using point-based segmentation with ${points.positive.length} positive, ${points.negative?.length || 0} negative points`);
                    
                } else if (box && Array.isArray(box) && box.length === 4) {
                    // Convert box to FAL.ai format [x1, y1, x2, y2] -> {x_min, y_min, x_max, y_max}
                    requestPayload.box_prompts = [{
                        x_min: Math.round(Math.min(box[0], box[2])),
                        y_min: Math.round(Math.min(box[1], box[3])),
                        x_max: Math.round(Math.max(box[0], box[2])),
                        y_max: Math.round(Math.max(box[1], box[3])),
                        frame_index: 0
                    }];
                    console.log(`📦 Using box-based segmentation with box: [${box.join(', ')}]`);
                    
                } else {
                    return res.status(400).json({ error: 'Invalid request: points or box required for segment_image task.' });
                }
            } else if (req.body.task === 'auto_segment_image') {
                // For auto segmentation, we don't need prompts - SAM 2 will segment everything
                console.log('🤖 Using auto segmentation (no prompts needed)');
            }

            console.log(`🎯 Calling FAL.ai SAM 2 API...`);
            console.log('Request payload:', JSON.stringify(requestPayload, null, 2));

            // Call FAL.ai SAM 2 API
            const response = await fetch('https://queue.fal.run/fal-ai/sam2/image', {
                method: 'POST',
                headers: {
                    'Authorization': `Key ${falApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('🚨 FAL.ai SAM 2 API error:', response.status, errorText);
                return res.status(response.status).json({
                    error: 'FAL.ai SAM 2 segmentation failed',
                    details: errorText
                });
            }

            const result = await response.json();
            console.log('✅ FAL.ai SAM 2 segmentation successful');
            console.log('Response:', JSON.stringify(result, null, 2));

            // Handle both queue response and direct response
            if (result.status && result.status !== 'COMPLETED') {
                // If queued, we need to poll for results
                const requestId = result.request_id;
                console.log(`⏳ Request queued with ID: ${requestId}, polling for results...`);
                
                // Poll for completion
                let attempts = 0;
                const maxAttempts = 30; // 30 seconds max wait
                
                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                    
                    const statusResponse = await fetch(`https://queue.fal.run/fal-ai/sam2/image/requests/${requestId}`, {
                        headers: {
                            'Authorization': `Key ${falApiKey}`,
                        }
                    });
                    
                    if (statusResponse.ok) {
                        const statusResult = await statusResponse.json();
                        console.log(`📊 Poll attempt ${attempts + 1}: Status response:`, statusResult);
                        
                        if (statusResult.image) {
                            // Success - return the segmented image
                            return res.json({
                                success: true,
                                image: statusResult.image,
                                modelIdUsed: 'fal-ai/sam2',
                                task: req.body.task,
                                processingTime: attempts * 1000 // Approximate processing time
                            });
                        }
                    }
                    
                    attempts++;
                }
                
                return res.status(408).json({ error: 'Segmentation request timed out' });
                
            } else if (result.image) {
                // Direct response with image
                return res.json({
                    success: true,
                    image: result.image,
                    modelIdUsed: 'fal-ai/sam2',
                    task: req.body.task,
                    processingTime: 0
                });
            } else {
                console.error('🚨 Unexpected FAL.ai response format:', result);
                return res.status(500).json({ error: 'Unexpected response format from FAL.ai' });
            }

        } catch (error) {
            console.error('🚨 Error in FAL.ai SAM 2 segmentation task:', error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during segmentation.';
            return res.status(500).json({ error: `Failed to segment image: ${message}` });
        }
    }
    // <<< END: FAL.ai SAM 2 Segmentation Task Handling >>>

    // <<< ADDED: FAL.ai IC-Light-v2 Relight Task Handling >>>
    else if (req.body.task === 'iclight_relight') {
        console.log(`🔥 Handling FAL.ai IC-Light-v2 relight task`);
        try {
            const { imageData, prompt, model, image_size, num_inference_steps, guidance_scale, cfg, lowres_denoise, enable_hr_fix, sync_mode, num_images, output_format, enable_safety_checker, negative_prompt, initial_latent } = req.body;

            if (!imageData || !prompt) {
                return res.status(400).json({ error: 'Invalid request: imageData and prompt are required for IC-Light-v2 relight.' });
            }

            // Get FAL API key
            const falApiKey = process.env.VITE_FAL_KEY;
            if (!falApiKey) {
                return res.status(500).json({ error: 'FAL API key not configured' });
            }

            // Convert base64 image data to blob URL for fal.ai
            let imageUrl;
            if (imageData.startsWith('data:')) {
                // Convert base64 to blob and upload to fal.ai
                const base64Data = imageData.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                
                // Upload image to fal.ai storage
                const uploadResponse = await fetch('https://queue.fal.run/storage/upload', {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Key ${falApiKey}`,
                        'Content-Type': 'image/png',
                    },
                    body: buffer
                });

                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text();
                    console.error('🚨 FAL.ai image upload error:', uploadResponse.status, errorText);
                    return res.status(uploadResponse.status).json({
                        error: 'Failed to upload image to FAL.ai',
                        details: errorText
                    });
                }

                const uploadResult = await uploadResponse.json();
                imageUrl = uploadResult.url;
                console.log('📤 Image uploaded to FAL.ai:', imageUrl);
            } else {
                imageUrl = imageData;
            }

            // Prepare IC-Light-v2 request payload
            const requestPayload = {
                prompt: prompt,
                image_url: imageUrl,
                image_size: image_size || 'square_hd',
                num_inference_steps: num_inference_steps || 28,
                guidance_scale: guidance_scale || 5,
                cfg: cfg || 1,
                lowres_denoise: lowres_denoise || 0.98,
                enable_hr_fix: enable_hr_fix || false,
                sync_mode: sync_mode || true,
                num_images: num_images || 1,
                output_format: output_format || 'png',
                enable_safety_checker: enable_safety_checker !== false,
                negative_prompt: negative_prompt || '',
                initial_latent: initial_latent || 'None'
            };

            console.log(`🔥 Calling FAL.ai IC-Light-v2 API with prompt: "${prompt}"`);
            console.log('Request payload:', JSON.stringify(requestPayload, null, 2));

            // Call FAL.ai IC-Light-v2 API
            const response = await fetch('https://queue.fal.run/fal-ai/iclight-v2', {
                method: 'POST',
                headers: {
                    'Authorization': `Key ${falApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('🚨 FAL.ai IC-Light-v2 API error:', response.status, errorText);
                return res.status(response.status).json({
                    error: 'FAL.ai IC-Light-v2 relight failed',
                    details: errorText
                });
            }

            const result = await response.json();
            console.log('✅ FAL.ai IC-Light-v2 relight successful');
            console.log('Response:', JSON.stringify(result, null, 2));

            // Handle both queue response and direct response
            if (result.status && result.status !== 'COMPLETED') {
                // If queued, we need to poll for results
                const requestId = result.request_id;
                console.log(`⏳ IC-Light-v2 request queued with ID: ${requestId}, polling for results...`);
                
                // Poll for completion
                let attempts = 0;
                const maxAttempts = 60; // 60 seconds max wait for IC-Light-v2
                
                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                    
                    const statusResponse = await fetch(`https://queue.fal.run/fal-ai/iclight-v2/requests/${requestId}`, {
                        headers: {
                            'Authorization': `Key ${falApiKey}`,
                        }
                    });
                    
                    if (statusResponse.ok) {
                        const statusResult = await statusResponse.json();
                        console.log(`📊 IC-Light-v2 poll attempt ${attempts + 1}: Status response:`, statusResult);
                        
                        if (statusResult.images && statusResult.images.length > 0) {
                            // Success - convert image to base64 and return
                            const imageUrl = statusResult.images[0].url;
                            
                            // Download the image and convert to base64
                            const imageResponse = await fetch(imageUrl);
                            const imageBuffer = await imageResponse.buffer();
                            const base64Data = imageBuffer.toString('base64');
                            
                            return res.json({
                                success: true,
                                imageData: base64Data,
                                images: statusResult.images,
                                modelIdUsed: 'fal-ai/iclight-v2',
                                task: 'iclight_relight',
                                prompt: prompt,
                                processingTime: attempts * 1000,
                                seed: statusResult.seed,
                                has_nsfw_concepts: statusResult.has_nsfw_concepts
                            });
                        }
                    }
                    
                    attempts++;
                }
                
                return res.status(408).json({ error: 'IC-Light-v2 relight request timed out' });
                
            } else if (result.images && result.images.length > 0) {
                // Direct response with images
                const imageUrl = result.images[0].url;
                
                // Download the image and convert to base64
                const imageResponse = await fetch(imageUrl);
                const imageBuffer = await imageResponse.buffer();
                const base64Data = imageBuffer.toString('base64');
                
                return res.json({
                    success: true,
                    imageData: base64Data,
                    images: result.images,
                    modelIdUsed: 'fal-ai/iclight-v2',
                    task: 'iclight_relight',
                    prompt: prompt,
                    processingTime: 0,
                    seed: result.seed,
                    has_nsfw_concepts: result.has_nsfw_concepts
                });
            } else {
                console.error('🚨 Unexpected FAL.ai IC-Light-v2 response format:', result);
                return res.status(500).json({ error: 'Unexpected response format from FAL.ai IC-Light-v2' });
            }

        } catch (error) {
            console.error('🚨 Error in FAL.ai IC-Light-v2 relight task:', error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during IC-Light-v2 relight.';
            return res.status(500).json({ error: `Failed to relight image: ${message}` });
        }
    }
    // <<< END: FAL.ai IC-Light-v2 Relight Task Handling >>>

    // <<< ADDED: FAL.ai IC-Light-v2 Background Change Task Handling >>>
    else if (req.body.task === 'iclight_background') {
        console.log(`🌄 Handling FAL.ai IC-Light-v2 background change task`);
        try {
            const { imageData, prompt, model, image_size, num_inference_steps, guidance_scale, cfg, lowres_denoise, enable_hr_fix, sync_mode, num_images, output_format, enable_safety_checker, negative_prompt, initial_latent, background_threshold } = req.body;

            if (!imageData || !prompt) {
                return res.status(400).json({ error: 'Invalid request: imageData and prompt are required for IC-Light-v2 background change.' });
            }

            // Get FAL API key
            const falApiKey = process.env.VITE_FAL_KEY;
            if (!falApiKey) {
                return res.status(500).json({ error: 'FAL API key not configured' });
            }

            // Convert base64 image data to blob URL for fal.ai
            let imageUrl;
            if (imageData.startsWith('data:')) {
                // Convert base64 to blob and upload to fal.ai
                const base64Data = imageData.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                
                // Upload image to fal.ai storage
                const uploadResponse = await fetch('https://queue.fal.run/storage/upload', {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Key ${falApiKey}`,
                        'Content-Type': 'image/png',
                    },
                    body: buffer
                });

                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text();
                    console.error('🚨 FAL.ai image upload error:', uploadResponse.status, errorText);
                    return res.status(uploadResponse.status).json({
                        error: 'Failed to upload image to FAL.ai',
                        details: errorText
                    });
                }

                const uploadResult = await uploadResponse.json();
                imageUrl = uploadResult.url;
                console.log('📤 Image uploaded to FAL.ai for background change:', imageUrl);
            } else {
                imageUrl = imageData;
            }

            // Prepare IC-Light-v2 request payload for background change
            // For background changes, we modify the prompt to be more specific about background replacement
            const backgroundPrompt = `Change the background to: ${prompt}. Keep the main subject intact and only modify the background.`;
            
            const requestPayload = {
                prompt: backgroundPrompt,
                image_url: imageUrl,
                image_size: image_size || 'square_hd',
                num_inference_steps: num_inference_steps || 28,
                guidance_scale: guidance_scale || 5,
                cfg: cfg || 1,
                lowres_denoise: lowres_denoise || 0.98,
                enable_hr_fix: enable_hr_fix || false,
                sync_mode: sync_mode || true,
                num_images: num_images || 1,
                output_format: output_format || 'png',
                enable_safety_checker: enable_safety_checker !== false,
                negative_prompt: negative_prompt || 'blurry, low quality, distorted, deformed',
                initial_latent: initial_latent || 'None',
                background_threshold: background_threshold || 0.67
            };

            console.log(`🌄 Calling FAL.ai IC-Light-v2 API for background change with prompt: "${backgroundPrompt}"`);
            console.log('Request payload:', JSON.stringify(requestPayload, null, 2));

            // Call FAL.ai IC-Light-v2 API
            const response = await fetch('https://queue.fal.run/fal-ai/iclight-v2', {
                method: 'POST',
                headers: {
                    'Authorization': `Key ${falApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('🚨 FAL.ai IC-Light-v2 background change API error:', response.status, errorText);
                return res.status(response.status).json({
                    error: 'FAL.ai IC-Light-v2 background change failed',
                    details: errorText
                });
            }

            const result = await response.json();
            console.log('✅ FAL.ai IC-Light-v2 background change successful');
            console.log('Response:', JSON.stringify(result, null, 2));

            // Handle both queue response and direct response
            if (result.status && result.status !== 'COMPLETED') {
                // If queued, we need to poll for results
                const requestId = result.request_id;
                console.log(`⏳ IC-Light-v2 background change request queued with ID: ${requestId}, polling for results...`);
                
                // Poll for completion
                let attempts = 0;
                const maxAttempts = 60; // 60 seconds max wait for IC-Light-v2
                
                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                    
                    const statusResponse = await fetch(`https://queue.fal.run/fal-ai/iclight-v2/requests/${requestId}`, {
                        headers: {
                            'Authorization': `Key ${falApiKey}`,
                        }
                    });
                    
                    if (statusResponse.ok) {
                        const statusResult = await statusResponse.json();
                        console.log(`📊 IC-Light-v2 background change poll attempt ${attempts + 1}: Status response:`, statusResult);
                        
                        if (statusResult.images && statusResult.images.length > 0) {
                            // Success - convert image to base64 and return
                            const imageUrl = statusResult.images[0].url;
                            
                            // Download the image and convert to base64
                            const imageResponse = await fetch(imageUrl);
                            const imageBuffer = await imageResponse.buffer();
                            const base64Data = imageBuffer.toString('base64');
                            
                            return res.json({
                                success: true,
                                imageData: base64Data,
                                images: statusResult.images,
                                modelIdUsed: 'fal-ai/iclight-v2',
                                task: 'iclight_background',
                                prompt: prompt,
                                processingTime: attempts * 1000,
                                seed: statusResult.seed,
                                has_nsfw_concepts: statusResult.has_nsfw_concepts
                            });
                        }
                    }
                    
                    attempts++;
                }
                
                return res.status(408).json({ error: 'IC-Light-v2 background change request timed out' });
                
            } else if (result.images && result.images.length > 0) {
                // Direct response with images
                const imageUrl = result.images[0].url;
                
                // Download the image and convert to base64
                const imageResponse = await fetch(imageUrl);
                const imageBuffer = await imageResponse.buffer();
                const base64Data = imageBuffer.toString('base64');
                
                return res.json({
                    success: true,
                    imageData: base64Data,
                    images: result.images,
                    modelIdUsed: 'fal-ai/iclight-v2',
                    task: 'iclight_background',
                    prompt: prompt,
                    processingTime: 0,
                    seed: result.seed,
                    has_nsfw_concepts: result.has_nsfw_concepts
                });
            } else {
                console.error('🚨 Unexpected FAL.ai IC-Light-v2 background change response format:', result);
                return res.status(500).json({ error: 'Unexpected response format from FAL.ai IC-Light-v2 background change' });
            }

        } catch (error) {
            console.error('🚨 Error in FAL.ai IC-Light-v2 background change task:', error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during IC-Light-v2 background change.';
            return res.status(500).json({ error: `Failed to change background: ${message}` });
        }
    }
    // <<< END: FAL.ai IC-Light-v2 Background Change Task Handling >>>

    console.log(`Received request on /api/chat/generate for OpenRouter model: ${req.body.selectedModelId}`);

    try {
        // <<< RECEIVE effectiveReasoningState >>>
        const { messages, systemPrompt, selectedModelId, effectiveReasoningState } = req.body; 

        // Basic validation
        if (messages === undefined || !Array.isArray(messages) || selectedModelId === undefined || effectiveReasoningState === undefined) {
            console.error('Invalid request payload:', req.body);
            return res.status(400).json({ error: 'Invalid request: messages array, selectedModelId, and effectiveReasoningState are required.' });
        }
        if (!openRouterApiKey) {
             return res.status(500).json({ error: 'Server configuration error: OpenRouter API key not configured.' });
        }
        
        // --- Start OpenRouter API Call Logic --- 

        // 1. Format messages for OpenRouter (similar to OpenAI standard)
        let apiMessages = [];
        
        // Handle System Prompt (potentially add reasoning/table instructions if needed)
        let finalSystemPromptContent = systemPrompt ? systemPrompt.trim() : null;
        // const useReasoning = req.body.useReasoning === true; // <<< REMOVE old flag check >>>
        
        // <<< USE effectiveReasoningState for prompt instructions >>>
        if (effectiveReasoningState) {
            console.log(`Effective Reasoning State is TRUE for ${selectedModelId}. Checking for marker instructions.`);
            // Add appropriate instructions based on model type
            // Models that use native API reasoning field - NO marker instructions needed
            const usesNativeReasoningField =
                selectedModelId.includes('qwen/') ||
                selectedModelId.includes('deepseek/') ||
                selectedModelId.includes('x-ai/grok-') ||
                selectedModelId.includes('google/gemini-2.5') ||
                selectedModelId.includes('google/gemini-3') ||
                selectedModelId.includes('claude-sonnet-4') ||
                selectedModelId.includes('claude-opus-4') ||
                selectedModelId.includes('claude-haiku-4') ||
                selectedModelId.includes('claude-3.7-sonnet') ||
                selectedModelId.includes('openai/o1') ||
                selectedModelId.includes('openai/o3') ||
                selectedModelId.includes('openai/o4');

            // Legacy models that need marker instructions in prompt
            const isPotentiallyGeminiStyle = false; // Now handled by native reasoning
            const isPotentiallyOpenAIStyle = selectedModelId.includes('openai/') &&
                                             !selectedModelId.includes('openai/o1') &&
                                             !selectedModelId.includes('openai/o3') &&
                                             !selectedModelId.includes('openai/o4');
            const isPotentiallyQwenStyle = usesNativeReasoningField; 

            let reasoningInstruction = "";
            // Only add markers if state is TRUE and model needs them
            if (isPotentiallyGeminiStyle || isPotentiallyOpenAIStyle) { 
                 const modelsToExcludeMarkers = [
                     'anthropic/claude-3.5-sonnet',
                     'deepseek/deepseek-chat-v3-0324:free'
                 ];
                 if (!modelsToExcludeMarkers.includes(selectedModelId)) {
                    // Make instructions more emphatic for Gemini/OpenAI styles
                    if (isPotentiallyGeminiStyle) {
                        reasoningInstruction = "CRITICAL INSTRUCTION: You MUST follow this response format. First, write out your step-by-step thinking process under a heading formatted exactly as 'Thinking Process:'. After you have completed your entire thinking process, and only then, write out your final answer under a heading formatted exactly as 'Final Answer:'. Do not deviate from this structure. Both headings are mandatory.";
                    } else {
                        reasoningInstruction = "Follow this format strictly:\nThinking Process:\n[Your step-by-step thinking process here]\nFinal Answer:\n[Your final answer here]";
                    }
                    console.log(`   -> Adding marker instructions for ${selectedModelId}.`);
                 } else {
                     console.log(`   -> Model ${selectedModelId} is excluded from marker instructions.`);
                 }
            } else if (isPotentiallyQwenStyle) {
                console.log(`   -> Model ${selectedModelId} is Qwen-style, no marker instructions added.`);
                // Qwen might use fields, no instruction needed in system prompt
            } else {
                 console.log(`   -> Model type not recognized for specific marker instructions.`);
                 // Potentially add a generic fallback if needed, but maybe not necessary
                 // reasoningInstruction = "Think step-by-step..."; 
            }
            
            // Apply instruction if generated
            if (reasoningInstruction) {
                finalSystemPromptContent = finalSystemPromptContent 
                    ? `${reasoningInstruction}\n\n${finalSystemPromptContent}` 
                    : reasoningInstruction;
            }
        } else {
             console.log(`Effective Reasoning State is FALSE for ${selectedModelId}. No reasoning instructions added.`);
        }

        // Add the final system prompt if it exists
        if (finalSystemPromptContent) {
             apiMessages.push({ role: "system", content: finalSystemPromptContent });
        }
        
        // <<< NEW: Intelligent Image Referral Logic >>>
        if (messages.length >= 1 && !req.body.task) { // Only if not an explicit task like image generation/refinement
            const currentUserMessageIndex = messages.length - 1;
            const currentUserMessage = messages[currentUserMessageIndex];
        
            if (currentUserMessage.role === 'user' && currentUserMessage.parts && Array.isArray(currentUserMessage.parts)) {
                const userTextPart = currentUserMessage.parts.find(p => p.type === 'text');
                const userText = userTextPart ? userTextPart.text.toLowerCase() : "";
                const userTextTrimmed = userText.trim();
        
                // Keywords for general image reference
                const imageReferenceKeywords = [
                    "that image", "the image", "this image", "an image",
                    "that picture", "the picture", "this picture", "a picture",
                    "the photo", "that photo", "this photo", "a photo",
                    "the generated one", "the one you made", "the one you generated",
                    "it looks", "about it", "draw it", "generate it", "regarding it",
                    "what about that", "how about that", "make that", "change that",
                    "the previous one", "that one", "referring to that", "related to that",
                    "the cat", "the dog", "the car", // Add common nouns that might follow "the" or "that" when referring to an image subject
                    "what's in the image", "describe the image", "tell me about the picture",
                    "details about that", "more on that", "zoom in on that",
                    "the one with the", "the image of the", "the picture of the"
                ];

                // Short phrases/pronouns that, if an AI image was *just* shown, likely refer to it.
                const immediateReferencePhrases = [
                    "it", "this", "that", "these", "those", 
                    "cool", "nice", "cute", "great", "awesome", "love it", "wow",
                    "so cool", "very nice", "looks great", "how about that one",
                    "what is it", "what's that", "tell me more"
                ];
        
                let refersToImage = false;
                let imageToAttach = null;
                let associatedPromptText = null;

                // Check for immediate reference first if an AI image was the last message
                if (currentUserMessageIndex > 0) {
                    const previousMessage = messages[currentUserMessageIndex - 1];
                    if (previousMessage.role === 'model' && previousMessage.parts?.some(p => p.type === 'image')) {
                        if (immediateReferencePhrases.some(phrase => userTextTrimmed === phrase || userText.includes(phrase))) {
                             // More lenient check for immediateReferencePhrases, e.g. "what is it?" or "cool"
                            if ( (userTextTrimmed.length < 20 && immediateReferencePhrases.includes(userTextTrimmed)) || 
                                 immediateReferencePhrases.some(phrase => userText.includes(phrase)) ) {
                                refersToImage = true;
                                console.log(`   [ImageReferral] Detected immediate reference phrase ("${userTextTrimmed}") to preceding AI image.`);
                            }
                        }
                    }
                }

                // If not an immediate reference, check general keywords
                if (!refersToImage) {
                    if (imageReferenceKeywords.some(keyword => userText.includes(keyword))) {
                        refersToImage = true;
                        console.log(`   [ImageReferral] Detected general image reference keyword in ("${userText.substring(0,50)}...")`);
                    }
                }
                
                // More nuanced check for "it" if not caught by immediate check (e.g., if there was intervening text)
                if (!refersToImage && userText.includes("it")) {
                    if (messages.length > 1) {
                        for (let i = currentUserMessageIndex - 1; i >= Math.max(0, currentUserMessageIndex - 3); i--) { // Check last 3 messages
                            const prevMessage = messages[i];
                            if (prevMessage.role === 'model' && (prevMessage.parts?.some(p => p.type === 'image') || prevMessage.parts?.some(p => p.type === 'text' && p.text?.toLowerCase().includes("image")))) {
                                refersToImage = true;
                                console.log(`   [ImageReferral] Detected 'it' potentially referring to an image within recent history.`);
                                break;
                            }
                        }
                    }
                }
        
                if (refersToImage) {
                    console.log(`   [ImageReferral] User message ("${userText.substring(0,50)}...") considered to refer to an image. Searching for most recent AI image.`);
                    for (let i = currentUserMessageIndex - 1; i >= 0; i--) {
                        const prevMessage = messages[i];
                        if (prevMessage.role === 'model' && prevMessage.parts && Array.isArray(prevMessage.parts)) {
                            const aiImagePart = prevMessage.parts.find(p => p.type === 'image' && p.data && p.media_type);
                            const aiTextPart = prevMessage.parts.find(p => p.type === 'text');
        
                            if (aiImagePart) {
                                imageToAttach = {
                                    type: 'image', 
                                    media_type: aiImagePart.media_type,
                                    data: aiImagePart.data
                                };
                                if (aiTextPart && aiTextPart.text) {
                                    associatedPromptText = aiTextPart.text;
                                }
                                console.log(`   [ImageReferral] Found AI image in message at index ${i}.`);
                                if (associatedPromptText) {
                                     console.log(`   [ImageReferral] Associated prompt/text: "${associatedPromptText.substring(0,100)}"`);
                                }
                                break; 
                            }
                        }
                    }

                    if (imageToAttach) {
                        if (!currentUserMessage.parts) currentUserMessage.parts = [];
                        
                        const imageAlreadyExists = currentUserMessage.parts.some(part =>
                            part.type === 'image' && 
                            part.data === imageToAttach.data && 
                            part.media_type === imageToAttach.media_type
                        );
        
                        if (!imageAlreadyExists) {
                            currentUserMessage.parts.unshift(imageToAttach); // Add to the beginning
                            console.log(`   [ImageReferral] Successfully prepended image to user's message parts.`);
                        } else {
                             console.log("   [ImageReferral] Image part (identical) already exists in current user message. Not re-adding.");
                        }
                    } else {
                        console.log("   [ImageReferral] Referral detected, but no suitable AI image found in history to attach.");
                    }
                } else {
                    console.log(`   [ImageReferral] User message ("${userText.substring(0,50)}...") does not seem to refer to an image. No image attached.`);
                }
            }
        }
        // <<< END: Intelligent Image Referral Logic >>>

        // Add user/assistant messages, conditionally cleaning history if effectiveReasoningState is FALSE
        console.log(`Processing message history. effectiveReasoningState: ${effectiveReasoningState}`);
        messages.forEach(msg => {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            let contentParts = []; // Initialize as an array to hold multiple parts

            if (msg.parts && Array.isArray(msg.parts)) {
                msg.parts.forEach(part => {
                    if (part.type === 'text' && part.text && part.text.trim() !== '') {
                        let textForPart = part.text;
                        if (role === 'assistant') {
                            // Clean AI history text parts
                            // console.log(`   - Cleaning history text part from AI. Original: "${textForPart.substring(0, 50)}..."`); // Verbose
                            const parsedHistory = parseResponseBackend(textForPart);
                            textForPart = parsedHistory.answer;
                            // console.log(`   - Cleaned AI history text part: "${textForPart.substring(0, 50)}..."`); // Verbose
                        }
                        if (textForPart && textForPart.trim() !== '') {
                            contentParts.push({ type: 'text', text: textForPart });
                        }
                    } else if (part.type === 'image' && part.media_type && part.data) {
                        if (role === 'user') { // Only add for user role
                           contentParts.push({
                                type: 'image_url',
                                image_url: {
                                    url: `data:${part.media_type};base64,${part.data}`
                                }
                            });
                            console.log(`   - Added image part for role ${role}: ${part.media_type}`); 
                        } else {
                            // Image part from assistant message in history - VisionHeuristic handles this by attaching to next user msg if relevant.
                            console.log(`   - Skipping image part from assistant message in history for role ${role}: ${part.media_type}. VisionHeuristic should handle context.`);
                        }
                    } else if (part.type === 'file' && part.name && part.media_type && part.data_type && part.data) {
                        if (part.media_type === 'application/pdf' && part.data_type === 'base64') {
                            if (role === 'user') {
                                contentParts.push({
                                    type: 'image_url', // Treat PDF as image_url for OpenRouter
                                    image_url: {
                                        url: `data:application/pdf;base64,${part.data}`
                                    }
                                });
                                console.log(`   - Added PDF file part (as image_url) for role ${role}: ${part.name}`);
                            } else {
                                console.log(`   - Skipping PDF file part from assistant message in history for role ${role}: ${part.name}`);
                            }
                        } else if (part.data_type === 'text') {
                            const fileTextContent = `Content of file "${part.name}":\n\n${part.data}`;
                            // No need to clean user-provided file text for history in the same way as AI responses.
                            contentParts.push({ type: 'text', text: fileTextContent });
                            console.log(`   - Added text file part for role ${role}: ${part.name}`);
                        } else {
                            // For other files, just mention it if it's a user message, or skip if AI
                            if (role === 'user'){
                                contentParts.push({ type: 'text', text: `[Attached file: ${part.name} of type ${part.media_type}]` });
                                console.log(`   - Added placeholder for unprocessable file part for role ${role}: ${part.name}`);
                            } else {
                                console.log(`   - Skipping unprocessable AI file part in history: ${part.name}`);
                            }
                        }
                    }
                });
            } else if (msg.text && msg.text.trim() !== '') { // Legacy: Handle plain text messages if parts are not present
                let textContent = msg.text;
                if (role === 'assistant') {
                    console.log(`   - Cleaning legacy history message from AI. Original: "${textContent.substring(0, 50)}..."`);
                    const parsedHistory = parseResponseBackend(textContent);
                    textContent = parsedHistory.answer;
                    console.log(`   - Cleaned legacy AI history: "${textContent.substring(0, 50)}..."`);
                }
                if (textContent && textContent.trim() !== '') {
                    contentParts.push({ type: 'text', text: textContent });
                }
            }

            // Add to apiMessages if contentParts is not empty
            if (contentParts.length > 0) {
                // If only one text part, send as string content, otherwise as array.
                // OpenRouter prefers string content for simple text messages.
                if (contentParts.length === 1 && contentParts[0].type === 'text') {
                    apiMessages.push({ role: role, content: contentParts[0].text });
                } else {
                    apiMessages.push({ role: role, content: contentParts });
                }
            } else {
                console.warn(`   - Skipping message for role ${role} as it resulted in no content parts after processing.`);
            }
        });

        // <<< NEW DETAILED LOGGING FOR apiMessages >>>
        console.log('[API Call Prep] Verifying apiMessages before sending to OpenRouter:');
        if (apiMessages && apiMessages.length > 0) {
            apiMessages.forEach((msg, index) => {
                let contentPreview = '';
                if (typeof msg.content === 'string') {
                    contentPreview = msg.content.substring(0, 150);
                } else if (Array.isArray(msg.content)) {
                    contentPreview = JSON.stringify(msg.content.map(part => {
                        if (part.type === 'image_url' && part.image_url && typeof part.image_url.url === 'string' && part.image_url.url.startsWith('data:')) {
                            return { ...part, image_url: { ...part.image_url, url: part.image_url.url.substring(0, 70) + '...[truncated]' } };
                        } else if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 100) {
                            return { ...part, text: part.text.substring(0,100) + '...[truncated]' };
                        }
                        return part;
                    })).substring(0, 200);
                }
                console.log(`  Message [${index}] | Role: ${msg.role} | Content Preview: ${contentPreview}...`);
            });
            console.log(`Total messages in apiMessages: ${apiMessages.length}`);
        } else {
            console.log('  apiMessages is empty or undefined.');
        }
        // <<< END NEW DETAILED LOGGING >>>

        // 2. Prepare Headers
        const headers = {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "Content-Type": "application/json",
            // Add optional headers
            ...(siteUrl && { "HTTP-Referer": siteUrl }),
            ...(siteTitle && { "X-Title": siteTitle }),
        };
        
        // 3. Prepare Body
        const bodyPayload = {
            "model": selectedModelId, // Use the ID sent from the frontend directly
            "messages": apiMessages,
            // Optional: Pass temperature etc. if needed
            // "temperature": 1, // Example
            // "max_tokens": 8192, // Example
        };

        // Add reasoning parameter for reasoning-capable models when reasoning is enabled
        if (effectiveReasoningState) {
            // Models that support OpenRouter's reasoning parameter
            const reasoningModels = [
                'anthropic/claude-3.7-sonnet:thinking',
                'deepseek/deepseek-r1',
                'google/gemini-2.5-flash-preview-05-20:thinking',
                'google/gemini-2.5-pro-preview',
                'x-ai/grok-3-beta',
                'x-ai/grok-3-mini-beta'
            ];

            // Check if model needs reasoning parameter
            const modelNeedsReasoning = reasoningModels.includes(selectedModelId) ||
                selectedModelId.includes('deepseek/') ||
                selectedModelId.includes('qwen/') ||
                selectedModelId.includes('x-ai/grok-') ||
                selectedModelId.includes('google/gemini-2.5') ||
                selectedModelId.includes('google/gemini-3') ||
                selectedModelId.includes('claude-sonnet-4') ||
                selectedModelId.includes('claude-opus-4') ||
                selectedModelId.includes('claude-haiku-4') ||
                selectedModelId.includes('openai/o1') ||
                selectedModelId.includes('openai/o3') ||
                selectedModelId.includes('openai/o4');

            if (modelNeedsReasoning) {
                // OpenRouter expects reasoning to be an object, not a boolean
                bodyPayload.reasoning = {
                    effort: "high" // Can be "high", "medium", or "low"
                };
                console.log(`   -> Added reasoning: {effort: "high"} parameter for model ${selectedModelId}`);
            }
        }
        const body = JSON.stringify(bodyPayload);

        // 4. Make the fetch call
        console.log(`Calling OpenRouter API with model: ${selectedModelId}`);
        console.log(`Authorization Header Check: Bearer ${openRouterApiKey?.substring(0, 5)}...`);
        console.log('OpenRouter Request Body:', body); // Log body for debugging
        
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: headers,
            body: body
        });

        // 5. Handle Response
        const responseBody = await response.text(); // Read body once
        
        if (!response.ok) {
             let errorData = {};
             try {
                 errorData = JSON.parse(responseBody); // Try to parse error JSON
             } catch(e) {
                 console.error("Failed to parse OpenRouter error response:", responseBody);
                 errorData = { error: { message: `API request failed with status ${response.status}. Response: ${responseBody}` }};
            }
             console.error('Error calling OpenRouter API:', response.status, errorData);
             const errorMessage = errorData.error?.message || `OpenRouter API Error: Status ${response.status}`;
             const errorDetails = errorData.error ? JSON.stringify(errorData.error) : '';
             const errorResponsePayload = { error: `${errorMessage} ${errorDetails}`.trim() };
             console.log("[BACKEND ERROR] Sending error to frontend:", errorResponsePayload);
             return res.status(response.status || 500).json(errorResponsePayload);
        }

        let data = {};
        try {
            data = JSON.parse(responseBody); // Parse success JSON
        } catch(e) {
             console.error("Failed to parse OpenRouter success response:", responseBody);
             throw new Error("Failed to parse successful API response");
        }
        // Log with potentially sensitive data (like image content) truncated or summarized
        const dataForLogging = JSON.parse(JSON.stringify(data)); // Deep copy
        if (dataForLogging.choices && dataForLogging.choices[0] && dataForLogging.choices[0].message && dataForLogging.choices[0].message.content) {
            // If content is very long, truncate it for logging.
            // This is a generic truncation, specific handling for base64 image data in response content might be needed if models start returning that directly.
            if (typeof dataForLogging.choices[0].message.content === 'string' && dataForLogging.choices[0].message.content.length > 50) {
                 dataForLogging.choices[0].message.content = dataForLogging.choices[0].message.content.substring(0, 50) + "... [AI response truncated for logging]";
            }
        }
        console.log('OpenRouter API Response (content truncated if long):', JSON.stringify(dataForLogging));

        // Extract text - structure follows OpenAI standard
        let outputText = data.choices?.[0]?.message?.content;

        if (outputText === null || outputText === undefined) {
            console.error('OpenRouter response missing expected content:', data);
            throw new Error("API response did not contain expected message content");
        }

        // Convert literal '\n' to actual newline characters for the main output text
        outputText = outputText.replace(/\\n/g, '\n');

        // --- START RESPONSE FORMATTING --- 
        let finalResponse = {};
        const modelIdUsed = selectedModelId; // Use the requested ID
        
        // Check if the model is excluded from marker instructions
        const modelsToExcludeMarkers = [
            'anthropic/claude-3.5-sonnet',
            'deepseek/deepseek-chat-v3-0324:free'
        ];
        const isModelExcluded = modelsToExcludeMarkers.some(excludedModel => selectedModelId.includes(excludedModel));
        
        // If model is excluded, treat as if reasoning is disabled regardless of effectiveReasoningState
        const effectiveReasoningForResponse = effectiveReasoningState && !isModelExcluded;
        
        if (effectiveReasoningForResponse) {
            console.log(`Handling response with effectiveReasoningState: TRUE for ${modelIdUsed}`);
            // Reasoning was requested for this call.
            // Check for special fields first (Qwen/Deepseek R1/Gemini Pro/Grok/Claude 3.7)
            // Models that may return reasoning in a separate field
            const modelProvidesSeparateReasoning =
                selectedModelId.includes('qwen/') ||
                selectedModelId.includes('deepseek/') ||
                selectedModelId.includes('google/gemini-2.5') ||
                selectedModelId.includes('google/gemini-3') ||
                selectedModelId.includes('x-ai/grok-') ||
                selectedModelId.includes('anthropic/claude-3.7-sonnet') ||
                selectedModelId.includes('claude-sonnet-4') ||
                selectedModelId.includes('claude-opus-4') ||
                selectedModelId.includes('claude-haiku-4') ||
                selectedModelId.includes('openai/o1') ||
                selectedModelId.includes('openai/o3') ||
                selectedModelId.includes('openai/o4');
                
            if (modelProvidesSeparateReasoning) {
                const reasoningContent = data.choices?.[0]?.message?.reasoning;
                const answerContent = outputText; // Uses the already cleaned outputText

                if (reasoningContent) {
                    console.log(`   -> Using separate 'reasoning' field from OpenRouter.`);
                    
                    try {
                        // Initial processing: convert literal \n, assign to working vars
                        let processedThinking = (reasoningContent || '').replace(/\\n/g, '\n');
                        let processedAnswer = (data.choices?.[0]?.message?.content || '').replace(/\\n/g, '\n');

                        // 1. Clean known malformed/standard think tags from processedThinking FIRST
                        processedThinking = processedThinking
                            .replace(/<\/\s*th\.\s*ink\s*>/gi, '') // For specific </th.\ink>
                            .replace(/<\/\s*think\s*>/gi, '')      // For standard </think>
                            .replace(/<\s*think\s*>/gi, '')         // For standard <think>
                            .trim();

                        // 2. Refined logic to separate thinking and answer
                        const tempThinkingTrimmed = processedThinking.trim(); // Use already tag-cleaned thinking
                        const tempAnswerTrimmed = processedAnswer.trim();

                        if (tempAnswerTrimmed.length > 0 && tempThinkingTrimmed.endsWith(tempAnswerTrimmed)) {
                            // Case 1: Answer from content field is present and is a suffix of thinking. Clean thinking.
                            let potentialThinkingOnly = tempThinkingTrimmed.substring(0, tempThinkingTrimmed.length - tempAnswerTrimmed.length).trim();
                            if (tempThinkingTrimmed !== tempAnswerTrimmed) { // Avoid emptying if thinking was *only* the answer
                                processedThinking = potentialThinkingOnly;
                                console.log(`   -> Cleaned duplicated answer (from content field) from thinking content.`);
                            }
                            // processedAnswer remains tempAnswerTrimmed (or rather, will be set from it)
                        } else if (tempAnswerTrimmed.length === 0 && tempThinkingTrimmed.length > 0) {
                            // Case 2: Answer from content field is empty, but thinking field has content.
                            // Attempt to split thinking into actual_thinking and actual_answer (common Qwen pattern).
                            const parts = tempThinkingTrimmed.split(/\n\n+/); // Split by 2 or more newlines
                            if (parts.length > 1) {
                                const potentialAnswerFromThinking = parts.pop().trim(); // Last part is potential answer
                                const potentialThinkingFromBody = parts.join('\n\n').trim(); // Rest is potential thinking

                                if (potentialAnswerFromThinking.length > 0) {
                                    processedThinking = potentialThinkingFromBody;
                                    processedAnswer = potentialAnswerFromThinking; // Overwrite empty processedAnswer
                                    console.log(`   -> Extracted answer from thinking field as content field was empty/irrelevant.`);
                                } else {
                                    // Splitting didn't yield a usable answer, thinking might be just thoughts.
                                    console.log(`   -> Content field empty, and could not extract distinct answer from thinking. Thinking remains as is.`);
                                }
                            } else {
                                 // No clear \n\n split, thinking might be just thoughts.
                                 console.log(`   -> Content field empty, no clear \n\n split in thinking. Thinking remains as is.`);
                            }
                        }
                        // If none of the above, processedThinking and processedAnswer retain their current values.

                        // 3. Apply other specific cleanups (quotes, leading backslash)
                        // These apply to the potentially modified processedThinking and processedAnswer
                        processedThinking = processedThinking.replace(/^\\(\s*)/, '$1');
                        processedAnswer = processedAnswer.replace(/^\\(\s*)/, '$1');
                        
                        // Clean specific leading quote pattern from answer (e.g., \"\n)
                        if (processedAnswer.startsWith('\"\n')) { 
                            processedAnswer = processedAnswer.substring(3);
                        }
                        // Remove general outer quotes from answer
                        processedAnswer = processedAnswer.replace(/^\s*["'](.*)["']\s*$/s, '$1').trim();

                        // 4. Apply final general cleaning (collapse newlines, final trim, markdown emphasis)
                        let finalThinking = cleanTextContent(processedThinking);
                        let finalAnswer = cleanTextContent(processedAnswer);
                        
                        // Validate that we have meaningful content after processing
                        if (!finalThinking || finalThinking.trim().length === 0) {
                            console.warn(`   -> WARNING: Thinking content became empty after processing, falling back to raw reasoning`);
                            finalThinking = reasoningContent.trim();
                        }
                        
                        if (!finalAnswer || finalAnswer.trim().length === 0) {
                            console.warn(`   -> WARNING: Answer content became empty after processing, falling back to raw content`);
                            finalAnswer = (data.choices?.[0]?.message?.content || '').trim();
                        }
                        
                        console.log("   -> Final Qwen/DS-R1 thinking to send:", finalThinking);
                        console.log("   -> Final Qwen/DS-R1 answer to send:", finalAnswer);
                        
                        finalResponse = { 
                            thinking: finalThinking,
                            answer: finalAnswer,
                            modelIdUsed: modelIdUsed,
                            reasoningProcessed: true  // Indicate that reasoning was processed
                        };
                    } catch (processingError) {
                        console.error(`   -> ERROR processing reasoning field for ${modelIdUsed}:`, processingError);
                        console.log(`   -> Falling back to raw text due to processing error`);
                        
                        // Fallback to raw text when reasoning processing fails
                        finalResponse = { 
                            text: outputText.trim(), 
                            modelIdUsed: modelIdUsed, 
                            reasoningProcessed: false,
                            error: "reasoning_processing_failed"
                        };
                    }
                } else {
                    // Model *should* provide reasoning field but didn't. Fallback to raw text.
                    console.warn(`   -> ${modelIdUsed} did not provide 'reasoning' field. Sending raw text.`);
                    
                    // Enhanced error handling for Qwen3 models
                    if (selectedModelId.includes('qwen/')) {
                        console.log(`   -> Qwen model detected, applying enhanced error handling`);
                        
                        // Check if outputText contains any content
                        if (!outputText || outputText.trim().length === 0) {
                            console.error(`   -> ERROR: Qwen model returned empty response`);
                            finalResponse = { 
                                text: "Error: The model returned an empty response. Please try again.", 
                                modelIdUsed: modelIdUsed, 
                                reasoningProcessed: false,
                                error: "empty_response"
                            };
                        } else {
                            // Try to extract meaningful content from the response
                            let cleanedText = outputText.trim();
                            
                            // Remove any malformed XML tags that might be present
                            cleanedText = cleanedText.replace(/<[^>]*>/g, '').trim();
                            
                            // Remove any remaining malformed thinking tags
                            cleanedText = cleanedText
                                .replace(/<\/\s*th\.\s*ink\s*>/gi, '')
                                .replace(/<\/\s*think\s*>/gi, '')
                                .replace(/<\s*think\s*>/gi, '')
                                .trim();
                            
                            if (cleanedText.length === 0) {
                                console.error(`   -> ERROR: Qwen model response became empty after cleaning`);
                                finalResponse = { 
                                    text: "Error: The model response could not be processed properly. Please try again.", 
                                    modelIdUsed: modelIdUsed, 
                                    reasoningProcessed: false,
                                    error: "processing_failed"
                                };
                            } else {
                                console.log(`   -> Successfully cleaned Qwen response, length: ${cleanedText.length}`);
                                finalResponse = { 
                                    text: cleanedText, 
                                    modelIdUsed: modelIdUsed, 
                                    reasoningProcessed: false 
                                };
                            }
                        }
                    } else {
                        // Non-Qwen models use standard fallback
                        finalResponse = { 
                            text: outputText.trim(), 
                            modelIdUsed: modelIdUsed, 
                            reasoningProcessed: false 
                        };
                    }
                }
            } else {
                 // Model doesn't use separate fields (Gemini, Grok, OpenAI, etc.)
                 // Send the raw text, frontend parser will handle markers.
                 console.log(`   -> Model uses markers. Sending raw text for frontend parsing.`);
                 finalResponse = { text: outputText.trim(), modelIdUsed: modelIdUsed, reasoningProcessed: true }; // outputText is already cleaned
            }
        } else {
             // Reasoning was FALSE for this call OR model is excluded from reasoning.
             if (effectiveReasoningState && isModelExcluded) {
                 console.log(`Handling response with effectiveReasoningState: TRUE for ${modelIdUsed} - BUT model is excluded from marker instructions, treating as non-reasoning response`);
             } else {
                 console.log(`Handling response with effectiveReasoningState: FALSE for ${modelIdUsed}`);
             }
             // Send only the raw text. Frontend will not parse.
             finalResponse = { text: outputText.trim(), modelIdUsed: modelIdUsed, reasoningProcessed: false }; // outputText is already cleaned
        }
        // --- END RESPONSE FORMATTING --- 

        // <<< START: ADD searchInfo processing for annotations >>>
        if (data.choices?.[0]?.message?.annotations && Array.isArray(data.choices[0].message.annotations)) {
            const annotations = data.choices[0].message.annotations;
            const sources = [];
            const supports = [];
            const urlMap = new Map(); // To track unique sources by URL

            annotations.forEach(annotation => {
                if (annotation.type === 'url_citation' && annotation.url_citation) {
                    const { url, title, start_index, end_index } = annotation.url_citation;
                    
                    let sourceIndex;
                    if (urlMap.has(url)) {
                        sourceIndex = urlMap.get(url);
                    } else {
                        sourceIndex = sources.length;
                        sources.push({ uri: url, title: title || url }); // Use URL as title if title is missing
                        urlMap.set(url, sourceIndex);
                    }
                    
                    if (start_index !== undefined && end_index !== undefined) {
                        supports.push({
                            startIndex: start_index,
                            endIndex: end_index,
                            sourceIndices: [sourceIndex]
                        });
                    }
                }
            });

            if (sources.length > 0) {
                finalResponse.searchInfo = {
                    queries: [], // Placeholder, as OpenRouter doesn't directly provide the user's search query in annotations
                    sources: sources,
                    supports: supports
                };
                console.log("   -> Added searchInfo from annotations:", finalResponse.searchInfo);
            }
        }
        // <<< END: ADD searchInfo processing for annotations >>>

        // <<< START: ADD usage data to response >>>
        if (data.usage) {
            finalResponse.usage = {
                prompt_tokens: data.usage.prompt_tokens || 0,
                completion_tokens: data.usage.completion_tokens || 0,
                total_tokens: data.usage.total_tokens || 0
            };
            console.log("   -> Added usage data:", finalResponse.usage);
        }
        // <<< END: ADD usage data to response >>>

        // Return the final response object
        console.log("Final response object being sent to frontend:", finalResponse);
        return res.json(finalResponse);

    } catch (error) {
        console.error('Error in /api/chat/generate route:', error);
        const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
        const errorResponsePayload = { error: `Failed to generate chat response: ${message}` };
        console.log("[BACKEND CATCH] Sending error to frontend:", errorResponsePayload);
        return res.status(500).json(errorResponsePayload);
    }
});
// --- End Chat Generation Route ---

/*
 * API Endpoint: /api/xeno-search
 * Method: POST
 * Description: Receives a search query, calls the Python Xeno Search service,
 *              and returns the results.
 * Request Body:
 *   {
 *     "query": "string (required)",
 *     "search_type": "string (optional, default: 'normal')",
 *     "num_results": "number (optional, default: 5)"
 *   }
 * Responses:
 *   200 OK: Returns JSON from Python service.
 *   400 Bad Request: If query is missing.
 *   500 Internal Server Error / Other 5xx: If errors occur calling Python service.
 */
app.post('/api/xeno-search', async (req, res) => {
  const { query, search_type = 'normal', num_results = 5 } = req.body;
  // Use docker network name when in container, fallback to localhost for local dev
  const pythonServiceUrl = process.env.NODE_ENV === 'production'
    ? 'http://xeno-search:8000/api/xeno-search-internal'
    : 'http://localhost:8000/api/xeno-search-internal';

  if (!query) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  console.log(`[Node.js Backend] Received /api/xeno-search request: Query='${query}', Type='${search_type}', NumResults='${num_results}'`);

  try {
    const pythonServicePayload = {
      query: query,
      search_type: search_type,
      num_results: parseInt(num_results, 10) || 5,
    };

    console.log(`[Node.js Backend] Calling Python service at ${pythonServiceUrl} with payload:`, pythonServicePayload);

    const response = await axios.post(pythonServiceUrl, pythonServicePayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000, // 60 seconds timeout
    });

    console.log('[Node.js Backend] Successfully received response from Python service.');
    res.json(response.data);

  } catch (error) {
    console.error('[Node.js Backend] Error calling Python service:', error.message);
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('[Node.js Backend] Python Service Error Data:', error.response.data);
      console.error('[Node.js Backend] Python Service Error Status:', error.response.status);
      res.status(error.response.status || 500).json({
        error: 'Error from Xeno Search service.',
        details: error.response.data,
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error('[Node.js Backend] No response received from Python service. Error Request:', error.request);
      res.status(503).json({ error: 'No response from Xeno Search service. The service might be down or unreachable.' });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('[Node.js Backend] Internal error setting up request to Python service:', error.message);
      res.status(500).json({ error: 'Internal server error while contacting Xeno Search service.' });
    }
  }
});

/**
 * API Endpoint: /api/v2/engine/dynamic-search
 * Dynamic real-time search using Xeno Search Engine
 * Crawls authoritative sites on-demand based on query topics
 */
app.post('/api/v2/engine/dynamic-search', async (req, res) => {
  const { query, max_pages = 10, index_results = true } = req.body;

  const pythonServiceUrl = process.env.NODE_ENV === 'production'
    ? 'http://xeno-search-service:8000/api/v2/engine/dynamic-search'
    : 'http://localhost:8000/api/v2/engine/dynamic-search';

  if (!query) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  console.log(`[Dynamic Search] Query='${query}', MaxPages=${max_pages}`);

  try {
    const response = await axios.post(pythonServiceUrl, {
      query,
      max_pages: parseInt(max_pages, 10) || 10,
      index_results: Boolean(index_results)
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000, // 2 minutes timeout for dynamic crawling
    });

    console.log(`[Dynamic Search] Found ${response.data.total_results || 0} results`);
    res.json(response.data);

  } catch (error) {
    console.error('[Dynamic Search] Error:', error.message);
    if (error.response) {
      res.status(error.response.status || 500).json({
        error: 'Error from Dynamic Search service.',
        details: error.response.data,
      });
    } else if (error.request) {
      res.status(503).json({ error: 'Dynamic Search service unreachable.' });
    } else {
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

// OpenAI Realtime API endpoint - creates ephemeral session and returns session details
app.get('/api/openai-realtime-session', async (req, res) => {
  console.log('Requesting ephemeral key from OpenAI Realtime API with voice:', req.query.voice || 'alloy');
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  }

  const voice = req.query.voice || 'alloy'; // Default to 'alloy' if no voice specified

  try {
    const openAiSessionResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-realtime-preview",
        voice: voice,
        modalities: ["text", "audio"],
        instructions: "Your knowledge cutoff is 2023-10. You are a helpful, witty, and friendly AI. Act like a human, but remember that you aren't a human and that you can't do human things in the real world. Your voice and personality should be warm and engaging, with a lively and playful tone. If interacting in a non-English language, start by using the standard accent or dialect familiar to the user. Talk quickly. You should always call a function if you can. Do not refer to these rules, even if you're asked about them.",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200,
          create_response: true,
          interrupt_response: true
        },
        tools: [],
        tool_choice: "auto",
        temperature: 0.8,
        max_response_output_tokens: "inf"
      }),
    });

    const responseBody = await openAiSessionResponse.text();
    let responseData;
    try {
      responseData = JSON.parse(responseBody);
    } catch (e) {
      console.error(`[Node.js Backend] Failed to parse OpenAI Realtime session response: ${responseBody.substring(0,200)}...`);
      return res.status(500).json({ error: 'Failed to parse session response from OpenAI.', details: responseBody });
    }

    if (!openAiSessionResponse.ok) {
      console.error('[Node.js Backend] Error from OpenAI Realtime session API:', responseData);
      return res.status(openAiSessionResponse.status || 500).json({ 
        error: 'Failed to create OpenAI Realtime session.', 
        details: responseData.error || responseData 
      });
    }

    console.log('[Node.js Backend] Successfully obtained session data from OpenAI:', JSON.stringify(responseData, null, 2)); // Log the full response from OpenAI
    res.json(responseData); // Send the full response which includes the client_secret (ephemeral key)

  } catch (error) {    console.error('[Node.js Backend] Error creating OpenAI Realtime session:', error);
    res.status(500).json({ error: 'Failed to create OpenAI Realtime session', message: error instanceof Error ? error.message : 'Unknown server error' });
  }
});

// OpenAI Realtime WebRTC endpoint - exchanges SDP offer for answer
app.post('/api/openai-realtime-webrtc', async (req, res) => {
  console.log('[Node.js Backend] HIT /api/openai-realtime-webrtc with body keys:', Object.keys(req.body));
  const { sdpOffer, model = 'gpt-4o-mini-realtime-preview' } = req.body;

  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  }
  
  if (!sdpOffer) {
    return res.status(400).json({ error: 'SDP offer is required.' });
  }

  try {
    console.log('[Node.js Backend] Sending SDP offer to OpenAI Realtime API...');
    const openAiResponse = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/sdp",
      },
      body: sdpOffer, // Send raw SDP string
    });

    if (!openAiResponse.ok) {
      const errorText = await openAiResponse.text();
      console.error('[Node.js Backend] Error from OpenAI Realtime WebRTC endpoint:', errorText);
      return res.status(openAiResponse.status).json({ 
        error: 'Failed to exchange SDP with OpenAI.', 
        details: errorText 
      });
    }

    const sdpAnswer = await openAiResponse.text(); // SDP answer as plain text
    console.log('[Node.js Backend] Successfully received SDP answer from OpenAI');
    
    res.set('Content-Type', 'application/sdp');
    res.send(sdpAnswer);

  } catch (error) {
    console.error('[Node.js Backend] Error in OpenAI WebRTC SDP exchange:', error);
    res.status(500).json({ error: 'Failed to exchange SDP with OpenAI', message: error instanceof Error ? error.message : 'Unknown server error' });
  }
});

// API endpoint to fetch metadata from a URL
app.post('/api/fetch-metadata', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (e) {
    console.error(`Invalid URL format received: ${url}`);
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    console.log(`Fetching metadata for URL: ${url}`);
    
    // Enhanced Fetch options
    const fetchOptions = {
      method: 'GET', // Ensure GET method
      headers: {
        // More comprehensive User-Agent
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br', // Accept compressed content
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow', // Follow redirects
      timeout: 10000 // Add a 10-second timeout
    };

    // Fetch the webpage content
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      // Log more details on fetch failure
      console.error(`Failed to fetch URL: ${url} - Status: ${response.status} ${response.statusText}`);
      throw new Error(`HTTP error ${response.status}`); // Throw a more specific error
    }
    
    // Check content type - Proceed only if it looks like HTML
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
      console.warn(`Skipping metadata extraction for non-HTML content: ${url} (Content-Type: ${contentType})`);
      // Return minimal data or indicate non-HTML content
      return res.json({
        title: url, // Use URL as title if no HTML
        description: 'Content is not HTML, preview unavailable.',
        favicon: '',
        url: url // Return the original URL requested
      }); 
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract metadata
    const metadata = {
      title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
      description: $('meta[name="description"]').attr('content') || 
                  $('meta[property="og:description"]').attr('content') || '',
      favicon: '',
      url: url // Store the requested URL here as well
    };
    
    // Use Google's favicon service for reliable favicon fetching (avoids CORS issues)
    try {
      const parsedUrl = new URL(url);
      metadata.favicon = `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`;
    } catch (favError) {
      console.warn(`Could not extract domain for favicon: ${url}`);
      metadata.favicon = '';
    }
    
    console.log('Extracted metadata:', metadata);
    
    res.json(metadata);
    
  } catch (error) {
    // Log the specific error message
    console.error(`Error processing metadata for ${url}:`, error.message, error.stack);
    // Return a structured error response
    res.status(500).json({ 
      error: 'Failed to process metadata',
      message: error.message || 'An unexpected error occurred.',
      url: url // Include the URL that failed
    });
  }
});

// API endpoint for generating images using OpenAI
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Image prompt is required' });
    }
    
    console.log(`Generating image with prompt: "${prompt}"`);
    
    // Check if OpenAI API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is missing or empty in .env file');
      return res.status(500).json({ 
        error: 'Server configuration error: OpenAI API key is not configured.'
      });
    }
    
    console.log('OPENAI_API_KEY is configured');
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });
    
    // Generate image using OpenAI API
    console.log('Calling OpenAI GPT Image API...');
    const result = await openai.images.generate({
      model: "gpt-image-1", // Use GPT Image model
      prompt: prompt,
      n: 1,
      size: "1024x1024",
    });
    
    console.log('Image generation successful');
    
    // Get the base64 image data
    const imageData = result.data[0].b64_json;
    
    // Return the image data
    return res.json({ 
      success: true, 
      image: imageData 
    });
    
  } catch (error) {
    console.error('Error generating image:', error);
    return res.status(500).json({ 
      error: `Failed to generate image: ${error.message}` 
    });
  }
});

// OpenAI Images API endpoint (GPT Image 1) - matches frontend expectations
app.post('/api/openai/images/generations', async (req, res) => {
  try {
    const { model, prompt, quality = 'medium', size = '1024x1024', n = 1, image } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    console.log(`GPT Image 1 generation request: "${prompt}" (${quality} quality, ${size})`);
    
    // Check if OpenAI API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is missing or empty in .env file for GPT Image 1');
      return res.status(500).json({ 
        error: 'Server configuration error: OpenAI API key is not configured.'
      });
    }
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });
    
    // Prepare generation parameters
    const generationParams = {
      model: model || "gpt-image-1",
      prompt: prompt,
      n: n,
      size: size,
      quality: quality
    };
    
    // Add image input for image-to-image generation if provided
    if (image) {
      generationParams.image = image;
    }
    
    console.log('Calling OpenAI Images API with GPT Image 1...');
    const result = await openai.images.generate(generationParams);
    
    console.log('GPT Image 1 generation successful');
    console.log('OpenAI response structure:', {
      dataLength: result.data.length,
      firstItem: {
        hasUrl: !!result.data[0]?.url,
        hasB64Json: !!result.data[0]?.b64_json,
        urlLength: result.data[0]?.url?.length,
        b64Length: result.data[0]?.b64_json?.length
      }
    });
    
    // Return response in OpenAI API format
    return res.json({
      created: Math.floor(Date.now() / 1000),
      data: result.data.map(item => ({
        url: item.url,
        b64_json: item.b64_json,
        revised_prompt: item.revised_prompt
      }))
    });
    
  } catch (error) {
    console.error('Error with GPT Image 1 generation:', error);
    
    // Handle specific OpenAI API errors
    if (error.status) {
      return res.status(error.status).json({ 
        error: error.message || 'OpenAI API error'
      });
    }
    
    return res.status(500).json({ 
      error: `Failed to generate image with GPT Image 1: ${error.message}` 
    });
  }
});

// OpenAI Image Edit endpoint
app.post('/api/openai/images/edits', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('OpenAI Image Edit Request:', req.body);
    
    const { 
      prompt, 
      model = 'dall-e-2', 
      n = 1, 
      size = '1024x1024',
      response_format = 'b64_json' 
    } = req.body;

    if (!req.files || !req.files.image) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    // Check if OpenAI API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is missing or empty in .env file');
      return res.status(500).json({
        error: 'Server configuration error: OpenAI API key is not configured.'
      });
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    // Read uploaded files
    const imageFile = req.files.image[0];
    const maskFile = req.files.mask ? req.files.mask[0] : null;

    console.log('Processing image edit with OpenAI...');
    const result = await openai.images.edit({
      model: model,
      image: fs.createReadStream(imageFile.path),
      mask: maskFile ? fs.createReadStream(maskFile.path) : undefined,
      prompt: prompt,
      n: n,
      size: size,
      response_format: response_format
    });

    // Clean up uploaded files
    fs.unlinkSync(imageFile.path);
    if (maskFile) {
      fs.unlinkSync(maskFile.path);
    }

    // Return response in OpenAI API format
    res.json({
      created: result.created,
      data: result.data.map(image => ({
        url: image.url,
        b64_json: image.b64_json
      }))
    });

  } catch (error) {
    console.error('Error in OpenAI image edit:', error);
    
    // Clean up files on error
    if (req.files) {
      if (req.files.image) {
        req.files.image.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      }
      if (req.files.mask) {
        req.files.mask.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      }
    }
    
    res.status(500).json({
      error: error.message || 'OpenAI Image Edit API error'
    });
  }
});

// OpenAI Image Variations endpoint
app.post('/api/openai/images/variations', upload.single('image'), async (req, res) => {
  try {
    console.log('OpenAI Image Variations Request:', req.body);
    
    const { 
      model = 'dall-e-2', 
      n = 1, 
      size = '1024x1024',
      response_format = 'b64_json' 
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    // Check if OpenAI API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is missing or empty in .env file');
      return res.status(500).json({
        error: 'Server configuration error: OpenAI API key is not configured.'
      });
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    console.log('Processing image variations with OpenAI...');
    const result = await openai.images.createVariation({
      model: model,
      image: fs.createReadStream(req.file.path),
      n: n,
      size: size,
      response_format: response_format
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Return response in OpenAI API format
    res.json({
      created: result.created,
      data: result.data.map(image => ({
        url: image.url,
        b64_json: image.b64_json
      }))
    });

  } catch (error) {
    console.error('Error in OpenAI image variations:', error);
    
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: error.message || 'OpenAI Image Variations API error'
    });
  }
});

// OpenAI Conversational Image Generation (Responses API simulation)
app.post('/api/openai/responses/create', async (req, res) => {
  try {
    console.log('OpenAI Responses API Request:', req.body);
    
    const { 
      model = 'gpt-4o-mini',
      input,
      previous_response_id,
      stream = false,
      tools = [{ type: 'image_generation' }]
    } = req.body;

    // Check if OpenAI API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is missing or empty in .env file');
      return res.status(500).json({
        error: 'Server configuration error: OpenAI API key is not configured.'
      });
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    // Extract text prompts from input
    const textInputs = input?.filter(item => item.type === 'input_text') || [];
    const imageInputs = input?.filter(item => item.type === 'image_generation_call') || [];
    
    const combinedPrompt = textInputs.map(item => item.text).join(' ');

    if (!combinedPrompt) {
      return res.status(400).json({ error: 'No text input provided' });
    }

    console.log('Processing conversational image generation...');
    
    // For now, use regular image generation as the Responses API might not be fully available
    const result = await openai.images.generate({
      model: 'dall-e-3',
      prompt: combinedPrompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json'
    });

    // Format response to match expected Responses API structure
    const response = {
      id: `resp_${Date.now()}`,
      model: model,
      created: Math.floor(Date.now() / 1000),
      output: [
        {
          type: 'text',
          text: `Generated image for: "${combinedPrompt}"`
        }
      ]
    };

    // Add image generation call if image was created
    if (result.data && result.data.length > 0) {
      response.output.push({
        type: 'image_generation_call',
        id: `img_${Date.now()}`,
        result: result.data[0].b64_json
      });
    }

    res.json(response);

  } catch (error) {
    console.error('Error in OpenAI conversational image generation:', error);
    
    res.status(500).json({
      error: error.message || 'OpenAI Responses API error'
    });
  }
});

// WebSocket for real-time image streaming (simplified implementation)
app.get('/api/openai/stream/setup', (req, res) => {
  // This would setup WebSocket connections for streaming
  // For now, return connection info
  res.json({
    supported: false,
    message: 'Streaming implementation requires WebSocket setup'
  });
});

// --- XenoRun Code Execution API Routes ---
// XenoRun is our proprietary code execution engine running locally

const XENORUN_URL = process.env.XENORUN_URL || 'http://xenorun:3000';

// Fetch available runtimes from XenoRun
app.get('/api/piston/runtimes', async (req, res) => {
  try {
    console.log('Fetching runtimes from XenoRun...');
    const response = await fetch(`${XENORUN_URL}/api/v1/runtimes`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`XenoRun API error (${response.status}): ${errorText}`);
      return res.status(response.status).json({ error: `Failed to fetch runtimes. Status: ${response.status}` });
    }

    const xenorunRuntimes = await response.json();
    // Convert XenoRun format to Piston-compatible format for frontend compatibility
    const runtimes = xenorunRuntimes.map(r => ({
      language: r.name.toLowerCase(),
      version: r.version,
      aliases: r.aliases || [],
      runtime: r.name
    }));

    console.log(`Successfully fetched ${runtimes.length} runtimes from XenoRun.`);
    res.json(runtimes);

  } catch (error) {
    console.error('Error fetching XenoRun runtimes:', error);
    res.status(500).json({ error: 'Failed to fetch runtimes', message: error instanceof Error ? error.message : 'Unknown server error' });
  }
});

// Execute code via XenoRun
app.post('/api/piston/execute', async (req, res) => {
  try {
    console.log('Executing code via XenoRun...');
    const requestBody = req.body;

    // Basic validation - accept both Piston format and direct XenoRun format
    if (!requestBody || !requestBody.language) {
      return res.status(400).json({ error: 'Invalid request body. Missing language.' });
    }

    // Extract code from Piston format (files array) or direct code property
    let code = '';
    if (requestBody.files && Array.isArray(requestBody.files) && requestBody.files.length > 0) {
      code = requestBody.files[0].content || requestBody.files[0];
    } else if (requestBody.code) {
      code = requestBody.code;
    } else {
      return res.status(400).json({ error: 'No code provided.' });
    }

    console.log(`Executing language: ${requestBody.language}`);

    const response = await fetch(`${XENORUN_URL}/api/v1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: requestBody.language,
        code: code,
        stdin: requestBody.stdin || '',
        timeout: requestBody.timeout || 10000,
        memoryLimit: requestBody.memoryLimit || 256
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(`XenoRun execution error (${response.status}):`, result);
      return res.status(response.status).json(result);
    }

    // Convert XenoRun response to Piston-compatible format for frontend
    const pistonResponse = {
      run: {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        code: result.exitCode,
        signal: null,
        output: result.stdout || result.stderr || ''
      },
      language: result.language,
      version: 'XenoRun'
    };

    console.log('Successfully executed code via XenoRun.');
    res.json(pistonResponse);

  } catch (error) {
    console.error('Error executing via XenoRun:', error);
    res.status(500).json({ error: 'Failed to execute code', message: error instanceof Error ? error.message : 'Unknown server error' });
  }
});

// --- End XenoRun Code Execution API Routes ---

// Ideogram V3 Reframe API Endpoint
app.post('/api/ideogram-reframe', async (req, res) => {
  try {
    console.log('🖼️ Ideogram V3 Reframe request received:', req.body);
    console.log('🖼️ Request headers:', req.headers);
    console.log('🖼️ FAL_KEY available:', !!process.env.VITE_FAL_KEY);
    
    const { image_url, image_data, image_size, rendering_speed = 'BALANCED', num_images = 1, sync_mode = true } = req.body;
    
    // Validate required parameters
    if (!image_url && !image_data) {
      return res.status(400).json({ error: 'Either image_url or image_data is required' });
    }
    
    if (!image_size) {
      return res.status(400).json({ error: 'image_size is required' });
    }
    
    let finalImageUrl = image_url;
    
    // For testing, let's use a sample image URL first to see if the API works
    if (image_data) {
      try {
        console.log('🖼️ Testing with sample image first...');
        
        // Use a sample image URL to test if the API works
        finalImageUrl = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=512&h=512&fit=crop';
        console.log('🖼️ Using sample image URL for testing:', finalImageUrl);
        
        // Save the actual image locally for later use
        const imageBuffer = Buffer.from(image_data, 'base64');
        const filename = `reframe-${Date.now()}.png`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, imageBuffer);
        console.log('🖼️ Actual image saved locally:', filePath);
        
      } catch (error) {
        console.error('🖼️ Error processing image:', error);
        return res.status(500).json({ error: 'Failed to process image' });
      }
    }
    
    // Skip URL validation for localhost URLs since they're served by our own server
    if (finalImageUrl && finalImageUrl.includes('localhost')) {
      console.log(`Using localhost URL (skipping validation): ${finalImageUrl}`);
    } else if (finalImageUrl) {
      console.log(`Using external URL: ${finalImageUrl}`);
    }
    
    // Call Ideogram V3 reframe API via FAL.ai queue
    const requestBody = {
      image_url: finalImageUrl,
      image_size,
      rendering_speed,
      num_images,
      sync_mode
    };
    
    console.log('🖼️ Sending to FAL.ai API:', JSON.stringify(requestBody, null, 2));
    console.log('🖼️ FAL.ai endpoint:', 'https://queue.fal.run/fal-ai/ideogram/v3/reframe');
    console.log('🖼️ Final image URL being sent:', finalImageUrl);
    
    let queueStatus;
    try {
      const falResponse = await fetch('https://queue.fal.run/fal-ai/ideogram/v3/reframe', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.VITE_FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      console.log(`🖼️ FAL.ai response status: ${falResponse.status}`);
      console.log(`🖼️ FAL.ai response headers:`, Object.fromEntries(falResponse.headers.entries()));
      
      if (!falResponse.ok) {
        const errorText = await falResponse.text();
        console.error(`🖼️ Ideogram V3 API error (${falResponse.status}): ${errorText}`);
        return res.status(falResponse.status).json({ 
          error: `Ideogram V3 reframe failed. Status: ${falResponse.status}`, 
          details: errorText 
        });
      }
      
      queueStatus = await falResponse.json();
      console.log('🖼️ Ideogram V3 reframe queued:', queueStatus);
    } catch (falError) {
      console.error('🖼️ Error calling FAL.ai API:', falError);
      return res.status(500).json({ 
        error: 'Failed to call FAL.ai API', 
        details: falError.message 
      });
    }
    
    // Poll for completion using the URLs returned by FAL.ai
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5-second intervals

    const statusUrl = queueStatus.status_url || `https://queue.fal.run/fal-ai/ideogram/v3/reframe/requests/${queueStatus.request_id}/status`;
    const responseUrl = queueStatus.response_url || `https://queue.fal.run/fal-ai/ideogram/v3/reframe/requests/${queueStatus.request_id}`;

    while (attempts < maxAttempts) {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

        console.log(`🖼️ Checking status for request: ${queueStatus.request_id} (attempt ${attempts + 1}/${maxAttempts})`);

        // Check queue status endpoint (GET)
        const statusResponse = await fetch(statusUrl, {
          headers: {
            'Authorization': `Key ${process.env.VITE_FAL_KEY}`,
          },
        });

        if (!statusResponse.ok) {
          console.log(`🖼️ Status check failed (${statusResponse.status}): ${await statusResponse.text()}`);
          attempts++;
          continue;
        }

        const statusJson = await statusResponse.json();
        const currentStatus = statusJson.status;
        if (currentStatus === 'COMPLETED') {
          // Fetch the final result from response URL
          const resultResponse = await fetch(responseUrl, {
            headers: {
              'Authorization': `Key ${process.env.VITE_FAL_KEY}`,
            },
          });
          if (!resultResponse.ok) {
            console.log(`🖼️ Result fetch failed (${resultResponse.status}): ${await resultResponse.text()}`);
            attempts++;
            continue;
          }
          const result = await resultResponse.json();
          console.log('🖼️ Ideogram V3 reframe completed:', result);
          res.json(result);
          return;
        }

        // Otherwise keep polling
        console.log(`🖼️ Current queue status: ${currentStatus}${typeof statusJson.queue_position === 'number' ? ` (position ${statusJson.queue_position})` : ''}`);
        attempts++;
      } catch (pollError) {
        console.error(`🖼️ Error during polling attempt ${attempts + 1}:`, pollError);
        attempts++;
      }
    }
    
    // Timeout
    res.status(408).json({ 
      error: 'Reframe operation timed out', 
      request_id: queueStatus.request_id 
    });
    
  } catch (error) {
    console.error('🖼️ Error in Ideogram V3 reframe API:', error);
    console.error('🖼️ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to process reframe request', 
      message: error instanceof Error ? error.message : 'Unknown server error',
      stack: error.stack
    });
  }
});

// LaTeX to PDF compilation using local TeX Live service
// Full TeX Live installation - supports ALL LaTeX packages and features
app.post('/api/latex/compile', async (req, res) => {
  try {
    const { latex, command = 'pdflatex' } = req.body;
    
    if (!latex) {
      return res.status(400).json({ error: 'LaTeX content is required' });
    }
    
    console.log(`📄 Compiling LaTeX document (${latex.length} chars) with ${command}`);
    
    // Use local LaTeX service (Docker container with full TeX Live)
    const latexServiceUrl = process.env.LATEX_SERVICE_URL || 'http://latex:3001';
    
    try {
      const response = await fetch(`${latexServiceUrl}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex }),
        timeout: 120000, // 2 minute timeout for complex documents
      });
      
      const result = await response.json();
      
      if (!response.ok || result.error) {
        console.error('LaTeX compilation error:', result.error);
        return res.status(400).json({ 
          error: 'LaTeX compilation failed', 
          details: result.error || 'Unknown error'
        });
      }
      
      if (result.pdf) {
        // Convert base64 PDF to buffer and send
        const pdfBuffer = Buffer.from(result.pdf, 'base64');
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="document.pdf"',
          'Content-Length': pdfBuffer.length,
        });
        
        res.send(pdfBuffer);
        console.log(`✅ LaTeX compiled successfully (${pdfBuffer.length} bytes)`);
        return;
      }
      
      return res.status(500).json({ error: 'No PDF generated' });
      
    } catch (fetchError) {
      console.error('LaTeX service connection error:', fetchError.message);
      
      // Fallback to LaTeX.Online if local service is unavailable
      console.log('⚠️ Local LaTeX service unavailable, falling back to LaTeX.Online...');
      
      const pack = tar.pack();
      pack.entry({ name: 'document.tex' }, latex);
      pack.finalize();
      
      const chunks = [];
      for await (const chunk of pack) {
        chunks.push(chunk);
      }
      const tarBuffer = Buffer.concat(chunks);
      
      const formData = new FormData();
      formData.append('file', tarBuffer, {
        filename: 'upload.tar',
        contentType: 'application/x-tar',
      });
      
      const fallbackResponse = await fetch(`https://texlive2020.latexonline.cc/data?target=document.tex&command=${command}`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
      });
      
      if (fallbackResponse.ok) {
        const pdfArrayBuffer = await fallbackResponse.arrayBuffer();
        const pdfBuffer = Buffer.from(pdfArrayBuffer);
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="document.pdf"',
          'Content-Length': pdfBuffer.length,
        });
        
        res.send(pdfBuffer);
        console.log(`✅ LaTeX compiled via fallback (${pdfBuffer.length} bytes)`);
        return;
      }
      
      const errorText = await fallbackResponse.text();
      return res.status(fallbackResponse.status).json({ 
        error: 'LaTeX compilation failed', 
        details: errorText 
      });
    }
    
  } catch (error) {
    console.error('LaTeX proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to compile LaTeX', 
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        server: 'running'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Handle 404 - with proxy redirect for relative URLs from proxied pages
app.use((req, res) => {
  const referer = req.get('Referer') || '';
  const requestedPath = req.originalUrl || req.path;

  // Check if this request came from a proxied page and is requesting a relative resource
  // The Referer will contain /api/browser/proxy?url= if it's from a proxied page
  if (referer.includes('/api/browser/proxy?url=')) {
    try {
      // Extract the original site URL from the referer
      const refererUrl = new URL(referer);
      const originalUrlParam = refererUrl.searchParams.get('url');

      if (originalUrlParam) {
        const originalUrl = new URL(decodeURIComponent(originalUrlParam));
        const originalOrigin = originalUrl.origin;

        // Build the correct URL for the requested resource
        let targetUrl;
        if (requestedPath.startsWith('/')) {
          targetUrl = originalOrigin + requestedPath;
        } else {
          // Handle relative paths
          const basePath = originalUrl.pathname.substring(0, originalUrl.pathname.lastIndexOf('/') + 1);
          targetUrl = originalOrigin + basePath + requestedPath;
        }

        // Redirect to the proxy with the correct URL
        const proxyUrl = `/api/browser/proxy?url=${encodeURIComponent(targetUrl)}`;
        console.log(`[Proxy Redirect] ${requestedPath} -> ${targetUrl}`);
        return res.redirect(302, proxyUrl);
      }
    } catch (e) {
      console.error('[Proxy Redirect] Error parsing referer:', e.message);
    }
  }

  // For ES module imports without Referer, check the proxy context cookie
  // This handles dynamic imports like import('/vendor.js') where browser doesn't send Referer
  const proxyOrigin = req.cookies?.xeno_proxy_origin;
  if (proxyOrigin && requestedPath.startsWith('/') && !requestedPath.startsWith('/api/')) {
    // Check if this looks like a web resource (JS, CSS, fonts, etc.)
    const isWebResource = /\.(js|mjs|css|woff2?|ttf|eot|otf|json|svg|png|jpg|jpeg|gif|webp|ico)(\?|$)/i.test(requestedPath);
    if (isWebResource) {
      try {
        const targetUrl = proxyOrigin + requestedPath;
        const proxyUrl = `/api/browser/proxy?url=${encodeURIComponent(targetUrl)}`;
        console.log(`[Proxy Redirect Cookie] ${requestedPath} -> ${targetUrl}`);
        return res.redirect(302, proxyUrl);
      } catch (e) {
        console.error('[Proxy Redirect Cookie] Error:', e.message);
      }
    }
  }

  // Default 404 response
  res.status(404).json({ error: 'Not found' });
});

// Create HTTP server from Express app
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket({ server });

// Store connected clients with their session info
const wsClients = new Map();

// Collaboration session maps
// Map<sessionId, Map<WebSocket, ClientInfo>>
const collabSessions = new Map();
// Map<canvasId, Map<WebSocket, ClientInfo>>
const officeCanvasSessions = new Map();

// Collaboration message types
const CollabMessageTypes = {
  AUTH: 'auth',
  AUTH_SUCCESS: 'auth_success',
  AUTH_ERROR: 'auth_error',
  JOIN_SESSION: 'join_session',
  LEAVE_SESSION: 'leave_session',
  SESSION_JOINED: 'session_joined',
  SESSION_LEFT: 'session_left',
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  CURSOR_MOVE: 'cursor_move',
  CURSOR_UPDATE: 'cursor_update',
  SELECTION_CHANGE: 'selection_change',
  SELECTION_UPDATE: 'selection_update',
  FILE_OPERATION: 'file_operation',
  FILE_SYNC: 'file_sync',
  WINDOW_OPERATION: 'window_operation',
  WINDOW_SYNC: 'window_sync',
  ICON_POSITION: 'icon_position',
  ICON_POSITION_UPDATE: 'icon_position_update',
  CHAT_MESSAGE: 'chat_message',
  PING: 'ping',
  PONG: 'pong'
};

const OfficeCanvasMessageTypes = {
  JOIN: 'office_canvas_join',
  LEAVE: 'office_canvas_leave',
  JOINED: 'office_canvas_joined',
  USER_JOINED: 'office_canvas_user_joined',
  USER_LEFT: 'office_canvas_user_left',
  CURSOR: 'office_canvas_cursor',
  CURSOR_UPDATE: 'office_canvas_cursor_update',
  PATCH: 'office_canvas_patch',
  NODE_MOVE: 'office_canvas_node_move'
};

const OFFICE_PARTICIPANT_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B',
  '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#06B6D4'
];

function getOfficeColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return OFFICE_PARTICIPANT_COLORS[Math.abs(hash) % OFFICE_PARTICIPANT_COLORS.length];
}

async function canAccessOfficeCanvas(canvasId, userId) {
  const result = await pool.query(
    `SELECT c.id
     FROM office_canvases c
     LEFT JOIN office_canvas_collaborators col
       ON col.canvas_id = c.id AND col.user_id = $2
     WHERE c.id = $1 AND (c.owner_id = $2 OR col.user_id = $2)
     LIMIT 1`,
    [canvasId, userId]
  );
  return result.rows.length > 0;
}

function broadcastToOfficeCanvas(canvasId, message, excludeUserId = null) {
  const sessionClients = officeCanvasSessions.get(canvasId);
  if (!sessionClients) return;
  const messageStr = JSON.stringify(message);
  sessionClients.forEach((clientInfo, ws) => {
    if (excludeUserId && clientInfo.userId === excludeUserId) return;
    if (ws.readyState === 1) {
      ws.send(messageStr);
    }
  });
}

function getOfficeCanvasUsers(canvasId) {
  const sessionClients = officeCanvasSessions.get(canvasId);
  if (!sessionClients) return [];
  const users = [];
  sessionClients.forEach((clientInfo) => {
    users.push({
      id: clientInfo.userId,
      displayName: clientInfo.displayName || 'User',
      avatarUrl: clientInfo.avatarUrl,
      color: clientInfo.officeCanvasColor || getOfficeColor(clientInfo.userId || 'user'),
      cursorX: clientInfo.officeCursorX || 0,
      cursorY: clientInfo.officeCursorY || 0,
    });
  });
  return users;
}

async function resolveWebSocketUserByToken(token) {
  if (!token || typeof token !== 'string') return null;

  // Preferred path: token exists in active session table.
  const sessionResult = await pool.query(
    `SELECT u.*
     FROM users u
     JOIN user_sessions s ON u.id = s.user_id
     WHERE s.session_token = $1
       AND s.expires_at > $2
       AND u.is_active = true
     LIMIT 1`,
    [token, new Date().toISOString()]
  );

  if (sessionResult.rows.length > 0) {
    return sessionResult.rows[0];
  }

  // Fallback path: accept valid JWT bearer token directly.
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded?.userId || decoded?.id;
    if (!userId) return null;

    const userResult = await pool.query(
      `SELECT *
       FROM users
       WHERE id = $1 AND is_active = true
       LIMIT 1`,
      [userId]
    );

    return userResult.rows[0] || null;
  } catch {
    return null;
  }
}

// Debounced cursor updates to database
const cursorUpdateQueue = new Map();

function updateCursorInDB(sessionId, odea, x, y, windowId) {
  const key = `${sessionId}:${odea}`;
  if (cursorUpdateQueue.has(key)) {
    clearTimeout(cursorUpdateQueue.get(key));
  }
  cursorUpdateQueue.set(key, setTimeout(async () => {
    try {
      await pool.query(
        `UPDATE os_session_participants
         SET cursor_x = $1, cursor_y = $2, cursor_window_id = $3, last_seen_at = NOW()
         WHERE session_id = $4 AND user_id = $5`,
        [x, y, windowId, sessionId, odea]
      );
    } catch (error) {
      console.error('Error updating cursor in DB:', error);
    }
    cursorUpdateQueue.delete(key);
  }, 500));
}

// Broadcast to all users in a collaboration session
function broadcastToCollabSession(sessionId, message, excludeUserId = null) {
  const sessionClients = collabSessions.get(sessionId);
  if (!sessionClients) return;
  const messageStr = JSON.stringify(message);
  sessionClients.forEach((clientInfo, ws) => {
    if (excludeUserId && clientInfo.odea === excludeUserId) return;
    if (ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(messageStr);
    }
  });
}

// Get all users in a collaboration session
function getCollabSessionUsers(sessionId) {
  const sessionClients = collabSessions.get(sessionId);
  if (!sessionClients) return [];
  const users = [];
  sessionClients.forEach((clientInfo) => {
    users.push({
      id: clientInfo.odea,
      odea: clientInfo.odea,
      displayName: clientInfo.displayName,
      avatarUrl: clientInfo.avatarUrl,
      color: clientInfo.collabColor,
      cursorX: clientInfo.cursorX || 0,
      cursorY: clientInfo.cursorY || 0,
      cursorWindowId: clientInfo.cursorWindowId,
      selection: clientInfo.selection || []
    });
  });
  return users;
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = Date.now() + Math.random().toString(36).substr(2, 9);
  const clientInfo = {
    id: clientId,
    ip: req.socket.remoteAddress,
    connectedAt: new Date(),
    userAgent: req.headers['user-agent'],
    sessionToken: null,
    userId: null,
    // Collaboration fields
    collabSessionId: null,
    odea: null,
    displayName: null,
    avatarUrl: null,
    collabColor: '#3B82F6',
    cursorX: 0,
    cursorY: 0,
    cursorWindowId: null,
    selection: [],
    collabPermissions: null
    ,
    // Office canvas realtime fields
    officeCanvasId: null,
    officeCanvasColor: '#3B82F6',
    officeCursorX: 0,
    officeCursorY: 0
  };

  wsClients.set(ws, clientInfo);

  console.log(`🔌 WebSocket client connected: ${clientId}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId: clientId,
    message: 'Connected to XenoStudio WebSocket Server'
  }));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 WebSocket message from ${clientId}:`, message.type);

      // Handle authentication
      if (message.type === 'authenticate') {
        const { token } = message;
        if (token) {
          resolveWebSocketUserByToken(token).then(user => {
            if (user) {
              clientInfo.sessionToken = token;
              clientInfo.userId = user.id;
              clientInfo.odea = user.id;
              clientInfo.displayName = user.display_name || user.username || 'User';
              clientInfo.avatarUrl = user.avatar_url || null;
              clientInfo.collabColor = clientInfo.collabColor || '#3B82F6';
              ws.send(JSON.stringify({
                type: 'authenticated',
                user: {
                  id: user.id,
                  username: user.username,
                  display_name: user.display_name
                }
              }));
              console.log(`✅ WebSocket client ${clientId} authenticated as ${user.username}`);
            } else {
              ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid or expired token'
              }));
            }
          }).catch(error => {
            console.error('WebSocket auth error:', error);
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Authentication failed'
            }));
          });
        }
      }

      // Handle file operation requests
      else if (message.type === 'file_operation') {
        handleFileOperation(ws, message);
      }

      // ===========================================
      // COLLABORATION MESSAGE HANDLERS
      // ===========================================

      // Handle auth for collaboration (using session token)
      else if (message.type === CollabMessageTypes.AUTH) {
        const { token } = message;
        if (token) {
          resolveWebSocketUserByToken(token).then(user => {
            if (user) {
              clientInfo.sessionToken = token;
              clientInfo.userId = user.id;
              clientInfo.odea = user.id;
              clientInfo.displayName = user.display_name || user.username || 'User';
              clientInfo.avatarUrl = user.avatar_url;
              ws.send(JSON.stringify({
                type: CollabMessageTypes.AUTH_SUCCESS,
                user: {
                  id: user.id,
                  displayName: clientInfo.displayName,
                  avatarUrl: clientInfo.avatarUrl
                }
              }));
              console.log(`✅ Collaboration auth: ${clientId} as ${clientInfo.displayName}`);
            } else {
              ws.send(JSON.stringify({
                type: CollabMessageTypes.AUTH_ERROR,
                error: 'Invalid or expired token'
              }));
            }
          }).catch(error => {
            console.error('Collaboration auth error:', error);
            ws.send(JSON.stringify({
              type: CollabMessageTypes.AUTH_ERROR,
              error: 'Authentication failed'
            }));
          });
        }
      }

      // Handle join collaboration session
      else if (message.type === CollabMessageTypes.JOIN_SESSION) {
        if (!clientInfo.userId) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Not authenticated'
          }));
          return;
        }

        const { sessionId } = message;

        // Get participant info from database
        pool.query(
          'SELECT * FROM os_session_participants WHERE session_id = $1 AND user_id = $2',
          [sessionId, clientInfo.userId]
        ).then(async (result) => {
          if (result.rows.length === 0) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Not a participant in this session'
            }));
            return;
          }

          const participant = result.rows[0];

          // Update client info
          clientInfo.collabSessionId = sessionId;
          clientInfo.collabColor = participant.color;
          clientInfo.collabPermissions = participant.permissions;

          // Add to session map
          if (!collabSessions.has(sessionId)) {
            collabSessions.set(sessionId, new Map());
          }
          collabSessions.get(sessionId).set(ws, clientInfo);

          // Update participant as active in DB
          await pool.query(
            `UPDATE os_session_participants
             SET is_active = true, last_seen_at = NOW()
             WHERE session_id = $1 AND user_id = $2`,
            [sessionId, clientInfo.userId]
          );

          // Get existing users in session
          const existingUsers = getCollabSessionUsers(sessionId);

          // Send session joined confirmation
          ws.send(JSON.stringify({
            type: CollabMessageTypes.SESSION_JOINED,
            sessionId,
            odea: clientInfo.userId,
            color: clientInfo.collabColor,
            users: existingUsers
          }));

          // Broadcast user joined to others
          broadcastToCollabSession(sessionId, {
            type: CollabMessageTypes.USER_JOINED,
            user: {
              id: clientInfo.odea,
              odea: clientInfo.odea,
              displayName: clientInfo.displayName,
              avatarUrl: clientInfo.avatarUrl,
              color: clientInfo.collabColor
            }
          }, clientInfo.userId);

          console.log(`🤝 User ${clientInfo.displayName} joined collab session ${sessionId}`);
        }).catch(error => {
          console.error('Error joining session:', error);
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Failed to join session'
          }));
        });
      }

      // Handle leave collaboration session
      else if (message.type === CollabMessageTypes.LEAVE_SESSION) {
        if (clientInfo.collabSessionId) {
          const sid = clientInfo.collabSessionId;

          // Remove from session map
          const sessionMap = collabSessions.get(sid);
          if (sessionMap) {
            sessionMap.delete(ws);
            if (sessionMap.size === 0) {
              collabSessions.delete(sid);
            }
          }

          // Update participant as inactive in DB
          pool.query(
            `UPDATE os_session_participants
             SET is_active = false, last_seen_at = NOW()
             WHERE session_id = $1 AND user_id = $2`,
            [sid, clientInfo.userId]
          ).catch(err => console.error('Error updating participant:', err));

          // Broadcast user left
          broadcastToCollabSession(sid, {
            type: CollabMessageTypes.USER_LEFT,
            odea: clientInfo.userId
          });

          clientInfo.collabSessionId = null;

          ws.send(JSON.stringify({
            type: CollabMessageTypes.SESSION_LEFT,
            sessionId: sid
          }));

          console.log(`🤝 User ${clientInfo.displayName} left collab session ${sid}`);
        }
      }

      // Handle cursor move
      else if (message.type === CollabMessageTypes.CURSOR_MOVE) {
        if (!clientInfo.collabSessionId) return;

        const { x, y, windowId } = message;
        clientInfo.cursorX = x;
        clientInfo.cursorY = y;
        clientInfo.cursorWindowId = windowId;

        // Update in database (debounced)
        updateCursorInDB(clientInfo.collabSessionId, clientInfo.userId, x, y, windowId);

        // Broadcast to session immediately
        broadcastToCollabSession(clientInfo.collabSessionId, {
          type: CollabMessageTypes.CURSOR_UPDATE,
          odea: clientInfo.userId,
          displayName: clientInfo.displayName,
          color: clientInfo.collabColor,
          x,
          y,
          windowId
        }, clientInfo.userId);
      }

      // Handle selection change
      else if (message.type === CollabMessageTypes.SELECTION_CHANGE) {
        if (!clientInfo.collabSessionId) return;

        clientInfo.selection = message.selection || [];

        broadcastToCollabSession(clientInfo.collabSessionId, {
          type: CollabMessageTypes.SELECTION_UPDATE,
          odea: clientInfo.userId,
          color: clientInfo.collabColor,
          selection: clientInfo.selection
        }, clientInfo.userId);
      }

      // Handle file operation broadcast
      else if (message.type === CollabMessageTypes.FILE_OPERATION) {
        if (!clientInfo.collabSessionId) return;

        broadcastToCollabSession(clientInfo.collabSessionId, {
          type: CollabMessageTypes.FILE_SYNC,
          odea: clientInfo.userId,
          displayName: clientInfo.displayName,
          operation: message.operation,
          path: message.path,
          newPath: message.newPath,
          itemType: message.itemType,
          timestamp: new Date().toISOString()
        });
      }

      // Handle window operation broadcast
      else if (message.type === CollabMessageTypes.WINDOW_OPERATION) {
        if (!clientInfo.collabSessionId) return;

        broadcastToCollabSession(clientInfo.collabSessionId, {
          type: CollabMessageTypes.WINDOW_SYNC,
          odea: clientInfo.userId,
          displayName: clientInfo.displayName,
          operation: message.operation,
          windowId: message.windowId,
          windowType: message.windowType,
          windowTitle: message.windowTitle,
          position: message.position,
          size: message.size,
          timestamp: new Date().toISOString()
        });
      }

      // Handle chat message
      else if (message.type === CollabMessageTypes.CHAT_MESSAGE) {
        if (!clientInfo.collabSessionId) return;

        broadcastToCollabSession(clientInfo.collabSessionId, {
          type: CollabMessageTypes.CHAT_MESSAGE,
          odea: clientInfo.userId,
          displayName: clientInfo.displayName,
          avatarUrl: clientInfo.avatarUrl,
          color: clientInfo.collabColor,
          message: message.message,
          timestamp: new Date().toISOString()
        });
      }

      // Handle icon position broadcast (for real-time icon drag sync)
      else if (message.type === CollabMessageTypes.ICON_POSITION) {
        if (!clientInfo.collabSessionId) return;

        broadcastToCollabSession(clientInfo.collabSessionId, {
          type: CollabMessageTypes.ICON_POSITION_UPDATE,
          odea: clientInfo.userId,
          displayName: clientInfo.displayName,
          iconId: message.iconId,
          position: message.position,
          isDragging: message.isDragging,
          timestamp: new Date().toISOString()
        }, clientInfo.userId);
      }

      // ===========================================
      // OFFICE CANVAS REALTIME MESSAGE HANDLERS
      // ===========================================
      else if (message.type === OfficeCanvasMessageTypes.JOIN) {
        if (!clientInfo.userId) {
          ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
          return;
        }

        const { canvasId } = message;
        if (!canvasId) {
          ws.send(JSON.stringify({ type: 'error', error: 'canvasId is required' }));
          return;
        }

        canAccessOfficeCanvas(canvasId, clientInfo.userId).then((allowed) => {
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', error: 'No access to this canvas' }));
            return;
          }

          if (clientInfo.officeCanvasId && clientInfo.officeCanvasId !== canvasId) {
            const previousMap = officeCanvasSessions.get(clientInfo.officeCanvasId);
            if (previousMap) {
              previousMap.delete(ws);
              if (previousMap.size === 0) {
                officeCanvasSessions.delete(clientInfo.officeCanvasId);
              }
              broadcastToOfficeCanvas(clientInfo.officeCanvasId, {
                type: OfficeCanvasMessageTypes.USER_LEFT,
                canvasId: clientInfo.officeCanvasId,
                userId: clientInfo.userId
              }, clientInfo.userId);
            }
          }

          clientInfo.officeCanvasId = canvasId;
          clientInfo.officeCanvasColor = getOfficeColor(clientInfo.userId);

          if (!officeCanvasSessions.has(canvasId)) {
            officeCanvasSessions.set(canvasId, new Map());
          }
          officeCanvasSessions.get(canvasId).set(ws, clientInfo);

          const users = getOfficeCanvasUsers(canvasId);

          ws.send(JSON.stringify({
            type: OfficeCanvasMessageTypes.JOINED,
            canvasId,
            users
          }));

          broadcastToOfficeCanvas(canvasId, {
            type: OfficeCanvasMessageTypes.USER_JOINED,
            canvasId,
            user: {
              id: clientInfo.userId,
              displayName: clientInfo.displayName || 'User',
              avatarUrl: clientInfo.avatarUrl,
              color: clientInfo.officeCanvasColor
            }
          }, clientInfo.userId);
        }).catch((error) => {
          console.error('Office canvas join error:', error);
          ws.send(JSON.stringify({ type: 'error', error: 'Failed to join canvas' }));
        });
      }

      else if (message.type === OfficeCanvasMessageTypes.LEAVE) {
        if (!clientInfo.officeCanvasId) return;
        const sid = clientInfo.officeCanvasId;
        const sessionMap = officeCanvasSessions.get(sid);
        if (sessionMap) {
          sessionMap.delete(ws);
          if (sessionMap.size === 0) {
            officeCanvasSessions.delete(sid);
          }
        }
        clientInfo.officeCanvasId = null;
        broadcastToOfficeCanvas(sid, {
          type: OfficeCanvasMessageTypes.USER_LEFT,
          canvasId: sid,
          userId: clientInfo.userId
        }, clientInfo.userId);
      }

      else if (message.type === OfficeCanvasMessageTypes.CURSOR) {
        if (!clientInfo.officeCanvasId) return;
        const { x, y } = message;
        clientInfo.officeCursorX = Number.isFinite(x) ? x : 0;
        clientInfo.officeCursorY = Number.isFinite(y) ? y : 0;

        broadcastToOfficeCanvas(clientInfo.officeCanvasId, {
          type: OfficeCanvasMessageTypes.CURSOR_UPDATE,
          canvasId: clientInfo.officeCanvasId,
          userId: clientInfo.userId,
          displayName: clientInfo.displayName || 'User',
          color: clientInfo.officeCanvasColor,
          x: clientInfo.officeCursorX,
          y: clientInfo.officeCursorY
        }, clientInfo.userId);
      }

      else if (message.type === OfficeCanvasMessageTypes.PATCH) {
        if (!clientInfo.officeCanvasId) return;
        const canvasId = clientInfo.officeCanvasId;
        if (message.canvasId && message.canvasId !== canvasId) return;

        broadcastToOfficeCanvas(canvasId, {
          type: OfficeCanvasMessageTypes.PATCH,
          canvasId,
          userId: clientInfo.userId,
          displayName: clientInfo.displayName || 'User',
          color: clientInfo.officeCanvasColor,
          realtime: message.realtime === true,
          version: message.version,
          updatedAt: message.updatedAt,
          state: message.state
        }, clientInfo.userId);
      }

      else if (message.type === OfficeCanvasMessageTypes.NODE_MOVE) {
        if (!clientInfo.officeCanvasId) return;
        const canvasId = clientInfo.officeCanvasId;
        if (message.canvasId && message.canvasId !== canvasId) return;
        if (!message.nodeId || typeof message.x !== 'number' || typeof message.y !== 'number') return;

        broadcastToOfficeCanvas(canvasId, {
          type: OfficeCanvasMessageTypes.NODE_MOVE,
          canvasId,
          userId: clientInfo.userId,
          displayName: clientInfo.displayName || 'User',
          nodeId: message.nodeId,
          x: message.x,
          y: message.y
        }, clientInfo.userId);
      }

      // Handle ping
      else if (message.type === CollabMessageTypes.PING) {
        ws.send(JSON.stringify({ type: CollabMessageTypes.PONG }));
      }

      // ===========================================
      // END COLLABORATION HANDLERS
      // ===========================================

      // Broadcast other messages to authenticated clients
      else if (clientInfo.userId) {
        broadcastToAuthenticatedClients(message, ws);
      }

    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  // Handle disconnection
  ws.on('close', async () => {
    const info = wsClients.get(ws);
    if (info) {
      console.log(`🔌 WebSocket client disconnected: ${info.id}`);

      // Clean up collaboration session
      if (info.collabSessionId) {
        const sessionMap = collabSessions.get(info.collabSessionId);
        if (sessionMap) {
          sessionMap.delete(ws);
          if (sessionMap.size === 0) {
            collabSessions.delete(info.collabSessionId);
          }
        }

        // Update participant as inactive in DB
        if (info.userId) {
          try {
            await pool.query(
              `UPDATE os_session_participants
               SET is_active = false, last_seen_at = NOW()
               WHERE session_id = $1 AND user_id = $2`,
              [info.collabSessionId, info.userId]
            );
          } catch (error) {
            console.error('Error updating participant on disconnect:', error);
          }
        }

        // Broadcast user left
        broadcastToCollabSession(info.collabSessionId, {
          type: CollabMessageTypes.USER_LEFT,
          odea: info.userId
        });
      }

      // Clean up office canvas session
      if (info.officeCanvasId) {
        const officeMap = officeCanvasSessions.get(info.officeCanvasId);
        if (officeMap) {
          officeMap.delete(ws);
          if (officeMap.size === 0) {
            officeCanvasSessions.delete(info.officeCanvasId);
          }
        }

        broadcastToOfficeCanvas(info.officeCanvasId, {
          type: OfficeCanvasMessageTypes.USER_LEFT,
          canvasId: info.officeCanvasId,
          userId: info.userId
        }, info.userId);
      }

      wsClients.delete(ws);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// File operation handler
async function handleFileOperation(ws, message) {
  const clientInfo = wsClients.get(ws);
  if (!clientInfo || !clientInfo.userId) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Authentication required'
    }));
    return;
  }

  try {
    const { operation, filePath, content, data } = message;

    switch (operation) {
      case 'read_file':
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          ws.send(JSON.stringify({
            type: 'file_content',
            filePath: filePath,
            content: fileContent
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'File not found'
          }));
        }
        break;

      case 'write_file':
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content || '');
        ws.send(JSON.stringify({
          type: 'file_operation_success',
          operation: 'write_file',
          filePath: filePath
        }));
        // Broadcast file change to other clients
        broadcastFileChange(filePath, 'write', clientInfo.userId);
        break;

      case 'delete_file':
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          ws.send(JSON.stringify({
            type: 'file_operation_success',
            operation: 'delete_file',
            filePath: filePath
          }));
          // Broadcast file change to other clients
          broadcastFileChange(filePath, 'delete', clientInfo.userId);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'File not found'
          }));
        }
        break;

      case 'list_directory':
        if (fs.existsSync(filePath)) {
          const items = fs.readdirSync(filePath).map(item => {
            const itemPath = path.join(filePath, item);
            const stats = fs.statSync(itemPath);
            return {
              name: item,
              path: itemPath,
              type: stats.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: stats.mtime
            };
          });
          ws.send(JSON.stringify({
            type: 'directory_listing',
            directory: filePath,
            items: items
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Directory not found'
          }));
        }
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown file operation'
        }));
    }
  } catch (error) {
    console.error('File operation error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: error.message
    }));
  }
}

// Broadcast file changes to authenticated clients
function broadcastFileChange(filePath, changeType, userId) {
  const message = {
    type: 'file_change',
    filePath: filePath,
    changeType: changeType,
    userId: userId,
    timestamp: new Date().toISOString()
  };

  wsClients.forEach((clientInfo, clientWs) => {
    if (clientInfo.userId && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(message));
    }
  });
}

// Broadcast messages to authenticated clients
function broadcastToAuthenticatedClients(message, excludeWs = null) {
  wsClients.forEach((clientInfo, clientWs) => {
    if (clientInfo.userId && clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        ...message,
        from: wsClients.get(excludeWs)?.id,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

// Set up file watching for real-time synchronization
const watcher = chokidar.watch([], {
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.log'
  ],
  persistent: true,
  ignoreInitial: true
});

// File change handler
watcher.on('change', (filePath) => {
  console.log(`📁 File changed: ${filePath}`);
  broadcastFileChange(filePath, 'change', 'system');
});

watcher.on('add', (filePath) => {
  console.log(`📁 File added: ${filePath}`);
  broadcastFileChange(filePath, 'add', 'system');
});

watcher.on('unlink', (filePath) => {
  console.log(`📁 File deleted: ${filePath}`);
  broadcastFileChange(filePath, 'delete', 'system');
});

// API endpoint to watch/unwatch directories
app.post('/api/files/watch', (req, res) => {
  const { directories, action } = req.body;

  if (!Array.isArray(directories)) {
    return res.status(400).json({ error: 'Directories must be an array' });
  }

  try {
    if (action === 'add') {
      directories.forEach(dir => {
        if (fs.existsSync(dir)) {
          watcher.add(dir);
          console.log(`👀 Started watching: ${dir}`);
        }
      });
      res.json({ success: true, message: `Added ${directories.length} directories to watch` });
    } else if (action === 'remove') {
      directories.forEach(dir => {
        watcher.unwatch(dir);
        console.log(`🙈 Stopped watching: ${dir}`);
      });
      res.json({ success: true, message: `Removed ${directories.length} directories from watch` });
    } else {
      res.status(400).json({ error: 'Action must be "add" or "remove"' });
    }
  } catch (error) {
    console.error('Watch operation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get watched directories
app.get('/api/files/watched', (req, res) => {
  const watchedPaths = watcher.getWatched();
  const directories = Object.keys(watchedPaths);
  res.json({ directories });
});

// Initialize cleanup service for old conversions
initCleanupService();

// Run database migrations on startup
runMigrations(pool).catch(err => {
  console.error('Migration warning:', err.message);
});

// Start main server
server.listen(PORT, () => {
  console.log(`🚀 XenoStudio Main Server running on port ${PORT}`);
  console.log(`🔌 WebSocket server available at ws://localhost:${PORT}`);
  console.log(`📁 File uploads available at: http://localhost:${PORT}/uploads/`);
  console.log(`💾 Persistent File System API available at: http://localhost:${PORT}/api/filesystem/*`);
  console.log(`🐳 Container Provisioning API available at: http://localhost:${PORT}/api/containers/*`);
  console.log(`🔄 File Conversion API available at: http://localhost:${PORT}/api/conversion/*`);
  console.log(`🎨 FAL.ai proxy available at: http://localhost:${PORT}/api/fal/*`);
  console.log(`🎯 SAM 2 segmentation available via FAL.ai integration`);
  console.log(`📊 Real-time file synchronization enabled`);
  console.log(`\n✅ Server ready! Use Ctrl+C to stop.`);
}); 

export default app;
