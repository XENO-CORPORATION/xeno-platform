# API Reference

All endpoints are mounted under `/api/` on the Express backend (port 8080, proxied through Nginx at xenostudio.ai).

**Auth legend:**
- **None** -- No authentication required
- **JWT** -- Requires `Authorization: Bearer <token>` header
- **Admin** -- Requires JWT + admin role
- **Optional** -- Works with or without auth (behavior differs)
- **DB** -- Requires database middleware only (no user auth)

---

## Auth (`/api/auth`) -- authRoutes.js

Authentication, registration, OAuth, profile management, and linked accounts.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/init` | None | Initialize auth system / DB schema |
| POST | `/auth/register` | None | Create account (email + password) |
| POST | `/auth/login` | None | Login with email + password, returns JWT |
| GET | `/auth/validate` | JWT | Validate current token |
| POST | `/auth/logout` | JWT | Invalidate session |
| POST | `/auth/migrate` | JWT | Migrate legacy account data |
| GET | `/auth/me` | JWT | Get current user profile |
| PUT | `/auth/profile` | JWT | Update display name, avatar, etc. |
| PUT | `/auth/password` | JWT | Change password |
| GET | `/auth/usage` | JWT | Get credit usage statistics |
| POST | `/auth/use-credits` | JWT | Deduct credits for an operation |
| DELETE | `/auth/account` | JWT | Delete user account |
| POST | `/auth/claim-bonus` | JWT | Claim sign-up bonus credits |
| GET | `/auth/google` | None | Initiate Google OAuth flow |
| GET | `/auth/google/callback` | None | Google OAuth callback |
| GET | `/auth/github` | None | Initiate GitHub OAuth flow |
| GET | `/auth/github/callback` | None | GitHub OAuth callback |
| GET | `/auth/twitter` | None | Initiate Twitter/X OAuth flow |
| GET | `/auth/twitter/callback` | None | Twitter/X OAuth callback |
| GET | `/auth/linked-accounts` | JWT | List linked OAuth providers |
| DELETE | `/auth/linked-accounts/:provider` | JWT | Unlink an OAuth provider |

---

## Chat (`/api/chat`) -- chatRoutes.js

Conversation management, messages, personas, and sharing.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/chat/init` | JWT | Initialize chat system for user |
| GET | `/chat/conversations` | JWT | List all conversations |
| GET | `/chat/conversations/:id` | JWT | Get single conversation with messages |
| POST | `/chat/conversations` | JWT | Create new conversation |
| PUT | `/chat/conversations/:id` | JWT | Update conversation title/settings |
| DELETE | `/chat/conversations/:id` | JWT | Delete conversation |
| POST | `/chat/conversations/:id/messages` | JWT | Add message to conversation |
| POST | `/chat/conversations/:id/messages/batch` | JWT | Add multiple messages at once |
| PUT | `/chat/messages/:id` | JWT | Edit a message |
| GET | `/chat/personas` | JWT | List custom personas |
| POST | `/chat/personas` | JWT | Create persona |
| PUT | `/chat/personas/:id` | JWT | Update persona |
| DELETE | `/chat/personas/:id` | JWT | Delete persona |
| POST | `/chat/personas/:id/use` | JWT | Set persona as active |
| POST | `/chat/conversations/:id/share` | JWT | Generate share link |
| GET | `/chat/share/:token` | None | View shared conversation |
| POST | `/chat/share/:token/accept` | JWT | Accept shared conversation into account |
| DELETE | `/chat/conversations/:id/share` | JWT | Revoke share link |
| GET | `/chat/conversations/:id/shares` | JWT | List active shares |
| POST | `/chat/sync` | JWT | Sync conversations (desktop app) |

---

## Image (`/api/image`) -- imageRoutes.js

