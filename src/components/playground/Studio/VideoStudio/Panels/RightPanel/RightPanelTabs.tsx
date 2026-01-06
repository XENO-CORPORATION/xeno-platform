import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { TabId, getTabDefinition, getAvailableTabsForPanel } from '../TabRegistry';
import AddTabSearch from '../AddTabSearch';
import EffectControlsTab from './EffectControlsTab';
import LumetriColorTab from './LumetriColorTab';
import EssentialSoundTab from './EssentialSoundTab';
import EssentialGraphicsTab from './EssentialGraphicsTab';
import MarkersTab from './MarkersTab';
import MetadataTab from './MetadataTab';

interface RightPanelTabsProps {
  selectedClipId?: string;
  clipName?: string;
  clipEffects?: any[];
  onEffectToggle?: (effectId: string) => void;
  onEffectRemove?: (effectId: string) => void;
  onParameterChange?: (effectId: string, parameterId: string, value: any) => void;
  onKeyframeAdd?: (effectId: string, parameterId: string) => void;
}

const RightPanelTabs: React.FC<RightPanelTabsProps> = ({
  selectedClipId,
  clipName,
  clipEffects = [],
  onEffectToggle,
  onEffectRemove,
  onParameterChange,
  onKeyframeAdd
}) => {
  // Only show fully implemented tabs by default
  const [activeTabs, setActiveTabs] = useState<TabId[]>(['effect-controls', 'lumetri-color']);
  const [activeTab, setActiveTab] = useState<TabId>('effect-controls');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const addTabButtonRef = React.useRef<HTMLButtonElement>(null);

  const availableTabs = getAvailableTabsForPanel('right', activeTabs);

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
          {/* Dynamic Tab Content */}
          {activeTab && (() => {
          if (activeTab === 'effect-controls') {
            return (
              <EffectControlsTab
                selectedClipId={selectedClipId}
                clipName={clipName}
                effects={clipEffects}
                onEffectToggle={onEffectToggle}
                onEffectRemove={onEffectRemove}
                onParameterChange={onParameterChange}
                onKeyframeAdd={onKeyframeAdd}
              />
            );
          }

          if (activeTab === 'lumetri-color') {
            return (
              <LumetriColorTab
                selectedClipId={selectedClipId}
                clipName={clipName}
                onParameterChange={(parameterId, value) => {
                  console.log('Lumetri parameter changed:', parameterId, value);
                }}
                onReset={(section) => {
                  console.log('Lumetri section reset:', section);
                }}
              />
            );
          }

          if (activeTab === 'essential-sound') {
            return (
              <EssentialSoundTab
                selectedClipId={selectedClipId}
                clipName={clipName}
                onParameterChange={(parameterId, value) => {
                  console.log('Essential Sound parameter changed:', parameterId, value);
                }}
                onPresetApply={(preset) => {
                  console.log('Preset applied:', preset);
                }}
              />
            );
          }

          if (activeTab === 'essential-graphics') {
            return (
              <EssentialGraphicsTab
                selectedClipId={selectedClipId}
                clipName={clipName}
                onParameterChange={(parameterId, value) => {
                  console.log('Essential Graphics parameter changed:', parameterId, value);
                }}
              />
            );
          }

          if (activeTab === 'markers') {
            return (
              <MarkersTab
                selectedClipId={selectedClipId}
                clipName={clipName}
                onMarkerAdd={(time) => {
                  console.log('Marker added at:', time);
                }}
                onMarkerEdit={(markerId, data) => {
                  console.log('Marker edited:', markerId, data);
                }}
                onMarkerDelete={(markerId) => {
                  console.log('Marker deleted:', markerId);
                }}
                onMarkerSeek={(time) => {
                  console.log('Seek to marker:', time);
                }}
              />
            );
          }

          if (activeTab === 'metadata') {
            return (
              <MetadataTab
                selectedClipId={selectedClipId}
                clipName={clipName}
                onMetadataUpdate={(metadata) => {
                  console.log('Metadata updated:', metadata);
                }}
                onMetadataSave={() => {
                  console.log('Metadata saved');
                }}
              />
            );
          }

          if (activeTab === 'info') {
            return (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <Plus className="w-8 h-8 text-white/20" />
                </div>
                <h4 className="text-white text-sm font-medium mb-2">Clip Information</h4>
                <p className="text-white/40 text-xs max-w-xs">
                  {selectedClipId
                    ? 'View and edit metadata for the selected clip'
                    : 'Select a clip to view its information'
                  }
                </p>
                {selectedClipId && (
                  <div className="mt-4 w-full max-w-xs space-y-2 text-left">
                    <div className="px-3 py-2 bg-white/5 border border-white/10 rounded">
                      <div className="text-[10px] text-white/40 mb-1">Clip Name</div>
                      <div className="text-xs text-white">{clipName || 'Untitled'}</div>
                    </div>
                    <div className="px-3 py-2 bg-white/5 border border-white/10 rounded">
                      <div className="text-[10px] text-white/40 mb-1">Clip ID</div>
                      <div className="text-xs text-white font-mono">{selectedClipId}</div>
                    </div>
                    <div className="px-3 py-2 bg-white/5 border border-white/10 rounded">
                      <div className="text-[10px] text-white/40 mb-1">Effects Applied</div>
                      <div className="text-xs text-white">{clipEffects.length} effect{clipEffects.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          // Generic placeholder for other tabs
          const tabDef = getTabDefinition(activeTab);
          return (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                {tabDef && React.createElement(tabDef.icon, { className: "w-8 h-8 text-white/20" })}
              </div>
              <h4 className="text-white text-sm font-medium mb-2">{tabDef?.name}</h4>
              <p className="text-white/40 text-xs max-w-xs">
                {tabDef?.description || 'Content coming soon'}
              </p>
            </div>
          );
          })()}
        </div>
      </div>
    </>
  );
};

export default RightPanelTabs;
