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
import { apiOrigin, acceptedSiteOrigins } from './config/hosts.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import OpenAI, { toFile } from 'openai';
import Xeno from 'xeno-ai';
import util from 'util';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import FormData from 'form-data';
import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'crypto';
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
import cliAuthRoutes from './routes/cliAuthRoutes.js';
import conversionRoutes from './routes/conversionRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import imageRoutes, { imagePublicRoutes } from './routes/imageRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import tokenizerRoutes from './routes/tokenizerRoutes.js';
import userDataRoutes from './routes/userDataRoutes.js';
import browserRoutes from './routes/browserRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import { workspaceRoutes, workspaceInviteRoutes } from './routes/workspaceRoutes.js';
import { resolveBillingAccountId } from './services/walletService.js';
import { xenoModelCatalog, PROVIDER_LABELS, prettyModelName, xenoChatCompletion, normalizeXenoModelId, XENO_API_BASE, XENO_API_KEY, xenoApiConfigured } from './utils/xenoChat.js';
import { meterPremiumChat, meterMediaGeneration } from './utils/inferenceMeter.js';
import { estimateMessageTokens, getCreditCost } from './utils/creditCosts.js';
import { deductCredits, refundCredits, logUsage as logCreditUsage } from './utils/creditTransactions.js';
import { resolveEntitlements, gateMeta } from './utils/entitlementGate.js';
import { watermarkBuffer } from './utils/watermark.js';
import youtubeRoutes, { youtubePublicRoutes } from './routes/youtubeRoutes.js';
import collaborationRoutes from './routes/collaborationRoutes.js';
import officeCanvasRoutes from './routes/officeCanvasRoutes.js';
import downloadRoutes from './routes/downloadRoutes.js';
import productDownloadRoutes from './routes/productDownloadRoutes.js';
import xenoRoutes from './routes/xenoRoutes.js';
import marketplaceRoutes from './routes/marketplaceRoutes.js';
import billingRoutes, { stripeWebhook } from './routes/billingRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import v2LedgerRoutes from './routes/v2LedgerRoutes.js';
import serviceLedgerRoutes from './routes/serviceLedgerRoutes.js';
import oauth2Routes from './routes/oauth2Routes.js';
import v2MeRoutes from './routes/v2MeRoutes.js';
import v2AuthzRoutes from './routes/v2AuthzRoutes.js';
import handleRoutes from './routes/handleRoutes.js';
import { oidcAuth } from './middleware/oidcAuth.js';
import { discovery as oidcDiscovery } from './utils/oidcProvider.js';
import { databaseMiddleware } from './middleware/database.js';
import blogRoutes from './routes/blogRoutes.js';
import learnRoutes from './routes/learnRoutes.js';
import forumRoutes from './routes/forumRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import { authMiddleware } from './middleware/auth.js';
import { initCleanupService } from './services/cleanupService.js';
import { runMigrations } from './services/migrationService.js';

// Round 8: Infrastructure imports
import healthRoutes from './routes/healthRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import docsRoutes from './routes/docsRoutes.js';
import jobRoutes from './routes/jobRoutes.js';
import { requestLoggerMiddleware, logger } from './middleware/requestLogger.js';
import { staticCacheMiddleware, apiCacheMiddleware, securityHeadersMiddleware } from './middleware/cdnOptimization.js';
import { authLimiter as perEndpointAuthLimiter, llmLimiter, imageGenLimiter, uploadLimiter, clientIp } from './middleware/rateLimiter.js';
import { runAllMigrations } from './services/migrationRunner.js';
import { migrateAccountV2 } from './database/migrate-account-v2.js';
import { migrateOidcClients } from './database/migrate-oidc-clients.js';
import { sweepExpiredHolds, MICRO_PER_CREDIT } from './utils/creditLedgerV2.js';
import { seedMarketplace } from './database/seeds/marketplace-seed.js';
import { seedForum } from './database/seeds/forum-seed.js';
import { initBackgroundJobs } from './services/backgroundJobs.js';

// ── Internal-service JSON POST helper (replaces the axios dependency) ──────────
// Uses the module's existing `fetch` + an AbortController timeout. Returns
// { ok, status, data } for ANY completed HTTP response (does NOT throw on non-2xx,
// unlike axios). Throws a tagged { isNoResponse:true } error ONLY when no response
// arrives (network failure or timeout) — this mirrors axios's error.request branch
// so callers keep their exact status-code behavior. Zero third-party HTTP client.
async function postJsonToService(url, body, { timeoutMs = 60000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const e = new Error(`No response from ${url}: ${err?.message || err}`);
      e.isNoResponse = true;
      e.cause = err;
      throw e;
    }
    let data = null;
    const text = await resp.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ── XENO gateway image client (no direct third-party AI) ──────────────────────
// The platform makes ZERO direct third-party AI calls. Chat image generation + edit
// route through the XENO gateway's OpenAI-compatible /v1/images/* endpoints — exactly
// like /api/xeno/images/* (see routes/xenoRoutes.js). XENO_API_KEY is an internal
// service key that is credit-EXEMPT on the gateway, so the platform meters credits
// LOCALLY (deductCredits / meterMediaGeneration) with no double charge. When the key
// is absent, the image branches 500 with a clear "gateway not configured" error.
const xenoImageClient = process.env.XENO_API_KEY
  ? new Xeno({ apiKey: process.env.XENO_API_KEY, baseURL: `${apiOrigin()}/v1` })
  : null;

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
    // Sanitize originalname to prevent path traversal
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uniquePrefix}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 10, // Max 10 files per request
  },
});

// Create Express app with increased limits for image processing
const app = express();
const PORT = process.env.BACKEND_PORT || 8090;
const JWT_DEFAULT_SECRET = 'xenostudio-super-secret-jwt-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || JWT_DEFAULT_SECRET;
// SECURITY: never run on a missing/committed-default signing secret in production — with
// it, anyone can forge an HS256 token for ANY user. Fail fast instead of just warning.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || JWT_SECRET === JWT_DEFAULT_SECRET)) {
  console.error('FATAL: JWT_SECRET is unset or equals the committed default in production. Refusing to boot. Set a strong JWT_SECRET.');
  process.exit(1);
}

// =============================================================================
// SECURITY MIDDLEWARE (must be first)
// =============================================================================

// Helmet: sets security-related HTTP headers (CSP, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for SPA with inline scripts/styles
  crossOriginEmbedderPolicy: false, // Disabled for cross-origin resource loading
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin requests for API
}));

// Remove X-Powered-By header (defense in depth — Helmet also does this)
app.disable('x-powered-by');

// Trust the reverse-proxy chain (Cloudflare tunnel -> nginx -> app) so req.ip is the
// REAL client IP, not the loopback proxy hop. Without this every IP-keyed rate limiter
// (auth, global, generation) collapses to ONE shared global bucket. `1` = trust the first
// hop (nginx on the same host); the CF edge sets CF-Connecting-IP which nginx forwards as
// X-Forwarded-For. (Blocker #7 INFRA-7.1.)
app.set('trust proxy', 1);

// HTTP Parameter Pollution protection
app.use(hpp());

// Structured request logging (JSON output with request ID correlation)
app.use(requestLoggerMiddleware);

// CDN cache headers for static assets & security headers
app.use(securityHeadersMiddleware);
app.use(staticCacheMiddleware);

// Global rate limiter: 200 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  validate: { ip: false }, // custom key (CF-Connecting-IP) — skip the built-in req.ip validator
  keyGenerator: clientIp, // real client IP behind Cloudflare, not the collapsed upstream hop
  message: { success: false, error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/status' || req.path === '/health';
  },
});
app.use('/api/', globalLimiter);

// Strict rate limiter for auth endpoints: 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: clientIp, // per-client (else one collapsed bucket = platform-wide login lockout)
  message: { success: false, error: 'Too many authentication attempts, please try again later.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/register-with-handle', authLimiter);
// Account-recovery + verification endpoints send email and mutate credentials —
// same strict, client-IP-keyed limiter as login/register (never the collapsed proxy hop).
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/verify-email', authLimiter);
app.use('/api/auth/resend-verification', authLimiter);

// Stricter rate limiter for AI generation endpoints: 30 requests per minute
const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: clientIp,
  message: { success: false, error: 'Generation rate limit exceeded. Please wait before trying again.' },
});
app.use('/api/chat/generate', generationLimiter);
app.use('/api/xeno/', generationLimiter);

// ── Retire legacy un-metered provider endpoints (Blocker #4b / LEAK-8) ─────────
// These raw OpenAI / FAL passthrough routes predate the metered /api/xeno/* and
// /api/chat/generate paths. They charge NO credits, apply NO entitlement gate, and
// return raw provider output (incl. clean URLs) — a live free-inference cost leak
// while OPENAI_API_KEY is set (FAL ones are inert only because VITE_FAL_KEY is unset).
// None are called by the frontend/services (verified by whole-repo grep). Disabled by
// default; set ENABLE_LEGACY_PROVIDER_ENDPOINTS=true only after re-wiring a given route
// through meterMediaGeneration + watermark.
const RETIRED_PROVIDER_PATHS = new Set([
  '/api/generate-image',
  '/api/openai/images/generations',
  '/api/openai/images/edits',
  '/api/openai/images/variations',
  '/api/openai/responses/create',
  '/api/ideogram-reframe',
  '/api/fal',
]);
app.use((req, res, next) => {
  if (process.env.ENABLE_LEGACY_PROVIDER_ENDPOINTS === 'true') return next();
  // Express routing is NON-strict (trailing slash optional) and CASE-INSENSITIVE, so an
  // exact case-sensitive Set.has(req.path) is bypassable with `/api/GENERATE-IMAGE` or
  // `/api/generate-image/` — which would still dispatch to the live un-metered handler.
  // Normalize the way Express matches (lowercase + strip trailing slashes) before testing.
  const p = req.path.replace(/\/+$/, '').toLowerCase() || '/';
  const retired = RETIRED_PROVIDER_PATHS.has(p)
    || p === '/api/fal'
    || p.startsWith('/api/fal/')
    || p.startsWith('/api/fal-direct');
  if (retired) {
    return res.status(410).json({
      error: 'This endpoint has been retired. Use the metered /api/xeno/images/* or /api/chat/generate endpoints.',
      code: 'ENDPOINT_RETIRED',
    });
  }
  next();
});

// CRITICAL FIX: Increase server limits for large image data
// This prevents 431 "Request Header Fields Too Large" errors when processing images
app.use((req, res, next) => {
  // Set timeout for large image processing requests
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000); // 5 minutes
  next();
});

// CORS: restrict to known origins in production
// CORS_ORIGINS (explicit CSV) still wins, byte-for-byte as before. Otherwise the
// list is derived from config/hosts.js: the canonical site origin + its www twin
// + anything in XENO_ALIAS_SITE_ORIGINS, plus the two dev origins. With no env
// set this is exactly the array that used to be hardcoded here.
//
// DUAL-HOMING: to accept a second domain, add it to XENO_ALIAS_SITE_ORIGINS —
// do NOT move XENO_SITE_ORIGIN. Widening this allowlist is additive and
// individually revertible; moving the canonical origin is not.
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : [...acceptedSiteOrigins(), 'http://localhost:5173', 'http://localhost:4040'];

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, desktop app, etc.)
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`[CORS] Blocked request from unlisted origin: ${origin}`);
          callback(new Error('CORS: origin not allowed'), false);
        }
      }
    : true, // Allow all origins in development
  maxAge: 86400, // 24 hours
  credentials: true
}));

// Cookie parser for tracking proxy context
app.use(cookieParser());

// IMPORTANT: Mount browser proxy routes BEFORE JSON body parser
// This allows browser proxy to handle raw POST bodies from proxied pages
// The browserRoutes handles its own body parsing
// SECURITY: databaseMiddleware + authMiddleware are REQUIRED — these routes drive
// docker exec / Browserless / server-side fetch and must never be anonymous.
app.use('/api/browser', databaseMiddleware, authMiddleware, express.raw({ type: '*/*', limit: '10mb' }), browserRoutes);
console.log('🌐 Browser routes integrated: /api/browser/* (mounted early for raw body handling)');

// Stripe billing webhook — MUST be mounted BEFORE express.json so the raw request
// body survives for signature verification (billingService.constructEvent).
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res, next) => { req.db = pool; next(); }, stripeWebhook);
console.log('💳 Billing webhook integrated: /api/billing/webhook (raw body, pre-json)');

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

// CLI authentication routes (mounted BEFORE /api/auth so the more-specific
// path always wins). Browser-OAuth + device-code flows for xeno-agent-cli.
// authMiddleware is applied inline only on /complete and /device-code/verify
// inside cliAuthRoutes.js — the other endpoints are public (the session_id
// IS the secret).
app.use('/api/auth/cli', databaseMiddleware, cliAuthRoutes);
console.log('🔐 CLI auth routes integrated: /api/auth/cli/*');

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

// Conversion routes — SECURITY: require auth at the mount (identity comes only from
// req.user, never from headers). uploadLimiter caps the file-upload endpoint.
app.use('/api/conversion/upload', uploadLimiter);
app.use('/api/conversion', databaseMiddleware, authMiddleware, conversionRoutes);

// Video Studio routes (with auth and database middleware)
app.use('/api/video', databaseMiddleware, authMiddleware, videoRoutes);
console.log('🎬 Video Studio routes integrated: /api/video/*');


// Xeno AI proxy routes (credit-tracked generation)
app.use('/api/xeno', databaseMiddleware, authMiddleware, xenoRoutes);
console.log('🎯 Xeno AI proxy routes integrated: /api/xeno/*');

// Marketplace routes (catalog, commerce, developer publishing, admin review).
// Auth is applied PER-ROUTE inside the router: catalog/listing reads use
// optionalAuthMiddleware (public, entitlement-aware), while commerce/developer/
// admin routes require authMiddleware. Mounting with only databaseMiddleware.
// Rate-limit the metered pay-per-use invoke surface (keyed per user, IP fallback).
app.use('/api/marketplace/invoke', llmLimiter);
app.use('/api/marketplace', databaseMiddleware, marketplaceRoutes);
app.use('/api/billing', databaseMiddleware, billingRoutes);
console.log('💳 Billing routes integrated: /api/billing/* (checkout, portal, config)');

