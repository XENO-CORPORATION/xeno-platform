/**
 * API Documentation Routes
 *
 * Serves OpenAPI 3.1 specification and a built-in API explorer.
 * Available at /api/docs and /api/docs/openapi.json
 */

import { Router } from 'express';

const router = Router();

// --------------------------------------------------------------------------
// OpenAPI 3.1 Specification
// --------------------------------------------------------------------------
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'XENO Platform API',
    version: '1.0.0',
    description: 'The API powering xenostudio.ai — authentication, AI generation, credit management, file handling, and more.',
    contact: {
      name: 'XENO Corporation',
      url: 'https://xenostudio.ai',
      email: 'support@xenostudio.ai',
    },
    license: {
      name: 'Proprietary',
    },
  },
  servers: [
    { url: 'https://xenostudio.ai/api', description: 'Production' },
    { url: 'http://localhost:8080/api', description: 'Local development' },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication & user management' },
    { name: 'Credits', description: 'Credit balance & transactions' },
    { name: 'AI Generation', description: 'AI-powered content generation (LLM, image, video, audio)' },
    { name: 'Chat', description: 'Chat completions via OpenRouter' },
    { name: 'Webhooks', description: 'Webhook registration & delivery' },
    { name: 'Analytics', description: 'Usage analytics & admin dashboard' },
    { name: 'Health', description: 'Health checks & system status' },
    { name: 'Files', description: 'File upload & management' },
    { name: 'Download', description: 'App download & version info' },
    { name: 'Background Jobs', description: 'Job queue management' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Session token from login/register response',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'Something went wrong' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          email: { type: 'string', format: 'email' },
          display_name: { type: 'string' },
          credits: { type: 'integer' },
          email_verified: { type: 'boolean' },
          is_active: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Webhook: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          is_active: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      HealthCheck: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
          timestamp: { type: 'string', format: 'date-time' },
          uptime: { type: 'object' },
          memory: { type: 'object' },
          checks: { type: 'object' },
        },
      },
    },
  },
  paths: {
    // --- Auth ---
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password', 'display_name'],
                properties: {
                  username: { type: 'string', minLength: 3, maxLength: 30 },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  display_name: { type: 'string', minLength: 1, maxLength: 100 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Registration successful', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, user: { $ref: '#/components/schemas/User' }, token: { type: 'string' } } } } } },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Login successful' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/validate': {
      get: {
        tags: ['Auth'],
        summary: 'Validate session token',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Token is valid' },
          '401': { description: 'Token invalid or expired' },
        },
      },
    },

    // --- Health ---
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Detailed health check with dependency status',
        responses: {
          '200': { description: 'All systems healthy', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } } } },
          '503': { description: 'One or more dependencies degraded' },
        },
      },
    },
    '/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe (are dependencies available?)',
        responses: { '200': { description: 'Ready' }, '503': { description: 'Not ready' } },
      },
    },
    '/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe (is the process alive?)',
        responses: { '200': { description: 'Alive' } },
      },
    },
    '/status': {
      get: {
        tags: ['Health'],
        summary: 'Simple status check',
        responses: { '200': { description: 'Server is running' } },
      },
    },

    // --- Xeno AI Generation ---
    '/xeno/image': {
      post: {
        tags: ['AI Generation'],
        summary: 'Generate an image (deducts credits)',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, model: { type: 'string', default: 'auto' }, width: { type: 'integer' }, height: { type: 'integer' } } } } } },
        responses: { '200': { description: 'Image generated' }, '402': { description: 'Insufficient credits' }, '401': { description: 'Not authenticated' } },
      },
    },

    // --- Webhooks ---
    '/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List your registered webhooks',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'List of webhooks', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, webhooks: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } } } } } } } },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Register a new webhook',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url', 'events'], properties: { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string', enum: ['new_version', 'build_complete', 'credits_low', 'user_signup', 'generation_complete'] } } } } } } },
        responses: { '201': { description: 'Webhook created (includes secret — save it)' } },
      },
    },
    '/webhooks/{id}': {
      put: {
        tags: ['Webhooks'],
        summary: 'Update a webhook',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Webhook updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete a webhook',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Webhook deleted' }, '404': { description: 'Not found' } },
      },
    },

    // --- Analytics ---
    '/analytics/event': {
      post: {
        tags: ['Analytics'],
        summary: 'Track an analytics event',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['event_type'], properties: { event_type: { type: 'string' }, properties: { type: 'object' }, session_id: { type: 'string' } } } } } },
        responses: { '200': { description: 'Event tracked' } },
      },
    },
    '/analytics/dashboard': {
      get: {
        tags: ['Analytics'],
        summary: 'Admin dashboard overview stats',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Dashboard data' }, '403': { description: 'Admin access required' } },
      },
    },
    '/analytics/downloads': {
      get: {
        tags: ['Analytics'],
        summary: 'Download counts per app',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
        responses: { '200': { description: 'Download statistics' } },
      },
    },
    '/analytics/active-users': {
      get: {
        tags: ['Analytics'],
        summary: 'Active users (DAU trend)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
        responses: { '200': { description: 'Active user data' } },
      },
    },
    '/analytics/credit-usage': {
      get: {
        tags: ['Analytics'],
        summary: 'Credit usage breakdown by feature',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Credit usage data' } },
      },
    },
    '/analytics/my-usage': {
      get: {
        tags: ['Analytics'],
        summary: 'Your personal usage stats',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Personal usage data' } },
      },
    },

    // --- Models ---
    '/models': {
      get: {
        tags: ['AI Generation'],
        summary: 'List available AI models (grouped by company)',
        responses: { '200': { description: 'Grouped model list' } },
      },
    },

    // --- Chat ---
    '/chat/generate': {
      post: {
        tags: ['Chat'],
        summary: 'Generate a chat completion via OpenRouter',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['messages'], properties: { messages: { type: 'array' }, model: { type: 'string' }, task: { type: 'string' } } } } } },
        responses: { '200': { description: 'Chat completion' } },
      },
    },

    // --- Upload ---
    '/upload': {
      post: {
        tags: ['Files'],
        summary: 'Upload a file',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } } } },
        responses: { '200': { description: 'File uploaded' }, '400': { description: 'Invalid file' } },
      },
    },

    // --- Background Jobs ---
    '/jobs/stats': {
      get: {
        tags: ['Background Jobs'],
        summary: 'Get queue statistics (admin)',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Queue stats' }, '403': { description: 'Admin only' } },
      },
    },
  },
};

// --------------------------------------------------------------------------
// Routes
// --------------------------------------------------------------------------

// Serve OpenAPI JSON spec
router.get('/openapi.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(openApiSpec);
});

// Serve Swagger UI (using CDN-hosted Swagger UI)
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>XENO Platform API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #08080a; }
    .swagger-ui { max-width: 1200px; margin: 0 auto; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: white; }
    .swagger-ui .info p, .swagger-ui .info li { color: rgba(255,255,255,0.7); }
    /* Dark theme overrides */
    .swagger-ui .opblock .opblock-summary { border-color: rgba(255,255,255,0.1); }
    .swagger-ui .btn { border-radius: 4px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`);
});

export { openApiSpec };
export default router;
