# Video Studio Backend Integration Guide

This guide explains how to integrate the Video Studio canvas with the backend, Docker containers, and user authentication.

## Architecture Overview

```
┌─────────────────┐
│  VideoStudio    │  React Component (Frontend)
│  Component      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ VideoStudio     │  Frontend Service Layer
│ Service         │  (videoStudioService.ts)
└────────┬────────┘
         │ HTTP/Auth
         ▼
┌─────────────────┐
│  Express API    │  Backend API Routes
│  /api/video/*   │  (videoRoutes.js)
└────────┬────────┘
         │
         ├──►  PostgreSQL Database (Projects, Assets, Jobs)
         │
         └──►  Docker Containers (FFmpeg Video Rendering)
```

## Setup Instructions

### 1. Database Migration

First, run the database migration to create video tables:

```bash
node src/server/database/migrate-video.js
```

This creates the following tables:
- `video_projects` - Video project metadata and settings
- `video_assets` - Media library (videos, images, audio)
- `video_render_jobs` - Rendering job queue and status
- `video_project_sessions` - Project history/versions

### 2. Environment Variables

Add to your `.env` file:

```env
# Video Processing
USE_DOCKER_RENDERING=true  # Set to false for direct FFmpeg
DOCKER_HOST=tcp://localhost:2375  # If using remote Docker

# Storage Paths
VIDEOS_STORAGE_PATH=./storage/videos
ASSETS_STORAGE_PATH=./storage/assets
TEMP_STORAGE_PATH=./storage/temp

# Credits System
VIDEO_RENDER_CREDIT_RATE=1  # Credits per million pixels*frames
```

### 3. Docker Setup

The video rendering uses Docker containers with FFmpeg. Ensure Docker is running:

```bash
# Test Docker connection
docker ps

# Pull FFmpeg image (optional, will auto-pull on first use)
docker pull jrottenberg/ffmpeg:latest
```

### 4. Update docker-compose.yml

The backend container already has Docker socket access. Verify this line exists:

```yaml
volumes:
  - //var/run/docker.sock:/var/run/docker.sock
```

## API Endpoints

### Project Management

#### Create Project
```http
POST /api/video/projects/create
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "My Video Project",
  "description": "Project description",
  "width": 1920,
  "height": 1080,
  "fps": 24,
  "duration": 10,
  "quality": "high",
  "aspect_ratio": "16:9",
  "generation_steps": 50,
  "output_format": "mp4"
}
```

#### Get All Projects
```http
GET /api/video/projects?status=draft&limit=50&offset=0
Authorization: Bearer {token}
```

#### Get Single Project
```http
GET /api/video/projects/:projectId
Authorization: Bearer {token}
```

#### Update Project
```http
PUT /api/video/projects/:projectId
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "Updated Title",
  "timeline_data": { /* timeline state */ },
  "fps": 30
}
```

#### Delete Project
```http
DELETE /api/video/projects/:projectId
Authorization: Bearer {token}
```

### Asset Management

#### Upload Asset
```http
POST /api/video/assets/upload
Authorization: Bearer {token}
Content-Type: application/json

{
  "project_id": "uuid",
  "name": "my-video.mp4",
  "type": "video",
  "format": "mp4",
  "file_url": "/uploads/video.mp4",
  "duration": 10.5,
  "width": 1920,
  "height": 1080,
  "file_size": 1048576,
  "source": "upload"
}
```

#### Get Project Assets
```http
GET /api/video/assets/:projectId
Authorization: Bearer {token}
```

### Rendering

#### Start Render
```http
POST /api/video/render
Authorization: Bearer {token}
Content-Type: application/json

{
  "project_id": "uuid",
  "render_settings": {
    "quality": "high",
    "format": "mp4"
  }
}
```

Response:
```json
{
  "success": true,
  "job": {
    "id": "job-uuid",
    "status": "queued",
    "progress": 0
  },
  "estimated_credits": 25
}
```

#### Get Render Status
```http
GET /api/video/render/:jobId/status
Authorization: Bearer {token}
```

Response:
```json
{
  "success": true,
  "job": {
    "id": "job-uuid",
    "status": "processing",
    "progress": 45,
    "current_frame": 540,
    "total_frames": 1200
  }
}
```

#### Cancel Render
```http
POST /api/video/render/:jobId/cancel
Authorization: Bearer {token}
```

#### Export Project
```http
POST /api/video/export
Authorization: Bearer {token}
Content-Type: application/json

{
  "project_id": "uuid",
  "format": "mp4",
  "quality": "high"
}
```

## Frontend Integration

### 1. Import the Service

```typescript
import { videoStudioService } from '@/services/videoStudioService';
```

### 2. Create a Project

```typescript
const handleCreateProject = async () => {
  const result = await videoStudioService.createProject({
    title: projectTitle,
    width: projectWidth,
    height: projectHeight,
    fps: projectFps,
    duration: projectDurationSec,
    quality: quality,
    aspect_ratio: aspectRatio,
    generation_steps: steps,
    output_format: 'mp4'
  });

  if (result.success && result.project) {
    setCurrentProject(result.project);
    console.log('Project created:', result.project.id);
  } else {
    console.error('Failed to create project:', result.error);
  }
};
```

### 3. Save Timeline State