Image generation, projects, assets, and sessions. Some routes are public (no auth).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/image/replicate/predictions` | JWT | Create Replicate prediction |
| POST | `/image/xeno-flow/generate` | JWT | Generate via Xeno Flow |
| GET | `/image/replicate/predictions/:predictionId` | JWT | Poll prediction status |
| POST | `/image/replicate/predictions/:predictionId/cancel` | JWT | Cancel prediction |
| POST | `/image/projects/create` | JWT | Create image project |
| GET | `/image/projects` | JWT | List projects |
| GET | `/image/projects/:projectId` | JWT | Get project details |
| PUT | `/image/projects/:projectId` | JWT | Update project |
| DELETE | `/image/projects/:projectId` | JWT | Delete project |
| POST | `/image/sessions/save` | JWT | Save editor session state |
| GET | `/image/sessions/:projectId` | JWT | Load session state |
| DELETE | `/image/sessions/:sessionId` | JWT | Delete session |
| POST | `/image/assets/create` | JWT | Upload asset to project |
| GET | `/image/assets/:projectId` | JWT | List project assets |
| DELETE | `/image/assets/:assetId` | JWT | Delete asset |
| POST | `/image/generations/init` | JWT | Initialize generation tracking |
| POST | `/image/generations` | JWT | Record generation result |
| GET | `/image/generations` | JWT | List generation history |
| PATCH | `/image/generations/:generationId/favorite` | JWT | Toggle favorite |
| DELETE | `/image/generations/:generationId` | JWT | Delete generation record |
| GET | `/image/health` | None | Image service health check |

---

## Video (`/api/video`) -- videoRoutes.js

Video project management, asset upload, rendering, and export.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/video/projects/create` | JWT | Create video project |
| GET | `/video/projects` | JWT | List video projects |
| GET | `/video/projects/:projectId` | JWT | Get project details |
| PUT | `/video/projects/:projectId` | JWT | Update project (timeline, settings) |
| DELETE | `/video/projects/:projectId` | JWT | Delete project |
| POST | `/video/assets/upload` | JWT | Upload media asset |
| GET | `/video/assets/:projectId` | JWT | List project assets |
| POST | `/video/render` | JWT | Start render job |
| GET | `/video/render/:jobId/status` | JWT | Check render progress |
| POST | `/video/render/:jobId/cancel` | JWT | Cancel render job |
| POST | `/video/export` | JWT | Export final video |
| POST | `/video/sessions/save` | JWT | Save editor session |
| GET | `/video/sessions/:projectId` | JWT | Load editor session |

---

## AI (`/api/ai`) -- aiRoutes.js

AI chat completions and model listing.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/ai/chat` | JWT | Send chat completion request |
| GET | `/ai/models` | JWT | List available AI models |
| GET | `/ai/local-model-catalog` | JWT | List local/GGUF model catalog |

---

## Xeno Unified Generation (`/api/xeno`) -- xenoRoutes.js

Unified API for image, video, audio, and CLI remote-readiness metadata.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/xeno/images/generate` | JWT | Generate images |
| POST | `/xeno/images/edit` | JWT | Edit/transform images |
| POST | `/xeno/videos/generate` | JWT | Generate videos |
| POST | `/xeno/audio/generate` | JWT | Generate audio |
| GET | `/xeno/remote/status` | JWT | CLI remote protocol status; currently advertises no hosted run capabilities |

---

## YouTube (`/api/youtube`) -- youtubeRoutes.js

