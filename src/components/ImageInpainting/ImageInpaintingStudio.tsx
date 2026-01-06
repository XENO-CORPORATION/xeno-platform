import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Upload, Download, Eraser, Brush, Loader2, Settings, Trash2 } from 'lucide-react';

interface InpaintingResult {
  processedImage: string;
  originalImage: string;
  mask: string;
  modelUsed: string;
  processingTime: number;
}

interface IOPaintConfig {
  serverUrl: string;
  model: string;
  device: 'cpu' | 'cuda';
}

const ImageInpaintingStudio: React.FC = () => {
  // State management
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(20);
  const [isServerOnline, setIsServerOnline] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>(['lama', 'stable-diffusion-inpainting']);
  const [selectedModel, setSelectedModel] = useState('lama');
  
  // Refs for canvas manipulation
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  
  // Configuration
  const config: IOPaintConfig = {
    serverUrl: process.env.REACT_APP_IOPAINT_SERVER_URL || 'http://localhost:8080',
    model: selectedModel,
    device: 'cuda'
  };

  // Check server health on component mount
  useEffect(() => {
    checkServerHealth();
  }, []);

  const checkServerHealth = async () => {
    try {
      const response = await fetch(`${config.serverUrl}/docs`);
      setIsServerOnline(response.ok);
    } catch {
      setIsServerOnline(false);
    }
  };

  // File upload handler with validation
  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image file too large. Maximum size is 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string;
      setOriginalImage(imageUrl);
      setProcessedImage(null);
      setError(null);
      
      // Initialize canvas
      setTimeout(() => initializeCanvas(imageUrl), 100);
    };
    reader.readAsDataURL(file);
  }, []);

  // Initialize canvas for mask drawing
  const initializeCanvas = useCallback((imageUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = maskCanvasRef.current;
      const imageCanvas = imageCanvasRef.current;
      if (!canvas || !imageCanvas) return;
      
      const ctx = canvas.getContext('2d');
      const imageCtx = imageCanvas.getContext('2d');
      if (!ctx || !imageCtx) return;
      
      // Calculate canvas size to fit container while maintaining aspect ratio
      const maxWidth = 600;
      const maxHeight = 400;
      const aspectRatio = img.width / img.height;
      
      let canvasWidth = maxWidth;
      let canvasHeight = maxWidth / aspectRatio;
      
      if (canvasHeight > maxHeight) {
        canvasHeight = maxHeight;
        canvasWidth = maxHeight * aspectRatio;
      }
      
      // Set canvas sizes
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      imageCanvas.width = canvasWidth;
      imageCanvas.height = canvasHeight;
      
      // Draw original image on background canvas
      imageCtx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
      
      // Clear mask canvas (transparent background)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Set up drawing context
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };
    img.src = imageUrl;
  }, []);

  // Get coordinates accounting for canvas scaling
  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }, []);

  // Mouse drawing handlers
  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDrawing.current = true;
    
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    
    lastPoint.current = coords;
    
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    
    // Draw initial point
    drawPoint(coords.x, coords.y);
  }, [getCanvasCoordinates, tool, brushSize]);

  const drawPoint = useCallback((x: number, y: number) => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    
    ctx.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }, [tool, brushSize]);

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    
    const coords = getCanvasCoordinates(e);
    if (!coords || !lastPoint.current) return;
    
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    
    // Set drawing properties
    ctx.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = brushSize;
    
    // Draw line from last point to current point
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    
    // Draw point at current position for smoother lines
    drawPoint(coords.x, coords.y);
    
    lastPoint.current = coords;
  }, [getCanvasCoordinates, tool, brushSize, drawPoint]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing.current) return;
    
    isDrawing.current = false;
    lastPoint.current = null;
    
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    
    // Update mask image state
    setMaskImage(canvas.toDataURL());
  }, []);

  // Clear mask
  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setMaskImage(null);
  }, []);

  // Convert data URL to File
  const dataURLtoFile = useCallback((dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || '';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new File([u8arr], filename, { type: mime });
  }, []);

  // Process image with IOPaint API
  const processImage = useCallback(async () => {
    if (!originalImage || !maskImage) {
      setError('Please upload an image and create a mask');
      return;
    }

    if (!isServerOnline) {
      setError('IOPaint server is not available. Please check your server configuration.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Convert images to files
      const imageFile = dataURLtoFile(originalImage, 'image.png');
      const maskFile = dataURLtoFile(maskImage, 'mask.png');
      
      // Prepare form data
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('mask', maskFile);
      formData.append('model', selectedModel);
      
      const startTime = Date.now();
      
      const response = await fetch(`${config.serverUrl}/api/v1/inpaint`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`IOPaint API error: ${response.status} - ${errorText}`);
      }

      // Get processed image
      const resultBlob = await response.blob();
      const resultUrl = URL.createObjectURL(resultBlob);
      setProcessedImage(resultUrl);
      
      const processingTime = Date.now() - startTime;
      console.log(`Image processed successfully in ${processingTime}ms using model: ${selectedModel}`);

    } catch (err) {
      console.error('Error processing image:', err);
      setError(err instanceof Error ? err.message : 'Failed to process image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [originalImage, maskImage, config, selectedModel, isServerOnline, dataURLtoFile]);

  // Download processed image
  const downloadImage = useCallback(() => {
    if (!processedImage) return;
    
    const link = document.createElement('a');
    link.href = processedImage;
    link.download = `inpainted-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [processedImage]);

  // Reset all state
  const resetStudio = useCallback(() => {
    setOriginalImage(null);
    setMaskImage(null);
    setProcessedImage(null);
    setError(null);
    clearMask();
  }, [clearMask]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brush className="w-6 h-6" />
              Image Inpainting Studio
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isServerOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-600">
                {isServerOnline ? 'Server Online' : 'Server Offline'}
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Upload and Model Selection */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload Image</label>
              <Button
                variant="outline"
                onClick={() => document.getElementById('image-upload')?.click()}
                className="w-full flex items-center gap-2"
                disabled={isProcessing}
              >
                <Upload className="w-4 h-4" />
                {originalImage ? 'Change Image' : 'Upload Image'}
              </Button>
              <input
                id="image-upload"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">AI Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-white"
                disabled={isProcessing}
              >
                {availableModels.map(model => (
                  <option key={model} value={model}>
                    {model === 'lama' ? 'LaMa (Fast, Object Removal)' : 
                     model === 'stable-diffusion-inpainting' ? 'Stable Diffusion (High Quality)' :
                     model}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tools Section */}
          {originalImage && (
            <div className="space-y-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex gap-2">
                    <Button
                      variant={tool === 'brush' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTool('brush')}
                      disabled={isProcessing}
                      className="flex items-center"
                    >
                      <Brush className="w-4 h-4 mr-1" />
                      Brush
                    </Button>
                    <Button
                      variant={tool === 'eraser' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTool('eraser')}
                      disabled={isProcessing}
                      className="flex items-center"
                    >
                      <Eraser className="w-4 h-4 mr-1" />
                      Eraser
                    </Button>
                  </div>
                  
                  <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg">
                    <label className="text-sm font-medium whitespace-nowrap">Size:</label>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      className="w-24"
                      disabled={isProcessing}
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400 min-w-[40px] text-center">{brushSize}px</span>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={clearMask} disabled={isProcessing}>
                    Clear Mask
                  </Button>
                  <Button variant="outline" size="sm" onClick={resetStudio} disabled={isProcessing} className="flex items-center gap-1">
                    <Trash2 className="w-4 h-4" />
                    Reset
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Canvas Section */}
          {originalImage && (
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Original Image with Mask Overlay */}
              <div className="space-y-3">
                <h3 className="font-medium text-lg">Original Image + Mask</h3>
                <div className="relative border rounded-lg overflow-hidden bg-gray-50 p-4 shadow-inner">
                  <div className="relative w-full h-full flex items-center justify-center">
                    <canvas
                      ref={imageCanvasRef}
                      className="relative w-full h-auto max-w-full"
                      style={{ maxHeight: '500px', maxWidth: '100%' }}
                    />
                    <canvas
                      ref={maskCanvasRef}
                      className="absolute top-0 left-0 w-full h-full cursor-crosshair"
                      style={{ 
                        maxHeight: '500px',
                        mixBlendMode: 'multiply'
                      }}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 pl-1">
                  Paint with white to mark areas for inpainting. Use the eraser to remove mask areas.
                </p>
              </div>

              {/* Processed Result */}
              <div className="space-y-3">
                <h3 className="font-medium text-lg">Processed Result</h3>
                <div className="border rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center p-4 shadow-inner" style={{ minHeight: '200px', maxHeight: '500px' }}>
                  {processedImage ? (
                    <img
                      src={processedImage}
                      alt="Processed"
                      className="w-full h-auto object-contain max-w-full"
                      style={{ maxHeight: '500px' }}
                    />
                  ) : (
                    <div className="text-gray-500 text-center">
                      {isProcessing ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <span>Processing image with {selectedModel}...</span>
                          <span className="text-xs">This may take 10-30 seconds</span>
                        </div>
                      ) : (
                        <span>Processed image will appear here</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {originalImage && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  onClick={processImage}
                  disabled={!maskImage || isProcessing || !isServerOnline}
                  className="flex items-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Brush className="w-4 h-4" />
                      Process Image
                    </>
                  )}
                </Button>
                
                <Button
                  variant="outline"
                  onClick={checkServerHealth}
                  className="flex items-center gap-2"
                  disabled={isProcessing}
                >
                  <Settings className="w-4 h-4" />
                  Test Connection
                </Button>
              </div>
              
              {processedImage && (
                <Button
                  variant="outline"
                  onClick={downloadImage}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Result
                </Button>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600">{error}</p>
              {!isServerOnline && (
                <div className="mt-2 text-sm text-red-500">
                  <p>Make sure IOPaint server is running at: {config.serverUrl}</p>
                  <p>Run: <code className="bg-red-100 px-1 rounded">iopaint start --model=lama --device=cuda --port=8080 --host=0.0.0.0</code></p>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          {!originalImage && (
            <div className="text-center p-8 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-medium mb-2">Get Started with Image Inpainting</h3>
              <p className="text-gray-600 mb-4">
                Upload an image and paint a mask over areas you want to remove or replace
              </p>
              <ul className="text-sm text-gray-500 space-y-1 max-w-md mx-auto">
                <li>• Upload any image (JPEG, PNG, WebP up to 10MB)</li>
                <li>• Use the brush tool to mark areas for inpainting</li>
                <li>• Choose between LaMa (fast) or Stable Diffusion (high quality)</li>
                <li>• Process and download your result</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ImageInpaintingStudio;
