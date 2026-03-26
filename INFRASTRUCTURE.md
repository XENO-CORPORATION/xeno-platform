# Infrastructure

XENO Platform runs on a single server (`xeno-platform-001`) using Docker Compose with 10 active services on a bridge network (`xenostudio-network`, subnet `172.20.0.0/16`).

## Architecture

```
Internet
  │
  ├── xenostudio.ai:443 (HTTPS)
  │     │
  │     └── Nginx (host) ──► xenostudio-frontend:80 (port 4040)
  │                               │
  │                               └── /api/* ──► xenostudio-backend:8080
  │                                                │
  │                                                ├── xenostudio-postgres:5432
  │                                                ├── xenostudio-redis:6379
  │                                                ├── xenostudio-browserless:3000
  │                                                ├── xenostudio-xeno-browser:6901
  │                                                ├── xenostudio-xenorun:3000
  │                                                ├── xenostudio-latex:3001
  │                                                ├── xenostudio-meilisearch:7700
  │                                                └── xenostudio-xeno-search:8000
  │
  ├── api.xenostudio.ai:443 ──► xeno-private-api-001 (separate server)
  ├── updates.xenostudio.ai ──► Cloudflare R2 (static CDN)
  └── stdb.xenostudio.ai ──► K3s on xeno-platform-001
```

## Services

### xenostudio-frontend

- **Image:** `xeno-platform-frontend` (custom, built from `Dockerfile.frontend`)
- **Port:** `127.0.0.1:4040 -> 80`
- **Purpose:** Nginx serving the React SPA build output and static product pages. Handles client-side routing (SPA fallback) and proxies `/api` requests to the backend container.
- **Volumes:** None (static files baked into image during build)
- **Health check:** Verifies `index.html` exists, `/health` returns 200, `/api/status` is reachable
- **Dependencies:** backend (healthy)

### xenostudio-backend

- **Image:** `xeno-platform-backend` (custom, built from `Dockerfile.backend`)
- **Port:** `127.0.0.1:8080 -> 8080`
- **Purpose:** Express.js API server. Handles all `/api/*` routes including auth, chat, image/video/audio generation, file management, YouTube analytics, collaboration, and more. Also manages WebSocket connections for real-time features.
- **Volumes:**
  - `./src/server/uploads` -- user file uploads
  - `./src/server/storage` -- persistent storage
  - `./conversions` -- file conversion output
  - `/var/run/docker.sock` -- Docker socket (for container provisioning)
  - `./storage/videos`, `./storage/thumbnails`, `./storage/assets` -- video studio media
- **Resource limits:** 4 CPUs, 4 GB RAM
- **Dependencies:** postgres (healthy), redis (started)
- **Key env vars:** DATABASE_URL, REDIS_URL, JWT_SECRET, OPENAI_API_KEY, OPENROUTER_API_KEY, Google/GitHub/Twitter OAuth credentials

### xenostudio-postgres

- **Image:** `postgres:15-alpine`
- **Port:** `192.168.2.225:5433 -> 5432`
- **Purpose:** Primary PostgreSQL database. 56 tables covering users, auth, billing, chat, image/video projects, YouTube analytics, office canvases, blog, tutorials, containers, jobs, webhooks, and analytics.
- **Volumes:** `postgres_data` (named volume)
- **Resource limits:** 2 CPUs, 2 GB RAM
- **Database:** `xenostudio` (user: `postgres`)
- **Note:** Port is bound to the LAN IP (192.168.2.225) on port 5433, not localhost.

### xenostudio-redis

- **Image:** `redis:7-alpine`
- **Port:** `127.0.0.1:6380 -> 6379`
- **Purpose:** Caching layer and session store. Configured with 512 MB max memory, allkeys-LRU eviction, and AOF persistence.
- **Volumes:** `redis_data` (named volume)
- **Resource limits:** 1 CPU, 1 GB RAM
- **Auth:** Password protected

### xenostudio-xeno-search

- **Image:** `xeno-platform-xeno-search` (custom, built from `../xeno-search-service/Dockerfile`)
- **Port:** `127.0.0.1:8000 -> 8000`
- **Purpose:** Python/FastAPI service for AI-powered web search and content analysis. Uses Meilisearch for indexing. Called by the backend for search-related features.
- **Runtime:** uvicorn with 1 worker
- **Resource limits:** 2 CPUs, 4 GB RAM
- **Dependencies:** meilisearch, redis

### xenostudio-xenorun

- **Image:** `xeno-platform-xenorun` (custom, built from `../xenorun/Dockerfile`)
- **Port:** `127.0.0.1:3002 -> 3000`
- **Purpose:** Sandboxed code execution engine. Creates ephemeral Docker containers for running user code in multiple languages (Node.js, Python, Go, Rust, Java). Used by the AI workspace for code execution.
- **Volumes:** `/var/run/docker.sock` -- needs Docker socket to create child containers
- **Health check:** `wget` to `/api/v1/health`

### xenostudio-latex

