import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { authService } from '../../services/authService';
import ClaimCreditsModal from '../modals/ClaimCreditsModal';
import {
  Plus,
  Search,
  Image,
  Video,
  ArrowUpRight,
  Beaker,
  BrainCircuit,
  Sparkles,
  MessageSquare,
  MessageCircle,
  Volume2,
  FileText,
  Settings,
  User,
  Home,
  Palette,
  Bell,
  Sun,
  Code,
  Wrench,
  RefreshCw,
  Archive,
  FileImage,
  FileType,
  Share,
  FileSpreadsheet,
  Presentation,
  Layout,
  Briefcase,
  LogOut,
  BarChart3,
  HelpCircle,
  ChevronRight,
  ChevronDown,
  Building2,
  Check,
  Gift,
  Coins,
  Megaphone,
  Youtube,
  Music2,
  Zap,
  Calendar,
  Download,
  Twitter,
  Instagram,
  Menu,
  X
} from 'lucide-react';

interface OverviewTaskbarProps {
  labs: { id: string; name: string; lastModified: Date }[];
  onCreateLab: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
  onToggleInterface?: () => void;
  isCleanMode?: boolean;
}

const homeSections = [
  {
    id: 'home',
    name: 'Home',
    icon: <Home size={16} />,
    pages: [
      { id: 'overview', icon: <Home size={14} />, path: '/' }
    ]
  },
  {
    id: 'os',
    name: 'OS',
    icon: <span style={{ fontSize: 12, fontWeight: 600 }}>OS</span>,
    pages: [
      { id: 'connect', icon: <span style={{ fontSize: 10, fontWeight: 600 }}>OS</span>, path: '/os/connect' }
    ]
  },
  {
    id: 'search',
    name: 'Search',
    icon: <Search size={16} />,
    pages: [
      { id: 'global', icon: <Search size={14} />, path: '/overview/search' }
    ]
  }
];

const footerSections = [
  {
    id: 'settings',
    name: 'Settings',
    icon: <Settings size={16} />,
    pages: [
      { id: 'general', icon: <Settings size={14} />, path: '/overview/settings' }
    ]
  },
  {
    id: 'profile',
    name: 'Profile',
    icon: <User size={16} />,
    pages: [
      { id: 'account', icon: <User size={14} />, path: '/overview/profile' }
    ]
  },
  {
    id: 'create-lab',
    name: 'Create Lab',
    icon: <Plus size={16} />,
    pages: [
      { id: 'new', icon: <Plus size={14} />, path: '/overview/create-lab' }
    ]
  }
];

