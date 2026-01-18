import React, { useState, createContext, useContext, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import OverviewTaskbar from '../components/overview/OverviewTaskbar';
import OSAuthInterface from '../components/os/OSAuthInterface';
import DisplayContainer from '../components/layout/DisplayContainer';
import EmptyState from '../components/overview/EmptyState';
import TopUpModal from '../components/overview/TopUpModal';
import CreateLabModal from '../components/overview/CreateLabModal';
import ClaimCreditsModal from '../components/modals/ClaimCreditsModal';
import Overview from '../components/overview/Overview';
import CanvasView from '../components/canvas/CanvasView';
import WindowManager, { useWindowManager, createFileExplorerWindow, createSettingsWindow } from '../components/os/desktop/WindowManager';
import { Beaker, Image, Video, ArrowUpRight, BrainCircuit, Palette, Sparkles, MessageSquare } from 'lucide-react';

// Import playground interfaces with gallery
import ImageGenerationInterface from '../components/playground/Generation/ImageGenerationInterface';
import ImageGenerationInterface2 from '../components/playground/Generation/ImageGenerationInterface2';
import ImageUpscaleInterface from '../components/playground/Enhance/ImageEnhanceInterface';
import VideoUpscaleInterface from '../components/playground/Enhance/VideoEnhanceInterface';
import MultiChatContainer from '../components/playground/Chat/MultiChatContainer';
import ChatWithVoice from '../components/playground/Chat/ChatWithVoice';
import SearchChatInterface from '../components/playground/Chat/SearchChatInterface';
import ThreeDGenerationInterface from '../components/playground/Generation/ThreeDGenerationInterface';
import AudioGenerationInterface from '../components/playground/Generation/AudioGenerationInterface';
import VideoGenerationInterface from '../components/playground/Generation/VideoGenerationInterface';
// Add imports for the new training components
import LoRaImageTrainComponent from '../components/playground/Train/LoRaImageTrainInterface';
import LoRaVideoTrainComponent from '../components/playground/Train/LoRaVideoTrainInterface';
import TextLLMTrainComponent from '../components/playground/Train/TextLLMTrainInterface';
// Import new Search sub-interfaces
import GeneralSearchInterface from '../components/playground/Search/GeneralSearchInterface';
import FinanceSearchInterface from '../components/playground/Search/FinanceSearchInterface';
import ShoppingSearchInterface from '../components/playground/Search/ShoppingSearchInterface';
// Import new Studio interfaces
import ImageStudioInterface from '../components/playground/Studio/ImageStudio';
// Lazy load VideoStudio interface (the chat interface, not the canvas)
const VideoStudioInterface = React.lazy(() =>
  import('../components/playground/Studio/VideoStudioInterface')
);
import AudioStudioInterface from '../components/playground/Studio/AudioStudioInterface';
// Import Office components
import CanvasPlanning from '../components/office/CanvasPlanning';
import CanvasPlanningVisual from '../components/office/CanvasPlanningVisual';
import PDFChatInterface from '../components/playground/Office/PDFChatInterface';
import WordChatInterface from '../components/playground/Office/WordChatInterface';
// Import IOPaint interface
import ImageInpaintingStudio from '../components/ImageInpainting/ImageInpaintingStudio';
// Import Tools interfaces
import ConvertToolsInterface from '../components/playground/Tools/ConvertToolsInterface';
import ConversionHistory from '../components/playground/Tools/ConversionHistory';
import CompressToolsInterface from '../components/playground/Tools/CompressToolsInterface';
import ImgToolsInterface from '../components/playground/Tools/ImgToolsInterface';
import PDFToolsInterface from '../components/playground/Tools/PDFToolsInterface';
import ShareToolsInterface from '../components/playground/Tools/ShareToolsInterface';
// Import Download interface
import DownloadToolsInterface from '../components/playground/Download/DownloadToolsInterface';
// Import Account pages
import ProfilePage from '../components/account/ProfilePage';
import SettingsPage from '../components/account/SettingsPage';
import UsageAnalyticsPage from '../components/account/UsageAnalyticsPage';
// Import Content Creation pages
import YouTubeChannelManager from '../components/youtube/YouTubeChannelManager';
import AllChannelsPage from '../components/youtube/AllChannelsPage';
import VideoDetailPage from '../components/youtube/VideoDetailPage';

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

// Create a separate component for the main content to use WindowManager hook
const OverviewContent: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [labs] = useState(mockLabs);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [isCreateLabModalOpen, setIsCreateLabModalOpen] = useState(false);
  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(false);
  // Taskbar is always collapsed
  const isSidebarCollapsed = true;
  const [isCleanMode, setIsCleanMode] = useState(localStorage.getItem('isCleanMode') === 'true');
  
  // Window management integration
  const { openWindow } = useWindowManager();

  // Check if user should see welcome modal
  useEffect(() => {
    if (user && user.credits === 0 && !user.bonus_credits_claimed) {
      setIsWelcomeModalOpen(true);
    }
  }, [user]);

  // Handle creating a new lab
  const handleCreateLab = () => {
    setIsCreateLabModalOpen(true);
  };
  
  // Handle opening Settings window
  const handleSettingsClick = () => {
    console.log('🔧 Opening Settings window...');
    const settingsWindow = createSettingsWindow();
    openWindow(settingsWindow.id, settingsWindow.title, settingsWindow.content, settingsWindow.icon, settingsWindow.size);
  };
  
  // Handle opening windows from taskbar
  const handleOpenWindow = (windowType: string) => {
    console.log('🪟 Opening window type:', windowType);
    if (windowType === 'file-explorer') {
      const explorerWindow = createFileExplorerWindow();
      openWindow(explorerWindow.id, explorerWindow.title, explorerWindow.content, explorerWindow.icon, explorerWindow.size);
    } else if (windowType === 'settings') {
      handleSettingsClick();
    }
  };
  // Top up modal controls
  const openTopUpModal = () => setIsTopUpModalOpen(true);
  const closeTopUpModal = () => setIsTopUpModalOpen(false);
  // Create lab modal controls
  const closeCreateLabModal = () => setIsCreateLabModalOpen(false);
  
  // Welcome modal controls
  const closeWelcomeModal = () => setIsWelcomeModalOpen(false);
  const handleWelcomeClaim = () => {
    // Modal will handle the API call and close itself
    // This could trigger a user data refresh if needed
    console.log('Welcome credits claimed!');
  };
  // Handle sidebar collapse state changes
  // Remove collapse handler, always collapsed
  const handleSidebarCollapseChange = () => {};
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
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'row', overflow: 'hidden', margin: 0, padding: 0 }}>
      <LayoutContext.Provider value={{ isSidebarCollapsed }}>
        {/* Left Taskbar - Original taskbar with OS button and AI interfaces */}
        <OverviewTaskbar 
          labs={labs}
          onCreateLab={handleCreateLab}
          onCollapseChange={handleSidebarCollapseChange}
          onToggleInterface={toggleInterfaceMode}
          isCleanMode={isCleanMode}
        />
        
        {/* Main content area - full width, minus taskbar width */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DisplayContainer>
          <Routes>
            {/* Full-screen canvas view - no header or sidebar */}
            <Route path="/labs/:labId/canvas" element={<CanvasView />} />
            {/* Main overview home */}
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
            {/* New direct feature routes (no playground) */}
            <Route path="generation/image" element={<ImageGenerationInterface />} />
            <Route path="generation/image2" element={<ImageGenerationInterface2 />} />
            <Route path="/overview/generation/image2" element={<ImageGenerationInterface2 />} />
            <Route path="generation/3d" element={<ThreeDGenerationInterface />} />
            <Route path="generation/video" element={<VideoGenerationInterface />} />
            <Route path="generation/audio" element={<AudioGenerationInterface />} />
            <Route path="enhance/image" element={<ImageUpscaleInterface />} />
            <Route path="enhance/video" element={<VideoUpscaleInterface />} />
            <Route path="upscale/video" element={<VideoUpscaleInterface />} />
            <Route path="train/lora" element={<LoRaImageTrainComponent />} />
            <Route path="train/lora-video" element={<LoRaVideoTrainComponent />} />
            <Route path="train/llm" element={<TextLLMTrainComponent />} />
            <Route path="chat/llm" element={<MultiChatContainer />} />
            <Route path="chat/voice" element={<ChatWithVoice />} />
            <Route path="chat/search" element={<SearchChatInterface />} />
            <Route path="search/general" element={<GeneralSearchInterface />} />
            <Route path="search/finance" element={<FinanceSearchInterface />} />
            <Route path="search/shopping" element={<ShoppingSearchInterface />} />
            <Route path="studio/image" element={<ImageStudioInterface />} />
            <Route path="studio/video" element={<React.Suspense fallback={<div>Loading Video Studio...</div>}><VideoStudioInterface /></React.Suspense>} />
            <Route path="studio/audio" element={<AudioStudioInterface />} />
            <Route path="studio/inpainting" element={<ImageInpaintingStudio />} />
            {/* Office routes */}
            <Route path="office/canvas" element={<CanvasPlanningVisual />} />
            <Route path="office/word" element={<WordChatInterface />} />
            <Route path="office/spreadsheet" element={<div className="w-full h-full flex items-center justify-center"><h1 className="text-xl font-bold text-white">Spreadsheet - Coming Soon</h1></div>} />
            <Route path="office/presentation" element={<div className="w-full h-full flex items-center justify-center"><h1 className="text-xl font-bold text-white">Presentation - Coming Soon</h1></div>} />
            <Route path="office/pdf" element={<PDFChatInterface />} />
            {/* Tools routes */}
            <Route path="tools/convert" element={<ConvertToolsInterface />} />
            <Route path="tools/convert/history" element={<ConversionHistory />} />
            <Route path="tools/compress" element={<CompressToolsInterface />} />
            <Route path="tools/img-tools" element={<ImgToolsInterface />} />
            <Route path="tools/pdf-tools" element={<PDFToolsInterface />} />
            <Route path="tools/share" element={<ShareToolsInterface />} />
            {/* Download routes */}
            <Route path="download/youtube" element={<DownloadToolsInterface defaultPlatform="youtube" />} />
            <Route path="download/twitter" element={<DownloadToolsInterface defaultPlatform="twitter" />} />
            <Route path="download/instagram" element={<DownloadToolsInterface defaultPlatform="instagram" />} />
            <Route path="download/tiktok" element={<DownloadToolsInterface defaultPlatform="tiktok" />} />
            <Route path="download/all" element={<DownloadToolsInterface defaultPlatform="auto" />} />
            {/* Content Creation routes */}
            <Route path="content-creation/youtube/all-channels/:groupSlug" element={<AllChannelsPage />} />
            <Route path="content-creation/youtube/all-channels" element={<AllChannelsPage />} />
            <Route path="content-creation/youtube/video" element={<VideoDetailPage />} />
            <Route path="content-creation/youtube" element={<YouTubeChannelManager />} />
            <Route path="content-creation/tiktok" element={<div className="w-full h-full flex items-center justify-center"><div className="text-center"><h1 className="text-2xl font-bold text-white mb-2">TikTok Channel Manager</h1><p className="text-white/60">Manage your TikTok accounts, post content, and monitor engagement</p></div></div>} />
            <Route path="content-creation/automations" element={<div className="w-full h-full flex items-center justify-center"><div className="text-center"><h1 className="text-2xl font-bold text-white mb-2">Content Automations</h1><p className="text-white/60">Create automated workflows for cross-platform posting and content distribution</p></div></div>} />
            <Route path="content-creation/scheduler" element={<div className="w-full h-full flex items-center justify-center"><div className="text-center"><h1 className="text-2xl font-bold text-white mb-2">Content Scheduler</h1><p className="text-white/60">Schedule and manage your posts across all connected platforms</p></div></div>} />
            {/* Account settings routes */}
            <Route path="profile" element={<ProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="usage-analytics" element={<UsageAnalyticsPage />} />
            <Route path="subscription" element={<div className="h-full flex items-center justify-center"><h1 className="text-xl font-bold text-white">Subscription - Coming Soon</h1></div>} />
            <Route path="help" element={<div className="h-full flex items-center justify-center"><h1 className="text-xl font-bold text-white">Help Center - Coming Soon</h1></div>} />
            {/* Individual lab routes */}
            <Route path="labs/:labId" element={<div><h1 className="text-xl font-bold text-white">Lab Editor</h1></div>} />
            {/* Redirects from old playground routes to new routes */}
            <Route path="playground/generation/image" element={<Navigate to="generation/image" replace />} />
            <Route path="playground/generation/3d" element={<Navigate to="generation/3d" replace />} />
            <Route path="playground/generation/video" element={<Navigate to="generation/video" replace />} />
            <Route path="playground/generation/audio" element={<Navigate to="generation/audio" replace />} />
            <Route path="playground/enhance/image" element={<Navigate to="enhance/image" replace />} />
            <Route path="playground/enhance/video" element={<Navigate to="enhance/video" replace />} />
            <Route path="playground/upscale/video" element={<Navigate to="upscale/video" replace />} />
            <Route path="playground/train/lora" element={<Navigate to="train/lora" replace />} />
            <Route path="playground/train/lora-video" element={<Navigate to="train/lora-video" replace />} />
            <Route path="playground/train/llm" element={<Navigate to="train/llm" replace />} />
            <Route path="playground/chat/llm" element={<Navigate to="chat/llm" replace />} />
            <Route path="playground/chat/voice" element={<Navigate to="chat/voice" replace />} />
            <Route path="playground/chat/search" element={<Navigate to="chat/search" replace />} />
            <Route path="playground/search/general" element={<Navigate to="search/general" replace />} />
            <Route path="playground/search/finance" element={<Navigate to="search/finance" replace />} />
            <Route path="playground/search/shopping" element={<Navigate to="search/shopping" replace />} />
            <Route path="playground/studio/image" element={<Navigate to="studio/image" replace />} />
            <Route path="playground/studio/video" element={<Navigate to="studio/video" replace />} />
            <Route path="playground/studio/audio" element={<Navigate to="studio/audio" replace />} />
            <Route path="playground/studio/inpainting" element={<Navigate to="studio/inpainting" replace />} />
          </Routes>
          </DisplayContainer>
        </div>
        
        {/* Modals at root */}
        <TopUpModal isOpen={isTopUpModalOpen} onClose={closeTopUpModal} />
        <CreateLabModal isOpen={isCreateLabModalOpen} onClose={closeCreateLabModal} />
        <ClaimCreditsModal
          isOpen={isWelcomeModalOpen}
          onClose={closeWelcomeModal}
          onClaim={handleWelcomeClaim}
        />
      </LayoutContext.Provider>
    </div>
  );
};

// Main OverviewPage component with WindowManager wrapper
const OverviewPage: React.FC = () => {
  return (
    <WindowManager>
      <OverviewContent />
    </WindowManager>
  );
};

export default OverviewPage;
