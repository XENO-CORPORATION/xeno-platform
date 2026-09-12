/**
 * Structured Logging Middleware
 *
 * JSON-formatted request/response logging with:
 * - Request ID correlation (X-Request-ID header)
 * - Performance timing (response duration)
 * - Log levels (info, warn, error, debug)
 * - Structured JSON output for log aggregation
 */

import { v4 as uuidv4 } from 'uuid';

// --------------------------------------------------------------------------
// Logger utility — lightweight structured logger (Pino-like JSON output)
// --------------------------------------------------------------------------
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;

class StructuredLogger {
  constructor(context = {}) {
    this.context = context;
  }

  child(extra) {
    return new StructuredLogger({ ...this.context, ...extra });
  }

  _log(level, message, data = {}) {
    if (LOG_LEVELS[level] < CURRENT_LEVEL) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };

    // Remove undefined values
    for (const key of Object.keys(entry)) {
      if (entry[key] === undefined) delete entry[key];
    }

    const line = JSON.stringify(entry);

    switch (level) {
      case 'error':
        process.stderr.write(line + '\n');
        break;
      case 'warn':
        process.stderr.write(line + '\n');
        break;
      default:
        process.stdout.write(line + '\n');
    }
  }

  debug(msg, data) { this._log('debug', msg, data); }
  info(msg, data) { this._log('info', msg, data); }
  warn(msg, data) { this._log('warn', msg, data); }
  error(msg, data) { this._log('error', msg, data); }
}

export const logger = new StructuredLogger({ service: 'xenostudio-backend' });

// --------------------------------------------------------------------------
// Request logging middleware
// --------------------------------------------------------------------------

// Paths to skip logging (noisy health checks)
const SKIP_LOG_PATHS = new Set(['/health', '/api/status']);

// Paths with sensitive bodies (don't log request body)
const SENSITIVE_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/reset-password'];

export function requestLoggerMiddleware(req, res, next) {
  // Skip noisy paths
  if (SKIP_LOG_PATHS.has(req.path)) return next();

  // Assign request ID (use existing or generate)
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const startTime = process.hrtime.bigint();
  const startMs = Date.now();

  // Create child logger with request context
  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent']?.substring(0, 120),
  });

  // Log incoming request
  const isSensitive = SENSITIVE_PATHS.some(p => req.path.startsWith(p));
  req.log.info('request_start', {
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    contentLength: req.headers['content-length'],
    userId: req.user?.id,
  });

  // Capture response finish
  const originalEnd = res.end;
  res.end = function (...args) {
    const durationNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(durationNs / 1_000_000n);

    const logData = {
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.getHeader('content-length'),
      userId: req.user?.id,
    };

    if (res.statusCode >= 500) {
      req.log.error('request_error', logData);
    } else if (res.statusCode >= 400) {
      req.log.warn('request_client_error', logData);
    } else {
      req.log.info('request_complete', logData);
    }

    originalEnd.apply(res, args);
  };

  next();
}

// --------------------------------------------------------------------------
// Error logging helper
// --------------------------------------------------------------------------
export function logError(error, context = {}) {
  logger.error('unhandled_error', {
    error: error.message,
    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    code: error.code,
    ...context,
  });
}

export default { logger, requestLoggerMiddleware, logError };