const playgroundSections = [
  {
    id: 'coding',
    name: 'Coding',
    icon: <Code size={16} />,
    pages: [
      { id: 'editor', icon: <Code size={14} />, path: '/overview/coding/editor' },
      { id: 'assistant', icon: <BrainCircuit size={14} />, path: '/overview/coding/assistant' },
      { id: 'terminal', icon: <FileText size={14} />, path: '/overview/coding/terminal' }
    ]
  },
  {
    id: 'tools',
    name: 'Tools',
    icon: <Wrench size={16} />,
    pages: [
      { id: 'convert', icon: <RefreshCw size={14} />, path: '/overview/tools/convert' },
      { id: 'compress', icon: <Archive size={14} />, path: '/overview/tools/compress' },
      { id: 'img-tools', icon: <FileImage size={14} />, path: '/overview/tools/img-tools' },
      { id: 'pdf-tools', icon: <FileType size={14} />, path: '/overview/tools/pdf-tools' },
      { id: 'share', icon: <Share size={14} />, path: '/overview/tools/share' }
    ]
  },
  {
    id: 'download',
    name: 'Download',
    icon: <Download size={16} />,
    pages: [
      { id: 'youtube', icon: <Youtube size={14} />, path: '/overview/download/youtube' },
      { id: 'twitter', icon: <Twitter size={14} />, path: '/overview/download/twitter' },
      { id: 'instagram', icon: <Instagram size={14} />, path: '/overview/download/instagram' },
      { id: 'tiktok', icon: <Music2 size={14} />, path: '/overview/download/tiktok' },
      { id: 'all', icon: <Download size={14} />, path: '/overview/download/all' }
    ]
  },
  {
    id: 'generation',
    name: 'Generation',
    icon: <Sparkles size={16} />,
    pages: [
      { id: 'image', icon: <Image size={14} />, path: '/overview/generation/image' },
      { id: 'image2', icon: <Image size={14} />, path: '/overview/generation/image2' },
      { id: '3d', icon: <Beaker size={14} />, path: '/overview/generation/3d' },
      { id: 'video', icon: <Video size={14} />, path: '/overview/generation/video' },
      { id: 'audio', icon: <Volume2 size={14} />, path: '/overview/generation/audio' }
    ]
  },
  {
    id: 'enhance',
    name: 'Enhance',
    icon: <ArrowUpRight size={16} />,
    pages: [
      { id: 'image', icon: <Image size={14} />, path: '/overview/enhance/image' },
      { id: 'video', icon: <Video size={14} />, path: '/overview/enhance/video' }
    ]
  },
  {
    id: 'train',
    name: 'Train',
    icon: <BrainCircuit size={16} />,
    pages: [
      { id: 'lora', icon: <Image size={14} />, path: '/overview/train/lora' },
      { id: 'lora-video', icon: <Video size={14} />, path: '/overview/train/lora-video' },
      { id: 'llm', icon: <FileText size={14} />, path: '/overview/train/llm' }
    ]
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: <MessageSquare size={16} />,
    pages: [
      { id: 'llm', icon: <MessageCircle size={14} />, path: '/overview/chat/llm' },
      // XENO: voice mode entry removed — voice de-scoped (no direct provider calls)
      { id: 'search', icon: <Search size={14} />, path: '/overview/chat/search' }
    ]
  },
  {
    id: 'studio',
    name: 'Studio',
    icon: <Palette size={16} />,
    pages: [
      { id: 'image', icon: <Image size={14} />, path: '/overview/studio/image' },
      { id: 'video', icon: <Video size={14} />, path: '/overview/studio/video' },
      { id: 'audio', icon: <Volume2 size={14} />, path: '/overview/studio/audio' }
    ]
  },
  {
    id: 'content-creation',
    name: 'Create',
    icon: <Megaphone size={16} />,
    pages: [
      { id: 'youtube', icon: <Youtube size={14} />, path: '/overview/content-creation/youtube' },
      { id: 'tiktok', icon: <Music2 size={14} />, path: '/overview/content-creation/tiktok' },
      { id: 'automations', icon: <Zap size={14} />, path: '/overview/content-creation/automations' },
      { id: 'scheduler', icon: <Calendar size={14} />, path: '/overview/content-creation/scheduler' }
    ]
  },
  {
    id: 'office',
    name: 'Office',
    icon: <Briefcase size={16} />,
    pages: [
      { id: 'word', icon: <FileText size={14} />, path: '/overview/office/word' },
      { id: 'spreadsheet', icon: <FileSpreadsheet size={14} />, path: '/overview/office/spreadsheet' },
      { id: 'presentation', icon: <Presentation size={14} />, path: '/overview/office/presentation' },
      { id: 'canvas', icon: <Layout size={14} />, path: '/overview/office/canvas' },
      { id: 'pdf', icon: <FileType size={14} />, path: '/overview/office/pdf' }
    ]
  }
];

