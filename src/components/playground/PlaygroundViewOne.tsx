import React, { useState } from 'react';
import { Image, Info, Send, ChevronLeft, ChevronRight, MessageCircle, FileImage, Database } from 'lucide-react';
import OverviewTaskbar from '../overview/OverviewTaskbar';
import ModelSelector from '../common/ModelSelector';
import ApiTokenNotice from '../common/ApiTokenNotice';

// Define aspect ratio options for image generation
const aspectRatioOptions = [
  { ratio: '1:1', width: 1024, height: 1024 },
  { ratio: '4:3', width: 1024, height: 768 },
  { ratio: '3:4', width: 768, height: 1024 },
  { ratio: '16:9', width: 1024, height: 576 },
  { ratio: '9:16', width: 576, height: 1024 },
  { ratio: '2:1', width: 1024, height: 512 }
];

// PlaygroundViewOne - Unified view that combines:
// 1. Taskbar (navigation)
// 2. Left container (image generation controls)
// 3. Right container (results panel)
const PlaygroundViewOne: React.FC = () => {
  // State for sidebar
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [labs, setLabs] = useState([
    { id: 'lab-1', name: 'Project Alpha', lastModified: new Date() },
    { id: 'lab-2', name: 'Creative Concepts', lastModified: new Date() }
  ]);
  
  // State for image generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiTokenAvailable, setApiTokenAvailable] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [numGenerations, setNumGenerations] = useState(1);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  
  // Model selection
  const [models, setModels] = useState([
    { id: 'sd3', name: 'Stable Diffusion 3.5 Large' },
    { id: 'sd3-small', name: 'Stable Diffusion 3.5 Small' },
    { id: 'flux-1.1', name: 'Flux 1.1' }
  ]);
  const [selectedModel, setSelectedModel] = useState('sd3');
  
  // Sidebar handlers
  const handleCreateLab = () => {
    const newLab = {
      id: `lab-${labs.length + 1}`,
      name: `New Project ${labs.length + 1}`,
      lastModified: new Date()
    };
    setLabs([...labs, newLab]);
  };
  
  const handleSidebarCollapseChange = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
  };
  
  // Image generation handlers
  const handleAspectRatioChange = (newWidth: number, newHeight: number) => {
    setWidth(newWidth);
    setHeight(newHeight);
  };
  
  const getCurrentAspectRatio = (): string => {
    const option = aspectRatioOptions.find(
      opt => opt.width === width && opt.height === height
    );
    return option ? option.ratio : `${width}:${height}`;
  };
  
  const increaseGenerations = () => {
    if (numGenerations < 4) setNumGenerations(numGenerations + 1);
  };
  
  const decreaseGenerations = () => {
    if (numGenerations > 1) setNumGenerations(numGenerations - 1);
  };
  
  const isGemini = () => false;
  
  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    
    setIsGenerating(true);
    
    try {
      // Create placeholder images for demo
      const newImages = [];
      for (let i = 0; i < numGenerations; i++) {
        // Use Unsplash to generate random images based on the prompt
        const imageUrl = `https://source.unsplash.com/random/${width}x${height}/?${encodeURIComponent(prompt)}`;
        newImages.push(imageUrl);
      }
      
      // Simulate loading
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Add new images to the state
      setGeneratedImages(newImages);
      
    } catch (error) {
      console.error('Error generating image:', error);
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleGenerate();
      e.preventDefault();
    }
  };
  
  const handleTokenSaved = () => {
    setApiTokenAvailable(true);
  };
  
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gradient-to-br from-gray-900 to-black">
      {/* Unified container for all three elements */}
      <div className="flex flex-1 h-full relative overflow-hidden">
        {/* 1. Sidebar - Left navigation panel */}
        <div className="z-10 h-full">
          <OverviewTaskbar
            labs={labs}
            onCreateLab={handleCreateLab}
            onCollapseChange={handleSidebarCollapseChange}
          />
        </div>
        
        {/* Main content area with both control panel and results */}
        <div className={`flex-1 flex transition-all duration-300 ${isSidebarCollapsed ? 'ml-20' : 'ml-68'}`}>
          {/* Image generation interface container - both panels in a single container */}
          <div className="flex-1 flex flex-col lg:flex-row p-6 h-full overflow-hidden">
            {/* 2. Left container - Control panel */}
            <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 space-y-3 lg:w-[30%] lg:max-w-[350px] mr-6 backdrop-blur-sm h-full overflow-hidden">
              {/* Token notice if needed */}
              {!apiTokenAvailable && (
                <ApiTokenNotice 
                  serviceKey="replicate" 
                  onTokenSaved={handleTokenSaved}
                />
              )}
              
              {/* Header with icon */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center">
                  <Image size={16} className="mr-2 text-indigo-400" />
                  <span>Image Generation</span>
                </h2>
                <div className="px-2 py-1 bg-indigo-600/30 rounded-md text-xs text-white/80">
                  AI Studio
                </div>
              </div>
              
              {/* Model selector */}
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onChange={setSelectedModel}
                disabled={isGenerating}
              />
              
              {/* Prompt input with enhanced design */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-white/70 font-medium mb-1">
                  <span>Prompt</span>
                  <span className="text-indigo-400/80">{prompt.length} chars</span>
                </div>
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the image you want to generate in detail..."
                    className="w-full h-28 bg-black/40 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-400/50 shadow-inner"
                    disabled={isGenerating}
                    onKeyDown={handleKeyDown}
                  />
                  {prompt.length > 0 && (
                    <button 
                      onClick={() => setPrompt('')}
                      className="absolute top-2 right-2 text-white/40 hover:text-white/70 p-1 rounded-full"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              
              {/* Credit usage info */}
              <div className="bg-[rgba(20,20,20,0.5)] border border-indigo-500/10 rounded-lg px-3 py-2.5 mt-2 flex items-center shadow-inner">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center text-white/70">
                    <Database size={12} className="mr-1.5 text-indigo-400/70" />
                    <span className="text-xs">Credit usage</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-white/90 font-medium">
                      ~{
                        selectedModel === 'flux-1.1' ? 10 :
                        selectedModel === 'sd3' ? 3 :
                        selectedModel === 'sd3-small' ? 2 :
                        2  // default for other models
                      } credits
                    </span>
                    <span className="text-white/50 ml-1">per image</span>
                  </div>
                </div>
              </div>
              
              {/* Parameters controls in a more consistent format */}
              <div className="mt-2">
                {/* Controls Header */}
                <div className="text-white/80 text-xs font-medium mb-2 px-1 flex items-center">
                  <span className="inline-block w-1.5 h-1.5 bg-indigo-400 rounded-full mr-1.5"></span>
                  Generation Parameters
                </div>
                
                {/* Aspect Ratio Control with improved design */}
                <div className="mb-3 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-white/70 text-xs">Aspect ratio</span>
                    <span className="text-xs text-indigo-400/80">{getCurrentAspectRatio()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {aspectRatioOptions.map((option) => (
                      <button
                        key={option.ratio}
                        onClick={() => handleAspectRatioChange(option.width, option.height)}
                        className={`px-2 py-1.5 rounded-md text-xs ${
                          getCurrentAspectRatio() === option.ratio
                            ? 'bg-indigo-500/30 text-white border border-indigo-500/20'
                            : 'bg-black/30 text-white/70 hover:bg-black/40 border border-transparent hover:border-white/10'
                        }`}
                      >
                        {option.ratio}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Number of Generations Control */}
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-white/70 text-xs">Number of images</span>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={decreaseGenerations} 
                        disabled={numGenerations <= 1 || isGenerating}
                        className={`flex items-center justify-center h-6 w-6 rounded-md ${
                          numGenerations <= 1 || isGenerating
                            ? 'text-white/30 cursor-not-allowed'
                            : 'text-white/80 bg-black/30 hover:bg-black/50'
                        }`}
                      >
                        <svg width="14" height="2" viewBox="0 0 14 2" xmlns="http://www.w3.org/2000/svg">
                          <path d="M0 1h14" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </button>
                      <div className="flex items-center justify-center w-10 text-white text-center">
                        {numGenerations}
                      </div>
                      <button
                        onClick={increaseGenerations} 
                        disabled={numGenerations >= 4 || isGenerating}
                        className={`flex items-center justify-center h-6 w-6 rounded-md ${
                          numGenerations >= 4 || isGenerating
                            ? 'text-white/30 cursor-not-allowed'
                            : 'text-white/80 bg-black/30 hover:bg-black/50'
                        }`}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                          <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Generate button with improved design */}
              <div className="mt-4">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className={`w-full p-2.5 rounded-lg text-white flex items-center justify-center text-sm font-medium
                    ${
                      isGenerating
                        ? 'bg-gradient-to-r from-indigo-600/40 to-purple-600/40 cursor-not-allowed'
                        : prompt.trim()
                          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-900/20'
                          : 'bg-gradient-to-r from-indigo-600/30 to-purple-600/30 cursor-not-allowed'
                    }
                  `}
                >
                  {isGenerating ? (
                    <>
                      <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Creating Images...
                    </>
                  ) : (
                    <>
                      <Send size={16} className="mr-2" />
                      Generate {numGenerations > 1 ? `${numGenerations} Images` : 'Image'}
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {/* 3. Right container - Results panel */}
            <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-5 flex-1 lg:ml-2 backdrop-blur-sm h-full overflow-hidden flex flex-col">
              {/* Results header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center">
                  <FileImage size={16} className="mr-2 text-indigo-400" />
                  <span>Generated Images</span>
                </h2>
                
                {generatedImages.length > 0 && (
                  <button className="px-2.5 py-1 text-xs bg-black/30 hover:bg-black/40 text-white/70 hover:text-white/90 rounded-md flex items-center border border-white/5">
                    <span>Gallery</span>
                    <ChevronRight size={14} className="ml-1" />
                  </button>
                )}
              </div>
              
              {/* Results content area */}
              <div className="flex-1 overflow-hidden">
                {generatedImages.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full overflow-y-auto p-1">
                    {generatedImages.map((imageUrl, index) => (
                      <div 
                        key={index} 
                        className="relative group rounded-lg overflow-hidden border border-white/5 bg-black/20 shadow-md h-[250px]"
                      >
                        <img 
                          src={imageUrl} 
                          alt={`Generated from: ${prompt}`} 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-white text-xs truncate max-w-[80%]">
                                {prompt}
                              </div>
                              <div className="flex gap-1">
                                <button className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                  </svg>
                                </button>
                                <button className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                                    <polyline points="16 6 12 2 8 6"></polyline>
                                    <line x1="12" y1="2" x2="12" y2="15"></line>
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center border border-dashed border-white/10 rounded-lg bg-black/20">
                    <div className="text-white/50 text-sm text-center p-8 max-w-md">
                      {isGenerating ? (
                        <div className="flex flex-col items-center">
                          <svg className="animate-spin h-10 w-10 mb-4 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <p className="text-lg font-medium mb-2">Creating your masterpiece...</p>
                          <p className="text-sm text-white/40">This might take a few moments while we work our AI magic</p>
                        </div>
                      ) : (
                        <>
                          <Image className="h-16 w-16 mx-auto mb-4 opacity-20 text-indigo-300" />
                          <p className="text-lg font-medium mb-2">Your creative canvas awaits</p>
                          <p className="mb-4 text-sm text-white/40">Enter a detailed prompt on the left and click "Generate" to create images</p>
                          <div className="bg-black/30 rounded-lg p-3 text-xs text-left border border-white/5 max-w-xs mx-auto">
                            <p className="text-white/70 font-medium mb-1">Try these prompt ideas:</p>
                            <ul className="list-disc list-inside space-y-1 text-indigo-300/80">
                              <li>A serene landscape with mountains at sunset</li>
                              <li>Futuristic cityscape with flying cars and neon lights</li>
                              <li>Photorealistic portrait of a cyberpunk character</li>
                            </ul>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaygroundViewOne;