```typescript
const handleSaveProject = async () => {
  if (!currentProject) return;

  const result = await videoStudioService.updateProject(
    currentProject.id,
    {
      title: projectTitle,
      timeline_data: timelineSnapshot,
      duration: canvasDuration
    }
  );

  if (result.success) {
    console.log('Project saved');
  }
};
```

### 4. Start Rendering

```typescript
const handleRender = async () => {
  if (!currentProject) return;

  // Check credits first
  const estimatedCredits = videoStudioService.estimateCredits(currentProject);
  const user = authService.getCurrentUser();
  
  if (user && user.credits < estimatedCredits) {
    alert(`Insufficient credits. Need ${estimatedCredits}, have ${user.credits}`);
    return;
  }

  // Start render
  const result = await videoStudioService.startRender({
    project_id: currentProject.id,
    render_settings: {
      quality: currentProject.quality,
      format: currentProject.output_format
    }
  });

  if (result.success && result.job) {
    console.log('Render started:', result.job.id);
    
    // Poll for status
    videoStudioService.pollRenderStatus(
      result.job.id,
      (job) => {
        console.log(`Render progress: ${job.progress}%`);
        setRenderProgress(job.progress);
      }
    ).then((completedJob) => {
      console.log('Render completed:', completedJob.output_url);
      setOutputVideoUrl(completedJob.output_url);
    }).catch((error) => {
      console.error('Render failed:', error);
    });
  }
};
```

### 5. Load Existing Project

```typescript
const handleLoadProject = async (projectId: string) => {
  const result = await videoStudioService.getProject(projectId);
  
  if (result.success && result.project) {
    setCurrentProject(result.project);
    
    // Restore timeline state
    if (result.project.timeline_data) {
      setTimelineSnapshot(result.project.timeline_data);
    }
    
    // Load assets
    const assetsResult = await videoStudioService.getAssets(projectId);
    if (assetsResult.success && assetsResult.assets) {
      setAssetLibrary(assetsResult.assets);
    }
  }
};
```

## Integration with VideoStudio.tsx

Update the `VideoStudio` component to use the service:

```typescript
// Add state for current project
const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
const [renderProgress, setRenderProgress] = useState(0);
const [isRendering, setIsRendering] = useState(false);

// Update handleStartNewProject
const handleStartNewProject = async () => {
  setIsCanvasActionMenuOpen(false);
  setIsProjectSettingsOpen(true);
};

// Update the "Create Canvas Project" button handler
const handleCreateCanvasProject = async () => {
  // Create project in backend
  const result = await videoStudioService.createProject({
    title: projectTitle,
    width: projectWidth,
    height: projectHeight,
    fps: projectFps,
    duration: projectDurationSec,
    quality: quality,
    aspect_ratio: aspectRatio,
    generation_steps: steps,
    output_format: 'mp4'
  });

  if (result.success && result.project) {
    setCurrentProject(result.project);
    setIsProjectSettingsOpen(false);
    setIsCanvasOpen(true);
    setHasCanvasProject(true);
    
    // Create session message
    const newProjectMsg = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: `Created project: ${result.project.title}`,
      timestamp: new Date()
    };
    setMessages([newProjectMsg]);
  } else {
    alert(`Failed to create project: ${result.error}`);
  }
};

// Auto-save project on timeline changes
useEffect(() => {
  if (currentProject && timelineSnapshot) {
    const debounceTimer = setTimeout(async () => {
      await videoStudioService.updateProject(currentProject.id, {
        timeline_data: timelineSnapshot
      });
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(debounceTimer);
  }
}, [timelineSnapshot, currentProject]);
```

## Credits System

The video rendering uses a credits-based system:

**Formula:** `credits = (width × height × duration × fps) / 1,000,000`

Examples:
- 1080p, 10s @ 24fps = ~500 credits
- 4K, 10s @ 60fps = ~8,000 credits

Users start with 1000 welcome credits after claiming the bonus.

## WebSocket Support (Future)

For real-time rendering progress, you can integrate WebSocket updates:

```javascript
// In backend
io.on('connection', (socket) => {
  socket.on('subscribe-render', (jobId) => {
    // Send progress updates
  });
});

// In frontend
const socket = io(API_BASE);
socket.emit('subscribe-render', jobId);
socket.on('render-progress', (data) => {
  setRenderProgress(data.progress);
});
```

## Troubleshooting

### "Docker not found" error
- Ensure Docker is installed and running
- Check Docker socket permissions: `ls -la /var/run/docker.sock`
- Set `USE_DOCKER_RENDERING=false` to use direct FFmpeg

### "Insufficient credits" error
- Check user credits: `authService.getCurrentUser().credits`
- Award more credits in database or implement purchase flow

### Rendering fails
- Check FFmpeg is available: `ffmpeg -version`
- Check video asset URLs are accessible
- Review container logs: `docker logs xenostudio-render-{jobId}`

### Timeline data not persisting
- Verify auth token is valid
- Check network requests in browser DevTools
- Ensure auto-save debounce is working

## Next Steps

1. ✅ Database schema created
2. ✅ Backend API routes implemented
3. ✅ Frontend service created
4. ✅ Video processing service with Docker
5. ⏳ Integrate service calls in VideoStudio.tsx
6. ⏳ Add WebSocket for real-time updates
7. ⏳ Implement thumbnail generation
8. ⏳ Add project templates
9. ⏳ Implement collaboration features

---

**Need Help?** Check the server logs at `/var/log/xenostudio/backend.log` or run with `DEBUG=true` for verbose output.
