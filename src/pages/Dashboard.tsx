import React, { useState, createContext, useContext, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import OverviewTaskbar from '../components/overview/OverviewTaskbar';
import EmptyState from '../components/overview/EmptyState';
import TopUpModal from '../components/overview/TopUpModal';
import CreateLabModal from '../components/overview/CreateLabModal';
import Overview from '../components/overview/Overview';
import CanvasView from '../components/canvas/CanvasView';
import { Beaker, Image, Video, ArrowUpRight, BrainCircuit, Palette, Sparkles, MessageSquare } from 'lucide-react';

// Import playground interfaces with gallery
import ImageGenerationInterface from '../components/playground/Generation/ImageGenerationInterface';

import ImageUpscaleInterface from '../components/playground/Enhance/ImageEnhanceInterface'; // corrected path
import VideoUpscaleInterface from '../components/playground/Enhance/VideoEnhanceInterface'; // Resolved missing import by creating placeholder component
import MultiChatContainer from '../components/playground/Chat/MultiChatContainer';
import ChatWithVoice from '../components/playground/Chat/ChatWithVoice';
import ThreeDGenerationInterface from '../components/playground/Generation/ThreeDGenerationInterface';
import AudioGenerationInterface from '../components/playground/Generation/AudioGenerationInterface';

import VideoGenerationInterface from '../components/playground/Generation/VideoGenerationInterface';

// Add imports for the new training components
import LoRaImageTrainComponent from '../components/playground/Train/LoRaImageTrainInterface';
import LoRaVideoTrainComponent from '../components/playground/Train/LoRaVideoTrainInterface';
import TextLLMTrainComponent from '../components/playground/Train/TextLLMTrainInterface';

// Import the new Search Interface (OLD - TO BE REMOVED/REPLACED)
// import SearchInterface from '../components/playground/Search/SearchInterface'; Removed this line

// Import new Search sub-interfaces
import GeneralSearchInterface from '../components/playground/Search/GeneralSearchInterface';
import FinanceSearchInterface from '../components/playground/Search/FinanceSearchInterface';
import ShoppingSearchInterface from '../components/playground/Search/ShoppingSearchInterface';

// Import new Studio interfaces
import { ImageStudio as ImageStudioInterface } from '../components/playground/Studio/ImageStudio';
// Lazy load VideoStudio to avoid circular dependency issues
const VideoStudioInterface = React.lazy(() => import('../components/playground/Studio/VideoStudio').then(m => ({ default: m.VideoStudio || m.default })));
import AudioStudioInterface from '../components/playground/Studio/AudioStudioInterface';

// Import IOPaint interface
import ImageInpaintingStudio from '../components/ImageInpainting/ImageInpaintingStudio';

// Mock data for labs
interface Lab {
  id: string;
  name: string;
  description?: string;
  image?: string;
  status?: 'active' | 'maintenance' | 'coming-soon';
  lastModified: Date;
}

const mockLabs: Lab[] = [
  // Uncomment to see populated labs
  /*
  {
    id: 'lab-1',
    name: 'Image Classification Lab',
    lastModified: new Date('2023-05-15')
  },
  {
    id: 'lab-2',
    name: 'Video Generation Workflow',
    lastModified: new Date('2023-06-20')
  },
  */
];

// Layout context for sidebar state
interface LayoutContextType {
  isSidebarCollapsed: boolean;
}

const LayoutContext = createContext<LayoutContextType>({ isSidebarCollapsed: false });

export const useLayout = () => useContext(LayoutContext);

const Dashboard: React.FC = () => {
  const [labs] = useState(mockLabs);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [isCreateLabModalOpen, setIsCreateLabModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCleanMode, setIsCleanMode] = useState(localStorage.getItem('isCleanMode') === 'true');

  // Handle creating a new lab
  const handleCreateLab = () => {
    // Open the create lab modal
    setIsCreateLabModalOpen(true);
  };
  
  // Top up modal controls
  const openTopUpModal = () => setIsTopUpModalOpen(true);
  const closeTopUpModal = () => setIsTopUpModalOpen(false);
  
  // Create lab modal controls
  const closeCreateLabModal = () => setIsCreateLabModalOpen(false);

  // Handle sidebar collapse state changes
  const handleSidebarCollapseChange = (collapsed: boolean) => {
    setIsSidebarCollapsed(collapsed);
  };

  // Handle interface mode toggle
  const toggleInterfaceMode = () => {
    const newMode = !isCleanMode;
    setIsCleanMode(newMode);
    localStorage.setItem('isCleanMode', newMode.toString());
    window.dispatchEvent(new CustomEvent('interface_mode_changed', { 
      detail: { isCleanMode: newMode } 
    }));
  };

  // Listen for interface mode changes from other components
  useEffect(() => {
    const handleInterfaceModeChange = (event: CustomEvent) => {
      setIsCleanMode(event.detail.isCleanMode);
    };

    window.addEventListener('interface_mode_changed', handleInterfaceModeChange as EventListener);
    
    return () => {
      window.removeEventListener('interface_mode_changed', handleInterfaceModeChange as EventListener);
    };
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <LayoutContext.Provider value={{ isSidebarCollapsed }}>
        <Routes>
          {/* Full-screen canvas view - no header or sidebar */}
          <Route path="/labs/:labId/canvas" element={<CanvasView />} />
          
          {/* Regular dashboard layout with header and sidebar */}
          <Route path="/*" element={
            <>
              {/* DashboardHeader removed as requested */}
              
              <div className="flex-1 overflow-hidden relative pt-0">
                {/* Sidebar - positioned as floating element */}
                <div className="z-10 fixed top-0 left-0 h-full">
                  <OverviewTaskbar 
                    labs={labs} 
                    onCreateLab={handleCreateLab} 
                    onCollapseChange={handleSidebarCollapseChange}
                    onToggleInterface={toggleInterfaceMode}
                    isCleanMode={isCleanMode}
                  />
                </div>
                
                {/* Main content area - with dynamic margin that follows sidebar edge */}
                <div 
                  className="flex-1 overflow-auto h-screen transition-all duration-300"
                  style={{ 
                    marginLeft: isSidebarCollapsed 
                      ? '4rem' // Exact width of collapsed sidebar
                      : '16rem', // Exact width of expanded sidebar
                    paddingLeft: '1rem',
                    paddingRight: '1rem',
                    paddingTop: '1rem',
                    paddingBottom: '1rem'
                  }}
                >
                  <Routes>
                    {/* Main dashboard home */}
                    <Route path="/" element={<Overview />} />
                    
                    {/* Labs empty state */}
                    <Route path="/labs" element={
                      <div className="h-full">
                        {labs.length === 0 ? (
                          <EmptyState
                            title="Welcome to XenoLabs"
                            description="Get started by creating your first AI workflow lab. Connect AI components to build intelligent systems with drag-and-drop simplicity."
                            buttonText="Create your first lab"
                            onAction={handleCreateLab}
                            icon={<Beaker size={32} className="text-white/40" />}
                          />
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0">
                            {/* Lab cards would go here */}
                            <div className="bg-white/5 rounded-xl border border-white/10 p-6">
                              <h2 className="text-lg font-semibold text-white">Lab card placeholder</h2>
                            </div>
                          </div>
                        )}
                      </div>
                    } />
                    
                    {/* Playground routes - Generation with Gallery */}
                    <Route path="/playground/generation/image" element={<ImageGenerationInterface />} />
                    <Route path="playground/generation/image" element={<ImageGenerationInterface />} />

                    <Route path="playground/generation/3d" element={<ThreeDGenerationInterface />} />
                    <Route path="playground/generation/video" element={<VideoGenerationInterface />} />
                    <Route path="/playground/generation/video" element={<VideoGenerationInterface />} />
                    <Route path="/playground/generation/audio" element={<AudioGenerationInterface />} />
                    <Route path="playground/generation/audio" element={<AudioGenerationInterface />} />
                    
                    {/* Playground routes - Enhance with Gallery */}
                    <Route path="/playground/enhance/image" element={<ImageUpscaleInterface />} />
                    <Route path="/playground/enhance/video" element={<VideoUpscaleInterface />} />

                    <Route path="playground/enhance/image" element={<ImageUpscaleInterface />} />
                    <Route path="playground/enhance/video" element={<VideoUpscaleInterface />} />

                    
                    {/* For backward compatibility */}
                    <Route path="/playground/upscale/video" element={<VideoUpscaleInterface />} />
                    <Route path="playground/upscale/video" element={<VideoUpscaleInterface />} />
                    
                    {/* Playground routes - Training */}
                    <Route path="/playground/train/lora" element={<LoRaImageTrainComponent />} />
                    <Route path="/playground/train/lora-video" element={<LoRaVideoTrainComponent />} />
                    <Route path="/playground/train/llm" element={<TextLLMTrainComponent />} />
                    <Route path="playground/train/lora" element={<LoRaImageTrainComponent />} />
                    <Route path="playground/train/lora-video" element={<LoRaVideoTrainComponent />} />
                    <Route path="playground/train/llm" element={<TextLLMTrainComponent />} />
                    
                    {/* Playground routes - Chat with LLM */}
                    <Route path="/playground/chat/llm" element={<MultiChatContainer />} />
                    <Route path="playground/chat/llm" element={<MultiChatContainer />} />
                    <Route path="/playground/chat/voice" element={<ChatWithVoice />} />
                    <Route path="playground/chat/voice" element={<ChatWithVoice />} />
                    
                    {/* Playground routes - Search (OLD - TO BE REMOVED/REPLACED) */}
                    {/* <Route path="/playground/search" element={<SearchInterface />} /> */}
                    {/* <Route path="playground/search" element={<SearchInterface />} /> */}

                    {/* New Playground routes - Search Subsections */}
                    <Route path="/playground/search/general" element={<GeneralSearchInterface />} />
                    <Route path="playground/search/general" element={<GeneralSearchInterface />} />
                    <Route path="/playground/search/finance" element={<FinanceSearchInterface />} />
                    <Route path="playground/search/finance" element={<FinanceSearchInterface />} />
                    <Route path="/playground/search/shopping" element={<ShoppingSearchInterface />} />
                    <Route path="playground/search/shopping" element={<ShoppingSearchInterface />} />
                    
                    {/* New Playground routes - Studio */}
                    <Route path="/playground/studio/image" element={<ImageStudioInterface />} />
                    <Route path="playground/studio/image" element={<ImageStudioInterface />} />
                    <Route path="/playground/studio/video" element={<React.Suspense fallback={<div>Loading Video Studio...</div>}><VideoStudioInterface /></React.Suspense>} />
                    <Route path="playground/studio/video" element={<React.Suspense fallback={<div>Loading Video Studio...</div>}><VideoStudioInterface /></React.Suspense>} />
                    <Route path="/playground/studio/audio" element={<AudioStudioInterface />} />
                    <Route path="playground/studio/audio" element={<AudioStudioInterface />} />
                    
                    {/* IOPaint Inpainting Studio */}
                    <Route path="/playground/studio/inpainting" element={<ImageInpaintingStudio />} />
                    <Route path="playground/studio/inpainting" element={<ImageInpaintingStudio />} />
                    
                    {/* Account settings routes would go here */}
                    <Route path="/profile" element={<div><h1 className="text-xl font-bold text-white">Profile</h1></div>} />
                    <Route path="/subscription" element={<div><h1 className="text-xl font-bold text-white">Subscription</h1></div>} />
                    <Route path="/theme" element={<div><h1 className="text-xl font-bold text-white">Theme</h1></div>} />
                    <Route path="/usage" element={<div><h1 className="text-xl font-bold text-white">Usage</h1></div>} />
                    <Route path="/settings" element={<div><h1 className="text-xl font-bold text-white">Settings</h1></div>} />
                    
                    {/* Individual lab routes */}
                    <Route path="/labs/:labId" element={<div><h1 className="text-xl font-bold text-white">Lab Editor</h1></div>} />
                  </Routes>
                </div>
              </div>
              
              {/* Modals */}
              <TopUpModal isOpen={isTopUpModalOpen} onClose={closeTopUpModal} />
              <CreateLabModal isOpen={isCreateLabModalOpen} onClose={closeCreateLabModal} />
            </>
          } />
        </Routes>
      </LayoutContext.Provider>
    </div>
  );
};

export default Dashboard;