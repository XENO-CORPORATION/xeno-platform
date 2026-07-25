import React, { useState } from 'react';
import TaskbarOSButton from './TaskbarOSButton';
import { useNavigate } from 'react-router-dom';
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
  Home
} from 'lucide-react';

interface TaskbarProps {
  labs: { id: string; name: string; lastModified: Date }[];
  onCreateLab: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
  onToggleInterface?: () => void;
  isCleanMode?: boolean;
}

const playgroundSections = [
  {
    id: 'generation',
    name: 'Generation',
    icon: <Sparkles size={18} />,
    pages: [
      { id: 'image', icon: <Image size={14} />, path: '/playground/generation/image' },
      { id: '3d', icon: <Beaker size={14} />, path: '/playground/generation/3d' },
      { id: 'video', icon: <Video size={14} />, path: '/playground/generation/video' },
      { id: 'audio', icon: <Volume2 size={14} />, path: '/playground/generation/audio' }
    ]
  },
  {
    id: 'enhance',
    name: 'Enhance',
    icon: <ArrowUpRight size={18} />,
    pages: [
      { id: 'image', icon: <Image size={14} />, path: '/playground/enhance/image' },
      { id: 'video', icon: <Video size={14} />, path: '/playground/enhance/video' }
    ]
  },
  {
    id: 'train',
    name: 'Train',
    icon: <BrainCircuit size={18} />,
    pages: [
      { id: 'lora', icon: <Image size={14} />, path: '/playground/train/lora' },
      { id: 'lora-video', icon: <Video size={14} />, path: '/playground/train/lora-video' },
      { id: 'llm', icon: <FileText size={14} />, path: '/playground/train/llm' }
    ]
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: <MessageSquare size={18} />,
    pages: [
      { id: 'llm', icon: <MessageCircle size={14} />, path: '/playground/chat/llm' }
      // XENO: voice mode entry removed — voice de-scoped (no direct provider calls)
    ]
  }
];

const Taskbar: React.FC<TaskbarProps> = ({ 
  labs, 
  onCreateLab, 
  onCollapseChange, 
  onToggleInterface,
  isCleanMode = false 
}) => {
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const handleCollapseToggle = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    onCollapseChange?.(newCollapsed);
  };

  const handleCategoryClick = (id: string) => {
    setOpenDropdown(openDropdown === id ? null : id);
  };

  const sidebarWidth = isCollapsed ? 'w-16' : 'w-64';

  return (
    <div className={`${sidebarWidth} h-full bg-black/90 backdrop-blur-md border-r border-white/10 flex flex-col transition-all duration-300`}>
      {/* Header with OS Button */}
      <div className="p-3 border-b border-white/10">
        <div className="flex items-center justify-between">
          <TaskbarOSButton onClick={() => navigate('/os/connect')} />
          {!isCollapsed && (
            <button
              onClick={handleCollapseToggle}
              className="p-1 rounded hover:bg-white/10 text-white/70"
            >
              <ArrowUpRight size={16} className="rotate-180" />
            </button>
          )}
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 p-2 space-y-1">
        {/* Home Button */}
        <button
          onClick={() => navigate('/')}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          title="Home"
        >
          <Home size={18} />
          {!isCollapsed && <span className="text-sm">Home</span>}
        </button>

        {/* Search Button */}
        <button
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          title="Search"
        >
          <Search size={18} />
          {!isCollapsed && <span className="text-sm">Search</span>}
        </button>

        {/* Create Lab Button */}
        <button
          onClick={onCreateLab}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          title="Create Lab"
        >
          <Plus size={18} />
          {!isCollapsed && <span className="text-sm">New Lab</span>}
        </button>

        {/* Playground Categories */}
        <div className="pt-2">
          {!isCollapsed && (
            <div className="text-xs text-white/50 uppercase tracking-wide mb-2 px-2">
              Playground
            </div>
          )}
          
          {playgroundSections.map((section) => (
            <div key={section.id} className="mb-1">
              <button
                onClick={() => handleCategoryClick(section.id)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title={section.name}
              >
                {section.icon}
                {!isCollapsed && (
                  <>
                    <span className="text-sm flex-1 text-left">{section.name}</span>
                    <ArrowUpRight size={14} className={`transform transition-transform ${
                      openDropdown === section.id ? 'rotate-90' : ''
                    }`} />
                  </>
                )}
              </button>
              
              {/* Dropdown */}
              {openDropdown === section.id && !isCollapsed && (
                <div className="ml-4 mt-1 space-y-1">
                  {section.pages.map((page) => (
                    <button
                      key={page.id}
                      onClick={() => navigate(page.path)}
                      className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors text-sm"
                    >
                      {page.icon}
                      <span>{page.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Labs Section */}
        {labs.length > 0 && (
          <div className="pt-4 border-t border-white/10">
            {!isCollapsed && (
              <div className="text-xs text-white/50 uppercase tracking-wide mb-2 px-2">
                Labs ({labs.length})
              </div>
            )}
            <div className="space-y-1">
              {labs.slice(0, isCollapsed ? 3 : 5).map((lab) => (
                <button
                  key={lab.id}
                  onClick={() => navigate(`/labs/${lab.id}`)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                  title={lab.name}
                >
                  <Beaker size={16} />
                  {!isCollapsed && (
                    <span className="text-sm truncate">{lab.name}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-white/10 space-y-1">
        {/* Settings */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          title="Settings"
        >
          <Settings size={18} />
          {!isCollapsed && <span className="text-sm">Settings</span>}
        </button>

        {/* Profile/Account */}
        <button
          onClick={() => navigate('/profile')}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          title="Account"
        >
          <User size={18} />
          {!isCollapsed && <span className="text-sm">Account</span>}
        </button>

        {/* Interface Mode Toggle */}
        {onToggleInterface && (
          <button
            onClick={onToggleInterface}
            className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
              isCleanMode 
                ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30' 
                : 'hover:bg-white/10 text-white/80 hover:text-white'
            }`}
            title={isCleanMode ? 'Clean Mode' : 'Standard Mode'}
          >
            <Sparkles size={18} />
            {!isCollapsed && (
              <span className="text-sm">{isCleanMode ? 'Clean' : 'Standard'}</span>
            )}
          </button>
        )}

        {/* Collapse Toggle (when collapsed) */}
        {isCollapsed && (
          <button
            onClick={handleCollapseToggle}
            className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            title="Expand Sidebar"
          >
            <ArrowUpRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

export default Taskbar;