// Account + dashboard read-aggregation surface (account UI / home dashboard).
// Pure reads over users + v2 ledger + plan + ReBAC workspaces. Auth per-route.
app.use('/api/account', databaseMiddleware, accountRoutes);
app.use('/api/dashboard', databaseMiddleware, dashboardRoutes);
console.log('👤 Account + dashboard routes integrated: /api/account/* + /api/dashboard/*');

// Workspaces / teams (multi-tenant): workspace entity tables + ReBAC membership
// (workspace:<id>#<role>@user:<id>). Standard authMiddleware — not OIDC-gated.
app.use('/api/workspaces', databaseMiddleware, authMiddleware, workspaceRoutes);
app.use('/api/workspace-invites', databaseMiddleware, authMiddleware, workspaceInviteRoutes);
console.log('🏢 Workspace routes integrated: /api/workspaces/* + /api/workspace-invites/*');

// ── Account & Ledger v2 (additive, flag-gated) ───────────────────────────────
// Mounted ONLY when LEDGER_V2_ENABLED=true, so the default (flag off) is a
// byte-for-byte no-op — the routes don't exist. This is the double-entry,
// idempotent, micro-credit spend surface the @xeno/account-client SDK calls.
// See 'XENO ACCOUNT - ARCHITECTURE.md' + database/migrate-account-v2.js.
if (process.env.LEDGER_V2_ENABLED === 'true') {
  // SERVICE-authenticated ledger surface for trusted backend services (e.g.
  // xeno-agents-api) acting ON BEHALF OF a user via a shared LEDGER_SERVICE_TOKEN.
  // Mounted with databaseMiddleware (req.db = pool) but WITHOUT oidcAuth/authMiddleware
  // — the router does its own constant-time bearer-token check and fails CLOSED when
  // LEDGER_SERVICE_TOKEN is unset. Registered BEFORE the user surface: Express matches
  // the full path, so the more-specific /api/v2/ledger/service never falls through to
  // (nor is shadowed by) the /api/v2/ledger user router below.
  app.use('/api/v2/ledger/service', databaseMiddleware, serviceLedgerRoutes);
  // oidcAuth accepts BOTH the new RS256 OIDC token and the legacy HS256 token.
  app.use('/api/v2/ledger', databaseMiddleware, oidcAuth, v2LedgerRoutes);
  console.log('💳 Ledger v2 routes integrated: /api/v2/ledger/* + /service/* (LEDGER_V2_ENABLED)');
}

// ── OIDC provider v2 (additive, flag-gated) ──────────────────────────────────
// Mounted ONLY when OIDC_ENABLED=true → default (flag off) is a no-op. The
// legacy HS256 /api/auth/* surface is UNTOUCHED (Identity Plan R2). New RS256 +
// JWKS surface for "Sign in with XENO" across the ecosystem.
if (process.env.OIDC_ENABLED === 'true') {
  // Mounted under /api/* because the edge only routes /api to the backend.
  app.use('/api/oauth2', databaseMiddleware, oauth2Routes);
  app.use('/api/v2/me', databaseMiddleware, oidcAuth, v2MeRoutes);
  app.use('/api/v2/authz', databaseMiddleware, oidcAuth, v2AuthzRoutes);
  // XENO handle registry (handle = login = identity = @xenostudio.ai address)
  app.use('/api/v2/handles', databaseMiddleware, oidcAuth, handleRoutes);
  app.get('/api/oauth2/.well-known/openid-configuration', (req, res) => res.json(oidcDiscovery()));
  console.log('🔐 OIDC provider integrated: /api/oauth2/* + /api/v2/me + /api/v2/authz (OIDC_ENABLED)');
}
console.log('🛒 Marketplace routes integrated: /api/marketplace/*');

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
  // Skip auth for init endpoint only (generate requires auth to prevent abuse)
  const publicPaths = ['/init'];
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

// AI Routes (for chat completion with multiple providers) - requires auth
app.use('/api/ai', databaseMiddleware, authMiddleware, llmLimiter, aiRoutes);

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
// Extension releases are public (handled by publicPaths in auth middleware)
// Rate-limit download starts (spawns yt-dlp — expensive).
app.use('/api/download/start', llmLimiter);
app.use('/api/download', databaseMiddleware, authMiddleware, downloadRoutes);
// Public, stable product download deep-links (PRODUCT-PAGES-SPEC.md §4).
// No auth / no DB — resolves the current installer from R2 and 302s to it.
app.use('/product', productDownloadRoutes);
console.log('⬇️ Product download deep-links: /product/:slug/download/:os');
app.use('/api/blog', databaseMiddleware, blogRoutes);
app.use('/api/learn', databaseMiddleware, learnRoutes);
// XENO Forum — the community Record. Public, cacheable reads only in v0.1
// (SPEC "XENO FORUM - SPEC.md" §9). No auth middleware: nothing here is
// personal, and /api/forum/feed (the only personal endpoint) is v0.4.
app.use('/api/forum', databaseMiddleware, forumRoutes);
// Agent identity — a PLATFORM primitive shared with Marketplace, Company and
// Comms (XENO FORUM - SPEC.md D8). Under /api/v2/* per the identity plan's
// rule that new surfaces sit beside the frozen legacy /api/auth/*.
app.use('/api/v2/agents', databaseMiddleware, agentRoutes);
console.log('⬇️ Download routes integrated: /api/download/*');

// Round 8: Infrastructure routes
// Health check routes (readiness, liveness, detailed health)
app.use('/api', databaseMiddleware, healthRoutes);
console.log('[Infra] Health check routes: /api/health, /api/ready, /api/live');

// Webhook management (requires auth)
app.use('/api/webhooks', databaseMiddleware, authMiddleware, webhookRoutes);
console.log('[Infra] Webhook routes: /api/webhooks/*');

// Analytics (event tracking + admin dashboard)
app.use('/api/analytics', databaseMiddleware, authMiddleware, analyticsRoutes);
console.log('[Infra] Analytics routes: /api/analytics/*');

// Background job management (admin only)
app.use('/api/jobs', databaseMiddleware, authMiddleware, jobRoutes);
console.log('[Infra] Job queue routes: /api/jobs/*');

// API documentation (Swagger UI + OpenAPI spec)
app.use('/api/docs', docsRoutes);
console.log('[Infra] API docs: /api/docs');

// API cache headers for all /api/ responses
app.use('/api/', apiCacheMiddleware);

console.log('✅ Custom routes integrated successfully');

// =============================================================================
// HEALTH & STATUS ENDPOINTS
// =============================================================================

// Basic status (for load balancers, uptime monitoring)
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running', timestamp: new Date().toISOString() });
});

