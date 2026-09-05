import React, { useState, createContext, useContext, useEffect } from 'react';
import { lazyRoute } from '../components/platform/lazyRoute';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import OverviewTaskbar from '../components/overview/OverviewTaskbar';
import OSAuthInterface from '../components/os/OSAuthInterface';
import DisplayContainer from '../components/layout/DisplayContainer';
import TopUpModal from '../components/overview/TopUpModal';
import CreateLabModal from '../components/overview/CreateLabModal';
import WelcomeCreditBonusModal from '../components/modals/WelcomeCreditBonusModal';
import Overview from '../components/overview/Overview';
import CanvasView from '../components/canvas/CanvasView';
import WindowManager, { useWindowManager, createFileExplorerWindow, createSettingsWindow } from '../components/os/desktop/WindowManager';

// Import playground interfaces with gallery
const ImageGenerationInterface = lazyRoute(() => import('../components/playground/Generation/ImageGenerationInterface'));
const ImageGenerationInterface2 = lazyRoute(() => import('../components/playground/Generation/ImageGenerationInterface2'));
const ImageGenerationInterface2Copy = lazyRoute(() => import('../components/playground/Generation/ImageGenerationInterface2Copy'));
const ImageUpscaleInterface = lazyRoute(() => import('../components/playground/Enhance/ImageEnhanceInterface'));
const VideoUpscaleInterface = lazyRoute(() => import('../components/playground/Enhance/VideoEnhanceInterface'));
const MultiChatContainer = lazyRoute(() => import('../components/playground/Chat/MultiChatContainer'));
const ChatWithVoice = lazyRoute(() => import('../components/playground/Chat/ChatWithVoice'));
const SearchChatInterface = lazyRoute(() => import('../components/playground/Chat/SearchChatInterface'));
const ThreeDGenerationInterface = React.lazy(() => import('../components/playground/Generation/ThreeDGenerationInterface'));
const AudioGenerationInterface = lazyRoute(() => import('../components/playground/Generation/AudioGenerationInterface'));
const VideoGenerationInterface = lazyRoute(() => import('../components/playground/Generation/VideoGenerationInterface'));
const VideoGenerationInterface2 = lazyRoute(() => import('../components/playground/Generation/VideoGenerationInterface2'));
// Add imports for the new training components
const LoRaImageTrainComponent = lazyRoute(() => import('../components/playground/Train/LoRaImageTrainInterface'));
const LoRaVideoTrainComponent = lazyRoute(() => import('../components/playground/Train/LoRaVideoTrainInterface'));
const TextLLMTrainComponent = lazyRoute(() => import('../components/playground/Train/TextLLMTrainInterface'));
// Import new Search sub-interfaces
const GeneralSearchInterface = lazyRoute(() => import('../components/playground/Search/GeneralSearchInterface'));
const FinanceSearchInterface = lazyRoute(() => import('../components/playground/Search/FinanceSearchInterface'));
const ShoppingSearchInterface = lazyRoute(() => import('../components/playground/Search/ShoppingSearchInterface'));
// Import new Studio interfaces
const ImageStudioInterface = lazyRoute(() => import('../components/playground/Studio/ImageStudio'));
// Lazy load VideoStudio interface (the chat interface, not the canvas)
const VideoStudioInterface = React.lazy(() =>
  import('../components/playground/Studio/VideoStudioInterface')
);
const AudioStudioInterface = lazyRoute(() => import('../components/playground/Studio/AudioStudioInterface'));
// Import Office components
const CanvasPlanning = lazyRoute(() => import('../components/office/CanvasPlanning'));
const CanvasPlanningVisual = lazyRoute(() => import('../components/office/CanvasPlanningVisual'));
const PDFChatInterface = lazyRoute(() => import('../components/playground/Office/PDFChatInterface'));
const WordChatInterface = lazyRoute(() => import('../components/playground/Office/WordChatInterface'));
// Import IOPaint interface
const ImageInpaintingStudio = lazyRoute(() => import('../components/ImageInpainting/ImageInpaintingStudio'));
// Import Tools interfaces
const ConvertToolsInterface = lazyRoute(() => import('../components/playground/Tools/ConvertToolsInterface'));
const ConversionHistory = lazyRoute(() => import('../components/playground/Tools/ConversionHistory'));
const CompressToolsInterface = lazyRoute(() => import('../components/playground/Tools/CompressToolsInterface'));
const ImgToolsInterface = lazyRoute(() => import('../components/playground/Tools/ImgToolsInterface'));
const PDFToolsInterface = lazyRoute(() => import('../components/playground/Tools/PDFToolsInterface'));
const ShareToolsInterface = lazyRoute(() => import('../components/playground/Tools/ShareToolsInterface'));
// Import Download interface
const DownloadToolsInterface = lazyRoute(() => import('../components/playground/Download/DownloadToolsInterface'));
// Import Account pages
import ProfilePage from '../components/account/ProfilePage';
import SettingsPage from '../components/account/SettingsPage';
import UsageAnalyticsPage from '../components/account/UsageAnalyticsPage';
import BillingPage from '../components/account/BillingPage';
import TeamPage from '../components/account/TeamPage';
import WorkspaceTeamsPage from '../components/account/WorkspaceTeamsPage';
import NotificationsPage from '../components/account/NotificationsPage';
import IntegrationsPage from '../components/account/IntegrationsPage';
import ProjectsPage from '../components/account/ProjectsPage';
import PlatformCommandPalette from '../components/platform/PlatformCommandPalette';
import ResourceState from '../components/platform/ResourceState';
import '../components/overview/platform-workbench.css';
import '../components/overview/platform-theme.css';
import { usePlatformTheme } from '../platform/platformTheme';
// Import Content Creation pages
const YouTubeChannelManager = lazyRoute(() => import('../components/youtube/YouTubeChannelManager'));
const AllChannelsPage = lazyRoute(() => import('../components/youtube/AllChannelsPage'));
const VideoDetailPage = lazyRoute(() => import('../components/youtube/VideoDetailPage'));