const OverviewTaskbar: React.FC<OverviewTaskbarProps> = ({
  labs,
  onCreateLab,
  onCollapseChange,
  onToggleInterface,
  isCleanMode = false
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { workspaces, activeWorkspace, switchWorkspace, isTeam } = useWorkspace();
  const isCollapsed = true; // Always collapsed
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  const [showClaimCreditsModal, setShowClaimCreditsModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClosingMobileMenu, setIsClosingMobileMenu] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [hoveredSubcategory, setHoveredSubcategory] = useState<string | null>(null);

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Handle closing the mobile menu with animation
  const closeMobileMenu = () => {
    setIsClosingMobileMenu(true);
    setTimeout(() => {
      setIsMobileMenuOpen(false);
      setIsClosingMobileMenu(false);
    }, 250);
  };

  // Function to get active section based on current path
  const getActiveSection = () => {
    const path = location.pathname;
    for (const section of playgroundSections) {
      for (const page of section.pages) {
        if (path === page.path) {
          return section.id;
        }
      }
    }
    return null;
  };

  // Function to check if a specific page is active
  const isPageActive = (pagePath: string) => {
    return location.pathname === pagePath;
  };

  const formatSubcategoryLabel = (pageId: string) => {
    return pageId
      .split(/[-_]/)
      .map((part) => {
        if (!part) return part;
        if (part.toLowerCase() === 'llm') return 'LLM';
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  };

  // Keep dropdown open for active section
  useEffect(() => {
    const activeSection = getActiveSection();
    if (activeSection) {
      setOpenDropdown(activeSection);
    }
  }, [location.pathname]);

  const handleCategoryClick = (categoryId: string) => {
    setOpenDropdown(openDropdown === categoryId ? null : categoryId);
  };

  const handleClaimCredits = () => {
    setShowAccountModal(false);
    setShowClaimCreditsModal(true);
  };

  const handleClaimSuccess = () => {
    window.location.reload();
  };

  const handleLogout = async () => {
    try {
      setShowAccountModal(false);
      setIsMobileMenuOpen(false);
      localStorage.clear();
      sessionStorage.clear();
      document.cookie.split(";").forEach((c) => {
        const eqPos = c.indexOf("=");
        const name = eqPos > -1 ? c.substr(0, eqPos) : c;
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
      navigate('/');
    }
  };

  // Close dropdown and external containers when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (taskbarRef.current && !taskbarRef.current.contains(target)) {
        const settingsContainer = document.querySelector('[data-container="settings"]');
        const accountContainer = document.querySelector('[data-container="account"]');
        
        if (!(settingsContainer?.contains(target) || accountContainer?.contains(target))) {
          setOpenDropdown(null);
          setShowSettings(false);
          setShowAccountModal(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Listen for open/toggle mobile taskbar events across the platform
  useEffect(() => {
    const handleOpen = () => setIsMobileMenuOpen(true);
    const handleToggle = () => setIsMobileMenuOpen((prev) => !prev);

    window.addEventListener('open_mobile_taskbar', handleOpen);
    window.addEventListener('toggle_overview_taskbar', handleToggle);
    return () => {
      window.removeEventListener('open_mobile_taskbar', handleOpen);
      window.removeEventListener('toggle_overview_taskbar', handleToggle);
    };
  }, []);

  const sidebarWidth = 'w-13';
  const isChatRoute = location.pathname.includes('/chat');

  // Close mobile menu when navigating
  const handleMobileNavigation = (path: string) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* ── Mobile Top-Right Menu Trigger (on non-chat pages without their own top bar) ── */}
      {!isChatRoute && typeof document !== 'undefined' && createPortal(
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="fixed top-3.5 right-3.5 z-[240] md:hidden flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/85 text-white shadow-2xl backdrop-blur-md active:scale-95 transition-all duration-150"
          aria-label="Open taskbar menu"
        >
          <Menu size={20} />
        </button>,
        document.body
      )}

      {/* ── Full Mobile Taskbar Drawer (Full Mobile Viewport) ─────────────────────────── */}
      {isMobileMenuOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[260] md:hidden flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Drawer Panel - Full Viewport */}
          <div className="relative z-10 flex flex-col h-[100dvh] max-h-[100dvh] w-full bg-[#0a0a0c] backdrop-blur-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 pt-[max(0.875rem,env(safe-area-inset-top))]">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white border border-white/10">
                  <svg width="20" height="20" viewBox="0 0 1082 1082" fill="currentColor">
                    <path d="M489.1 219.763L323.457 39.7072L101.649 30.4597C51.6926 28.3769 39.5494 67.5718 39.7224 87.4296L30.4124 310.735L347.816 655.757L475.833 537.987L241.73 283.514C207.644 246.462 222.019 240.156 233.467 241.634L455.275 250.881L489.1 219.763Z" />
                    <path d="M861.765 489.52L1041.69 323.704L1050.94 101.684C1053.03 51.6793 1013.87 39.5273 994.024 39.7019L770.9 30.3995L426.135 348.133L543.8 476.263L798.083 241.917C835.108 207.796 841.408 222.184 839.931 233.644L830.674 455.664L861.765 489.52Z" />
                    <path d="M592.871 862.143L758.514 1042.2L980.322 1051.45C1030.28 1053.53 1042.42 1014.33 1042.25 994.477L1051.56 771.171L734.155 426.15L606.138 543.919L840.241 798.392C874.327 835.444 859.952 841.751 848.504 840.272L626.696 831.025L592.871 862.143Z" />
                    <path d="M220.763 592.907L40.7063 758.55L31.4588 980.358C29.3761 1030.31 68.5709 1042.46 88.4287 1042.28L311.735 1051.59L656.756 734.191L538.986 606.174L284.514 840.277C247.462 874.363 241.155 859.988 242.633 848.54L251.881 626.733L220.763 592.907Z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">XENO Studio</div>
                  <div className="text-[11px] text-white/50">{user?.display_name || user?.email || 'Guest'}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Credits Pill */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs">
                  <Coins size={14} className="text-yellow-400" />
                  <span className="font-semibold">{user?.credits?.toLocaleString() || 0}</span>
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:text-white active:scale-95 transition-all"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Quick Actions Row */}
            <div className="px-5 py-3 border-b border-white/10 overflow-x-auto hide-scrollbar">
              <div className="flex items-center gap-2 min-w-max">
                <button
                  onClick={() => handleMobileNavigation('/overview')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs font-medium text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <Home size={14} />
                  <span>Overview</span>
                </button>
                <button
                  onClick={() => handleMobileNavigation('/os/connect')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs font-medium text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <span className="text-[11px] font-bold">OS</span>
                  <span>Connect</span>
                </button>
                <button
                  onClick={() => handleMobileNavigation('/overview/search')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs font-medium text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <Search size={14} />
                  <span>Search</span>
                </button>
                <button
                  onClick={() => { onCreateLab(); setIsMobileMenuOpen(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs font-medium text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <Plus size={14} />
                  <span>New Lab</span>
                </button>
                <button
                  onClick={() => handleMobileNavigation('/overview/settings')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs font-medium text-white hover:bg-white/20 active:scale-95 transition-all"
                >
                  <Settings size={14} />
                  <span>Settings</span>
                </button>
              </div>
            </div>

            {/* Scrollable Categories List */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3 pb-8">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                Products & Workspaces
              </div>

              <div className="space-y-2">
                {playgroundSections.map((section) => {
                  const isExpanded = expandedCategory === section.id || getActiveSection() === section.id;
                  return (
                    <div
                      key={section.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden transition-colors"
                    >
                      {/* Section Header Button */}
                      <button
                        type="button"
                        onClick={() => setExpandedCategory(expandedCategory === section.id ? null : section.id)}
                        className="flex w-full items-center justify-between p-3 text-left hover:bg-white/[0.05] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white">
                            {section.icon}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{section.name}</div>
                            <div className="text-[10px] text-white/40">{section.pages.length} interfaces</div>
                          </div>
                        </div>
                        <ChevronDown
                          size={16}
                          className={`text-white/40 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-white' : ''}`}
                        />
                      </button>

                      {/* Subpages / Tools */}
                      {isExpanded && (
                        <div className="grid grid-cols-2 gap-1.5 p-2.5 pt-0 border-t border-white/5 bg-black/20">
                          {section.pages.map((page) => {
                            const isActive = isPageActive(page.path);
                            return (
                              <button
                                key={page.id}
                                type="button"
                                onClick={() => handleMobileNavigation(page.path)}
                                className={`flex items-center gap-2 p-2 rounded-lg text-xs font-medium transition-all ${
                                  isActive
                                    ? 'bg-white/20 text-white border border-white/30 font-semibold'
                                    : 'bg-white/5 text-white/75 hover:bg-white/10 hover:text-white border border-transparent'
                                }`}
                              >
                                <span className="text-white/70">{page.icon}</span>
                                <span className="truncate">{formatSubcategoryLabel(page.id)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Recent Labs */}
              {labs.length > 0 && (
                <div className="pt-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-2">
                    Recent Labs
                  </div>
                  <div className="space-y-1.5">
                    {labs.slice(0, 4).map((lab) => (
                      <button
                        key={lab.id}
                        onClick={() => handleMobileNavigation(`/overview/labs/${lab.id}`)}
                        className="flex w-full items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-left hover:bg-white/[0.06] text-xs text-white"
                      >
                        <Beaker size={14} className="text-white/50" />
                        <span className="truncate font-medium">{lab.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Account Actions */}
            <div className="border-t border-white/10 bg-black/50 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex items-center justify-between">
              <button
                onClick={() => { setShowAccountModal(true); setIsMobileMenuOpen(false); }}
                className="flex items-center gap-2 text-xs text-white/70 hover:text-white font-medium"
              >
                <User size={15} />
                <span>{user?.display_name || 'Account'}</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
              >
                <LogOut size={14} />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:flex z-[200] h-screen relative">
        <div ref={taskbarRef} className={`${sidebarWidth} h-screen bg-black/90 backdrop-blur-md border-r border-white/10 flex flex-col items-center transition-all duration-300`}>
          {/* Version marker for deployment verification */}
          <div className="absolute -top-10 left-0 opacity-0 pointer-events-none">v2.1.0</div>
      {/* Main Navigation */}
      <div className="w-full flex-1 p-2 space-y-2 flex flex-col items-center">
        {/* Core Navigation Buttons */}
        <div className="w-full space-y-2 flex flex-col items-center">
          {/* XENO Logo — Home */}
          <button
            onClick={() => navigate('/overview')}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-150"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            aria-label="Home"
          >
            <svg width="16" height="16" viewBox="0 0 1082 1082" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M489.1 219.763L323.457 39.7072L101.649 30.4597C51.6926 28.3769 39.5494 67.5718 39.7224 87.4296L30.4124 310.735L347.816 655.757L475.833 537.987L241.73 283.514C207.644 246.462 222.019 240.156 233.467 241.634L455.275 250.881L489.1 219.763Z" />
              <path d="M861.765 489.52L1041.69 323.704L1050.94 101.684C1053.03 51.6793 1013.87 39.5273 994.024 39.7019L770.9 30.3995L426.135 348.133L543.8 476.263L798.083 241.917C835.108 207.796 841.408 222.184 839.931 233.644L830.674 455.664L861.765 489.52Z" />
              <path d="M592.871 862.143L758.514 1042.2L980.322 1051.45C1030.28 1053.53 1042.42 1014.33 1042.25 994.477L1051.56 771.171L734.155 426.15L606.138 543.919L840.241 798.392C874.327 835.444 859.952 841.751 848.504 840.272L626.696 831.025L592.871 862.143Z" />
              <path d="M220.763 592.907L40.7063 758.55L31.4588 980.358C29.3761 1030.31 68.5709 1042.46 88.4287 1042.28L311.735 1051.59L656.756 734.191L538.986 606.174L284.514 840.277C247.462 874.363 241.155 859.988 242.633 848.54L251.881 626.733L220.763 592.907Z" />
            </svg>
          </button>

          {/* OS Button */}
          <button
            onClick={() => navigate('/os/connect')}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-150"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            aria-label="OS"
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>OS</span>
          </button>

          {/* Search Button */}
          <button
            onClick={() => navigate('/overview/search')}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-150"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            aria-label="Search"
          >
            <Search size={16} />
          </button>

          {/* Create Lab Button */}
          <button
            onClick={onCreateLab}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-150"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            aria-label="Create Lab"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Spacer Line */}
        <div className="w-9 h-px bg-white/10 my-1"></div>

        {/* Playground Categories - Parent Buttons */}
        <div className="w-full space-y-2 flex flex-col items-center">
          {playgroundSections.map((section) => {
            const isTooltipVisible = hoveredCategory === section.id;
            return (
              <div
                key={section.id}
                className="w-full flex flex-col items-center"
              >
              {/* Category Button */}
              <div
                className="relative group w-[34px] flex justify-center"
                onMouseEnter={() => setHoveredCategory(section.id)}
                onMouseLeave={() => setHoveredCategory((prev) => (prev === section.id ? null : prev))}
              >
                <button
                  onClick={() => handleCategoryClick(section.id)}
                  className={`flex items-center justify-center rounded-md font-medium transition-colors duration-150 ${
                    openDropdown === section.id
                      ? 'bg-white/20 text-white'
                      : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                  }`}
                  style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  aria-label={section.name}
                >
                  {section.icon}
                </button>
                <span
                  className="taskbar-tooltip"
                  data-tooltip-state={isTooltipVisible ? 'visible' : 'hidden'}
                >
                  {section.name}
                </span>
              </div>

              {/* Inline Dropdown Container */}
              {openDropdown === section.id && (
                <div style={{ width: 34 }} className="mt-1 mb-1 p-1 bg-white/5 backdrop-blur-sm border border-white/5 rounded-md space-y-1 flex flex-col items-center transition-all duration-150">
                  {section.pages.map((page) => {
                    const subcategoryKey = `${section.id}:${page.id}`;
                    const isSubcategoryActive = isPageActive(page.path);
                    const isSubcategoryTooltipVisible = hoveredSubcategory === subcategoryKey;
                    return (
                      <div
                        key={page.id}
                        className="relative w-[28px] flex justify-center"
                        onMouseEnter={() => setHoveredSubcategory(subcategoryKey)}
                        onMouseLeave={() => setHoveredSubcategory((prev) => (prev === subcategoryKey ? null : prev))}
                      >
                        <button
                          onClick={() => {
                            navigate(page.path);
                            // Keep dropdown open for active section
                          }}
                          className={`flex items-center justify-center rounded-md font-medium transition-colors duration-150 ${
                            isSubcategoryActive
                              ? 'bg-white/20 text-white'
                              : 'bg-white/5 text-white/70 hover:bg-white/15 hover:text-white'
                          }`}
                          style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        >
                          {page.icon}
                        </button>
                        <span
                          className="taskbar-tooltip taskbar-subcategory-tooltip"
                          data-tooltip-state={isSubcategoryTooltipVisible ? 'visible' : 'hidden'}
                        >
                          {formatSubcategoryLabel(page.id)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
          })}
        </div>


        {/* Labs Section */}
        {labs.length > 0 && (
          <div className="w-full pt-2 flex flex-col items-center">
            <div className="w-full space-y-2 flex flex-col items-center">
              {labs.slice(0, 3).map((lab) => (
                <div key={lab.id} className="relative">
                  <button
                    onClick={() => handleCategoryClick(`lab-${lab.id}`)}
                    className={`flex items-center justify-center rounded-md font-medium transition-colors duration-150 ${
                      openDropdown === `lab-${lab.id}`
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                    }`}
                    style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 30 }}
                    aria-label={lab.name}
                  >
                    <Beaker size={16} />
                  </button>

                  {openDropdown === `lab-${lab.id}` && (
                    <div className="absolute top-8 left-0 bg-black/90 backdrop-blur-md border border-white/10 rounded-md p-1 space-y-1 z-40">
                      <button
                        onClick={() => {
                          navigate(`/overview/labs/${lab.id}`);
                          // Keep dropdown open for active section
                        }}
                        className="flex items-center justify-center rounded-md font-medium bg-white/5 text-white/70 hover:bg-white/15 hover:text-white transition-colors duration-150"
                        style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        aria-label={`${lab.name} - Open`}
                      >
                        <Beaker size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="w-full p-2 space-y-2 flex flex-col items-center">
        {/* Notification/News Button */}
        <button
          className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-150"
          style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>

        {/* Light Theme Switch Button */}
        <button
          className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-150"
          style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          aria-label="Light Theme"
        >
          <Sun size={16} />
        </button>

        {/* Profile Button - Toggleable Modal */}
        <button
          onClick={() => setShowAccountModal(!showAccountModal)}
          className={`flex items-center justify-center rounded-md font-medium transition-colors duration-150 ${
            showAccountModal
              ? 'bg-white/20 text-white'
              : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
          }`}
          style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          aria-label="Profile"
        >
          <User size={16} />
        </button>


      </div>
      </div>

      {/* Account Modal — XENO Design System compliant */}
      {showAccountModal && (
        <div
          data-container="account"
          className="absolute bg-[#0c0c0e] border border-white/[0.08] rounded-md z-50 overflow-hidden"
          style={{ left: 'calc(100% + 8px)', bottom: '8px', width: '248px' }}
        >
          {/* ── Identity ── */}
          <div className="px-3 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-sm bg-white/[0.05] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full rounded-sm object-cover" />
                ) : (
                  <User size={14} className="text-white/30" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-white/80 truncate">{user?.display_name || 'User'}</div>
                <div className="text-[10px] text-white/25 truncate">{user?.email || 'user@example.com'}</div>
              </div>
            </div>
          </div>

          {/* ── Plan ── */}
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-px rounded-sm bg-white/[0.06] text-white/45 font-medium uppercase tracking-[0.03em]">
                {user?.plan || 'Free'}
              </span>
              <span className="text-[10px] text-white/20 tabular-nums">{user?.credits?.toLocaleString() || 0} credits</span>
            </div>
            <button
              onClick={() => { setShowAccountModal(false); navigate('/overview/billing'); }}
              className="text-[10px] text-white/30 hover:text-white/55 transition-[color] duration-75"
            >
              Upgrade
            </button>
          </div>

          {/* ── Workspace ── */}
          <div className="border-b border-white/[0.06]">
            <button
              className="w-full flex items-center justify-between px-3 h-[28px] hover:bg-white/[0.03] transition-[background-color] duration-75"
              onClick={() => setShowWorkspaceSwitcher(!showWorkspaceSwitcher)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-sm bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                  {isTeam ? <Building2 size={10} className="text-white/30" /> : <User size={10} className="text-white/30" />}
                </div>
                <span className="text-[12px] text-white/55 truncate">{activeWorkspace?.name || 'Workspace'}</span>
              </div>
              <ChevronDown size={12} className={`text-white/15 transition-transform duration-75 ${showWorkspaceSwitcher ? 'rotate-180' : ''}`} />
            </button>
            {showWorkspaceSwitcher && (
              <div className="px-1.5 pb-1.5">
                {workspaces.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => { switchWorkspace(ws.id); setShowWorkspaceSwitcher(false); }}
                    className={`w-full flex items-center gap-2 px-1.5 h-[24px] rounded-sm text-left transition-[background-color,color] duration-75 ${
                      activeWorkspace?.id === ws.id ? 'bg-white/[0.05] text-white/65' : 'text-white/30 hover:text-white/50 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-sm bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                      {ws.workspace_type === 'team' ? <Building2 size={8} className="text-white/25" /> : <User size={8} className="text-white/25" />}
                    </div>
                    <span className="text-[11px] truncate flex-1">{ws.name}</span>
                    {activeWorkspace?.id === ws.id && <Check size={10} className="text-white/35 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Navigation ── */}
          <div className="py-0.5">
            {[
              { icon: User, label: 'Profile', path: '/overview/profile' },
              { icon: Coins, label: 'Billing', path: '/overview/billing' },
              ...(isTeam ? [{ icon: Building2, label: 'Team', path: '/overview/team' }] : []),
              { icon: BarChart3, label: 'Usage', path: '/overview/usage-analytics' },
              { icon: Settings, label: 'Settings', path: '/overview/settings' },
              // ⚠️ /overview/api-keys has NO route defined in Overview.tsx — this
              // entry has been a dead link. It is XENO-ISSUED keys (a different
              // thing from the provider keys above) and still needs its page.
              { icon: Code, label: 'API Keys', path: '/overview/api-keys' },
            ].map(item => (
              <button
                key={item.path}
                onClick={() => { setShowAccountModal(false); navigate(item.path); }}
                className="w-full flex items-center justify-between px-3 h-[28px] hover:bg-white/[0.03] transition-[background-color] duration-75 group"
              >
                <div className="flex items-center gap-2.5">
                  <item.icon size={14} className="text-white/20 group-hover:text-white/35" />
                  <span className="text-[12px] text-white/55 group-hover:text-white/75">{item.label}</span>
                </div>
                <ChevronRight size={12} className="text-white/8 group-hover:text-white/20" />
              </button>
            ))}
          </div>

          {/* ── Utility ── */}
          <div className="border-t border-white/[0.06] py-0.5">
            <button
              onClick={() => { setShowAccountModal(false); navigate('/overview/help'); }}
              className="w-full flex items-center gap-2.5 px-3 h-[28px] hover:bg-white/[0.03] transition-[background-color] duration-75 group"
            >
              <HelpCircle size={14} className="text-white/15 group-hover:text-white/30" />
              <span className="text-[12px] text-white/35 group-hover:text-white/55">Help & Support</span>
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 h-[28px] hover:bg-white/[0.03] transition-[background-color] duration-75 group"
            >
              <LogOut size={14} className="text-white/15 group-hover:text-white/30" />
              <span className="text-[12px] text-white/35 group-hover:text-white/55">Log out</span>
            </button>
          </div>
        </div>
      )}

      {/* Claim Credits Modal */}
      <ClaimCreditsModal
        isOpen={showClaimCreditsModal}
        onClose={() => setShowClaimCreditsModal(false)}
        onClaim={handleClaimSuccess}
      />
      </div>
    </>
  );
};

export default OverviewTaskbar;
