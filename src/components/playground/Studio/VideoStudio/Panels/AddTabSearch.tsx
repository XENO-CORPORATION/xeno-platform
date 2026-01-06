import React, { useRef, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { TabDefinition } from './TabRegistry';

interface AddTabSearchProps {
  isOpen: boolean;
  onClose: () => void;
  availableTabs: TabDefinition[];
  onSelectTab: (tabId: string) => void;
  triggerRef?: React.RefObject<HTMLButtonElement>; // Reference to the button that triggered this search
}

const AddTabSearch: React.FC<AddTabSearchProps> = ({
  isOpen,
  onClose,
  availableTabs,
  onSelectTab,
  triggerRef
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Filter tabs based on search query
  const filteredTabs = availableTabs.filter(tab =>
    tab.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tab.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate position based on the trigger button
  useEffect(() => {
    if (!isOpen || !triggerRef?.current) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;

      const buttonRect = triggerRef.current.getBoundingClientRect();

      // Position to the left of the button
      const leftPosition = buttonRect.left - 170; // 160px width + 10px gap

      // Center vertically within the button's height
      const buttonCenterY = buttonRect.top + (buttonRect.height / 2);

      setPosition({
        top: buttonCenterY,
        left: leftPosition
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;

    // Focus input when opened
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
        setSearchQuery('');
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectTab = (tabId: string) => {
    onSelectTab(tabId);
    onClose();
    setSearchQuery('');
  };

  return (
    <>
      {/* Search Bar - fixed positioning, overlays header */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: `${position.top}px`,
          left: `${position.left}px`,
          width: '160px',
          transform: 'translateY(-50%)'
        }}
        className="z-[9999] bg-[#0a0a0a] rounded px-1 py-1"
      >
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tabs..."
            className="w-full bg-white/5 border border-white/10 rounded pl-7 pr-7 py-1 text-[11px] text-white placeholder-white/20 focus:outline-none focus:border-white/20 focus:bg-white/10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/50"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Dropdown - below search bar */}
        {filteredTabs.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 mt-1 w-[280px] bg-[#1a1a1a] border border-white/10 rounded-md shadow-2xl max-h-[280px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              {filteredTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleSelectTab(tab.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left group"
                  >
                    <Icon className="w-3.5 h-3.5 text-white/60 group-hover:text-white/80 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-white group-hover:text-white truncate">
                        {tab.name}
                      </div>
                      <div className="text-[9px] text-white/40 group-hover:text-white/60 truncate">
                        {tab.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AddTabSearch;
