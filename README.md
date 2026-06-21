# XENO Platform

The web backend and frontend powering **xenostudio.ai** -- the public-facing website, authentication system, AI workspace, and product pages for the XENO Corporation ecosystem.

## Overview

XENO Platform is a full-stack application (Express + React 18) deployed via Docker Compose on `xeno-platform-001`. It serves:

- **xenostudio.ai** -- the marketing website, product pages, download pages, and blog
- **xenostudio.ai/app** -- the AI workspace (chat, image generation, video editing, file conversion, YouTube analytics, office canvas, and more)
- **xenostudio.ai/api** -- the REST API consumed by the web frontend, XENO Hub, and desktop apps

A separate server (`xeno-private-api-001`) hosts **api.xenostudio.ai**, the private API proxy for LLM inference, credit deduction, pricing, and web search used by desktop apps.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Radix UI, Socket.IO |
| Backend | Node.js, Express, ES Modules |
| Database | PostgreSQL 15 (56 tables) |
| Cache | Redis 7 (sessions, rate limiting, LRU cache) |
| Search | Meilisearch v1.6 (content indexing for Xeno Search) |
| Code Execution | XenoRun (sandboxed Docker container execution) |
| Browser Automation | Browserless (headless Chromium), KasmVNC Chrome |
| Document Rendering | LaTeX service (full TeX Live) |
| Auth | JWT (access + refresh tokens), OAuth 2.0 (Google, GitHub, Twitter/X) |
| Infrastructure | Docker Compose (10 services), Nginx reverse proxy, Cloudflare |

## Docker Services

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `xenostudio-backend` | `xeno-platform-backend` (custom) | 127.0.0.1:8080 | Express API server |
| `xenostudio-frontend` | `xeno-platform-frontend` (custom) | 127.0.0.1:4040 | Nginx serving React SPA + static product pages |
| `xenostudio-postgres` | `postgres:15-alpine` | 192.168.2.225:5433 | PostgreSQL database |
| `xenostudio-redis` | `redis:7-alpine` | 127.0.0.1:6380 | Redis cache and sessions |
| `xenostudio-xeno-search` | `xeno-platform-xeno-search` (custom) | 127.0.0.1:8000 | Python/FastAPI AI-powered search service |
| `xenostudio-xenorun` | `xeno-platform-xenorun` (custom) | 127.0.0.1:3002 | Sandboxed code execution engine |
| `xenostudio-latex` | `xeno-platform-latex` (custom) | 127.0.0.1:3001 | LaTeX compilation (full TeX Live) |
| `xenostudio-meilisearch` | `getmeili/meilisearch:v1.6` | 127.0.0.1:7700 | Full-text search index |
| `xenostudio-browserless` | `ghcr.io/browserless/chromium` | 127.0.0.1:3003 | Headless Chrome for AI browser automation |
| `xenostudio-xeno-browser` | `kasmweb/chrome:1.16.0` | 127.0.0.1:6901 | KasmVNC Chrome for embedded browsing |

See `INFRASTRUCTURE.md` for full details on each service.

## API Routes

All routes are mounted under `/api/`. See `API_REFERENCE.md` for every endpoint.

| Prefix | Route File | Auth | Description |
|--------|-----------|------|-------------|
| `/api/auth` | authRoutes.js | Mixed | Registration, login, OAuth, profile, credits, linked accounts |
| `/api/chat` | chatRoutes.js | JWT | Conversations, messages, personas, sharing, sync |
| `/api/image` | imageRoutes.js | Mixed | Image generation (Replicate, Xeno Flow), projects, assets, sessions |
| `/api/video` | videoRoutes.js | JWT | Video projects, assets, rendering, export, sessions |
| `/api/ai` | aiRoutes.js | JWT | AI chat completions, model catalog |
| `/api/xeno` | xenoRoutes.js | JWT | Unified generation API plus env-gated CLI remote runs |
| `/api/youtube` | youtubeRoutes.js | Mixed | YouTube channel management, analytics, videos, groups |
| `/api/filesystem` | fileSystemRoutes.js | Mixed | Cloud file storage, folders, upload, search, history |
| `/api/conversion` | conversionRoutes.js | Optional | File format conversion (batch, HTML-to-DOCX, etc.) |
| `/api/browser` | browserRoutes.js | None | Web proxy, screenshots, content extraction, web search |
| `/api/collaboration` | collaborationRoutes.js | JWT | Real-time collaboration sessions, invitations, cursors |
| `/api/office-canvas` | officeCanvasRoutes.js | DB | Document canvases, sharing, collaborators |
| `/api/user-data` | userDataRoutes.js | JWT | User settings, files, usage tracking |
| `/api/download` | downloadRoutes.js | JWT | File downloads, extension releases, cookie management |
| `/api/blog` | blogRoutes.js | DB | Blog posts and categories |
| `/api/learn` | learnRoutes.js | DB | Tutorials and learning content |
| `/api/tokenize` | tokenizerRoutes.js | None | Token counting for LLM messages |
| `/api/webhooks` | webhookRoutes.js | JWT | Webhook management and delivery logs |
| `/api/analytics` | analyticsRoutes.js | JWT | Event tracking, admin dashboards, usage reports |
| `/api/jobs` | jobRoutes.js | Admin | Background job management (stats, cancel, retry, cleanup) |
| `/api/docs` | docsRoutes.js | None | OpenAPI spec and API documentation UI |
| `/api/fal` | Inline proxy | None | Proxy to fal.ai API |
| `/api/` | healthRoutes.js | None | Health checks (/live, /ready, /health) |

**Note:** `accountRoutes.js`, `creditsRoutes.js`, and `terminalRoutes.js` exist as route files but are not currently mounted in the server. They contain prepared endpoints for future billing/workspace management and terminal container features.

