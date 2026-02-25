# Video Studio Backend Integration - Quick Start Guide

## ✅ What Was Implemented

### Backend Infrastructure
1. **Database Schema** - PostgreSQL tables for video projects, assets, render jobs, and sessions
2. **API Routes** - Complete REST API at `/api/video/*` with authentication
3. **Video Processing Service** - FFmpeg-based rendering with Docker support
4. **Frontend Service** - TypeScript service layer with full type safety

### Frontend Integration  
1. **Project Creation** - Canvas Settings now creates real database entries
2. **Auto-Save** - Timeline changes auto-save every 2 seconds
3. **Render System** - Full rendering workflow with progress tracking
4. **Credits System** - Real-time credit tracking and usage
5. **UI Controls** - Save, Render, Cancel buttons with progress bar

## 🚀 Getting Started

### Step 1: Run Database Migration

**IMPORTANT:** Run this first to create the required tables:

```bash
cd D:\DOCUMENTS\root\dev\xenostudio
node src/server/database/migrate-video.js
```

Expected output:
```
🎬 Starting Video Studio database migration...
📋 Creating tables...
✅ Video Studio tables created successfully!

Created tables:
  - video_projects
  - video_assets
  - video_render_jobs
  - video_project_sessions

🎉 Migration complete!
```

### Step 2: Restart Backend Server

The video routes are already integrated in `src/server/index.js`. Just restart:

```bash
# If running locally
npm run dev

# Or with Docker
docker-compose restart backend
```

Look for this log line:
```
🎬 Video Studio routes integrated: /api/video/*
```

### Step 3: Test Authentication

1. **Login** to get a JWT token:
   - Go to the XenoStudio app
   - Login with: `admin@xenostudio.local` / `xenostudio123`
   - Or create a new account

2. **Check Credits**:
   - After login, you should see your credits in the Canvas Settings modal
   - Default: 1000 welcome credits (after claiming)

### Step 4: Create Your First Project

1. **Open Video Studio**:
   - Navigate to Video Studio in the app
   - Click "Canvas" button

2. **Configure Project Settings**:
   - Click "New Project"
   - Configure:
     - Title: "My First Video"
     - Resolution: 1920x1080
     - FPS: 24
     - Duration: 10s
     - Quality: High
     - Aspect Ratio: 16:9
   - You'll see your credits displayed: `💰 Your credits: 1000`

3. **Create Project**:
   - Click "Create Canvas Project"
   - Watch for loading spinner: "Creating..."
   - Success: Canvas opens with your project

4. **Verify in Console**:
   ```javascript
   // Should see in browser console:
   ✅ Project created: <project-id>
   ```

### Step 5: Edit and Auto-Save

1. **Add Assets** (when implemented):
   - Upload videos/images to media library
   - Drag to timeline

2. **Watch Auto-Save**:
   - Make changes to timeline
   - After 2 seconds, see: `💾 Saving...`
   - Then: `✅ Project auto-saved` in console

3. **Manual Save**:
   - Click "Save" button (top-left when canvas is open)
   - Instant save confirmation

### Step 6: Render Video

1. **Click Render Button** (green, top-left):
   - Shows confirmation dialog with:
     - Project details
     - Estimated credits cost
     - Your available credits

2. **Confirm Render**:
   - Click "OK" to start
   - See progress bar appear
   - Watch percentage update: "Cancel (45%)"

3. **Monitor Progress**:
   ```javascript
   // Console logs:
   ✅ Render started: <job-id>
   📊 Render progress: 15%
   📊 Render progress: 30%
   ...
   ✅ Render completed: /storage/videos/<filename>.mp4
   ```

4. **Complete**:
   - Alert: "Render complete! Video saved to: ..."
   - Credits deducted automatically
   - Video URL available

### Step 7: Verify in Database

```sql
-- Check your projects
SELECT id, title, width, height, fps, duration, quality, status, created_at 
FROM video_projects 
ORDER BY created_at DESC 
LIMIT 5;

-- Check render jobs
SELECT id, project_id, status, progress, credits_used 
FROM video_render_jobs 
ORDER BY queued_at DESC 
LIMIT 5;
```

## 📋 API Testing with curl

### Create Project
```bash
curl -X POST http://localhost:8080/api/video/projects/create \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Project",
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "duration": 10,
    "quality": "high",
    "aspect_ratio": "16:9",
    "generation_steps": 50,
    "output_format": "mp4"
  }'
```

