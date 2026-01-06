import React, { useState, useRef } from 'react';
import { FileImage, Upload, Download, RotateCw, Crop, Palette, Sliders, Eye, Scissors } from 'lucide-react';

const ImgToolsInterface: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('resize');
  const [isProcessing, setIsProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tabs = [
    { id: 'resize', name: 'Resize', icon: <Sliders size={16} /> },
    { id: 'crop', name: 'Crop', icon: <Crop size={16} /> },
    { id: 'rotate', name: 'Rotate', icon: <RotateCw size={16} /> },
    { id: 'filter', name: 'Filters', icon: <Palette size={16} /> },
  ];

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcess = async () => {
    if (!selectedImage) return;

    setIsProcessing(true);
    // Simulate image processing
    setTimeout(() => {
      setIsProcessing(false);
      alert('Image processing completed! (This is a demo)');
    }, 2000);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'resize':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Resize Image</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-white/80 text-sm mb-1">Width (px)</label>
                <input type="number" defaultValue="800" className="w-full p-2 bg-white/10 border border-white/20 rounded text-white" />
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-1">Height (px)</label>
                <input type="number" defaultValue="600" className="w-full p-2 bg-white/10 border border-white/20 rounded text-white" />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input type="checkbox" id="maintain-ratio" className="rounded" />
              <label htmlFor="maintain-ratio" className="text-white/80 text-sm">Maintain aspect ratio</label>
            </div>
          </div>
        );
      case 'crop':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Crop Image</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-white/80 text-sm mb-1">Aspect Ratio</label>
                <select className="w-full p-2 bg-white/10 border border-white/20 rounded text-white">
                  <option>Custom</option>
                  <option>1:1 (Square)</option>
                  <option>4:3</option>
                  <option>16:9</option>
                  <option>3:2</option>
                </select>
              </div>
              <p className="text-white/60 text-sm">Click and drag on the image to select crop area</p>
            </div>
          </div>
        );
      case 'rotate':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Rotate Image</h3>
            <div className="space-y-3">
              <div className="flex space-x-2">
                <button className="flex-1 p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">90° CW</button>
                <button className="flex-1 p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">90° CCW</button>
              </div>
              <div className="flex space-x-2">
                <button className="flex-1 p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">180°</button>
                <button className="flex-1 p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">Flip H</button>
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-1">Custom Angle</label>
                <input type="range" min="-180" max="180" defaultValue="0" className="w-full" />
              </div>
            </div>
          </div>
        );
      case 'filter':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Apply Filters</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-white/80 text-sm mb-1">Brightness</label>
                <input type="range" min="-100" max="100" defaultValue="0" className="w-full" />
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-1">Contrast</label>
                <input type="range" min="-100" max="100" defaultValue="0" className="w-full" />
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-1">Saturation</label>
                <input type="range" min="-100" max="100" defaultValue="0" className="w-full" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">Grayscale</button>
                <button className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">Sepia</button>
                <button className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">Blur</button>
                <button className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white text-sm">Sharpen</button>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 space-y-6">
          {/* Header */}
          <div className="text-center py-4">
            <div className="flex items-center justify-center mb-3">
              <FileImage size={28} className="text-purple-400 mr-3" />
              <h1 className="text-2xl font-bold text-white">Image Tools</h1>
            </div>
            <p className="text-white/60 text-sm">Edit, resize, crop, and enhance your images</p>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Upload Section */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4">
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center">
                <Upload size={18} className="mr-2" />
                Upload Image
              </h2>

              <div className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center hover:border-white/40 transition-colors">
                <input
                  type="file"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="image-upload"
                  accept="image/*"
                />
                <label htmlFor="image-upload" className="cursor-pointer">
                  <FileImage size={40} className="text-white/40 mx-auto mb-3" />
                  <p className="text-white/80 mb-1">Upload Image</p>
                  <p className="text-white/40 text-sm">JPG, PNG, WebP, GIF</p>
                </label>
              </div>

              {selectedImage && (
                <div className="mt-4 p-3 bg-white/5 rounded-lg">
                  <p className="text-white/80 text-sm">
                    <strong>File:</strong> {selectedImage.name}
                  </p>
                  <p className="text-white/60 text-sm">
                    Size: {(selectedImage.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              )}
            </div>

            {/* Tools & Preview Section */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4">
              <h2 className="text-lg font-semibold text-white mb-3">Image Tools</h2>

              {/* Tool Tabs */}
              <div className="flex flex-wrap gap-1 mb-4">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-1 px-3 py-2 rounded-lg text-sm transition-all ${
                      activeTab === tab.id
                        ? 'bg-purple-500/20 text-white border border-purple-500/30'
                        : 'bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.name}</span>
                  </button>
                ))}
              </div>

              {renderTabContent()}

              {/* Preview Section */}
              <div className="mt-6">
                <h3 className="text-white font-medium mb-3 flex items-center">
                  <Eye size={16} className="mr-2" />
                  Preview
                </h3>
                <div className="bg-white/5 rounded-lg p-4 h-64 flex items-center justify-center">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  ) : (
                    <div className="text-center">
                      <FileImage size={48} className="text-white/20 mx-auto mb-2" />
                      <p className="text-white/40">Upload an image to see preview</p>
                    </div>
                  )}
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>

              <button
                onClick={handleProcess}
                disabled={!selectedImage || isProcessing}
                className="w-full mt-4 p-3 bg-purple-500/20 hover:bg-purple-500/30 disabled:bg-white/5
                         border border-purple-500/30 hover:border-purple-500/50 disabled:border-white/10
                         rounded-lg text-white disabled:text-white/40 transition-all flex items-center justify-center"
              >
                {isProcessing ? (
                  <>
                    <RotateCw size={20} className="mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Download size={20} className="mr-2" />
                    Apply Changes
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Features Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="group relative overflow-hidden bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-purple-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-purple-500/20 rounded-lg inline-block mb-3">
                  <Sliders size={20} className="text-purple-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Resize</h3>
                <p className="text-white/60 text-xs leading-relaxed">Change image dimensions</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-green-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/0 to-green-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-green-500/20 rounded-lg inline-block mb-3">
                  <Crop size={20} className="text-green-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Crop</h3>
                <p className="text-white/60 text-xs leading-relaxed">Remove unwanted areas</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-blue-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-blue-500/20 rounded-lg inline-block mb-3">
                  <RotateCw size={20} className="text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Rotate</h3>
                <p className="text-white/60 text-xs leading-relaxed">Rotate and flip images</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-orange-500/10 to-orange-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-orange-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/0 to-orange-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-orange-500/20 rounded-lg inline-block mb-3">
                  <Palette size={20} className="text-orange-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Filters</h3>
                <p className="text-white/60 text-xs leading-relaxed">Apply visual effects</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImgToolsInterface;