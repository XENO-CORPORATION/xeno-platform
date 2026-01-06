import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { TabId, getTabDefinition, getAvailableTabsForPanel } from '../TabRegistry';
import AddTabSearch from '../AddTabSearch';
import MotionTab from './MotionTab';
import AudioTab from './AudioTab';
import MasksTrackingTab from './MasksTrackingTab';
import AlignTransformTab from './AlignTransformTab';

interface LeftTopPanelTabsProps {
  selectedClipId?: string;
  clipName?: string;
}

const LeftTopPanelTabs: React.FC<LeftTopPanelTabsProps> = ({
  selectedClipId,
  clipName
}) => {
  // Only show fully implemented tabs by default
  const [activeTabs, setActiveTabs] = useState<TabId[]>(['motion', 'audio', 'masks-tracking']);
  const [activeTab, setActiveTab] = useState<TabId>('motion');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const addTabButtonRef = React.useRef<HTMLButtonElement>(null);

  const availableTabs = getAvailableTabsForPanel('left-top', activeTabs);

  const handleAddTab = (tabId: string) => {
    setActiveTabs([...activeTabs, tabId as TabId]);
    setActiveTab(tabId as TabId);
    setIsSearchOpen(false);
  };

  const handleRemoveTab = (tabId: TabId, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = activeTabs.filter(t => t !== tabId);
    setActiveTabs(newTabs);
    if (activeTab === tabId && newTabs.length > 0) {
      setActiveTab(newTabs[0]);
    }
  };

  // Render the active tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'motion':
        return (
          <MotionTab
            selectedClipId={selectedClipId}
            clipName={clipName}
            onParameterChange={(paramId, value) => {
              console.log('Motion parameter changed:', paramId, value);
            }}
            onKeyframeAdd={(paramId) => {
              console.log('Keyframe added:', paramId);
            }}
            onLockToggle={(paramId) => {
              console.log('Lock toggled:', paramId);
            }}
            onReset={(paramId) => {
              console.log('Parameter reset:', paramId);
            }}
          />
        );

      case 'audio':
        return (
          <AudioTab
            selectedClipId={selectedClipId}
            clipName={clipName}
            onParameterChange={(paramId, value) => {
              console.log('Audio parameter changed:', paramId, value);
            }}
            onKeyframeAdd={(paramId) => {
              console.log('Keyframe added:', paramId);
            }}
            onReset={(paramId) => {
              console.log('Parameter reset:', paramId);
            }}
            onMuteToggle={() => {
              console.log('Mute toggled');
            }}
          />
        );

      case 'masks-tracking':
        return (
          <MasksTrackingTab
            selectedClipId={selectedClipId}
            clipName={clipName}
            onMaskAdd={(type) => {
              console.log('Mask added:', type);
            }}
            onMaskToggle={(maskId) => {
              console.log('Mask toggled:', maskId);
            }}
            onMaskRemove={(maskId) => {
              console.log('Mask removed:', maskId);
            }}
            onMaskParameterChange={(maskId, parameter, value) => {
              console.log('Mask parameter changed:', maskId, parameter, value);
            }}
          />
        );

      case 'align-transform':
        return (
          <AlignTransformTab
            selectedClipId={selectedClipId}
            clipName={clipName}
            onAlign={(alignment) => {
              console.log('Align:', alignment);
            }}
            onDistribute={(distribution) => {
              console.log('Distribute:', distribution);
            }}
            onFlip={(direction) => {
              console.log('Flip:', direction);
            }}
          />
        );

      case 'effect-controls':
        // Placeholder for effect-controls (would use existing component from Right Panel)
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="text-xs font-medium text-white mb-2">Effect Controls</div>
            <p className="text-white/40 text-[10px]">
              Select a clip to view and edit effects
            </p>
          </div>
        );

      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-white/40 text-[10px]">
              Tab content not implemented yet
            </p>
          </div>
        );
    }
  };

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden relative min-h-0">
        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/20 overflow-x-auto flex-shrink-0" style={{ minHeight: 'clamp(40px, 5vh, 50px)' }}>
          {/* Dynamic Tabs */}
          {activeTabs.map((tabId) => {
            const tabDef = getTabDefinition(tabId);
            if (!tabDef) return null;

            const Icon = tabDef.icon;
            return (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-all whitespace-nowrap group ${
                  activeTab === tabId
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                }`}
                title={tabDef.description}
              >
                <Icon className="w-3 h-3 flex-shrink-0" />
                <span>{tabDef.name}</span>
                {activeTabs.length > 1 && (
                  <X
                    className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleRemoveTab(tabId, e)}
                  />
                )}
              </button>
            );
          })}

          {/* Add Tab Button - always visible */}
          <button
            ref={addTabButtonRef}
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white/40 hover:text-white/60 hover:bg-white/5 transition-all ml-auto"
            title="Add Tab"
          >
            <Plus className="w-3 h-3 flex-shrink-0" />
          </button>
        </div>

        {/* Search Overlay - rendered outside header flow */}
        {isSearchOpen && (
          <AddTabSearch
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
            availableTabs={availableTabs}
            onSelectTab={handleAddTab}
            triggerRef={addTabButtonRef}
          />
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {renderTabContent()}
        </div>
      </div>
    </>
  );
};

export default LeftTopPanelTabs;
