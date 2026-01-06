import React, { useState, useEffect } from 'react';
import { Image, Info, Send } from 'lucide-react';
import ModelSelector from '../common/ModelSelector';
import ApiTokenNotice from '../common/ApiTokenNotice';

// Define aspect ratio options
const aspectRatioOptions = [
  { ratio: '1:1', width: 1024, height: 1024 },
  { ratio: '4:3', width: 1024, height: 768 },
  { ratio: '3:4', width: 768, height: 1024 },
  { ratio: '16:9', width: 1024, height: 576 },
  { ratio: '9:16', width: 576, height: 1024 },
  { ratio: '2:1', width: 1024, height: 512 }
];

// Event name for image generation
export const IMAGE_GENERATED_EVENT = 'image_generated';

/**
 * DirectImageGeneration component
 * Contains just the two image generation interface panels without any container wrapper
 */
const DirectImageGeneration: React.FC = () => {
  // State for UI
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiTokenAvailable, setApiTokenAvailable] = useState(true);
  
  // State for generation settings
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [numGenerations, setNumGenerations] = useState(1);
  
  // Model selection
  const [models, setModels] = useState([
    { id: 'sd3', name: 'Stable Diffusion 3.5 Large' },
    { id: 'sd3-small', name: 'Stable Diffusion 3.5 Small' },
    { id: 'flux-1.1', name: 'Flux 1.1' }
  ]);
  const [selectedModel, setSelectedModel] = useState('sd3');
  
  // Handler for aspect ratio changes
  const handleAspectRatioChange = (newWidth: number, newHeight: number) => {
    setWidth(newWidth);
    setHeight(newHeight);
  };
  
  // Get current aspect ratio
  const getCurrentAspectRatio = (): string => {
    const option = aspectRatioOptions.find(
      opt => opt.width === width && opt.height === height
    );
    return option ? option.ratio : `${width}:${height}`;
  };
  
  // Handler for increasing/decreasing number of generations
  const increaseGenerations = () => {
    if (numGenerations < 4) setNumGenerations(numGenerations + 1);
  };
  
  const decreaseGenerations = () => {
    if (numGenerations > 1) setNumGenerations(numGenerations - 1);
  };
  
  // Check if using Gemini
  const isGemini = () => false;
  
  // Handle generate button click
  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    
    setIsGenerating(true);
    
    try {
      // Simulate generation for demo
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Create a sample result
      const imageUrl = `https://source.unsplash.com/random/1024x1024/?${encodeURIComponent(prompt)}`;
      
      // Dispatch event for generated image
      const generatedEvent = new CustomEvent(IMAGE_GENERATED_EVENT, {
        detail: {
          id: `img-${Date.now()}`,
          url: imageUrl,
          prompt: prompt,
          model: selectedModel,
          settings: {
            width,
            height,
            numGenerations
          }
        }
      });
      
      document.dispatchEvent(generatedEvent);
      
    } catch (error) {
      console.error('Error generating image:', error);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Handle key down for generating on enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleGenerate();
      e.preventDefault();
    }
  };
  
  // Handler for token saved
  const handleTokenSaved = () => {
    setApiTokenAvailable(true);
  };
  
  return (
    <div className="flex flex-col lg:flex-row h-full relative">
      {/* Left side - Controls panel */}
      <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 space-y-2 lg:w-[30%] lg:max-w-[350px] mr-2">
        {/* Header */}
        <h2 className="text-base font-semibold text-white flex items-center">
          <Image size={14} className="mr-1.5" />
          Image Generation
        </h2>
        
        {/* Model selector */}
        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          onChange={setSelectedModel}
          disabled={isGenerating}
        />
        
        {/* Prompt input */}
        <div className="mt-2 space-y-2">
          <div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate in detail..."
              className="w-full h-24 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
              disabled={isGenerating}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        
        {/* Credit usage info */}
        <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg px-1.5 py-2.5 mt-2 min-h-[40px] flex items-center">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center text-white/70">
              <Info size={10} className="mr-1" />
              <span className="text-xs">Credit usage</span>
            </div>
            <div className="text-xs">
              <span className="text-white/90 font-medium">
                ~{
                  selectedModel === 'flux-1.1' ? 10 :
                  selectedModel === 'fal-ai/stable-diffusion-v35-large' ? 12 :
                  selectedModel === 'fal-ai/luma-photon/flash' ? 8 :
                  selectedModel === 'fal-ai/recraft/v3/text-to-image' ? 7 :
                  selectedModel === 'fal-ai/ideogram/v3' ? 6 :
                  selectedModel === 'fal-ai/ideogram/v2a/turbo' ? 4 :
                  2  // default for other models
                } credits
              </span>
              <span className="text-white/50 ml-1">per image</span>
            </div>
          </div>
        </div>
        
        {/* Parameters controls */}
        <div className="mt-2">
          {/* Controls Header */}
          <div className="text-white/70 text-xs mb-1.5 px-1">Generation Parameters</div>
          
          {/* Aspect Ratio Control */}
          <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white/70 text-xs">Aspect ratio</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {aspectRatioOptions.map((option) => (
                <button
                  key={option.ratio}
                  onClick={() => handleAspectRatioChange(option.width, option.height)}
                  className={`px-2 py-1.5 rounded-md text-xs ${
                    getCurrentAspectRatio() === option.ratio
                      ? 'bg-white/20 text-white'
                      : 'bg-black/30 text-white/70 hover:bg-black/40'
                  }`}
                >
                  {option.ratio}
                </button>
              ))}
            </div>
          </div>
          
          {/* Number of Generations Control */}
          <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
            <div className="flex items-center justify-between mb-1.5">
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
                <div className="flex items-center justify-center w-8 text-white text-center">
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
        
        {/* Generate button */}
        <div className="mt-2">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className={`w-full p-2 rounded-lg text-white flex items-center justify-center text-xs
              ${
                isGenerating
                  ? 'bg-gradient-to-r from-purple-700/50 to-blue-700/50 cursor-not-allowed'
                  : prompt.trim()
                    ? 'bg-gradient-to-r from-purple-700 to-blue-700 hover:from-purple-600 hover:to-blue-600'
                    : 'bg-gradient-to-r from-purple-700/30 to-blue-700/30 cursor-not-allowed'
              }
            `}
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-3 w-3 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </>
            ) : (
              <>
                <Send size={14} className="mr-1.5" />
                Generate {numGenerations > 1 ? `${numGenerations} images` : 'image'}
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Right side - Preview & results */}
      <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col h-full flex-1 lg:ml-2">
        {/* Content will be populated here with generated images */}
        <div className="flex flex-col h-full">
          <h2 className="text-base font-semibold text-white/80 mb-4">Generated Images</h2>
          <div className="flex-1 flex items-center justify-center border border-dashed border-white/10 rounded-lg bg-black/20">
            <div className="text-white/50 text-sm text-center p-8">
              {isGenerating ? (
                <div className="flex flex-col items-center">
                  <svg className="animate-spin h-8 w-8 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p>Creating your masterpiece...</p>
                </div>
              ) : (
                <>
                  <Image className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Your generated images will appear here</p>
                  <p className="mt-2 text-xs">Enter a prompt and click "Generate"</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectImageGeneration;