// Detailed health check (for monitoring dashboards)
/*
 * ⚠ SHADOWED — THIS HANDLER NEVER RUNS.
 *
 * `/api/health` is served by src/server/routes/healthRoutes.js, whose router is
 * mounted earlier, so Express matches there and this block is unreachable. Proven
 * 2026-07-30: the live response contains `checks.redis` and `checks.r2_cdn` and an
 * `uptime` object, none of which exist here — and a field added here did not
 * appear in the response at all.
 *
 * Left in place rather than deleted because removing a route handler is a bigger
 * change than this note deserves, but do NOT add behaviour here expecting it to
 * take effect. The backup-freshness check that belongs on this endpoint lives in
 * healthRoutes.js for exactly this reason.
 */
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  };

  // Check database connectivity
  try {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    health.checks.database = { status: 'ok', responseTime: Date.now() - dbStart };
  } catch (err) {
    health.status = 'degraded';
    health.checks.database = { status: 'error', error: 'Database connection failed' };
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Health endpoint for Docker/Nginx (simple text response)
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// OpenRouter Models API - Fetch available models grouped by company
// Cache for models (refresh every 30 minutes)
let modelsCache = null;
let modelsCacheTimestamp = 0;
const MODELS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Reasoning-capable model detection — matches BOTH bare XENO-API ids ('gemini-3-flash',
// 'deepseek-v3.2', 'o3') and legacy 'company/model' (OpenRouter-style) ids, so the
// reasoning param is set correctly regardless of id shape.
function isReasoningCapableModel(id = '') {
  return /deepseek|qwen|grok-|gemini-2\.5|gemini-3|(^|\/)o[134](\b|-)|claude-(sonnet|opus|haiku)-4|claude-3\.7-sonnet/i.test(String(id));
}

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

app.get('/api/models', databaseMiddleware, authMiddleware, async (req, res) => {
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (modelsCache && (now - modelsCacheTimestamp) < MODELS_CACHE_DURATION) {
      console.log('📦 Returning cached models data');
      return res.json(modelsCache);
    }

    console.log('🔄 Fetching fresh models from the XENO API...');

    // The XENO API (api.xenostudio.ai) is the single key-holder + catalog source.
    // It returns bare ids ('gemini-3-flash', 'gpt-5.4', ...) grouped here by owned_by.
    const allModels = await xenoModelCatalog();

    console.log(`📊 Received ${allModels.length} total models from the XENO API`);

    // Chat picker shows ONLY the TEXT chat models actually available on the
    // endpoint (drop image/video/audio), and collapses pure reasoning-effort
    // variants (-high/-low/-medium/-none/-xhigh/-max) — the same model at a
    // different effort (handled by the reasoning toggle), not distinct models.
    const EFFORT_SUFFIX = /-(high|low|medium|none|xhigh|max)$/;
    const textModels = allModels.filter(m =>
      String(m.type || 'text').toLowerCase() === 'text' && !EFFORT_SUFFIX.test(String(m.id))
    );
    console.log(`📊 ${textModels.length} text chat models after filtering (of ${allModels.length})`);

    // Group by provider (owned_by) → { CompanyName: Model[] }, newest first.
    const byProvider = {};
    for (const m of textModels) {
      const prov = String(m.owned_by || 'xeno').toLowerCase();
      (byProvider[prov] = byProvider[prov] || []).push(m);
    }

    const groupedModels = {};
    for (const [prov, models] of Object.entries(byProvider)) {
      const companyName = PROVIDER_LABELS[prov] || (prov.charAt(0).toUpperCase() + prov.slice(1));
      models.sort((a, b) => (b.created || 0) - (a.created || 0));
      const latestModels = models.slice(0, 40).map(model => {
        const id = String(model.id).toLowerCase();

        let supportsReasoning = 'disabled';
        if (/deepseek|gemini-3|gemini-2\.5|grok-3|grok-4|claude-(sonnet|opus|haiku)-4|(^|\/)o[134]\b|thinking|-r1\b/.test(id)) {
          supportsReasoning = 'toggleable';
        }
        const supportsVision = /gemini|gpt-5|gpt-4o|claude|pixtral|vision|llama-4|grok-4/.test(id);

        return {
          id: model.id,
          name: model.name || prettyModelName(model.id),
          maxTokens: model.context_length || model.max_tokens || 128000,
          created: model.created,
          description: model.description || '',
          pricing: model.pricing,
          inputModalities: supportsVision ? ['text', 'image'] : ['text'],
          outputModalities: ['text'],
          supportsReasoning,
          supportsVision,
          supportsFileUpload: supportsVision,
          paths: ['premium', 'byok'],
          defaultPath: 'premium',
        };
      });
      if (latestModels.length > 0) groupedModels[companyName] = latestModels;
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
      error: 'Failed to fetch models'
    });
  }
});

// Test database connection (restricted in production)
app.get('/api/test-db', async (req, res) => {
  // SECURITY: Disable in production to prevent information disclosure
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({
      success: true,
      message: 'Database connection successful',
      time: result.rows[0].current_time
    });
  } catch (error) {
    console.error('Database test error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Database connection failed'
    });
  }
});

// NOTE: /api/auth/* is served by authRoutes.js (mounted on '/api/auth' above). The former
// inline init/register/login/validate handlers here were dead (shadowed by that mount) and
// used a divergent token model (opaque sessions + direct credit grants); removed to
// eliminate the latent auth-flip risk if the mount order ever changed.

// File upload endpoint with validation
const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'text/plain', 'application/json',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4',
]);
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB

app.post('/api/upload', databaseMiddleware, authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // SECURITY: Validate file type
  if (!ALLOWED_UPLOAD_MIMES.has(req.file.mimetype)) {
    // Remove the uploaded file
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: `File type '${req.file.mimetype}' is not allowed` });
  }

  // SECURITY: Validate file size
  if (req.file.size > MAX_UPLOAD_SIZE) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'File exceeds maximum size of 100MB' });
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
      message: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR'
      // SECURITY: Do not expose err.message to clients
    });
  }
  next();
});

