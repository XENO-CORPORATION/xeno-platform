import React from 'react';
import { 
  User, 
  Settings, 
  Power, 
  Grid3X3, 
  Terminal, 
  HardDrive, 
  Wifi, 
  FileText, 
  Activity, 
  Search,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';

interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  onLaunchApp: (appId: string) => void;
}

export const StartMenu: React.FC<StartMenuProps> = ({ 
  isOpen, 
  onClose, 
  onLogout, 
  onLaunchApp 
}) => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = React.useState('');

  if (!isOpen) return null;

  const apps = [
    { id: 'xeno-explorer', name: 'File Explorer', icon: HardDrive, category: 'System' },
    { id: 'terminal', name: 'Terminal', icon: Terminal, category: 'System' },
    { id: 'settings', name: 'Settings', icon: Settings, category: 'System' },
    { id: 'text-editor', name: 'Text Editor', icon: FileText, category: 'Accessories' },
    { id: 'task-manager', name: 'Task Manager', icon: Activity, category: 'System' },
    { id: 'websocket-demo', name: 'Network Demo', icon: Wifi, category: 'Development' },
  ];

  const filteredApps = apps.filter(app => 
    app.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {/* Transparent backdrop to close menu when clicking outside */}
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
      />

      {/* Start Menu Container */}
      <div
        className="fixed bottom-12 left-2 w-80 bg-[rgba(32,32,32,0.95)] backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-[9999] overflow-hidden flex flex-col"
        style={{
          animation: 'slideUp 0.2s ease-out',
          transformOrigin: 'bottom left',
          maxHeight: '600px'
        }}
      >
        {/* Search Bar */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40" size={16} />
            <input 
              type="text" 
              placeholder="Search apps..." 
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Pinned / All Apps Section */}
        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          <div className="px-2 mb-2 text-xs font-medium text-white/40 uppercase tracking-wider">
            Pinned
          </div>
          
          <div className="grid grid-cols-1 gap-1">
            {filteredApps.map((app) => (
              <button
                key={app.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 transition-colors group text-left"
                onClick={() => {
                  onLaunchApp(app.id);
                  onClose();
                }}
              >
                <div className="w-8 h-8 bg-white/5 rounded-md flex items-center justify-center group-hover:bg-white/10 transition-colors border border-white/5">
                  <app.icon size={18} className="text-white/80" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white/90">{app.name}</div>
                  <div className="text-xs text-white/40">{app.category}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer: User Profile & Power */}
        <div className="p-3 bg-white/5 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3 hover:bg-white/5 p-2 rounded-lg cursor-pointer transition-colors flex-1 mr-2">
            <div className="w-8 h-8 bg-blue-500/20 border border-blue-500/30 rounded-full flex items-center justify-center">
              <User size={16} className="text-blue-400" />
            </div>
            <div className="overflow-hidden">
              <div className="text-sm font-medium text-white/90 truncate">
                {user?.display_name || 'Xeno User'}
              </div>
              <div className="text-xs text-white/50 truncate">
                {user?.email || 'user@xenolabs.io'}
              </div>
            </div>
          </div>

          <button
            className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-red-400 transition-colors"
            onClick={onLogout}
            title="Sign Out"
          >
            <Power size={20} />
          </button>
        </div>
      </div>
    </>
  );
};

export default StartMenu;
