// CSS styles for ImageStudio components
export const shimmerStyles = `
/* Shimmer animation for loading states */
@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.animate-shimmer {
  animation: shimmer 2s infinite;
}

/* Additional styles for ImageStudio components */
.image-studio-container {
  position: relative;
  overflow: hidden;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.draggable-modal {
  position: absolute;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  z-index: 1001;
}

.segmentation-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;
}

.segmentation-point {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff4444;
  transform: translate(-50%, -50%);
  z-index: 6;
}

.segmentation-mask {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0.3;
  z-index: 4;
}
`;

// Inject styles into document head
export const injectStyles = () => {
  if (typeof document !== 'undefined' && !document.querySelector('#image-studio-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'image-studio-styles';
    styleSheet.textContent = shimmerStyles;
    document.head.appendChild(styleSheet);
  }
}; 