YouTube channel management, analytics, and video tracking. Some routes are public.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/youtube/init` | JWT | Initialize YouTube module |
| GET | `/youtube/auth` | JWT | Start YouTube OAuth flow |
| GET | `/youtube/channels` | JWT | List connected channels |
| GET | `/youtube/channels/:id` | JWT | Get channel details |
| DELETE | `/youtube/channels/:id` | JWT | Disconnect channel |
| POST | `/youtube/channels/:id/reauthorize` | JWT | Refresh channel OAuth |
| POST | `/youtube/channels/:id/sync` | JWT | Sync channel data |
| GET | `/youtube/analytics/overview` | JWT | Cross-channel analytics overview |
| GET | `/youtube/analytics/overview/:channelId` | JWT | Single channel analytics |
| GET | `/youtube/analytics/videos/:channelId` | JWT | Video-level analytics |
| GET | `/youtube/analytics/demographics/:channelId` | JWT | Audience demographics |
| GET | `/youtube/analytics/traffic/:channelId` | JWT | Traffic source analytics |
| GET | `/youtube/analytics/daily/:channelId` | JWT | Daily stats time series |
| GET | `/youtube/videos/:channelId` | JWT | List channel videos |
| GET | `/youtube/video/:channelId/:videoId` | JWT | Get video details |
| GET | `/youtube/dashboard/:channelId` | JWT | Channel dashboard data |
| GET | `/youtube/realtime/:channelId` | JWT | Real-time stats |
| GET | `/youtube/comments/:channelId` | JWT | Recent comments |
| GET | `/youtube/groups` | JWT | List channel groups |
| POST | `/youtube/groups` | JWT | Create channel group |
| PUT | `/youtube/groups/:id` | JWT | Update group |
| DELETE | `/youtube/groups/:id` | JWT | Delete group |
| PUT | `/youtube/groups/reorder` | JWT | Reorder groups |
| POST | `/youtube/groups/:id/channels` | JWT | Add channel to group |
| DELETE | `/youtube/groups/:id/channels/:channelId` | JWT | Remove channel from group |
| PUT | `/youtube/groups/:id/channels/reorder` | JWT | Reorder channels in group |
| GET | `/youtube/channels/:id/groups` | JWT | Get groups for channel |
| GET | `/youtube/languages` | JWT | List available languages |
| GET | `/youtube/channels/:id/languages` | JWT | Get channel languages |
| POST | `/youtube/channels/:id/languages` | JWT | Set channel languages |
| DELETE | `/youtube/channels/:id/languages/:languageCode` | JWT | Remove language |
| POST | `/youtube/sync/all` | JWT | Sync all channels |
| GET | `/youtube/sync/status` | JWT | Check sync status |
| POST | `/youtube/cache/clear` | JWT | Clear analytics cache |
| GET | `/youtube/history/:channelId` | JWT | Historical data snapshots |
| POST | `/youtube/history/:channelId/snapshot` | JWT | Create manual snapshot |
| POST | `/youtube/history/sync-all` | JWT | Sync all historical data |

---

## File System (`/api/filesystem`) -- fileSystemRoutes.js

Cloud file storage with folders, upload, search, and version history.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/filesystem/` | Mixed | List files and folders |
| POST | `/filesystem/folders` | Mixed | Create folder |
| POST | `/filesystem/upload` | Mixed | Upload files (multipart) |
| GET | `/filesystem/:id` | Mixed | Get file metadata |
| PUT | `/filesystem/:id` | Mixed | Rename/move file |
| DELETE | `/filesystem/:id` | Mixed | Delete file |
| GET | `/filesystem/:id/download` | Mixed | Download file content |
| GET | `/filesystem/search` | Mixed | Search files by name |
| GET | `/filesystem/:id/history` | Mixed | File version history |

---

## Conversion (`/api/conversion`) -- conversionRoutes.js

File format conversion with batch processing support.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/conversion/upload` | Optional | Upload files for conversion |
| POST | `/conversion/convert` | Optional | Convert single file |
| POST | `/conversion/batch` | Optional | Batch convert multiple files |
| GET | `/conversion/status/:id` | Optional | Check conversion status |
| GET | `/conversion/download/:id` | Optional | Download converted file |
| GET | `/conversion/history` | Optional | Conversion history |
| GET | `/conversion/storage` | Optional | Storage usage stats |
| DELETE | `/conversion/:id` | Optional | Delete conversion |
| POST | `/conversion/html-to-docx` | None | Convert HTML to DOCX |
| GET | `/conversion/formats` | None | List supported formats |

---

## Browser (`/api/browser`) -- browserRoutes.js

Web proxy, content extraction, screenshots, and browser automation via Browserless.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/browser/proxy` | None | GET proxy for external URLs |
| POST | `/browser/proxy` | None | POST proxy for external URLs |
| GET | `/browser/status` | None | Browser service status |
| GET | `/browser/config` | None | Browser configuration |
| POST | `/browser/navigate` | None | Navigate headless browser |
| POST | `/browser/screenshot` | None | Take page screenshot |
| GET | `/browser/content` | None | Extract page content (Readability) |
| POST | `/browser/render` | None | Render page to HTML/PDF |
| POST | `/browser/action` | None | Execute browser action (click, type) |
| POST | `/browser/screenshot-url` | None | Screenshot a URL |
| POST | `/browser/extract` | None | Extract structured data from page |
| GET | `/browser/browserless-status` | None | Browserless container health |
| POST | `/browser/proxy/web-search` | None | Proxied web search |
| GET | `/browser/*` | None | Catch-all proxy |

