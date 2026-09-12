import React, { useState, useRef } from 'react';
import { Upload, Film, Image, Music, File, Trash2, Search, X, Plus, Cloud, Wand2 } from 'lucide-react';
import { VideoFile } from '../../core/types';
import { TabId, getTabDefinition, getAvailableTabsForPanel } from '../TabRegistry';
import AddTabSearch from '../AddTabSearch';
import GraphicsTab from './GraphicsTab';
import AudioEffectsTab from './AudioEffectsTab';
import LibrariesTab from './LibrariesTab';
import PresetsTab from './PresetsTab';

interface LeftBottomPanelTabsProps {
  assets: VideoFile[];
  onAssetSelect?: (asset: VideoFile) => void;
  onAssetUpload?: (files: File[]) => void;
  onAssetDelete?: (assetId: string) => void;
}

const LeftBottomPanelTabs: React.FC<LeftBottomPanelTabsProps> = ({
  assets,
  onAssetSelect,
  onAssetUpload,
  onAssetDelete
}) => {
  // Only show fully implemented tabs by default
  const [activeTabs, setActiveTabs] = useState<TabId[]>(['project', 'graphics', 'audio-effects']);
  const [activeTab, setActiveTab] = useState<TabId>('project');
  const [isAddTabSearchOpen, setIsAddTabSearchOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addTabButtonRef = React.useRef<HTMLButtonElement>(null);

  const availableTabs = getAvailableTabsForPanel('left-bottom', activeTabs);

  const handleAddTab = (tabId: string) => {
    setActiveTabs([...activeTabs, tabId as TabId]);
    setActiveTab(tabId as TabId);
    setIsAddTabSearchOpen(false);
  };

  const handleRemoveTab = (tabId: TabId, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = activeTabs.filter(t => t !== tabId);
    setActiveTabs(newTabs);
    if (activeTab === tabId && newTabs.length > 0) {
      setActiveTab(newTabs[0]);
    }
  };

  // Group assets by type
  const groupedAssets = {
    videos: assets.filter(a => a.type === 'video'),
    images: assets.filter(a => a.type === 'image'),
    audio: assets.filter(a => a.type === 'audio'),
    other: assets.filter(a => !['video', 'image', 'audio'].includes(a.type ?? ''))
  };

  // Filter assets by search query
  const filterAssets = (assetList: VideoFile[]) => {
    if (!searchQuery) return assetList;
    return assetList.filter(asset =>
      asset.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onAssetUpload) {
      onAssetUpload(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && onAssetUpload) {
      onAssetUpload(files);
    }
  };

  const handleAssetClick = (asset: VideoFile) => {
    setSelectedAssetId(asset.id);
    if (onAssetSelect) {
      onAssetSelect(asset);
    }
  };

  const handleDeleteAsset = (assetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAssetDelete) {
      onAssetDelete(assetId);
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'video': return <Film className="w-4 h-4" />;
      case 'image': return <Image className="w-4 h-4" />;
      case 'audio': return <Music className="w-4 h-4" />;
      default: return <File className="w-4 h-4" />;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '--';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const renderAssetGroup = (title: string, assetList: VideoFile[], icon: React.ReactNode) => {
    const filtered = filterAssets(assetList);
    if (filtered.length === 0) return null;

    return (
      <div className="mb-3">
        <div className="flex items-center gap-2 px-3 py-1.5 text-white/50 text-[10px] font-medium uppercase tracking-wide">
          {icon}
          <span>{title} ({filtered.length})</span>
        </div>
        <div className="space-y-0.5">
          {filtered.map(asset => (
            <div
              key={asset.id}
              onClick={() => handleAssetClick(asset)}
              className={`group relative px-3 py-1.5 cursor-pointer transition-all duration-150 ${
                selectedAssetId === asset.id
                  ? 'bg-white/10'
                  : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-start gap-2">
                {/* Thumbnail */}
                <div className="flex-shrink-0 w-12 h-9 bg-black/40 rounded overflow-hidden border border-white/10">
                  {asset.thumbnail ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20">
                      {getFileIcon(asset.type ?? 'file')}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium truncate mb-0.5">
                    {asset.name}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-white/30">
                    {asset.duration && (
                      <span>{formatDuration(asset.duration)}</span>
                    )}
                    {asset.resolution && (
                      <span>{asset.resolution.width}×{asset.resolution.height}</span>
                    )}
                    {asset.size && (
                      <span>{formatFileSize(asset.size)}</span>
                    )}
                  </div>
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteAsset(asset.id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="h-full flex flex-col relative">
        {/* Header */}
        <div className="px-3 py-2 border-b border-white/10">
          {/* Tab Navigation and Search */}
          <div className="flex items-center gap-2">
            {/* Dynamic Tab Buttons */}
            {activeTabs.map((tabId) => {
              const tabDef = getTabDefinition(tabId);
              if (!tabDef) return null;

              const Icon = tabDef.icon;
              return (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-all group ${
                    activeTab === tabId
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                  }`}
                  title={tabDef.description}
                >
                  <Icon className="w-3 h-3 flex-shrink-0" />
                  <span className="whitespace-nowrap overflow-hidden text-ellipsis">{tabDef.name}</span>
                  {activeTabs.length > 1 && (
                    <X
                      className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={(e) => handleRemoveTab(tabId, e)}
                    />
                  )}
                </button>
              );
            })}

            {/* Add Tab Button / Search Bar */}
            <button
              ref={addTabButtonRef}
              onClick={() => setIsAddTabSearchOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
              title="Add Tab"
            >
              <Plus className="w-3 h-3 flex-shrink-0" />
            </button>

          {/* Project Search Bar - Right Aligned */}
          <div className="relative ml-auto w-40 flex-shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab === 'project' ? 'project' : activeTab === 'media-browser' ? 'files' : activeTab === 'cloud-library' ? 'cloud storage' : 'effects'}...`}
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
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Search Overlay - rendered outside header flow */}
      {isAddTabSearchOpen && (
        <AddTabSearch
          isOpen={isAddTabSearchOpen}
          onClose={() => setIsAddTabSearchOpen(false)}
          availableTabs={availableTabs}
          onSelectTab={handleAddTab}
          triggerRef={addTabButtonRef}
        />
      )}

      {/* Drop Zone Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="text-center text-white">
            <Upload className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs font-medium">Drop files here</p>
          </div>
        </div>
      )}

      {/* Content Area - Tab Specific */}
      <div
        className="flex-1 overflow-y-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Project Tab */}
        {activeTab === 'project' && (
          <>
            {assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6 text-white/20" />
                </div>
                <p className="text-white/40 text-xs mb-1">No assets</p>
                <p className="text-white/20 text-[10px]">
                  Import media to begin
                </p>
              </div>
            ) : (
              <div className="py-2">
                {renderAssetGroup('Videos', groupedAssets.videos, <Film className="w-3 h-3" />)}
                {renderAssetGroup('Images', groupedAssets.images, <Image className="w-3 h-3" />)}
                {renderAssetGroup('Audio', groupedAssets.audio, <Music className="w-3 h-3" />)}
                {renderAssetGroup('Other', groupedAssets.other, <File className="w-3 h-3" />)}
              </div>
            )}
          </>
        )}

        {/* Media Browser Tab */}
        {activeTab === 'media-browser' && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded text-white text-xs font-medium transition-all"
            >
              Browse Local Files
            </button>
          </div>
        )}

        {/* Cloud Library Tab */}
        {activeTab === 'cloud-library' && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="flex gap-2">
              {/* Google Cloud Storage */}
              <button
                className="w-10 h-10 bg-white/10 hover:bg-white/15 border border-white/20 rounded flex items-center justify-center transition-all"
                title="Google Cloud Storage"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 3.5L7 6.5V11.5L12 14.5L17 11.5V6.5L12 3.5Z" fill="#4285F4"/>
                  <path d="M7 11.5V16.5L12 19.5V14.5L7 11.5Z" fill="#34A853"/>
                  <path d="M12 14.5V19.5L17 16.5V11.5L12 14.5Z" fill="#FBBC04"/>
                  <path d="M12 9.5L9.5 11V13L12 14.5L14.5 13V11L12 9.5Z" fill="#EA4335"/>
                </svg>
              </button>

              {/* Microsoft Azure */}
              <button
                className="w-10 h-10 bg-white/10 hover:bg-white/15 border border-white/20 rounded flex items-center justify-center transition-all"
                title="Microsoft Azure"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="azureGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{stopColor: '#0078D4', stopOpacity: 1}} />
                      <stop offset="100%" style={{stopColor: '#50E6FF', stopOpacity: 1}} />
                    </linearGradient>
                  </defs>
                  <path d="M6.5 7L11 18H14.5L19.5 7H6.5Z" fill="url(#azureGrad)"/>
                  <path d="M14.5 18H4.5L11 7L14.5 18Z" fill="#0078D4" opacity="0.8"/>
                </svg>
              </button>

              {/* Amazon S3 */}
              <button
                className="w-10 h-10 bg-white/10 hover:bg-white/15 border border-white/20 rounded flex items-center justify-center transition-all"
                title="Amazon S3"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 9L12 6L18 9L12 12L6 9Z" fill="#569A31"/>
                  <path d="M6 12L12 15L18 12V15L12 18L6 15V12Z" fill="#569A31" opacity="0.7"/>
                  <path d="M12 6V12M18 9V15" stroke="#569A31" strokeWidth="0.5" opacity="0.5"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Effects Tab */}
        {activeTab === 'effects' && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Wand2 className="w-8 h-8 text-white/20" />
            </div>
            <h4 className="text-white text-sm font-medium mb-2">Effects</h4>
            <p className="text-white/40 text-xs mb-4 max-w-xs">
              Browse and apply visual effects, transitions, and filters to your clips
            </p>
            <div className="space-y-2 w-full max-w-xs">
              <div className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded text-white/60 text-xs text-left">
                <div className="font-medium mb-1">Color Correction</div>
                <div className="text-[10px] text-white/40">Brightness, Contrast, Saturation</div>
              </div>
              <div className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded text-white/60 text-xs text-left">
                <div className="font-medium mb-1">Transitions</div>
                <div className="text-[10px] text-white/40">Fade, Dissolve, Wipe, Slide</div>
              </div>
              <div className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded text-white/60 text-xs text-left">
                <div className="font-medium mb-1">Blur & Sharpen</div>
                <div className="text-[10px] text-white/40">Gaussian, Motion, Unsharp Mask</div>
              </div>
              <div className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded text-white/60 text-xs text-left">
                <div className="font-medium mb-1">Stylize</div>
                <div className="text-[10px] text-white/40">Glow, Vignette, Film Grain</div>
              </div>
            </div>
            <p className="text-white/20 text-[10px] mt-4">
              Drag effects onto clips in the timeline
            </p>
          </div>
        )}

        {/* Graphics Tab */}
        {activeTab === 'graphics' && (
          <GraphicsTab
            onTemplateSelect={(templateId) => {
              console.log('Graphics template selected:', templateId);
            }}
          />
        )}

        {/* Audio Effects Tab */}
        {activeTab === 'audio-effects' && (
          <AudioEffectsTab
            onEffectSelect={(effectId) => {
              console.log('Audio effect selected:', effectId);
            }}
          />
        )}

        {/* Libraries Tab */}
        {activeTab === 'libraries' && (
          <LibrariesTab
            onLibrarySelect={(libraryId) => {
              console.log('Library selected:', libraryId);
            }}
            onLibraryCreate={() => {
              console.log('Library creation requested');
            }}
            onLibraryDelete={(libraryId) => {
              console.log('Library deleted:', libraryId);
            }}
            onLibraryImport={() => {
              console.log('Import initiated');
            }}
            onLibraryExport={(libraryId: string) => {
              console.log('Export initiated:', libraryId);
            }}
          />
        )}

        {/* Presets Tab */}
        {activeTab === 'presets' && (
          <PresetsTab
            onPresetSelect={(presetId) => {
              console.log('Preset selected:', presetId);
            }}
            onPresetSave={() => {
              console.log('Preset save requested');
            }}
            onPresetDelete={(presetId) => {
              console.log('Preset deleted:', presetId);
            }}
          />
        )}
      </div>

      {/* Footer - Only show for Project tab */}
        {activeTab === 'project' && assets.length > 0 && (
          <div className="px-3 py-1.5 border-t border-white/10 text-white/30 text-[9px]">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
          </div>
        )}
      </div>
    </>
  );
};

export default LeftBottomPanelTabs;
