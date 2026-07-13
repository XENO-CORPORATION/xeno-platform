import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Download, RotateCcw } from 'lucide-react';

interface CanvasInterfaceProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onImageUpdate?: (newImageUrl: string) => void;
}

const CanvasInterface: React.FC<CanvasInterfaceProps> = ({
  imageUrl,
  isOpen,
  onClose,
  onImageUpdate
}) => {
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState(imageUrl);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Update current image URL when prop changes
  useEffect(() => {
    setCurrentImageUrl(imageUrl);
  }, [imageUrl]);

  // Load and draw image on canvas
  useEffect(() => {
    if (!currentImageUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Clear canvas and draw image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      console.log('🎨 Canvas Interface: Image loaded and drawn', {
        width: img.width,
        height: img.height,
        src: currentImageUrl.substring(0, 50) + '...'
      });
    };

    img.onerror = (error) => {
      console.error('🎨 Canvas Interface: Failed to load image', error);
    };

    img.src = currentImageUrl;
  }, [currentImageUrl]);

  const handleEditSubmit = async () => {
    if (!editPrompt.trim() || isEditing) return;

    setIsEditing(true);
    console.log('🎨 Canvas Interface: Starting edit with prompt:', editPrompt);

    try {
      // Get image data from canvas
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas not available');

      const imageDataUrl = canvas.toDataURL('image/png');
      console.log('🎨 Canvas Interface: Image data prepared, size:', imageDataUrl.length);

      // Send edit request to backend using the correct endpoint
      const response = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Stable idempotency key for THIS edit action (reused on any retry within this
          // call); the isEditing guard blocks double-clicks. Prevents the server from
          // minting a fresh id per request and double-charging on retry.
          requestId: crypto.randomUUID(),
          task: 'edit_image',
          imageData: imageDataUrl,
          prompt: editPrompt,
          model: 'gpt-image-1',
          outputFormat: 'png',
          quality: 'auto',
          size: 'auto',
          background: 'auto'
        }),
      });

      if (!response.ok) {
        throw new Error(`Edit request failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('🎨 Canvas Interface: Edit successful', result);

      if (result.imageData) {
        const newImageUrl = `data:image/png;base64,${result.imageData}`;
        setCurrentImageUrl(newImageUrl);
        
        // Notify parent component of the update
        if (onImageUpdate) {
          onImageUpdate(newImageUrl);
        }
        
        console.log('🎨 Canvas Interface: Image updated successfully');
      } else {
        console.error('🎨 Canvas Interface: No imageData in response:', result);
      }

      setEditPrompt('');
    } catch (error) {
      console.error('🎨 Canvas Interface: Edit failed:', error);
      // You could add error state/notification here
    } finally {
      setIsEditing(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `edited-image-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleReset = () => {
    setCurrentImageUrl(imageUrl);
    setEditPrompt('');
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-700">
          <h2 className="text-white text-lg font-semibold">Canvas Editor</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Reset to original"
            >
              <RotateCcw size={20} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Download image"
            >
              <Download size={20} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Canvas Container */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
          <div className="max-w-full max-h-full">
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full object-contain border border-gray-600 rounded-lg shadow-2xl"
              style={{
                maxWidth: 'calc(100vw - 4rem)',
                maxHeight: 'calc(100vh - 12rem)'
              }}
            />
          </div>
        </div>

        {/* Input Container */}
        <div className="p-6 bg-gray-900 border-t border-gray-700">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Describe your edit
                </label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="e.g., make the dog's fur black, change the background to blue, add sunglasses..."
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  rows={3}
                  disabled={isEditing}
                />
              </div>
              <button
                onClick={handleEditSubmit}
                disabled={!editPrompt.trim() || isEditing}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2 min-w-[100px] justify-center"
              >
                {isEditing ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Send size={18} />
                    Edit
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Press Enter to submit • Be specific for better results
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CanvasInterface; 