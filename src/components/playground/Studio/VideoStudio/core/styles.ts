// CSS styles for VideoStudio components
export const videoStudioStyles = `
/* Main VideoStudio Layout */
.video-studio {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.video-studio-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
}

.header-left h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #ffffff;
}

.project-name {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
  margin-left: 1rem;
}

.header-right {
  display: flex;
  gap: 0.75rem;
}

.upload-button, .export-button {
  padding: 0.5rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.upload-button:hover, .export-button:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

.video-studio-content {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* Video Library Panel */
.video-library {
  width: 250px;
  background: rgba(255, 255, 255, 0.03);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  overflow-y: auto;
}

.video-library h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.video-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.video-item {
  padding: 0.75rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;
}

.video-item:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-1px);
}

.video-item.selected {
  background: rgba(102, 126, 234, 0.2);
  border-color: rgba(102, 126, 234, 0.4);
}

.video-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.5rem;
}

.video-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-format {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.empty-library {
  text-align: center;
  padding: 2rem 1rem;
  color: rgba(255, 255, 255, 0.4);
}

.empty-library p {
  margin: 0.5rem 0;
  font-size: 0.875rem;
}

/* Video Player Panel */
.video-player-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000000;
  position: relative;
}

.no-video-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.placeholder {
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
}

.placeholder h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 500;
}

.placeholder p {
  margin: 0;
  font-size: 0.875rem;
}

/* Effects Panel */
.effects-panel {
  width: 280px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  overflow-y: auto;
}

.effects-panel h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.tool-section {
  margin-bottom: 1.5rem;
}

.tool-section h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
}

.effect-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

/* Timeline Panel */
.timeline-panel {
  height: 200px;
  background: rgba(255, 255, 255, 0.03);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* Video player styles */
.video-player {
  position: relative;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  height: 100%;
  max-height: 70vh;
}

.video-player video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.loading-spinner {
  font-size: 1rem;
}

.video-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.control-button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #ffffff;
  padding: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1rem;
}

.control-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

.control-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.time-display {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  color: #ffffff;
  margin: 0 0.5rem;
}

.progress-container {
  flex: 1;
  cursor: pointer;
  padding: 0.5rem 0;
}

.progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transition: width 0.1s ease;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.volume-slider {
  width: 80px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-radius: 50%;
  cursor: pointer;
}

.error-message {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #ff6b6b;
  text-align: center;
}

.error-message p {
  margin: 0;
  font-size: 0.875rem;
}

/* Timeline styles */
.video-timeline {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  height: 80px;
  overflow-x: auto;
  overflow-y: hidden;
}

.timeline-track {
  height: 24px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  margin: 2px 0;
  position: relative;
}

.timeline-clip {
  position: absolute;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 4px;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: all 0.2s ease;
}

.timeline-clip:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ff6b6b;
  pointer-events: none;
  z-index: 10;
}

/* Video thumbnail styles */
.video-thumbnail {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1a1a;
  aspect-ratio: 16/9;
}

.video-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-thumbnail-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.video-thumbnail:hover .video-thumbnail-overlay {
  opacity: 1;
}

/* Video effects panel */
.effects-panel {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.effect-item {
  padding: 0.75rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;
}

.effect-item:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-1px);
}

/* Video export modal */
.export-modal {
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.export-progress {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  height: 8px;
  overflow: hidden;
}

.export-progress-bar {
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  height: 100%;
  transition: width 0.3s ease;
}

/* Responsive design */
@media (max-width: 768px) {
  .video-controls {
    padding: 0.5rem;
    gap: 0.25rem;
  }
  
  .video-timeline {
    height: 60px;
  }
  
  .timeline-track {
    height: 18px;
  }
}

/* Animation keyframes */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.pulse {
  animation: pulse 2s infinite;
}

@keyframes slideIn {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.slide-in {
  animation: slideIn 0.3s ease-out;
}
`;

export const injectVideoStudioStyles = () => {
  if (typeof document !== 'undefined' && !document.querySelector('#video-studio-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'video-studio-styles';
    styleSheet.textContent = videoStudioStyles;
    document.head.appendChild(styleSheet);
  }
};