---

## Collaboration (`/api/collaboration`) -- collaborationRoutes.js

Real-time collaboration sessions with invitations and cursor tracking.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/collaboration/sessions` | JWT | Create collaboration session |
| GET | `/collaboration/sessions/:sessionId` | JWT | Get session details |
| POST | `/collaboration/sessions/:token/join` | JWT | Join session via token |
| POST | `/collaboration/sessions/:sessionId/invite` | JWT | Invite user to session |
| POST | `/collaboration/invitations/:token/accept` | JWT | Accept invitation |
| POST | `/collaboration/sessions/:sessionId/leave` | JWT | Leave session |
| DELETE | `/collaboration/sessions/:sessionId` | JWT | Delete session |
| PATCH | `/collaboration/sessions/:sessionId/cursor` | JWT | Update cursor position |
| GET | `/collaboration/sessions/:sessionId/participants` | JWT | List participants |
| GET | `/collaboration/my-sessions` | JWT | List user sessions |
| POST | `/collaboration/sessions/:sessionId/activity` | JWT | Record activity |
| PATCH | `/collaboration/sessions/:sessionId/participants/:participantId/kick` | JWT | Kick participant |

---

## Office Canvas (`/api/office-canvas`) -- officeCanvasRoutes.js

Document canvas management with sharing and collaboration.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/office-canvas/canvases` | DB | List canvases |
| POST | `/office-canvas/canvases` | DB | Create canvas |
| GET | `/office-canvas/canvases/:canvasId` | DB | Get canvas |
| PUT | `/office-canvas/canvases/:canvasId` | DB | Update canvas content |
| DELETE | `/office-canvas/canvases/:canvasId` | DB | Delete canvas |
| POST | `/office-canvas/canvases/:canvasId/share` | DB | Enable sharing |
| POST | `/office-canvas/canvases/:canvasId/share/disable` | DB | Disable sharing |
| GET | `/office-canvas/canvases/:canvasId/collaborators` | DB | List collaborators |
| DELETE | `/office-canvas/canvases/:canvasId/collaborators/:collaboratorUserId` | DB | Remove collaborator |
| POST | `/office-canvas/join/:token` | DB | Join via share token |

---

## User Data (`/api/user-data`) -- userDataRoutes.js

User settings, file management, and usage tracking.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/user-data/init` | JWT | Initialize user data |
| GET | `/user-data/settings` | JWT | Get user settings |
| PUT | `/user-data/settings` | JWT | Replace settings |
| PATCH | `/user-data/settings` | JWT | Partially update settings |
| GET | `/user-data/files` | JWT | List user files |
| POST | `/user-data/files` | JWT | Create file record |
| PUT | `/user-data/files/:id/touch` | JWT | Update file access time |
| DELETE | `/user-data/files/:id` | JWT | Delete file record |
| GET | `/user-data/usage` | JWT | Get usage data |
| POST | `/user-data/usage` | JWT | Record usage event |
| GET | `/user-data/usage/summary` | JWT | Usage summary |

---

## Download (`/api/download`) -- downloadRoutes.js

File download management and browser extension release distribution.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/download/extension/releases` | JWT | List extension releases |
| POST | `/download/info` | JWT | Get download info for URL |
| POST | `/download/start` | JWT | Start download |
| GET | `/download/status/:id` | JWT | Check download progress |
| GET | `/download/list` | JWT | List active downloads |
| GET | `/download/file/:id` | JWT | Get downloaded file |
| DELETE | `/download/:id` | JWT | Delete download |
| POST | `/download/cleanup` | JWT | Clean up old downloads |
| POST | `/download/cookies` | JWT | Set cookies for download |
| GET | `/download/cookies/status` | JWT | Check cookie status |
| DELETE | `/download/cookies` | JWT | Clear cookies |