interface Lab {
  id: string;
  name: string;
  description?: string;
  image?: string;
  status?: 'active' | 'maintenance' | 'coming-soon';
  lastModified: Date;
}

// Layout context for sidebar state
interface LayoutContextType {
  isSidebarCollapsed: boolean;
}

const LayoutContext = createContext<LayoutContextType>({ isSidebarCollapsed: false });
export const useLayout = () => useContext(LayoutContext);

/** Provider keys are managed on api.xenostudio.ai — products still call our API. */
const ProviderKeysPortalRedirect: React.FC = () => {
  useEffect(() => {
    window.location.replace('https://api.xenostudio.ai/dashboard/inference');
  }, []);
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-white/40 text-sm">Provider keys are managed on the API platform…</p>
    </div>
  );
};

const CapabilityHandoff: React.FC<{ title: string; detail: string; productPath: string }> = ({ title, detail, productPath }) => {
  const navigate = useNavigate();
  return <main className="xeno-platform-page"><ResourceState kind="unavailable" layout="page" previewLabel="XENO / Product boundary" title={title} detail={detail} actionLabel="Open product" onRetry={() => navigate(productPath)} secondaryActionLabel="Back to dashboard" onSecondaryAction={() => navigate('/overview')} /></main>;
};

// Create a separate component for the main content to use WindowManager hook
const OverviewContent: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    preference: platformThemePreference,
    resolvedTheme: platformTheme,
    brightness: platformThemeBrightness,
    themeStyle: platformThemeStyle,
  } = usePlatformTheme();
  // Labs remain empty until the server exposes a durable Lab resource contract.
  const labs: Lab[] = [];
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [isCreateLabModalOpen, setIsCreateLabModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('xeno_overview_sidebar_collapsed') === 'true',
  );
  const [isCleanMode, setIsCleanMode] = useState(localStorage.getItem('isCleanMode') === 'true');
  const legacyWelcomePreview = import.meta.env.DEV
    && location.pathname === '/overview'
    && new URLSearchParams(location.search).get('welcome') === '1';
  const isImageGenerationCopyRoute = location.pathname === '/overview/generation/image2-copy' || location.pathname.endsWith('/generation/image2-copy');
  
  // Window management integration
  const { openWindow } = useWindowManager();

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
  
  const handleSidebarCollapseChange = (collapsed: boolean) => {
    setIsSidebarCollapsed(collapsed);
    localStorage.setItem('xeno_overview_sidebar_collapsed', String(collapsed));
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [isTaskbarHidden, setIsTaskbarHidden] = useState(false);

  useEffect(() => {
    const toggleTaskbar = () => setIsTaskbarHidden((prev) => !prev);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'H') {
        e.preventDefault();
        toggleTaskbar();
      }
    };
    window.addEventListener('toggle_overview_taskbar', toggleTaskbar as EventListener);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('toggle_overview_taskbar', toggleTaskbar as EventListener);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('overview_taskbar_visibility', {
        detail: { hidden: isTaskbarHidden },
      }),
    );
  }, [isTaskbarHidden]);

  return (
    <div
      data-overview-shell
      data-theme={platformTheme}
      data-theme-preference={platformThemePreference}
      data-theme-brightness={platformThemeBrightness}
      style={{
        ...platformThemeStyle,
        height: '100dvh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'row',
        // `hidden` creates a scroll container. Focusing a taskbar item below the
        // fold then scrolls this WHOLE shell, taking the chat header with it.
        // `clip` contains painting without exposing a programmatic scrollport.
        overflow: 'clip',
        margin: 0,
        padding: 0,
      }}
    >
      <LayoutContext.Provider value={{ isSidebarCollapsed }}>
        {/* Left Taskbar - Original taskbar with OS button and AI interfaces */}
        <div style={{ transition: 'transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), margin 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)', transform: isTaskbarHidden ? 'translateX(-100%)' : 'translateX(0)', marginRight: isTaskbarHidden ? (isSidebarCollapsed ? '-52px' : '-300px') : '0', zIndex: 60, position: 'relative' }}>
        <OverviewTaskbar
          labs={labs}
          onCreateLab={handleCreateLab}
          onCollapseChange={handleSidebarCollapseChange}
          onToggleInterface={toggleInterfaceMode}
          isCleanMode={isCleanMode}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />
        </div>
        
        {/* Main content area - full width, minus taskbar width */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DisplayContainer background={isImageGenerationCopyRoute ? '#000000' : undefined}>
          <Routes>
            {/* Full-screen canvas view - no header or sidebar */}
            <Route path="/labs/:labId/canvas" element={<CanvasView />} />
            {/* Main overview home */}
            <Route path="/" element={legacyWelcomePreview
              ? <Navigate to="/overview/welcome?preview=1" replace />
              : <Overview onAddCredits={openTopUpModal} onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />} />
            <Route path="welcome" element={<WelcomeCreditBonusModal />} />
            {/* Labs empty state */}
            <Route path="/labs" element={<CapabilityHandoff title="Labs need a durable service contract" detail="No Lab records are invented in the browser. Use Projects for persisted agent work until Lab create, read, update, and delete routes are shipped." productPath="/overview/projects" />} />
            {/* New direct feature routes (no playground) */}
            <Route path="generation/image" element={<ImageGenerationInterface />} />
            <Route path="generation/image2" element={<ImageGenerationInterface2 />} />
            <Route path="/overview/generation/image2" element={<ImageGenerationInterface2 />} />
            <Route path="generation/image2-copy" element={<ImageGenerationInterface2Copy />} />
            <Route path="/overview/generation/image2-copy" element={<ImageGenerationInterface2Copy />} />
            <Route path="generation/3d" element={<React.Suspense fallback={<div>Loading 3D Studio...</div>}><ThreeDGenerationInterface /></React.Suspense>} />
            <Route path="generation/video" element={<VideoGenerationInterface />} />
            <Route path="generation/video2" element={<VideoGenerationInterface2 />} />
            <Route path="generation/audio" element={<AudioGenerationInterface />} />
            <Route path="enhance/image" element={<ImageUpscaleInterface />} />
            <Route path="enhance/video" element={<VideoUpscaleInterface />} />
            <Route path="upscale/video" element={<VideoUpscaleInterface />} />
            <Route path="train/lora" element={<LoRaImageTrainComponent />} />
            <Route path="train/lora-video" element={<LoRaVideoTrainComponent />} />
            <Route path="train/llm" element={<TextLLMTrainComponent />} />
            <Route path="c/:conversationId" element={<MultiChatContainer />} />
            <Route path="c" element={<MultiChatContainer />} />
            <Route path="chat" element={<Navigate to="/overview/chat/llm" replace />} />
            <Route path="chat/llm" element={<MultiChatContainer />} />
            <Route path="chat/llm/:conversationId" element={<MultiChatContainer />} />
            <Route path="chat/c/:conversationId" element={<MultiChatContainer />} />
            <Route path="chat/projects" element={<MultiChatContainer />} />
            <Route path="chat/projects/:projectId" element={<MultiChatContainer />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectsPage />} />
            <Route path="chat/library" element={<MultiChatContainer />} />
            <Route path="chat/library/:libraryItemId" element={<MultiChatContainer />} />
            <Route path="library" element={<MultiChatContainer />} />
            <Route path="library/:libraryItemId" element={<MultiChatContainer />} />
            <Route path="chat/artifacts" element={<MultiChatContainer />} />
            <Route path="chat/artifacts/:artifactId" element={<MultiChatContainer />} />
            <Route path="artifacts" element={<MultiChatContainer />} />
            <Route path="artifacts/:artifactId" element={<MultiChatContainer />} />
            <Route path="chat/customize" element={<MultiChatContainer />} />
            <Route path="customize" element={<MultiChatContainer />} />
            <Route path="chat/scheduled" element={<MultiChatContainer />} />
            <Route path="scheduled" element={<MultiChatContainer />} />
            <Route path="chat/settings" element={<MultiChatContainer />} />
            <Route path="chat/skills" element={<MultiChatContainer />} />
            <Route path="chat/multi" element={<MultiChatContainer />} />
            {/* XENO: voice mode route disabled — voice de-scoped (no direct provider calls) */}
            {/* <Route path="chat/voice" element={<ChatWithVoice />} /> */}
            <Route path="chat/search" element={<SearchChatInterface />} />
            <Route path="search/general" element={<GeneralSearchInterface />} />
            <Route path="search/finance" element={<FinanceSearchInterface />} />
            <Route path="search/shopping" element={<ShoppingSearchInterface />} />
            <Route path="studio/image" element={<ImageStudioInterface />} />
            <Route path="studio/image/:projectId" element={<ImageStudioInterface />} />
            <Route path="studio/video" element={<React.Suspense fallback={<div>Loading Video Studio...</div>}><VideoStudioInterface /></React.Suspense>} />
            <Route path="studio/audio" element={<AudioStudioInterface />} />
            <Route path="studio/inpainting" element={<ImageInpaintingStudio />} />
            {/* Office routes */}
            <Route path="office/canvas" element={<CanvasPlanningVisual />} />
            <Route path="office/canvas/:canvasId" element={<CanvasPlanningVisual />} />
            <Route path="office/word" element={<WordChatInterface />} />
            <Route path="office/spreadsheet" element={<CapabilityHandoff title="Spreadsheets live in XENO Sheets" detail="This platform route does not own a spreadsheet document service. Open the product surface instead of editing a disposable imitation here." productPath="/products/sheets" />} />
            <Route path="office/presentation" element={<CapabilityHandoff title="Presentations live in XENO Slides" detail="This platform route does not own presentation persistence or export. Open the product surface instead of showing a non-functional editor." productPath="/products/slides" />} />
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
            <Route path="content-creation/tiktok" element={<CapabilityHandoff title="TikTok management belongs to XENO Post" detail="No TikTok account or publishing API is connected to this route. Open XENO Post for the shipping social command-center contract." productPath="/products/post" />} />
            <Route path="content-creation/automations" element={<CapabilityHandoff title="Content automation belongs to XENO Post" detail="This route has no scheduler or connector write path. Open the product that owns authenticated publishing workflows." productPath="/products/post" />} />
            <Route path="content-creation/scheduler" element={<CapabilityHandoff title="Scheduling belongs to XENO Post" detail="This route does not persist or publish scheduled posts. Open XENO Post for server-backed scheduling." productPath="/products/post" />} />
            {/* Account settings routes */}
            <Route path="profile" element={<ProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="usage-analytics" element={<UsageAnalyticsPage />} />
            {/* Provider keys are managed on the API platform, not here. */}
            <Route path="ai-keys" element={<ProviderKeysPortalRedirect />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="teams" element={<WorkspaceTeamsPage />} />
            <Route path="team/:tab" element={<TeamPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="subscription" element={<BillingPage />} />
            <Route path="help" element={<Navigate to="/help" replace />} />
            {/* Individual lab routes */}
            <Route path="labs/:labId" element={<CapabilityHandoff title="This lab is not a persisted resource" detail="The platform has no server-confirmed lab record for this route. Use Projects for persisted agent work while the Lab service contract is implemented." productPath="/overview/projects" />} />
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
            {/* XENO: voice mode redirect disabled — voice de-scoped (no direct provider calls) */}
            {/* <Route path="playground/chat/voice" element={<Navigate to="chat/voice" replace />} /> */}
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
        <PlatformCommandPalette open={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} onNavigate={navigate} />
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
