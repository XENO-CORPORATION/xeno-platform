# 🚀 XenoStudio Web - Complete Cloud Operating System & AI Platform

**XenoStudio Web** is a revolutionary cloud-based operating system that brings a complete Windows-like desktop experience to your browser, powered by cutting-edge AI technologies and real container provisioning.

## ✨ Key Features

### 🖥️ **Cloud Operating System Interface**
- Windows-like desktop with taskbar, file explorer, and persistent storage
- Multi-user support with file isolation and session management
- Real-time collaboration via WebSocket
- Responsive design for all devices

### 🤖 **AI-Powered Creative Suite**
- 20+ AI models integrated (OpenAI, Google Gemini, Replicate, etc.)
- Image generation with Stable Diffusion, FLUX, Ideogram, Recraft V3
- Video creation with Luma Dream Machine, Pika Labs, Kling Video
- 3D model generation with Hyper3D Rodin, TripoSR, Hunyuan3D-V2
- Audio generation with MMAudio V2, CassetteAI, Lyria2
- Text-to-speech with ElevenLabs, Orpheus TTS, Minimax Speech

### 🐳 **Container Provisioning System**
- Dynamic Docker container creation with custom resource allocation
- Real-time pricing calculator for transparent billing
- Multi-language support (Node.js, Python, Go, Rust, Java)
- Container management and resource monitoring

### 🔄 **File Conversion System**
- Multi-format file conversion with batch processing
- Document conversion (PDF, DOCX, etc.)
- Image processing and optimization
- User storage tracking and quotas

## 🚀 Quick Start

### Prerequisites
- **Docker Desktop** installed and running
- **4GB+ RAM** available
- **Modern browser** (Chrome, Firefox, Safari, Edge)

### One-Command Deployment

**Windows (PowerShell):**
```powershell
docker-compose up -d --build
```

**Linux/Mac (Bash):**
```bash
docker-compose up -d --build
```

### Access Points
- **Main Application**: http://localhost:4040
- **Backend API**: http://localhost:8080

## 🏗️ Technical Architecture

### Frontend Stack
- **React 18** with TypeScript for type safety
- **Vite** for lightning-fast development
- **Tailwind CSS** with custom design system
- **Radix UI** for accessible components
- **Socket.IO** for real-time communication

### Backend Stack
- **Node.js** with Express.js
- **PostgreSQL** for persistent storage
- **Redis** for caching and sessions
- **Docker** integration for container management
- **WebSocket** support for real-time features

### Infrastructure
- **Docker Compose** for container orchestration
- **Nginx** reverse proxy
- **Multi-stage Docker builds**
- **Health checks** and monitoring

## 📁 Project Structure

```
xenostudio-web/
├── 📂 src/
│   ├── 📂 components/          # React components
│   ├── 📂 pages/              # Page-level components
│   ├── 📂 services/           # API service layers
│   ├── 📂 server/             # Backend code
│   │   ├── 📂 routes/         # API routes
│   │   ├── 📂 database/       # Database schema
│   │   └── 📂 middleware/     # Express middleware
│   └── 📂 types/              # TypeScript definitions
├── 📂 public/                # Static assets
├── 📄 docker-compose.yml     # Container orchestration
├── 🐳 Dockerfile.frontend     # Frontend container
├── 🐳 Dockerfile.backend     # Backend container
├── ⚙️ vite.config.ts         # Vite configuration
├── 🎨 tailwind.config.js     # Tailwind customization
└── 📋 package.json           # Dependencies & scripts
```

## 🎯 What Makes This Project Special

✅ **Real Cloud OS**: Not just a demo, but a fully functional cloud operating system
✅ **AI Integration**: 20+ AI models seamlessly integrated
✅ **Container Provisioning**: Real Docker containers with billing system
✅ **Modern Tech Stack**: Latest React, Node.js, and web technologies
✅ **Production Ready**: Scalable architecture with proper databases
✅ **Beautiful UI/UX**: Glass morphism design with smooth animations

## 📝 License

**⚠️ PROPRIETARY SOFTWARE - VIEWING ONLY**

This is proprietary software created by Emilian Cristea.

**Allowed:** View and study the source code for educational purposes only.

**Prohibited:** All other uses including copying, modifying, distributing, or using in any projects.

See the [LICENSE](LICENSE) file for complete terms.