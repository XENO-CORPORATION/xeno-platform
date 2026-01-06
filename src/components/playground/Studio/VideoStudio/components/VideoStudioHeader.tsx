import React, { useState } from 'react';
import {
  Film, FolderOpen, Save, Download, Upload, X,
  Plus, Eye, Grid, Layers, Clock, Settings, HelpCircle,
  Play, StopCircle, ArrowLeft
} from 'lucide-react';

interface VideoStudioHeaderProps {
  projectTitle?: string;
  onSave?: () => void;
  onOpenProject?: () => void;
  onNewProject?: () => void;
  onExport?: () => void;
  isSaving?: boolean;
  lastSaved?: Date | null;
  userCredits?: number;
  onBack?: () => void;
  onRender?: () => void;
  onCancelRender?: () => void;
  isRendering?: boolean;
  renderProgress?: number;
}

export const VideoStudioHeader: React.FC<VideoStudioHeaderProps> = ({
  onSave,
  onOpenProject,
  onNewProject,
  onExport,
  isSaving,
  onBack,
  onRender,
  onCancelRender,
  isRendering,
  renderProgress = 0
}) => {
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [isFileDropdownOpen, setIsFileDropdownOpen] = useState(false);
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);

  const handleTabMenuToggle = () => {
    setIsTabMenuOpen(!isTabMenuOpen);
    // Close dropdowns when menu closes
    if (isTabMenuOpen) {
      setIsFileDropdownOpen(false);
      setIsViewDropdownOpen(false);
    }
  };

  const handleMenuItemClick = (menuItem: string) => {
    console.log('📋 Menu item clicked:', menuItem);

    if (menuItem === 'file') {
      setIsFileDropdownOpen(!isFileDropdownOpen);
      setIsViewDropdownOpen(false);
    } else if (menuItem === 'view') {
      setIsViewDropdownOpen(!isViewDropdownOpen);
      setIsFileDropdownOpen(false);
    }
  };

  // File menu handlers
  const handleNewFile = () => {
    console.log('📄 New Project');
    if (onNewProject) onNewProject();
    setIsFileDropdownOpen(false);
  };

  const handleOpenFile = () => {
    console.log('📂 Open Project');
    if (onOpenProject) onOpenProject();
    setIsFileDropdownOpen(false);
  };

  const handleSaveFile = () => {
    console.log('💾 Save Project');
    if (onSave) onSave();
    setIsFileDropdownOpen(false);
  };

  const handleSaveAsProject = () => {
    console.log('💾 Save As Video Project');
    // TODO: Implement save as .xenvideoproject
    // Save video project to PC as .xenvideoproject file
    setIsFileDropdownOpen(false);
  };

  const handleImportProject = () => {
    console.log('📂 Import Video Project');
    // TODO: Implement import .xenvideoproject
    // Load .xenvideoproject file from PC
    setIsFileDropdownOpen(false);
  };

  const handleImportMedia = () => {
    console.log('📥 Import Media');
    // TODO: Import video/audio/image files to timeline
    setIsFileDropdownOpen(false);
  };

  const handleExportFile = (format: string) => {
    console.log(`📥 Export Video as ${format.toUpperCase()}`);
    // Render and export final video
    if (onExport) onExport();
    setIsFileDropdownOpen(false);
  };

  const handleCloseFile = () => {
    console.log('❌ Close');
    // Navigate back or close canvas
    window.history.back();
    setIsFileDropdownOpen(false);
  };

  return (
    <>
      {/* Transparent Header - Tab Menu Button - Top Left Corner */}
      <div
        className="absolute top-4 left-4 z-[1002] flex items-center gap-2"
      >
        {/* Main Tab Button */}
        <button
          onClick={handleTabMenuToggle}
          className="w-10 h-10 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
          title="Menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="3" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="14" y="3" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="14" y="14" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="3" y="14" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Expandable Menu Options */}
        {isTabMenuOpen && (
          <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
            {/* File Menu Item */}
            <div className="relative">
              <button
                onClick={() => handleMenuItemClick('file')}
                className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                title="File menu"
              >
                <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">File</span>
              </button>

              {/* File Dropdown Menu */}
              {isFileDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-black/95 backdrop-blur-md border border-white/20 rounded-lg shadow-xl z-[1003] animate-in slide-in-from-top-2 duration-200">
                  <div className="p-2 space-y-1">
                    {/* New Video Project */}
                    <button
                      onClick={handleNewFile}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Video Project
                    </button>

                    {/* Open Video Project */}
                    <button
                      onClick={handleOpenFile}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Open Project...
                    </button>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-1"></div>

                    {/* Save Video Project */}
                    <button
                      onClick={handleSaveFile}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save Project
                    </button>

                    {/* Save As... */}
                    <button
                      onClick={handleSaveAsProject}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Save Project As...
                    </button>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-1"></div>

                    {/* Import Video Project */}
                    <button
                      onClick={handleImportProject}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import Project...
                    </button>

                    {/* Import Media Files */}
                    <button
                      onClick={handleImportMedia}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <Film className="w-3.5 h-3.5" />
                      Import Media...
                    </button>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-1"></div>

                    {/* Export submenu header */}
                    <div className="px-3 py-1 text-xs text-white/50">Export Video As</div>

                    {/* Export MP4 */}
                    <button
                      onClick={() => handleExportFile('mp4')}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2 pl-6"
                    >
                      <Download className="w-3.5 h-3.5" />
                      MP4 Video
                    </button>

                    {/* Export WebM */}
                    <button
                      onClick={() => handleExportFile('webm')}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2 pl-6"
                    >
                      <Download className="w-3.5 h-3.5" />
                      WebM Video
                    </button>

                    {/* Export MOV */}
                    <button
                      onClick={() => handleExportFile('mov')}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2 pl-6"
                    >
                      <Download className="w-3.5 h-3.5" />
                      MOV Video
                    </button>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-1"></div>

                    {/* Close */}
                    <button
                      onClick={handleCloseFile}
                      className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                    >
                      <X className="w-3.5 h-3.5" />
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Edit Menu Item (Placeholder) */}
            <button
              onClick={() => handleMenuItemClick('edit')}
              className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
              title="Edit menu"
            >
              <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Edit</span>
            </button>

            {/* View Menu Item */}
            <div className="relative">
              <button
                onClick={() => handleMenuItemClick('view')}
                className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                title="View menu"
              >
                <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">View</span>
              </button>

              {/* View Dropdown Menu */}
              {isViewDropdownOpen && (
                <div className="absolute top-full -left-14 mt-1 w-48 bg-black/95 backdrop-blur-md border border-white/20 rounded-lg shadow-xl z-[1003] animate-in slide-in-from-top-2 duration-200">
                  <div className="p-2 space-y-1">
                    {/* Asset Library Toggle */}
                    <button
                      className="w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 text-white bg-white/10 hover:bg-white/20"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Layers className="w-3.5 h-3.5" />
                        Asset Library
                      </div>
                    </button>

                    {/* Video Preview Toggle */}
                    <button
                      className="w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 text-white bg-white/10 hover:bg-white/20"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Film className="w-3.5 h-3.5" />
                        Video Preview
                      </div>
                    </button>

                    {/* Properties Panel Toggle */}
                    <button
                      className="w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 text-white bg-white/10 hover:bg-white/20"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Settings className="w-3.5 h-3.5" />
                        Properties Panel
                      </div>
                    </button>

                    {/* Timeline Toggle */}
                    <button
                      className="w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 text-white bg-white/10 hover:bg-white/20"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Clock className="w-3.5 h-3.5" />
                        Timeline
                      </div>
                    </button>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-1"></div>

                    {/* Playback Controls */}
                    <button
                      className="w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 text-white hover:bg-white/10"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Film className="w-3.5 h-3.5" />
                        Playback Controls
                      </div>
                    </button>

                    {/* Full Screen */}
                    <button
                      className="w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 text-white hover:bg-white/10"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Eye className="w-3.5 h-3.5" />
                        Full Screen Mode
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Tools Menu Item (Placeholder) */}
            <button
              onClick={() => handleMenuItemClick('tools')}
              className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
              title="Tools menu"
            >
              <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Tools</span>
            </button>

            {/* Help Menu Item (Placeholder) */}
            <button
              onClick={() => handleMenuItemClick('help')}
              className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
              title="Help menu"
            >
              <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Help</span>
            </button>

            {/* Import Button */}
            <button
              onClick={() => console.log('📥 Import clicked')}
              className="px-3 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
              title="Import Media"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Import</span>
            </button>

            {/* Render Button */}
            {!isRendering ? (
              <button
                onClick={onRender}
                className="px-3 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
                title="Render Video"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">Render</span>
              </button>
            ) : (
              <button
                onClick={onCancelRender}
                className="px-4 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
                title="Cancel Rendering"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">Cancel ({Math.floor(renderProgress)}%)</span>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default VideoStudioHeader;