### Get Projects
```bash
curl -X GET http://localhost:8080/api/video/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Start Render
```bash
curl -X POST http://localhost:8080/api/video/render \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "YOUR_PROJECT_ID",
    "render_settings": {
      "quality": "high",
      "format": "mp4"
    }
  }'
```

### Check Render Status
```bash
curl -X GET http://localhost:8080/api/video/render/JOB_ID/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🎨 UI Features

### Top-Left Controls (Canvas Open)
- **Save Button** - Manual save (also auto-saves every 2s)
- **Render Button** - Start rendering (green, shows credits cost)
- **Cancel Button** - Stop rendering (red, shows progress %)
- **Project Info** - Current project title and credits

### Canvas Settings Modal
- **Credits Display** - Shows: `💰 Your credits: 1000`
- **Project Status** - `✓ Editing: Project Name`
- **Save Indicator** - `💾 Saving...` when auto-saving

### Progress Bar (During Render)
- Appears below top controls
- Shows percentage: 0-100%
- Real-time updates every second

## 🐛 Troubleshooting

### "Authentication required" Error
**Solution:**
1. Make sure you're logged in
2. Check localStorage for `xenoos_auth_token`
3. If missing, logout and login again

### "Insufficient credits" Error
**Solution:**
1. Check your credits: `authService.getCurrentUser().credits`
2. Claim welcome bonus if available
3. Or reduce project settings (resolution, duration, fps)

### Database Migration Fails
**Solution:**
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Check connection
psql -h localhost -p 5433 -U postgres -d xenostudio

# If tables exist, drop them first (CAUTION: deletes data)
DROP TABLE IF EXISTS video_project_sessions CASCADE;
DROP TABLE IF EXISTS video_render_jobs CASCADE;
DROP TABLE IF EXISTS video_assets CASCADE;
DROP TABLE IF EXISTS video_projects CASCADE;

# Then re-run migration
node src/server/database/migrate-video.js
```

### Render Not Starting
**Solution:**
1. Check FFmpeg is installed: `ffmpeg -version`
2. For Docker mode, check Docker is running: `docker ps`
3. Check backend logs for errors
4. Set `USE_DOCKER_RENDERING=false` in .env to use direct FFmpeg

### Auto-Save Not Working
**Solution:**
1. Check console for errors
2. Verify project was created successfully
3. Check network tab for PUT requests to `/api/video/projects/:id`

## 📊 Credits Formula

```
credits = (width × height × duration × fps) / 1,000,000
```

**Examples:**
- 1080p (1920×1080), 10s @ 24fps = ~500 credits
- 4K (3840×2160), 10s @ 60fps = ~5,000 credits
- 720p (1280×720), 5s @ 30fps = ~115 credits

## 🔄 Development Workflow

1. **Make Changes** → Auto-saved to database
2. **Click Render** → Job queued with credit estimate
3. **Monitor Progress** → Real-time percentage updates
4. **Get Result** → Video URL + updated credits
5. **Export** → Download or share video

## 🎯 Next Steps

To complete the integration:

1. **Add Asset Upload** - Implement file upload for videos/images
2. **Load Projects** - Add UI to load existing projects from database
3. **Timeline Integration** - Connect timeline data to actual video clips
4. **WebSocket** - Real-time render progress without polling
5. **Thumbnails** - Generate preview thumbnails for projects
6. **Export Options** - Multiple formats and quality presets

## 📝 Key Files Modified

- ✅ `src/server/routes/videoRoutes.js` - API endpoints
- ✅ `src/server/services/videoProcessingService.js` - Rendering logic
- ✅ `src/server/database/video-schema.sql` - Database schema
- ✅ `src/services/videoStudioService.ts` - Frontend service
- ✅ `src/components/.../VideoStudio.tsx` - UI integration
- ✅ `src/server/index.js` - Route registration

## 🎉 Success Indicators

You'll know it's working when:

1. ✅ Migration completes without errors
2. ✅ Backend logs show: `🎬 Video Studio routes integrated`
3. ✅ Canvas Settings shows your credits
4. ✅ "Create Canvas Project" creates database entry
5. ✅ Console shows: `✅ Project created: <id>`
6. ✅ Auto-save works after 2 seconds
7. ✅ Render button shows estimated credits
8. ✅ Progress bar appears during rendering
9. ✅ Credits deducted after completion

---

**Need Help?** Check the full integration guide: `VIDEO_STUDIO_INTEGRATION.md`
