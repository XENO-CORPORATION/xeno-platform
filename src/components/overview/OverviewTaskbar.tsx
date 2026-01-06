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
  Calendar
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
    name: 'Content Creation',
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
  const isCollapsed = true; // Always collapsed
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showClaimCreditsModal, setShowClaimCreditsModal] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative flex z-[200]">
      <div ref={taskbarRef} className={`${sidebarWidth} h-screen bg-black/90 backdrop-blur-md border-r border-white/10 flex flex-col items-center transition-all duration-300`}>
        {/* Version marker for deployment verification */}
        <div className="absolute -top-10 left-0 opacity-0 pointer-events-none">v2.0.1</div>
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
          {playgroundSections.map((section) => (
            <div key={section.id} className="w-full flex flex-col items-center">
              {/* Category Button */}
              <button
                onClick={() => handleCategoryClick(section.id)}
                className={`flex items-center justify-center rounded-md font-medium transition-colors duration-300 ${
                  openDropdown === section.id
                    ? 'bg-white/20 text-white'
                    : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                }`}
                style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                title={section.name}
              >
                {section.icon}
              </button>

              {/* Inline Dropdown Container */}
              {openDropdown === section.id && (
                <div style={{ width: 34 }} className="mt-1 mb-1 p-1 bg-white/5 backdrop-blur-sm border border-white/5 rounded-md space-y-1 flex flex-col items-center transition-all duration-300">
                  {section.pages.map((page) => (
                    <button
                      key={page.id}
                      onClick={() => {
                        navigate(page.path);
                        // Keep dropdown open for active section
                      }}
                      className={`flex items-center justify-center rounded-md font-medium transition-colors duration-300 ${
                        isPageActive(page.path)
                          ? 'bg-white/20 text-white'
                          : 'bg-white/5 text-white/70 hover:bg-white/15 hover:text-white'
                      }`}
                      style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      title={`${section.name} - ${page.id}`}
                    >
                      {page.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
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
  );
};

export default OverviewTaskbar;