## Database

PostgreSQL 15 with 56 tables. Key table groups:

- **Auth and Users** -- `users`, `user_sessions`, `oauth_accounts`, `external_identity_links`, `email_verifications`, `password_resets`, `security_events`
- **Billing and Credits** -- `credit_accounts`, `credit_transactions`, `credit_usage`, `pricing_tiers`, `billing_workspaces`, `billing_workspace_members`, `billing_workspace_invites`, `billing_workspace_events`, `billing_subscriptions`, `billing_payment_method_snapshots`, `billing_projects`, `billing_project_policies`
- **Chat** -- `chat_conversations`, `chat_messages`, `chat_personas`, `chat_shared_conversations`, `chat_share_acceptances`
- **Image Studio** -- `image_projects`, `image_project_sessions`, `image_assets`, `image_generations`
- **YouTube** -- `youtube_channels`, `youtube_oauth_states`, `youtube_analytics_cache`, `youtube_videos_cache`, `youtube_daily_snapshots`, `youtube_channel_groups`, `youtube_channel_group_members`, `youtube_channel_languages`
- **Office** -- `office_canvases`, `office_canvas_collaborators`
- **Content** -- `blog_posts`, `tutorials`
- **Infrastructure** -- `containers`, `api_jobs`, `background_jobs`, `api_keys`, `external_api_keys`, `api_usage_logs`, `webhooks`, `webhook_deliveries`, `analytics_events`, `analytics_daily_stats`, `rate_limits`, `user_files`, `user_settings`, `user_usage`, `email_logs`, `schema_migrations`

## Project Structure

```
xeno-platform/
├── src/
│   ├── server/
│   │   ├── index.js                ← Express server entry point (~5000 lines)
│   │   ├── routes/                 ← 22 route files
│   │   │   ├── authRoutes.js       ← Auth, OAuth, profile, credits
│   │   │   ├── chatRoutes.js       ← Conversations, messages, personas
│   │   │   ├── imageRoutes.js      ← Image generation and projects
│   │   │   ├── videoRoutes.js      ← Video projects and rendering
│   │   │   ├── aiRoutes.js         ← AI chat completions
│   │   │   ├── xenoRoutes.js       ← Unified generation (image/video/audio)
│   │   │   ├── youtubeRoutes.js    ← YouTube analytics and management
│   │   │   ├── fileSystemRoutes.js ← Cloud file storage
│   │   │   ├── conversionRoutes.js ← File format conversion
│   │   │   ├── browserRoutes.js    ← Web proxy and automation
│   │   │   ├── collaborationRoutes.js
│   │   │   ├── officeCanvasRoutes.js
│   │   │   ├── userDataRoutes.js
│   │   │   ├── downloadRoutes.js
│   │   │   ├── blogRoutes.js
│   │   │   ├── learnRoutes.js
│   │   │   ├── tokenizerRoutes.js
│   │   │   ├── webhookRoutes.js
│   │   │   ├── analyticsRoutes.js
│   │   │   ├── jobRoutes.js
│   │   │   ├── docsRoutes.js
│   │   │   └── healthRoutes.js
│   │   ├── middleware/
│   │   │   ├── auth.js             ← JWT verification
│   │   │   ├── database.js         ← PostgreSQL pool injection
│   │   │   ├── rateLimiter.js      ← Rate limiting
│   │   │   ├── requestLogger.js    ← Request logging
│   │   │   └── cdnOptimization.js  ← Static asset caching
│   │   ├── containerIntegration.js ← Docker container provisioning
│   │   ├── latex-service.js        ← LaTeX compilation client
│   │   └── uploads/                ← User file uploads
│   ├── components/                 ← React components (65,000+ lines)
│   ├── pages/                      ← Page-level React components
│   ├── services/                   ← Frontend API service layers
│   └── types/                      ← TypeScript type definitions
├── public/
│   ├── products/                   ← Static product pages (Pixel, Motion, Sound, Hub, Agent CLI, Lib)
│   │   ├── index.html              ← All products grid
│   │   ├── pixel/                  ← Product page, release notes, download
│   │   ├── motion/
│   │   ├── sound/
│   │   ├── hub/
│   │   ├── agent-cli/
│   │   └── lib/
│   └── download/                   ← Unified download page
├── docker-compose.yml              ← 10 services
├── Dockerfile.backend
├── Dockerfile.frontend
├── Dockerfile.latex
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── API_REFERENCE.md                ← Full API endpoint documentation
├── INFRASTRUCTURE.md               ← Docker services and deployment details
└── CLAUDE.md                       ← Agent instructions
```

## Development

```bash
# Install dependencies
npm install
cd src/server && npm install

# Run locally (frontend + backend)
npm run dev

# Build frontend
npm run build

# Production (Docker)
docker-compose up -d --build
```

## Deployment

The platform runs on `xeno-platform-001` via Docker Compose. Nginx on the host reverse-proxies port 443 (HTTPS) to the frontend container on port 4040, which proxies `/api` requests to the backend on port 8080.

### Deploy a single file change

```bash
cat "public/path/file.html" | ssh xeno-platform-001 \
  "docker exec -i xenostudio-frontend sh -c 'cat > /usr/share/nginx/html/path/file.html'"
```

### Full rebuild

```bash
ssh xeno-platform-001 "cd ~/xeno-platform && docker-compose up -d --build"
```

## Access Points

| URL | Purpose |
|-----|---------|
| https://xenostudio.ai | Production website |
| https://xenostudio.ai/api/health | Health check |
| https://api.xenostudio.ai | Private API proxy (separate server) |
| https://updates.xenostudio.ai | Cloudflare R2 CDN (app releases) |
| https://stdb.xenostudio.ai | SpacetimeDB (K3s) |

## License

Proprietary software. All rights reserved.