---

## Blog (`/api/blog`) -- blogRoutes.js

Blog posts and categories.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/blog/` | DB | List blog posts (paginated) |
| GET | `/blog/categories` | DB | List categories |
| GET | `/blog/:slug` | DB | Get post by slug |

---

## Learn (`/api/learn`) -- learnRoutes.js

Tutorials and learning content.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/learn/` | DB | List tutorials |
| GET | `/learn/categories` | DB | List tutorial categories |
| GET | `/learn/:slug` | DB | Get tutorial by slug |

---

## Tokenizer (`/api/tokenize`) -- tokenizerRoutes.js

Token counting for LLM input estimation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/tokenize/count` | None | Count tokens in text |
| POST | `/tokenize/messages` | None | Count tokens in message array |
| GET | `/tokenize/health` | None | Tokenizer health check |

---

## Webhooks (`/api/webhooks`) -- webhookRoutes.js

Webhook registration and delivery tracking.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/webhooks/` | JWT | List webhooks |
| POST | `/webhooks/` | JWT | Create webhook |
| PUT | `/webhooks/:id` | JWT | Update webhook |
| DELETE | `/webhooks/:id` | JWT | Delete webhook |
| GET | `/webhooks/:id/deliveries` | JWT | List delivery attempts |

---

## Analytics (`/api/analytics`) -- analyticsRoutes.js

Event tracking and admin analytics dashboards.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/analytics/event` | JWT | Record analytics event |
| GET | `/analytics/dashboard` | Admin | Admin analytics dashboard |
| GET | `/analytics/downloads` | Admin | Download statistics |
| GET | `/analytics/active-users` | Admin | Active user metrics |
| GET | `/analytics/api-usage` | Admin | API usage metrics |
| GET | `/analytics/credit-usage` | Admin | Credit consumption metrics |
| GET | `/analytics/my-usage` | JWT | Current user usage stats |

---

## Jobs (`/api/jobs`) -- jobRoutes.js

Background job management (admin only).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/jobs/stats` | Admin | Job queue statistics |
| GET | `/jobs/` | Admin | List jobs (filterable) |
| GET | `/jobs/:id` | Admin | Get job details |
| POST | `/jobs/:id/cancel` | Admin | Cancel running job |
| POST | `/jobs/:id/retry` | Admin | Retry failed job |
| POST | `/jobs/cleanup` | Admin | Clean up completed/old jobs |

---

## Docs (`/api/docs`) -- docsRoutes.js

API documentation and OpenAPI spec.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/docs/openapi.json` | None | OpenAPI 3.0 specification |
| GET | `/docs/` | None | API documentation UI |

---

## Health (`/api/`) -- healthRoutes.js

Health and readiness probes.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/live` | None | Liveness probe (always 200) |
| GET | `/ready` | None | Readiness probe (checks DB + Redis) |
| GET | `/health` | None | Detailed health with component status |

---

## FAL Proxy (`/api/fal`)

Inline proxy middleware forwarding requests to the fal.ai API. No authentication required. Configured in `index.js` via `createProxyMiddleware`.

---

## Unmounted Route Files

The following route files exist in `src/server/routes/` but are **not mounted** in the server:

- **accountRoutes.js** -- Workspace management, billing overview, project management, member/invite management. Contains 23 endpoints for a workspace-based billing system.
- **creditsRoutes.js** -- Payment method management (Stripe) and credit purchase. Contains 4 endpoints.
- **terminalRoutes.js** -- Terminal container management, execution, stats, logs, and templates. Contains 11 endpoints.

These are prepared for future features and will be mounted when their corresponding frontend UI is ready.