- **Image:** `xeno-platform-latex` (custom, built from `Dockerfile.latex`)
- **Port:** `127.0.0.1:3001 -> 3001`
- **Purpose:** LaTeX compilation service with full TeX Live installation. Accepts LaTeX source and returns compiled PDF. Used for document rendering in the office canvas and export features.
- **Health check:** `curl` to `/health`

### xenostudio-meilisearch

- **Image:** `getmeili/meilisearch:v1.6`
- **Port:** `127.0.0.1:7700 -> 7700`
- **Purpose:** Fast full-text search engine. Indexes content for the Xeno Search service. Configured in production mode with analytics disabled.
- **Volumes:** `meilisearch_data` (named volume)
- **Auth:** Master key protected

### xenostudio-browserless

- **Image:** `ghcr.io/browserless/chromium:latest`
- **Port:** `127.0.0.1:3003 -> 3000`
- **Purpose:** Headless Chromium API for programmatic browser automation. Used by the backend for web scraping, screenshots, content extraction, and AI-driven browser actions. Supports 5 concurrent sessions with a queue of 10.
- **Auth:** Token-based (`TOKEN` env var)
- **Timeout:** 120 seconds per session

### xenostudio-xeno-browser

- **Image:** `kasmweb/chrome:1.16.0`
- **Port:** `127.0.0.1:6901 -> 6901` (also exposes 4901/tcp and 5901/tcp)
- **Purpose:** Full Chrome browser accessible via KasmVNC. Provides an embedded browser experience within the web app, allowing users to browse the web inside the XENO workspace.
- **Shared memory:** 1 GB
- **Resolution:** 1920x1080, 24-bit color

## Networking

All services communicate over the `xenostudio-network` Docker bridge network (subnet `172.20.0.0/16`). Services reference each other by Docker Compose service name (e.g., the backend connects to `postgres:5432`, `redis:6379`, `browserless:3000`).

Only the frontend (port 4040) is exposed to the host Nginx reverse proxy. All other ports are bound to `127.0.0.1` except PostgreSQL which is bound to `192.168.2.225` (LAN access).

## Host Nginx

The host-level Nginx handles:
- TLS termination (Let's Encrypt / Cloudflare)
- Reverse proxy: `xenostudio.ai:443` -> `127.0.0.1:4040`
- WebSocket upgrade for real-time features

## External Services

| Service | URL | Purpose |
|---------|-----|---------|
| api.xenostudio.ai | Separate server (`xeno-private-api-001`) | LLM proxy, credit deduction, pricing, web search for desktop apps |
| updates.xenostudio.ai | Cloudflare R2 | App installer hosting and version.json for auto-updates |
| stdb.xenostudio.ai | K3s on same server | SpacetimeDB for real-time data |

## Named Volumes

| Volume | Used By | Purpose |
|--------|---------|---------|
| `postgres_data` | xenostudio-postgres | Database files |
| `redis_data` | xenostudio-redis | Redis AOF persistence |
| `meilisearch_data` | xenostudio-meilisearch | Search index data |
| `xeno_search_cache` | xenostudio-xeno-search | Search result cache |
| `xeno_search_logs` | xenostudio-xeno-search | Service logs |

## Commented-Out Services

The `docker-compose.yml` contains these services that are defined but not active:

- **xenostudio-proxy** (port 4001) -- External API proxy. No Dockerfile.
- **xenostudio-cors-proxy** (port 4002) -- CORS proxy for Topaz Labs API. No Dockerfile.
- **xenostudio-websocket** (port 4003) -- Dedicated WebSocket gateway. No Dockerfile (WebSocket is handled inline in the backend).
- **xenostudio-storage** (port 8082) -- Dedicated file storage service. No Dockerfile (file storage is handled by the backend).

## Deployment Commands

```bash
# SSH into server
ssh xeno-platform-001

# View running containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# View logs
docker logs xenostudio-backend --tail 100 -f
docker logs xenostudio-frontend --tail 100 -f

# Restart a single service
docker-compose restart backend

# Full rebuild and deploy
cd ~/xeno-platform && docker-compose up -d --build

# Deploy a single static file without rebuild
cat "public/path/file.html" | ssh xeno-platform-001 \
  "docker exec -i xenostudio-frontend sh -c 'cat > /usr/share/nginx/html/path/file.html'"

# Database access
docker exec -it xenostudio-postgres psql -U postgres -d xenostudio

# Redis access
docker exec -it xenostudio-redis redis-cli -a <password>
```

## Resource Allocation Summary

| Service | CPU Limit | RAM Limit | CPU Reserved | RAM Reserved |
|---------|-----------|-----------|-------------|-------------|
| backend | 4.0 | 4 GB | 1.0 | 1 GB |
| postgres | 2.0 | 2 GB | 0.5 | 512 MB |
| redis | 1.0 | 1 GB | 0.25 | 256 MB |
| xeno-search | 2.0 | 4 GB | 0.5 | 1 GB |
| Total | 9.0 | 11 GB | 2.25 | 2.75 GB |

Other services (frontend, xenorun, latex, meilisearch, browserless, xeno-browser) have no explicit resource limits.
