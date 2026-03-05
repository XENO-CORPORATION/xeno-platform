import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
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
      { id: 'voice', icon: <Volume2 size={14} />, path: '/overview/chat/voice' },
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

// Mobile navigation mode type
type MobileNavMode = 'radial' | 'edge-handle';

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
  const isCollapsed = true; // Always collapsed
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showClaimCreditsModal, setShowClaimCreditsModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClosingMobileMenu, setIsClosingMobileMenu] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [hoveredSubcategory, setHoveredSubcategory] = useState<string | null>(null);

  // Mobile navigation experiment state
  const [mobileNavMode, setMobileNavMode] = useState<MobileNavMode>('radial');

  // Radial menu state (Option 3)
  const [radialMenuOpen, setRadialMenuOpen] = useState(false);
  const [radialMenuPosition, setRadialMenuPosition] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef({ x: 0, y: 0 });

  // Edge handle state (Option 2)
  const [edgeHandleExpanded, setEdgeHandleExpanded] = useState(false);
  const [edgeHandleDragging, setEdgeHandleDragging] = useState(false);
  const [edgeHandleOffset, setEdgeHandleOffset] = useState(0);

  // Handle closing the mobile menu with animation
  const closeMobileMenu = () => {
    setIsClosingMobileMenu(true);
    setTimeout(() => {
      setIsMobileMenuOpen(false);
      setIsClosingMobileMenu(false);
      setOpenDropdown(null);
    }, 250); // Match animation duration
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
    setShowAccountModal(false); // Close account modal first
    setShowClaimCreditsModal(true);
  };

  const handleClaimSuccess = () => {
    // Refresh the page to update user credits
    window.location.reload();
  };

  // ============================================
  // OPTION 3: Long-Press Radial Menu Handlers
  // ============================================

  // Track if long-press is in progress (to block scrolling)
  const [isLongPressActive, setIsLongPressActive] = useState(false);

  // Disable text selection when radial mode is active (prevents selection on long-press)
  useEffect(() => {
    if (mobileNavMode !== 'radial') return;

    // Add CSS to disable selection
    document.body.style.webkitUserSelect = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.webkitTouchCallout = 'none';

    return () => {
      // Re-enable selection when leaving radial mode
      document.body.style.webkitUserSelect = '';
      document.body.style.userSelect = '';
      document.body.style.webkitTouchCallout = '';
    };
  }, [mobileNavMode]);

  // Prevent scrolling when long-press is active or radial menu is open
  useEffect(() => {
    if (mobileNavMode !== 'radial') return;
    if (!isLongPressActive && !radialMenuOpen) return;

    const preventScroll = (e: TouchEvent) => {
      e.preventDefault();
    };

    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [mobileNavMode, isLongPressActive, radialMenuOpen]);

  // Additional refs for menu open timer and double-tap detection
  const menuOpenTimer = useRef<NodeJS.Timeout | null>(null);
  const lastTapTime = useRef<number>(0);
  const longPressTriggered = useRef<boolean>(false);

  useEffect(() => {
    if (mobileNavMode !== 'radial') return;

    const openMenu = () => {
      setRadialMenuOpen(true);
      if (navigator.vibrate) navigator.vibrate(50);
    };

    const handleTouchStart = (e: TouchEvent) => {
      // Don't trigger on interactive elements
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, select, textarea, [role="button"]')) return;

      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      longPressTriggered.current = false;

      // Start tracking long-press after a short delay (150ms)
      longPressTimer.current = setTimeout(() => {
        setIsLongPressActive(true);
      }, 150);

      // Open menu after full long-press duration (500ms)
      menuOpenTimer.current = setTimeout(() => {
        longPressTriggered.current = true;
        openMenu();
      }, 500);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartPos.current.x;
      const dy = touch.clientY - touchStartPos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Cancel long press if finger moves too much
      if (distance > 10) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        if (menuOpenTimer.current) {
          clearTimeout(menuOpenTimer.current);
          menuOpenTimer.current = null;
        }
        setIsLongPressActive(false);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // Clear long-press timers
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      if (menuOpenTimer.current) {
        clearTimeout(menuOpenTimer.current);
        menuOpenTimer.current = null;
      }
      setIsLongPressActive(false);

      // Skip double-tap if long-press triggered
      if (longPressTriggered.current) {
        longPressTriggered.current = false;
        return;
      }

      // Don't trigger on interactive elements
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, select, textarea, [role="button"]')) return;

      // Check if finger moved (was a swipe, not a tap)
      const touch = e.changedTouches[0];
      if (touch) {
        const dx = touch.clientX - touchStartPos.current.x;
        const dy = touch.clientY - touchStartPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 15) return; // Was a swipe, not a tap
      }

      // Timestamp-based double-tap detection (more reliable)
      const currentTime = new Date().getTime();
      const tapInterval = currentTime - lastTapTime.current;

      if (tapInterval < 400 && tapInterval > 0) {
        // Double tap detected - prevent default and open menu
        e.preventDefault();
        lastTapTime.current = 0; // Reset to prevent triple-tap
        openMenu();
      } else {
        // First tap - record time
        lastTapTime.current = currentTime;
      }
    };

    // Prevent context menu on long press
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    // Use passive: false for touchend to allow preventDefault() for double-tap
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('contextmenu', handleContextMenu);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (menuOpenTimer.current) clearTimeout(menuOpenTimer.current);
    };
  }, [mobileNavMode]);

  const closeRadialMenu = () => {
    setRadialMenuOpen(false);
    setExpandedCategory(null);
  };

  // Track which category is expanded in radial menu
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Handle category tap in radial menu - shows sub-pages in inner ring
  const handleRadialCategoryTap = (categoryId: string) => {
    if (expandedCategory === categoryId) {
      setExpandedCategory(null);
    } else {
      setExpandedCategory(categoryId);
    }
  };

  // Handle page navigation from radial menu
  const handleRadialPageTap = (path: string) => {
    navigate(path);
    closeRadialMenu();
  };

  // Calculate responsive radius based on viewport size
  const getResponsiveRadius = () => {
    if (typeof window === 'undefined') return { outer: 135, inner: 68 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minDimension = Math.min(vw, vh);
    // Outer ring: 38% of smaller viewport dimension, clamped between 100-160px
    const outer = Math.min(Math.max(minDimension * 0.38, 100), 160);
    // Inner ring: 50% of outer radius
    const inner = outer * 0.5;
    return { outer, inner };
  };

  // Get radial items positioned in a circle - ALL categories (OUTER RING)
  const getRadialCategories = () => {
    const { outer: radius } = getResponsiveRadius();
    const startAngle = -90; // Start from top
    const angleStep = 360 / playgroundSections.length;

    return playgroundSections.map((section, index) => {
      const angle = (startAngle + index * angleStep) * (Math.PI / 180);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      return { ...section, x, y };
    });
  };

  // Get sub-pages for expanded category (INNER RING)
  const getExpandedPages = () => {
    if (!expandedCategory) return [];
    const section = playgroundSections.find(s => s.id === expandedCategory);
    if (!section) return [];

    const { inner: radius } = getResponsiveRadius();
    const startAngle = -90;
    const angleStep = 360 / section.pages.length;

    return section.pages.map((page, index) => {
      const angle = (startAngle + index * angleStep) * (Math.PI / 180);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      return { ...page, x, y };
    });
  };

  // Quick access items (Home, Settings, Profile) - positioned at center
  const quickAccessItems = [
    { id: 'home', icon: <Home size={16} />, label: 'Home', path: '/overview' },
    { id: 'settings', icon: <Settings size={16} />, label: 'Settings', path: '/overview/settings' },
    { id: 'profile', icon: <User size={16} />, label: 'Profile', action: () => { setShowAccountModal(true); closeRadialMenu(); } },
  ];

  // ============================================
  // OPTION 2: Edge Handle Handlers
  // ============================================
  const handleEdgeHandleTap = () => {
    if (mobileNavMode !== 'edge-handle') return;
    setEdgeHandleExpanded(!edgeHandleExpanded);
  };

  const handleEdgeHandleDragStart = (e: React.TouchEvent) => {
    if (mobileNavMode !== 'edge-handle') return;
    setEdgeHandleDragging(true);
  };

  const handleEdgeHandleDrag = (e: React.TouchEvent) => {
    if (mobileNavMode !== 'edge-handle' || !edgeHandleDragging) return;
    const touch = e.touches[0];
    const offset = Math.min(Math.max(touch.clientX, 0), 280);
    setEdgeHandleOffset(offset);
    if (offset > 140) {
      setEdgeHandleExpanded(true);
    }
  };

  const handleEdgeHandleDragEnd = () => {
    if (mobileNavMode !== 'edge-handle') return;
    setEdgeHandleDragging(false);
    if (edgeHandleOffset > 140) {
      setEdgeHandleExpanded(true);
    } else {
      setEdgeHandleExpanded(false);
    }
    setEdgeHandleOffset(0);
  };

  const handleLogout = async () => {
    try {
      // Close the account modal first
      setShowAccountModal(false);
      
      // Clear localStorage
      localStorage.clear();
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      // Clear any cookies (basic implementation)
      document.cookie.split(";").forEach((c) => {
        const eqPos = c.indexOf("=");
        const name = eqPos > -1 ? c.substr(0, eqPos) : c;
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      });
      
      // Wait a moment to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Redirect to homepage after logout is complete
      navigate('/');
      
    } catch (error) {
      console.error('Logout failed:', error);
      // Still redirect even if there's an error
      navigate('/');
    }
  };

  // Close dropdown and external containers when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (taskbarRef.current && !taskbarRef.current.contains(target)) {
        // Don't close if clicking inside settings or account containers
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

  const sidebarWidth = 'w-13'; // Slightly wider taskbar

  // Close mobile menu when navigating
  const handleMobileNavigation = (path: string) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* ============================================ */}
      {/* OPTION 3: Long-Press Radial Menu */}
      {/* ============================================ */}
      {mobileNavMode === 'radial' && radialMenuOpen && (
        <div className="fixed inset-0 z-[250] md:hidden">
          {/* Backdrop - Two-step close: first closes subpages, second closes menu */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => {
              if (expandedCategory) {
                setExpandedCategory(null); // First tap: close subpages
              } else {
                closeRadialMenu(); // Second tap: close entire menu
              }
            }}
          />

          {/* Settings - Top Left */}
          <button
            onClick={() => { navigate('/overview/settings'); closeRadialMenu(); }}
            className="absolute top-4 left-4 w-12 h-12 rounded-xl bg-white/10 border border-white/20 text-white active:bg-white/30 flex items-center justify-center"
            style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <Settings size={20} />
          </button>

          {/* Profile - Top Right */}
          <button
            onClick={() => { setShowAccountModal(true); closeRadialMenu(); }}
            className="absolute top-4 right-4 w-12 h-12 rounded-xl bg-white/10 border border-white/20 text-white active:bg-white/30 flex items-center justify-center"
            style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <User size={20} />
          </button>

          {/* Credits - Bottom Left */}
          <div
            className="absolute bottom-4 left-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white"
            style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <Coins size={18} className="text-yellow-400" />
            <span className="text-sm font-semibold">{user?.credits?.toLocaleString() || 0}</span>
          </div>

          {/* Home - Bottom Right */}
          <button
            onClick={() => { navigate('/overview'); closeRadialMenu(); }}
            className="absolute bottom-4 right-4 w-12 h-12 rounded-xl bg-white/10 border border-white/30 text-white active:bg-white/30 flex items-center justify-center"
            style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <Home size={20} />
          </button>

          {/* Radial Menu - Centered */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">

            {/* Category Buttons - Outer Ring */}
            {(() => {
              // Short names for display
              const shortNames: Record<string, string> = {
                'coding': 'Code',
                'tools': 'Tools',
                'download': 'DL',
                'generation': 'Gen',
                'enhance': 'Up',
                'train': 'Train',
                'chat': 'Chat',
                'studio': 'Studio',
                'content-creation': 'Create',
                'office': 'Office'
              };

              const total = playgroundSections.length;
              // Calculate radius based on screen width to fit all buttons
              const screenW = typeof window !== 'undefined' ? window.innerWidth : 375;
              const radius = Math.min(screenW * 0.38, 155);

              return playgroundSections.map((section, index) => {
                const angle = (-90 + (index * 360 / total)) * (Math.PI / 180);
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                const displayName = shortNames[section.id] || section.name;

                return (
                  <button
                    key={section.id}
                    onClick={() => handleRadialCategoryTap(section.id)}
                    className={`absolute w-20 h-9 rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
                      expandedCategory === section.id
                        ? 'bg-white/30 border-white/50 text-white'
                        : 'bg-black/90 border-white/20 text-white/80 active:bg-white/20'
                    }`}
                    style={{
                      left: x,
                      top: y,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    {section.icon}
                    <div className="w-px h-4 bg-white/30" />
                    <span className="text-[11px] font-medium">{displayName}</span>
                  </button>
                );
              });
            })()}

            {/* Subpage Buttons - Inner Ring (when category expanded) */}
            {expandedCategory && (() => {
              const section = playgroundSections.find(s => s.id === expandedCategory);
              if (!section) return null;

              const total = section.pages.length;
              // Smaller radius for inner ring
              const screenW = typeof window !== 'undefined' ? window.innerWidth : 375;
              const radius = Math.min(screenW * 0.15, 60);

              return section.pages.map((page, index) => {
                const angle = (-90 + (index * 360 / total)) * (Math.PI / 180);
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;

                // Shorten page names
                const shortPageName = page.id.length > 6 ? page.id.slice(0, 5) : page.id;

                return (
                  <button
                    key={page.id}
                    onClick={() => handleRadialPageTap(page.path)}
                    className={`absolute h-7 px-2 rounded-md border flex items-center gap-1 transition-all whitespace-nowrap ${
                      location.pathname === page.path
                        ? 'bg-white/30 border-white/50 text-white'
                        : 'bg-black/90 border-white/20 text-white/80 active:bg-white/20'
                    }`}
                    style={{
                      left: x,
                      top: y,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    {page.icon}
                    <div className="w-px h-3 bg-white/30" />
                    <span className="text-[9px] font-medium capitalize">{shortPageName}</span>
                  </button>
                );
              });
            })()}

            {/* Center hint text */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <span className="text-white/40 text-[9px]">
                {expandedCategory ? 'tap page' : 'tap'}
              </span>
            </div>
          </div>

        </div>
      )}

      {/* ============================================ */}
      {/* OPTION 2: Edge Handle */}
      {/* ============================================ */}
      {mobileNavMode === 'edge-handle' && (
        <>
          {/* Backdrop when expanded */}
          {edgeHandleExpanded && (
            <div
              className="fixed inset-0 z-[250] md:hidden bg-black/70 backdrop-blur-md"
              onClick={() => { setEdgeHandleExpanded(false); setExpandedCategory(null); }}
            />
          )}

          {/* Edge Handle + Menu Panel */}
          <div
            className={`fixed left-0 top-1/2 -translate-y-1/2 z-[260] md:hidden flex items-center transition-transform duration-300 ease-out`}
            style={{
              transform: `translateY(-50%) translateX(${edgeHandleExpanded ? '0' : edgeHandleDragging ? edgeHandleOffset - 320 : '-320'}px)`,
            }}
          >
            {/* Menu Panel */}
            <div className="w-[320px] bg-black/95 backdrop-blur-xl border-r border-y border-white/10 rounded-r-2xl p-3 flex flex-col max-h-[80vh] overflow-hidden">
              {/* Quick Access Row */}
              <div className="flex gap-2 mb-3 pb-3 border-b border-white/10">
                {quickAccessItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.action) {
                        item.action();
                        setEdgeHandleExpanded(false);
                      } else {
                        navigate(item.path!);
                        setEdgeHandleExpanded(false);
                        setExpandedCategory(null);
                      }
                    }}
                    className="flex-1 h-11 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/15 hover:text-white flex items-center justify-center gap-2 transition-all duration-200"
                  >
                    {item.icon}
                    <span className="text-[11px] font-medium">{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Categories Grid */}
              <div className="grid grid-cols-4 gap-2">
                {playgroundSections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => handleRadialCategoryTap(section.id)}
                    className={`aspect-square rounded-xl border flex flex-col items-center justify-center gap-1 transition-all duration-200 ${
                      expandedCategory === section.id
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {section.icon}
                    <span className="text-[8px] font-medium opacity-70 leading-tight text-center px-1">{section.name}</span>
                  </button>
                ))}
              </div>

              {/* Expanded Category Pages */}
              {expandedCategory && (
                <div className="mt-3 pt-3 border-t border-white/10 overflow-y-auto">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-white/40 text-[10px] uppercase tracking-wider">
                      {playgroundSections.find(s => s.id === expandedCategory)?.name}
                    </span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {playgroundSections
                      .find(s => s.id === expandedCategory)
                      ?.pages.map((page) => (
                        <button
                          key={page.id}
                          onClick={() => {
                            navigate(page.path);
                            setEdgeHandleExpanded(false);
                            setExpandedCategory(null);
                          }}
                          className={`h-12 rounded-xl border flex items-center justify-center gap-2 transition-all duration-200 ${
                            location.pathname === page.path
                              ? 'bg-white/20 border-white/30 text-white'
                              : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {page.icon}
                          <span className="text-[10px] font-medium capitalize">{page.id}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* The Handle itself */}
            <div
              className="w-5 h-20 bg-white/10 hover:bg-white/20 border border-white/20 rounded-r-xl flex items-center justify-center cursor-pointer transition-all duration-200"
              onClick={handleEdgeHandleTap}
              onTouchStart={handleEdgeHandleDragStart}
              onTouchMove={handleEdgeHandleDrag}
              onTouchEnd={handleEdgeHandleDragEnd}
            >
              <div className="w-0.5 h-6 bg-white/40 rounded-full" />
            </div>
          </div>
        </>
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
          {/* Home Button */}
          <button
            onClick={() => navigate('/overview')}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            title="Home"
          >
            <Home size={16} />
          </button>

          {/* OS Button */}
          <button
            onClick={() => navigate('/os/connect')}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            title="OS"
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>OS</span>
          </button>

          {/* Search Button */}
          <button
            onClick={() => navigate('/overview/search')}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            title="Search"
          >
            <Search size={16} />
          </button>

          {/* Create Lab Button */}
          <button
            onClick={onCreateLab}
            className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
            style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            title="Create Lab"
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
                  className={`flex items-center justify-center rounded-md font-medium transition-colors duration-300 ${
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
                <div style={{ width: 34 }} className="mt-1 mb-1 p-1 bg-white/5 backdrop-blur-sm border border-white/5 rounded-md space-y-1 flex flex-col items-center transition-all duration-300">
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
                          className={`flex items-center justify-center rounded-md font-medium transition-colors duration-300 ${
                            isSubcategoryActive
                              ? 'bg-white/20 text-white'
                              : 'bg-white/5 text-white/70 hover:bg-white/15 hover:text-white'
                          }`}
                          style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                          title={`${section.name} - ${page.id}`}
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
                    className={`flex items-center justify-center rounded-md font-medium transition-colors duration-300 ${
                      openDropdown === `lab-${lab.id}`
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                    }`}
                    style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 30 }}
                    title={lab.name}
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
                        className="flex items-center justify-center rounded-md font-medium bg-white/5 text-white/70 hover:bg-white/15 hover:text-white transition-colors duration-300"
                        style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        title={`${lab.name} - Open`}
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
          className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
          style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          title="Notifications"
        >
          <Bell size={16} />
        </button>

        {/* Light Theme Switch Button */}
        <button
          className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
          style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          title="Light Theme"
        >
          <Sun size={16} />
        </button>

        {/* Profile Button - Toggleable Modal */}
        <button
          onClick={() => setShowAccountModal(!showAccountModal)}
          className={`flex items-center justify-center rounded-md font-medium transition-colors duration-300 ${
            showAccountModal
              ? 'bg-white/20 text-white'
              : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
          }`}
          style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          title="Profile"
        >
          <User size={16} />
        </button>


      </div>
      </div>

      {/* Account Modal - Redesigned */}
      {showAccountModal && (
        <div
          data-container="account"
          className="absolute bg-[#0c0c0e]/98 backdrop-blur-xl border border-white/[0.08] rounded-md shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 overflow-hidden"
          style={{
            left: 'calc(100% + 8px)',
            bottom: '8px',
            width: '260px'
          }}
        >
          {/* User Info Header */}
          <div className="p-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1] flex items-center justify-center">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <User size={18} className="text-white/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{user?.display_name || 'User'}</div>
                <div className="text-xs text-white/40 truncate">{user?.email}</div>
              </div>
            </div>
          </div>

          {/* Credits Section */}
          <div className="p-4 border-b border-white/[0.06]">
            {/* Claim button */}
            {user && !user.bonus_credits_claimed && (
              <button
                onClick={handleClaimCredits}
                className="w-full flex items-center justify-center gap-1.5 mb-3 px-3 py-2 text-xs font-medium text-white/80 bg-white/[0.08] hover:bg-white/[0.12] rounded-md transition-colors"
              >
                <Gift size={12} />
                Claim 1,000 Free Credits
              </button>
            )}

            {/* Progress bar with labels */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Coins size={14} className="text-white/40" />
                <span className="text-xs font-medium text-white/60">Credits</span>
              </div>
              <span className="text-xs text-white/40">{user?.credits?.toLocaleString() || 0} / 1,000</span>
            </div>
            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-white/30 to-white/50 rounded-full transition-all duration-500"
                style={{ width: user?.credits ? `${Math.min((user.credits / 1000) * 100, 100)}%` : '0%' }}
              />
            </div>

            {/* Upgrade button */}
            <button className="w-full mt-3 py-2 text-xs font-medium text-[#08080a] bg-white hover:bg-white/90 rounded-lg transition-colors">
              Upgrade Plan
            </button>
          </div>

          {/* Navigation Links */}
          <div className="p-2">
            <button
              onClick={() => {
                setShowAccountModal(false);
                navigate('/overview/profile');
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-lg text-white/70 hover:text-white hover:bg-white/[0.04] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <User size={15} className="text-white/40 group-hover:text-white/60" />
                <span className="text-[13px]">Profile</span>
              </div>
              <ChevronRight size={14} className="text-white/20 group-hover:text-white/40" />
            </button>

            <button
              onClick={() => {
                setShowAccountModal(false);
                navigate('/overview/usage-analytics');
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-lg text-white/70 hover:text-white hover:bg-white/[0.04] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <BarChart3 size={15} className="text-white/40 group-hover:text-white/60" />
                <span className="text-[13px]">Usage Analytics</span>
              </div>
              <ChevronRight size={14} className="text-white/20 group-hover:text-white/40" />
            </button>

            <button
              onClick={() => {
                setShowAccountModal(false);
                navigate('/overview/settings');
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-lg text-white/70 hover:text-white hover:bg-white/[0.04] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Settings size={15} className="text-white/40 group-hover:text-white/60" />
                <span className="text-[13px]">Settings</span>
              </div>
              <ChevronRight size={14} className="text-white/20 group-hover:text-white/40" />
            </button>

            <button
              onClick={() => {
                setShowAccountModal(false);
                navigate('/overview/help');
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-lg text-white/70 hover:text-white hover:bg-white/[0.04] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <HelpCircle size={15} className="text-white/40 group-hover:text-white/60" />
                <span className="text-[13px]">Help Center</span>
              </div>
              <ChevronRight size={14} className="text-white/20 group-hover:text-white/40" />
            </button>
          </div>

          {/* Logout */}
          <div className="p-2 pt-0">
            <div className="h-px bg-white/[0.06] mb-2" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg text-white/50 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
            >
              <LogOut size={15} />
              <span className="text-[13px]">Log out</span>
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