// --- Chat Generation Route (Refactored for OpenRouter) ---
app.post('/api/chat/generate', databaseMiddleware, authMiddleware, async (req, res) => {
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
        let imgUserId, imgCost = 0, imgCharged = false, imgEnt = null;
        // Deterministic per-request id: the debit uses `imggen:<id>` as its ledger
        // transactionId and every refund path uses `imggen-refund:<id>` — so retries
        // dedupe and a double-refund is impossible. Assigned a real implementation
        // right after the debit succeeds; a no-op before that.
        const imgRequestId = randomUUID();
        let refundImgCharge = async () => {};
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

            // Entitlement gate + metering: charge before generating, refund on any failure below.
            imgUserId = req.user?.id;
            imgEnt = await resolveEntitlements(req.db, imgUserId);
            imgCost = getCreditCost('image', 'gpt-high');
            const imgDebit = await deductCredits(req.db, imgUserId, imgCost, {
                transactionId: `imggen:${imgRequestId}`,
                surface: 'chat',
                operation: 'image-generation',
                model: 'gpt-image-1',
            });
            if (!imgDebit.success) {
                return res.status(402).json({ error: 'Insufficient credits', required: imgCost, current: imgDebit.currentCredits ?? 0 });
            }
            imgCharged = true;
            refundImgCharge = async () => {
                const refundRef = `imggen-refund:${imgRequestId}`;
                try {
                    const r = await refundCredits(req.db, imgUserId, imgCost, {
                        transactionId: refundRef,
                        operation: 'image-generation',
                    });
                    if (!r?.success) {
                        console.error(`[imggen] refund FAILED user=${imgUserId} ref=${refundRef}:`, r?.error || 'unknown');
                    }
                } catch (refundErr) {
                    console.error(`[imggen] refund ERROR user=${imgUserId} ref=${refundRef}:`, refundErr.message);
                }
            };

            console.log(`Extracted image prompt (truncated): "${imagePrompt.substring(0, 50)}${imagePrompt.length > 50 ? '... [image prompt truncated for logging]' : ''}"`);

            // XENO gateway: ZERO direct third-party AI calls. Image generation flows through
            // the gateway's OpenAI-compatible /v1/images/generations (same client as
            // /api/xeno/images/*). Credits are already metered LOCALLY above (deductCredits);
            // XENO_API_KEY is credit-exempt on the gateway, so there is NO double charge.
            // The gateway does NOT expose /v1/responses, so the old conversational chaining
            // (previousResponseId / image_generation_call ids) becomes independent generations
            // — EXCEPT the combination path, which carries real image bytes and is routed
            // through /v1/images/edits for continuity.
            if (!xenoImageClient) {
                console.error('XENO_API_KEY is missing — image gateway is not configured.');
                if (imgCharged) await refundImgCharge();
                return res.status(500).json({ error: 'Server configuration error: image gateway is not configured.' });
            }

            // Extract just the base64 payload from a gateway image item ({ b64_json } | { url }).
            const itemToBase64 = async (item) => {
                if (!item) return null;
                if (item.b64_json) return item.b64_json;
                if (item.base64) return item.base64;
                if (typeof item.url === 'string') {
                    if (item.url.startsWith('data:')) return item.url.split(',')[1] || null;
                    if (item.url.startsWith('http')) {
                        try {
                            const r = await fetch(item.url);
                            if (!r.ok) return null;
                            return Buffer.from(await r.arrayBuffer()).toString('base64');
                        } catch { return null; }
                    }
                }
                return null;
            };

            // Finish an image response: watermark Free output FAIL-CLOSED (a watermark failure
            // refunds + errors rather than leaking a clean, commercial-usable image to Free),
            // log usage, and return the frontend's exact response shape.
            const finishImage = async (rawB64, modelLabel, respId, callId) => {
                let outImageData = rawB64;
                if (imgEnt?.watermark) {
                    try {
                        outImageData = (await watermarkBuffer(Buffer.from(rawB64, 'base64'))).toString('base64');
                    } catch (wmErr) {
                        console.error('[watermark] image task failed (fail-closed, refunding):', wmErr.message);
                        if (imgCharged) await refundImgCharge();
                        return res.status(500).json({ error: 'Image generation failed. Please try again.' });
                    }
                }
                await logCreditUsage(req.db, imgUserId, 'image:gpt-image-1', imgCost, { route: '/api/chat/generate:image' }).catch(() => {});
                return res.json({
                    imageData: outImageData,
                    modelIdUsed: modelLabel,
                    responseId: respId,               // opaque token — preserves the ImageStudio contract
                    imageGenerationCallId: callId,    // opaque token — preserves the ImageStudio contract
                    entitlement: gateMeta(imgEnt),
                });
            };

            // Multi-context combination carrying real image bytes → route through gateway edit
            // (combine by editing the PRIMARY image, describing the rest in the prompt — the same
            // strategy the old Responses path used, now on the gateway).
            const { combinationImages } = req.body;
            const hasCombinationImages = Array.isArray(combinationImages) && combinationImages.length > 0;
            const hasEditedImages = hasCombinationImages
                && combinationImages.some(img => img.isLatestVersion && img.imageData);

            if (hasEditedImages) {
                console.log('🎨 Combination with real image bytes — routing through gateway image edit');
                const sortedImages = [...combinationImages]
                    .filter(img => img.isLatestVersion && img.imageData)
                    .sort((a, b) => String(a.contextId).localeCompare(String(b.contextId)));
                const primaryImage = sortedImages[0];
                const secondaryImages = sortedImages.slice(1);
                const combinationPrompt = `${imagePrompt}. Primary scene: ${primaryImage.description}. Add to this scene: ${secondaryImages.map(img => img.description).join(', ')}.`;

                let primaryImageData = primaryImage.imageData;
                if (typeof primaryImageData === 'string' && primaryImageData.startsWith('data:image/')) {
                    const base64Match = primaryImageData.match(/data:image\/[^;]+;base64,(.+)/);
                    if (base64Match && base64Match[1]) primaryImageData = base64Match[1];
                }

                const editResponse = await xenoImageClient.image.edit({
                    model: 'nano_banana', // gateway conversational image-edit model
                    image: primaryImageData, // base64 — xeno-ai sends `image` as a JSON field, not multipart
                    prompt: combinationPrompt,
                    n: 1,
                    response_format: 'b64_json',
                });
                const comboB64 = await itemToBase64(editResponse?.data?.[0]);
                if (!comboB64) {
                    if (imgCharged) await refundImgCharge();
                    return res.status(500).json({ error: 'Image combination failed to return data.' });
                }
                return await finishImage(comboB64, 'gpt-image-1-edit', `combination_${Date.now()}`, `combination_${Date.now()}`);
            }

            // An edited-image context must carry its bytes via the edit_image task (the frontend
            // already switches to it). Refund + 400 here (the pre-gateway code 400'd WITHOUT a
            // refund — a latent charge-and-give-nothing bug, fixed).
            if (previousImageGenerationCallId && String(previousImageGenerationCallId).startsWith('edited_img_')) {
                if (imgCharged) await refundImgCharge();
                return res.status(400).json({
                    error: 'Edited image context requires image data. Please use edit_image task instead.',
                    requiresImageData: true,
                    contextType: 'edited_image'
                });
            }

            // Plain generation — fresh, or a conversational follow-up degraded to an independent
            // generation (the gateway has no /v1/responses chaining; the frontend does not resend
            // image bytes on a plain follow-up, so continuity there is not recoverable server-side).
            console.log('Calling XENO gateway /v1/images/generations for conversational image generation...');
            const genResponse = await xenoImageClient.image.generate({
                model: 'imagen4', // gateway default image-gen model
                prompt: imagePrompt,
                width: 1024,
                height: 1024,
                n: 1,
                response_format: 'b64_json',
            });
            const genB64 = await itemToBase64(genResponse?.data?.[0]);
            if (!genB64) {
                console.error('No image data returned from gateway:', genResponse);
                if (imgCharged) await refundImgCharge();
                return res.status(500).json({ error: 'Image generation failed: No image data returned.' });
            }
            return await finishImage(genB64, 'gpt-image-1', `xeno_resp_${randomUUID()}`, `xeno_imgcall_${randomUUID()}`);

        } catch (error) {
            if (imgCharged) await refundImgCharge();
            console.error('Error in conversational image generation task:', error);
            return res.status(500).json({ error: 'Failed to generate image. Please try again.' });
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
            if (!xenoApiConfigured()) {
                return res.status(503).json({ error: 'Premium inference unavailable', message: 'The inference service is not configured.' });
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

            // Route prompt refinement through the XENO API, metered on the user's credits.
            let data = {};
            try {
                const metered = await meterPremiumChat(req.db, req.user?.id, {
                    model: selectedModelId, provider: 'xeno', requestId: randomUUID(),
                    estInputTokens: estimateMessageTokens(apiMessages), maxTokens: 1024,
                    run: () => xenoChatCompletion({ model: selectedModelId, messages: apiMessages }),
                });
                data = metered.result;
            } catch (err) {
                if (err.http === 402) return res.status(402).json({ error: 'Insufficient credits', message: 'Top up credits to use premium models.' });
                if (err.http === 403) return res.status(403).json({ error: 'Account frozen' });
                console.error('Error calling XENO API for prompt refinement:', err.message);
                return res.status(err.status || 500).json({ error: `Failed to refine prompt: ${err.message}` });
            }
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
            return res.status(500).json({ error: 'Failed to refine prompt. Please try again.' });
        }
    }
    // <<< END: Prompt Refinement Task Handling >>>

    // <<< ADDED: Image Edit Task Handling >>>
    else if (req.body.task === 'edit_image') {
        console.log('Handling image edit task with XENO gateway Image Edits API');
        try {
            let { imageData, prompt, model = 'nano_banana', mask, background, outputFormat = 'png', quality = 'auto', size = 'auto' } = req.body;
            // The gateway image models are flux-*; reject stale OpenAI ids the frontend may still send.
            if (!model || model === 'auto' || model === 'gpt-image-1' || String(model).startsWith('dall-e') || String(model).startsWith('flux')) model = 'nano_banana';

            if (!imageData || !prompt) {
                return res.status(400).json({ error: 'Invalid request: imageData and prompt are required for image editing.' });
            }

            if (!xenoImageClient) {
                console.error('XENO_API_KEY is missing — image gateway is not configured.');
                return res.status(500).json({ error: 'Server configuration error: image gateway is not configured.' });
            }

            // Convert base64 image data to buffer for the gateway edit API
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

            // Create a temporary file for the image with correct extension.
            // Name it with a per-request random token (NOT Date.now(), which collides for
            // two concurrent edits in the same ms → one request would read the other's source
            // image and return an edit of it, a cross-user content bleed).
            const editTempToken = randomUUID();
            const tempImagePath = path.join(uploadsDir, `temp-edit-${editTempToken}.${fileExtension}`);
            fs.writeFileSync(tempImagePath, imageBuffer);
            
            // Verify the file was created correctly
            const fileStats = fs.statSync(tempImagePath);
            console.log('🎨 Temporary file created:', tempImagePath);
            console.log('🎨 File size:', fileStats.size, 'bytes');

            console.log('🎨 Calling XENO gateway Image Edits API...');
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
                
                tempMaskPath = path.join(uploadsDir, `temp-mask-${editTempToken}.${maskExtension}`);
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

            // Entitlement gate + metering (Blocker #4b / LEAK-8f): this OpenAI edit path was
            // previously ungated, uncharged, and un-watermarked. Now: resolve the plan, reserve
            // the edit cost via the hold→settle meter, run the provider inside run(), watermark
            // Free output before settle (a watermark failure voids the hold → no charge, no leak),
            // and settle. Temp files are cleaned in both the success and failure paths.
            const editUserId = req.user?.id;
            if (!editUserId) {
                try { fs.unlinkSync(tempImagePath); } catch {}
                try { if (tempMaskPath && fs.existsSync(tempMaskPath)) fs.unlinkSync(tempMaskPath); } catch {}
                return res.status(401).json({ error: 'Not authenticated' });
            }
            const editEnt = await resolveEntitlements(req.db, editUserId);
            // Idempotency key. Prefer a client-supplied id (updated clients send a per-action
            // requestId, reused verbatim on retry). If ABSENT, do NOT mint a fresh random id —
            // that gives every retry / double-click a new hold and double-charges. Instead
            // derive a DETERMINISTIC key from the edit's content + a coarse 5-min bucket, so a
            // retry of the same edit reuses the hold (meterMediaGeneration → 409, charged once);
            // a deliberate re-run after the bucket rolls gets a fresh key. (Blocker #4b review.)
            const editIdemBucket = Math.floor(Date.now() / 300000);
            const editContentKey = createHash('sha256')
                .update([editUserId, model, prompt, mask || '', imageData, editIdemBucket].join('\n'))
                .digest('hex').slice(0, 48);
            const editReqId = req.body.requestId || req.headers['x-request-id'] || `edit:${editContentKey}`;
            const editUnitCost = getCreditCost('edit', model);
            const cleanupEditTemps = () => {
                try { fs.unlinkSync(tempImagePath); } catch {}
                try { if (tempMaskPath && fs.existsSync(tempMaskPath)) fs.unlinkSync(tempMaskPath); } catch {}
            };

            let meteredEdit;
            try {
                meteredEdit = await meterMediaGeneration(req.db, editUserId, {
                    surface: 'image_edit', operation: 'chat.edit_image', model, provider: 'xeno',
                    requestId: editReqId, unitCostMicro: editUnitCost * MICRO_PER_CREDIT, count: 1,
                    run: async () => {
                        // xeno-ai SDK: `image`/`mask` are base64/URL JSON fields (NOT multipart).
                        const response = await xenoImageClient.image.edit({
                            image: imageData,
                            prompt,
                            model,
                            mask: mask || undefined,
                            response_format: 'b64_json',
                        });
                        cleanupEditTemps();
                        const item0 = response?.data?.[0];
                        if (!item0) {
                            throw new Error('Image editing failed: no image data returned');
                        }
                        let edited = item0.b64_json || item0.base64 || null;
                        if (!edited && typeof item0.url === 'string') {
                            if (item0.url.startsWith('data:')) edited = item0.url.split(',')[1] || null;
                            else if (item0.url.startsWith('http')) {
                                const rr = await fetch(item0.url);
                                if (rr.ok) edited = Buffer.from(await rr.arrayBuffer()).toString('base64');
                            }
                        }
                        if (!edited) {
                            throw new Error('Image editing failed: no image data returned');
                        }
                        // Free tier: watermark the edited image (self-contained base64).
                        if (editEnt.watermark && typeof edited === 'string' && edited) {
                            edited = (await watermarkBuffer(Buffer.from(edited, 'base64'))).toString('base64');
                        }
                        return { data: [{ b64_json: edited }] };
                    },
                });
            } catch (err) {
                cleanupEditTemps();
                if (err?.http === 402) return res.status(402).json({ error: 'Insufficient credits', message: 'Top up credits to edit images.' });
                if (err?.http === 403) return res.status(403).json({ error: 'Account frozen' });
                if (err?.http === 409) return res.status(409).json({ error: 'Duplicate request — use a new requestId', code: 'DUPLICATE_REQUEST' });
                console.error('Error in image edit task:', err);
                return res.status(err?.status || 500).json({ error: 'Failed to edit image. Please try again.', credits_refunded: true });
            }

            return res.json({
                imageData: meteredEdit.result.data[0].b64_json,
                modelIdUsed: model,
                editType: 'image_edit',
                prompt: prompt,
                credits_used: meteredEdit.creditsCharged,
                entitlement: gateMeta(editEnt),
            });

        } catch (error) {
            console.error('Error in image edit task:', error);
            return res.status(500).json({ error: 'Failed to edit image. Please try again.' });
        }
    }
    // <<< END: Image Edit Task Handling >>>

    // <<< Retired direct-provider tasks (SAM2 segmentation + IC-Light relight/background) >>>
    // These branches called https://queue.fal.run directly (with VITE_FAL_KEY). The platform
    // makes ZERO direct third-party AI calls, so they are removed. They return a clean 501
    // until/unless a replacement is wired through the metered XENO gateway.
    else if (['segment_image', 'auto_segment_image', 'iclight_relight', 'iclight_background'].includes(req.body.task)) {
        console.log(`[retired] Direct-FAL task '${req.body.task}' is unavailable (no direct third-party calls).`);
        return res.status(501).json({
            error: 'This feature is currently unavailable.',
            code: 'FEATURE_UNAVAILABLE',
            task: req.body.task,
        });
    }
    // <<< END retired direct-provider tasks >>>

    console.log(`Received request on /api/chat/generate for OpenRouter model: ${req.body.selectedModelId}`);

    try {
        // <<< RECEIVE effectiveReasoningState >>>
        const { messages, systemPrompt, selectedModelId, effectiveReasoningState } = req.body; 

        // Basic validation
        if (messages === undefined || !Array.isArray(messages) || selectedModelId === undefined || effectiveReasoningState === undefined) {
            console.error('Invalid request payload:', req.body);
            return res.status(400).json({ error: 'Invalid request: messages array, selectedModelId, and effectiveReasoningState are required.' });
        }
        if (!XENO_API_KEY) {
             return res.status(503).json({ error: 'Premium inference unavailable', message: 'The inference service is not configured.' });
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
            const usesNativeReasoningField = isReasoningCapableModel(selectedModelId);

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
            const modelNeedsReasoning = reasoningModels.includes(selectedModelId) || isReasoningCapableModel(selectedModelId);

            if (modelNeedsReasoning) {
                // OpenRouter expects reasoning to be an object, not a boolean
                bodyPayload.reasoning = {
                    effort: "high" // Can be "high", "medium", or "low"
                };
                console.log(`   -> Added reasoning: {effort: "high"} parameter for model ${selectedModelId}`);
            }
        }
        bodyPayload.model = normalizeXenoModelId(bodyPayload.model);

        // 4. Make the call — routed through the XENO API and METERED on the user's
        //    credits (hold worst-case → run → settle actual / void on failure).
        console.log(`Calling XENO API with model: ${bodyPayload.model}`);

        let data = {};
        try {
            // Pooled workspace billing (Phase 4, flag-gated): when enabled and the
            // request carries an x-xeno-workspace context whose workspace is in
            // 'pooled' mode and the caller is a member, bill the workspace wallet
            // instead of the personal one. Default (flag off) → bill the user.
            let billingSubjectId = req.user?.id;
            if (process.env.WORKSPACE_BILLING_ENABLED === 'true' && req.headers['x-xeno-workspace']) {
                try { billingSubjectId = (await resolveBillingAccountId(req.db, req.user.id, String(req.headers['x-xeno-workspace']))).id; }
                catch (e) { console.warn('[billing] workspace resolve failed, using personal:', e.message); }
            }
            const metered = await meterPremiumChat(req.db, billingSubjectId, {
                model: bodyPayload.model, provider: 'xeno', requestId: randomUUID(),
                estInputTokens: estimateMessageTokens(bodyPayload.messages || []),
                maxTokens: bodyPayload.max_tokens || 4096,
                run: async () => {
                    const response = await fetch(`${XENO_API_BASE}/chat/completions`, {
                        method: "POST",
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XENO_API_KEY}` },
                        body: JSON.stringify(bodyPayload),
                    });
                    const responseBody = await response.text();
                    if (!response.ok) {
                        let errorData = {};
                        try { errorData = JSON.parse(responseBody); } catch (e) { errorData = { error: { message: `API request failed with status ${response.status}.` } }; }
                        const e = new Error(errorData.error?.message || `XENO API Error: Status ${response.status}`);
                        e.status = response.status;
                        throw e;
                    }
                    return JSON.parse(responseBody);
                },
            });
            data = metered.result;
        } catch (err) {
            if (err.http === 402) return res.status(402).json({ error: 'Insufficient credits', message: 'Top up credits to use premium models.' });
            if (err.http === 403) return res.status(403).json({ error: 'Account frozen' });
            console.error('Error calling XENO API:', err.message);
            return res.status(err.status || 500).json({ error: `${err.message}`.trim() });
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
            const modelProvidesSeparateReasoning = isReasoningCapableModel(selectedModelId);
                
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
        const errorResponsePayload = { error: 'Failed to generate chat response. Please try again.' };
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
app.post('/api/xeno-search', databaseMiddleware, authMiddleware, async (req, res) => {
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

    const response = await postJsonToService(pythonServiceUrl, pythonServicePayload, {
      timeoutMs: 60000, // 60 seconds timeout
    });

    if (!response.ok) {
      // The service responded with a non-2xx status (axios error.response equivalent)
      console.error('[Node.js Backend] Python Service Error Data:', response.data);
      console.error('[Node.js Backend] Python Service Error Status:', response.status);
      return res.status(response.status || 500).json({
        error: 'Search service error',
      });
    }

    console.log('[Node.js Backend] Successfully received response from Python service.');
    res.json(response.data);

  } catch (error) {
    console.error('[Node.js Backend] Error calling Python service:', error.message);
    if (error.isNoResponse) {
      // No response was received — network failure or timeout (axios error.request equivalent)
      console.error('[Node.js Backend] No response received from Python service.');
      res.status(503).json({ error: 'Search service unavailable' });
    } else {
      // Unexpected error setting up / processing the request
      console.error('[Node.js Backend] Internal error contacting Python service:', error.message);
      res.status(500).json({ error: 'Internal server error while contacting Xeno Search service.' });
    }
  }
});

/**
 * API Endpoint: /api/v2/engine/dynamic-search
 * Dynamic real-time search using Xeno Search Engine
 * Crawls authoritative sites on-demand based on query topics
 */
app.post('/api/v2/engine/dynamic-search', databaseMiddleware, authMiddleware, async (req, res) => {
  const { query, max_pages = 10, index_results = true } = req.body;

  const pythonServiceUrl = process.env.NODE_ENV === 'production'
    ? 'http://xeno-search-service:8000/api/v2/engine/dynamic-search'
    : 'http://localhost:8000/api/v2/engine/dynamic-search';

  if (!query) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  console.log(`[Dynamic Search] Query='${query}', MaxPages=${max_pages}`);

  try {
    const response = await postJsonToService(pythonServiceUrl, {
      query,
      max_pages: parseInt(max_pages, 10) || 10,
      index_results: Boolean(index_results)
    }, {
      timeoutMs: 120000, // 2 minutes timeout for dynamic crawling
    });

    if (!response.ok) {
      return res.status(response.status || 500).json({
        error: 'Dynamic search service error',
      });
    }

    console.log(`[Dynamic Search] Found ${response.data?.total_results || 0} results`);
    res.json(response.data);

  } catch (error) {
    console.error('[Dynamic Search] Error:', error.message);
    if (error.isNoResponse) {
      res.status(503).json({ error: 'Dynamic Search service unreachable.' });
    } else {
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

// API endpoint to fetch metadata from a URL
app.post('/api/fetch-metadata', databaseMiddleware, authMiddleware, async (req, res) => {
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
      error: 'Failed to process metadata'
    });
  }
});

// WebSocket for real-time image streaming (simplified implementation)
app.get('/api/openai/stream/setup', databaseMiddleware, authMiddleware, (req, res) => {
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
app.get('/api/piston/runtimes', databaseMiddleware, authMiddleware, async (req, res) => {
  try {
    console.log('Fetching runtimes from XenoRun...');
    const response = await fetch(`${XENORUN_URL}/api/v1/runtimes`);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`XenoRun runtimes unavailable (${response.status}): ${errorText}`);
      // Degrade gracefully: no runtimes → the UI disables code execution, no client-facing error.
      return res.json([]);
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
    // XenoRun not deployed / unreachable → degrade gracefully so the chat loads without a
    // console 500; an empty runtimes list disables code execution in the UI. (Was: 500.)
    console.warn('XenoRun runtimes unavailable:', error.message);
    res.json([]);
  }
});

// Execute code via XenoRun
app.post('/api/piston/execute', databaseMiddleware, authMiddleware, async (req, res) => {
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
    // XenoRun not deployed / unreachable → clear, retryable status instead of a generic 500.
    console.warn('XenoRun execute unavailable:', error.message);
    res.status(503).json({ error: 'Code execution is temporarily unavailable.' });
  }
});

// --- End XenoRun Code Execution API Routes ---

// LaTeX to PDF compilation using local TeX Live service
// Full TeX Live installation - supports ALL LaTeX packages and features
app.post('/api/latex/compile', databaseMiddleware, authMiddleware, async (req, res) => {
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
      error: 'Failed to compile LaTeX'
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
      error: 'Service unavailable'
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
    // SECURITY: pin the algorithm so a forged token can't dictate its own verification.
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
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
      message: 'File operation failed'
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
// SECURITY: Restrict to safe base directories to prevent path traversal
const SAFE_WATCH_BASES = ['/app/uploads', '/app/storage', '/app/conversions'];

app.post('/api/files/watch', databaseMiddleware, authMiddleware, (req, res) => {
  const { directories, action } = req.body;

  if (!Array.isArray(directories)) {
    return res.status(400).json({ error: 'Directories must be an array' });
  }

  // SECURITY: Validate all directories are within allowed base paths
  const resolvedDirs = directories.map(d => path.resolve(d));
  const unsafeDirs = resolvedDirs.filter(d =>
    !SAFE_WATCH_BASES.some(base => d.startsWith(base))
  );
  if (unsafeDirs.length > 0) {
    return res.status(403).json({ error: 'Cannot watch directories outside allowed paths' });
  }

  try {
    if (action === 'add') {
      resolvedDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
          watcher.add(dir);
        }
      });
      res.json({ success: true, message: `Added ${directories.length} directories to watch` });
    } else if (action === 'remove') {
      resolvedDirs.forEach(dir => {
        watcher.unwatch(dir);
      });
      res.json({ success: true, message: `Removed ${directories.length} directories from watch` });
    } else {
      res.status(400).json({ error: 'Action must be "add" or "remove"' });
    }
  } catch (error) {
    console.error('Watch operation error:', error.message);
    res.status(500).json({ error: 'Watch operation failed' });
  }
});

// API endpoint to get watched directories
app.get('/api/files/watched', databaseMiddleware, authMiddleware, (req, res) => {
  const watchedPaths = watcher.getWatched();
  const directories = Object.keys(watchedPaths);
  res.json({ directories });
});

// =============================================================================
// GLOBAL ERROR HANDLER (must be last middleware)
// =============================================================================
app.use((err, req, res, next) => {
  // Log the full error server-side
  console.error('[Global Error Handler]', err.stack || err.message || err);

  // SECURITY: Never expose internal error details to clients in production
  const isDev = process.env.NODE_ENV !== 'production';

  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'Request payload too large',
      ...(isDev && { details: err.message })
    });
  }

  if (err.status === 431) {
    return res.status(431).json({
      success: false,
      error: 'Request header fields too large'
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error: isDev ? err.message : 'Internal server error'
  });
});

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed.');

    // Close database pool
    try {
      await pool.end();
      console.log('Database pool closed.');
    } catch (err) {
      console.error('Error closing database pool:', err.message);
    }

    process.exit(0);
  });

  // Force exit after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[UncaughtException]', error);
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

// Initialize cleanup service for old conversions
initCleanupService();

// Readiness gate: /api/ready reports not-ready (503) until every startup migration
// has succeeded, so a load balancer never routes traffic to a half-migrated schema.
app.locals.migrationsReady = false;

/**
 * Run ALL startup migrations, in order, AWAITED and fail-closed. The account/ledger
 * v2 surface (money-idempotency index, hash-chain columns + append-only trigger,
 * holds/grants/spend_caps, OIDC tables) is additive + idempotent but was previously
 * only applied by a hand-run CLI — it's now folded in here so a fresh box is never
 * silently missing the objects the ledger/auth code assumes. seedMarketplace is
 * best-effort (not schema-critical), so its failure does not block readiness.
 */
async function runStartupMigrations() {
  await runMigrations(pool);       // legacy schema files (youtube/office-canvas)
  await runAllMigrations(pool);    // versioned *.sql runner (rethrows on first failure)
  await migrateAccountV2(pool);    // account/ledger v2 (additive, idempotent) — creates oauth_clients
  await migrateOidcClients(pool);  // OIDC first-party clients + loopback column (additive, idempotent)
  await seedMarketplace(pool).catch(err => console.error('[Seed] marketplace warning (non-fatal):', err.message));
  // The Forum needs its SPACES to exist before anything works — with no spaces a
  // deploy yields an empty page and every post fails with "unknown space".
  // Idempotent and insert-only (keyed on a deterministic short_id), so re-running
  // on every boot updates the seeded rows and touches nothing a user created.
  await seedForum(pool).catch(err => console.error('[Seed] forum warning (non-fatal):', err.message));
}

runStartupMigrations()
  .then(() => {
    app.locals.migrationsReady = true;
    console.log('✅ Database migrations complete — readiness gate open');
    // Phantom-hold sweeper: void expired credit_holds every 15 min so stranded holds do
    // not linger in state='held' (the available-balance math already ignores expired holds,
    // but this keeps the table bounded and the state truthful). (Blocker #7 INFRA-7.3.)
    const sweepHolds = () => sweepExpiredHolds(pool)
      .then((n) => { if (n) console.log(`[HoldSweeper] voided ${n} expired hold(s)`); })
      .catch((e) => console.error('[HoldSweeper] error:', e.message));
    setInterval(sweepHolds, 15 * 60 * 1000).unref();
    sweepHolds();
  })
  .catch(err => {
    // FAIL CLOSED: a broken/half-applied schema must not serve traffic. Exit non-zero
    // so the orchestrator restarts (and /api/ready stays 503 in the meantime).
    console.error('FATAL: startup migrations failed — refusing to serve traffic:', err);
    process.exit(1);
  });

// Initialize background job queues
initBackgroundJobs(pool).catch(err => {
  console.error('[BackgroundJobs] Init warning:', err.message);
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
