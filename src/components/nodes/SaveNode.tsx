import React, { useState, useEffect } from 'react';
import { SaveIcon, FolderIcon } from 'lucide-react';
import { useNodeContent } from './BaseNode';
import BaseNode, { BaseNodeProps } from './BaseNode';

// Define the component props
interface SaveNodeProps {
  nodeId: string | number;
  initialState?: {
    format?: string;
    savePath?: string;
    fileName?: string;
    autoSave?: boolean;
  };
}

// Define the extended props that include BaseNodeProps
interface EnhancedSaveNodeProps extends BaseNodeProps {
  nodeId?: string | number;
  initialState?: {
    format?: string;
    savePath?: string;
    fileName?: string;
    autoSave?: boolean;
  };
}

const SaveNode: React.FC<SaveNodeProps | EnhancedSaveNodeProps> = (props) => {
  const { nodeId, initialState = {}, ...baseNodeProps } = props;
  
  // Check if this component is being used directly or through BaseNode
  const isDirectUsage = !('type' in props);
  
  // If used directly, render with internal state
  if (isDirectUsage) {
    // Use the original implementation for direct usage
    const [saveState, setSaveState] = useState({
      format: initialState.format || 'auto',
      savePath: initialState.savePath || '',
      fileName: initialState.fileName || 'output',
      autoSave: initialState.autoSave || false,
      inputConnected: false,
      contentType: 'unknown',
      saveCount: 0,
      lastSaved: '',
      isSaving: false,
      error: ''
    });
    
    const { isExpanded } = useNodeContent();
    
    // Event listeners for save-related events
    useEffect(() => {
      // Listen for format change
      const handleFormatChange = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number; value: string }>;
        if (detail.nodeId !== nodeId) return;
        
        setSaveState(prev => ({
          ...prev,
          format: detail.value
        }));
      };
      
      // Listen for save path change
      const handleSavePathChange = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number; value: string }>;
        if (detail.nodeId !== nodeId) return;
        
        setSaveState(prev => ({
          ...prev,
          savePath: detail.value
        }));
      };
      
      // Listen for browse path action
      const handleBrowsePath = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number }>;
        if (detail.nodeId !== nodeId) return;
        
        // Simulate opening a file browser
        // In a real implementation, this would open a file dialog
        console.log('Opening file browser for node', nodeId);
        
        // Mock implementation - replace with actual file dialog in production
        setTimeout(() => {
          setSaveState(prev => ({
            ...prev,
            savePath: '/User/Documents/outputs'
          }));
        }, 500);
      };
      
      // Listen for content connection
      const handleContentConnection = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ 
          nodeId: string | number; 
          contentType: string;
        }>;
        
        if (detail.nodeId !== nodeId) return;
        
        // Update state when content is connected
        setSaveState(prev => ({
          ...prev,
          inputConnected: true,
          contentType: detail.contentType
        }));
      };
      
      // Listen for save action
      const handleSaveAction = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number }>;
        if (detail.nodeId !== nodeId) return;
        
        // Start save action
        setSaveState(prev => ({
          ...prev,
          isSaving: true,
          error: ''
        }));
        
        // Simulate save operation
        setTimeout(() => {
          const timestamp = new Date().toLocaleTimeString();
          setSaveState(prev => ({
            ...prev,
            isSaving: false,
            saveCount: prev.saveCount + 1,
            lastSaved: timestamp
          }));
        }, 1000);
      };
      
      // Listen for auto-save toggle
      const handleAutoSaveToggle = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number; value: boolean }>;
        if (detail.nodeId !== nodeId) return;
        
        setSaveState(prev => ({
          ...prev,
          autoSave: detail.value
        }));
      };
      
      // Register event listeners
      window.addEventListener('save-format-change', handleFormatChange as EventListener);
      window.addEventListener('save-path-change', handleSavePathChange as EventListener);
      window.addEventListener('save-browse-path', handleBrowsePath as EventListener);
      window.addEventListener('save-content-connection', handleContentConnection as EventListener);
      window.addEventListener('save-action', handleSaveAction as EventListener);
      window.addEventListener('save-auto-toggle', handleAutoSaveToggle as EventListener);
      
      // Cleanup
      return () => {
        window.removeEventListener('save-format-change', handleFormatChange as EventListener);
        window.removeEventListener('save-path-change', handleSavePathChange as EventListener);
        window.removeEventListener('save-browse-path', handleBrowsePath as EventListener);
        window.removeEventListener('save-content-connection', handleContentConnection as EventListener);
        window.removeEventListener('save-action', handleSaveAction as EventListener);
        window.removeEventListener('save-auto-toggle', handleAutoSaveToggle as EventListener);
      };
    }, [nodeId]);
    
    // Simulate content connection
    const simulateContentConnection = () => {
      // Content types we might receive
      const contentTypes = ['image', 'video', 'text', 'json'];
      const randomType = contentTypes[Math.floor(Math.random() * contentTypes.length)];
      
      // Update state to show connection
      setSaveState(prev => ({
        ...prev,
        inputConnected: true,
        contentType: randomType
      }));
      
      // Dispatch content connection event
      const event = new CustomEvent('save-content-connection', { 
        detail: { nodeId, contentType: randomType } 
      });
      window.dispatchEvent(event);
    };
    
    // Add a component mount effect to simulate connection after a delay
    useEffect(() => {
      // Simulate receiving content after a short delay
      const timer = setTimeout(() => {
        simulateContentConnection();
      }, 1500);
      
      return () => clearTimeout(timer);
    }, []);  // Run once on mount
    
    // Get appropriate file extension based on format and content type
    const getFileExtension = () => {
      if (saveState.format !== 'auto') {
        // Use selected format
        return saveState.format;
      }
      
      // Otherwise infer from content type
      switch (saveState.contentType) {
        case 'image':
        case 'image/png':
        case 'image/jpeg':
          return 'png';
        case 'video':
        case 'video/mp4':
          return 'mp4';
        case 'text':
        case 'text/plain':
          return 'txt';
        case 'json':
        case 'application/json':
          return 'json';
        default:
          return 'txt';
      }
    };
    
    // Construct the full save path
    const getFullSavePath = () => {
      const ext = getFileExtension();
      const path = saveState.savePath || '/User/Documents';
      const fileName = saveState.fileName || 'output';
      
      return `${path}/${fileName}.${ext}`;
    };
    
    // Browse button functionality
    const handleBrowseButtonClick = () => {
      // In a web application, we can't directly browse the file system
      // But we can simulate the dialog and set a path
      const mockDialog = () => {
        // Show a loading state
        setSaveState(prev => ({ ...prev, browsing: true }));
        
        setTimeout(() => {
          // Simulate user selecting a folder
          const selectedPath = `/Downloads/${new Date().toISOString().slice(0, 10)}_exports`;
          
          // Set the selected path
          setSaveState(prev => ({ 
            ...prev, 
            savePath: selectedPath,
            browsing: false 
          }));
          
          // Dispatch save path change event
          const event = new CustomEvent('save-path-change', { 
            detail: { nodeId, value: selectedPath } 
          });
          window.dispatchEvent(event);
        }, 700);
      };
      
      mockDialog();
    };
    
    // Save functionality
    const handleSaveButtonClick = () => {
      if (!saveState.inputConnected) return;
      
      // Dispatch save action event
      const event = new CustomEvent('save-action', { 
        detail: { nodeId } 
      });
      window.dispatchEvent(event);
      
      // Simulate actual file saving in browser environment
      const performSave = async () => {
        try {
          // Set the isSaving state
          setSaveState(prev => ({
            ...prev,
            isSaving: true,
            error: ''
          }));
          
          // In a real app, you'd have actual content to save
          // Here we'll create a placeholder based on contentType
          let blobData;
          let mimeType;
          
          switch (saveState.contentType) {
            case 'image':
            case 'image/png':
            case 'image/jpeg':
              // For demo, create a text file with image placeholder
              blobData = new Blob([`[Image Placeholder: ${new Date().toISOString()}]`], { type: 'text/plain' });
              mimeType = 'text/plain';
              break;
            case 'video':
            case 'video/mp4':
              // For demo, create a text file with video placeholder
              blobData = new Blob([`[Video Placeholder: ${new Date().toISOString()}]`], { type: 'text/plain' });
              mimeType = 'text/plain';
              break;
            case 'json':
            case 'application/json':
              blobData = new Blob([JSON.stringify({ timestamp: new Date().toISOString(), sample: "data" }, null, 2)], 
                                  { type: 'application/json' });
              mimeType = 'application/json';
              break;
            case 'text':
            case 'text/plain':
            default:
              blobData = new Blob([`Sample content saved at ${new Date().toISOString()}`], { type: 'text/plain' });
              mimeType = 'text/plain';
              break;
          }
          
          // Create a download link
          const ext = getFileExtension();
          const fileName = `${saveState.fileName || 'output'}.${ext}`;
          
          const url = URL.createObjectURL(blobData);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          
          // Cleanup
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          
          // Update state on successful save
          const timestamp = new Date().toLocaleTimeString();
          setSaveState(prev => ({
            ...prev,
            isSaving: false,
            saveCount: prev.saveCount + 1,
            lastSaved: timestamp
          }));
          
          // Show a success message
          console.log(`File saved as ${fileName}`);
          
        } catch (error) {
          // Handle any errors
          console.error('Error saving file:', error);
          setSaveState(prev => ({
            ...prev,
            isSaving: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred while saving'
          }));
        }
      };
      
      performSave();
    };
    
    // The expanded view provides more controls and information
    if (isExpanded) {
      return (
        <div className="save-node-expanded">
          <div className="space-y-4">
            {/* File format selection */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Save Format</label>
              <div className="node-select-wrapper">
                <select 
                  className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                  value={saveState.format}
                  onChange={(e) => {
                    setSaveState(prev => ({ ...prev, format: e.target.value }));
                  }}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="png">PNG Image</option>
                  <option value="jpg">JPG Image</option>
                  <option value="mp4">MP4 Video</option>
                  <option value="txt">Text File</option>
                  <option value="json">JSON File</option>
                </select>
              </div>
              <p className="mt-2 text-xs text-white/50">File format to save the output as</p>
            </div>
            
            {/* File path selection */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Save Location</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    placeholder="/path/to/save"
                    value={saveState.savePath}
                    onChange={(e) => {
                      setSaveState(prev => ({ ...prev, savePath: e.target.value }));
                    }}
                  />
                </div>
                <button
                  className="px-3 py-1 bg-white/10 rounded-lg border border-white/10 hover:bg-white/15 transition-colors"
                  onClick={handleBrowseButtonClick}
                >
                  <FolderIcon size={16} className="text-white/70" />
                </button>
              </div>
              <p className="mt-2 text-xs text-white/50">Where to save the output file</p>
            </div>
            
            {/* Filename customization */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">File Name</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    placeholder="output"
                    value={saveState.fileName}
                    onChange={(e) => {
                      setSaveState(prev => ({ ...prev, fileName: e.target.value }));
                    }}
                  />
                </div>
                <div className="bg-black/30 text-white/50 border border-white/10 rounded-lg px-3 py-3 text-sm flex items-center">
                  .{getFileExtension()}
                </div>
              </div>
              <p className="mt-2 text-xs text-white/50">Name of the saved file</p>
            </div>
            
            {/* Auto-save option */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-white/70">Auto-Save</label>
                <div className="relative inline-block w-10 align-middle select-none">
                  <input 
                    type="checkbox"
                    id={`autosave-toggle-${nodeId}`}
                    className="sr-only"
                    checked={saveState.autoSave}
                    onChange={(e) => {
                      setSaveState(prev => ({ ...prev, autoSave: e.target.checked }));
                      
                      // Dispatch event for auto-save toggle
                      const event = new CustomEvent('save-auto-toggle', { 
                        detail: { nodeId, value: e.target.checked } 
                      });
                      window.dispatchEvent(event);
                    }}
                  />
                  <label 
                    htmlFor={`autosave-toggle-${nodeId}`}
                    className={`block overflow-hidden h-5 rounded-full cursor-pointer transition-colors ${saveState.autoSave ? 'bg-teal-500' : 'bg-white/20'}`}
                  >
                    <span 
                      className={`block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${saveState.autoSave ? 'translate-x-5' : 'translate-x-0'}`}
                    ></span>
                  </label>
                </div>
              </div>
              <p className="mt-2 text-xs text-white/50">Automatically save output when received</p>
            </div>
            
            {/* Save button and status */}
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/60">
                  {saveState.saveCount > 0 && (
                    <>
                      <span className="mr-1">Last saved at</span>
                      <span className="text-white font-medium">{saveState.lastSaved}</span>
                    </>
                  )}
                  {saveState.saveCount === 0 && (
                    <span>No files saved yet</span>
                  )}
                </div>
                <button 
                  className={`py-2 px-4 rounded-md text-sm flex items-center gap-1.5 transition-colors
                    ${saveState.inputConnected 
                      ? 'bg-teal-500/90 hover:bg-teal-500 text-white' 
                      : 'bg-white/10 text-white/40 cursor-not-allowed'}`}
                  disabled={!saveState.inputConnected || saveState.isSaving}
                  onClick={handleSaveButtonClick}
                >
                  {saveState.isSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <SaveIcon size={16} />
                      <span>Save Now</span>
                    </>
                  )}
                </button>
              </div>
              
              {saveState.error && (
                <div className="mt-2 text-xs text-red-400">
                  {saveState.error}
                </div>
              )}
              
              {/* Show full save path */}
              <div className="mt-4 p-3 bg-black/30 rounded-lg text-xs text-white/60 font-mono whitespace-pre-wrap break-all">
                {getFullSavePath()}
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // Default/collapsed view
    return (
      <div className="save-node-default">
        <div className="space-y-4">
          {/* Format selection */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-2.5">Save Format</label>
            <div className="node-select-wrapper">
              <select 
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                value={saveState.format}
                onChange={(e) => {
                  setSaveState(prev => ({ ...prev, format: e.target.value }));
                  
                  // Dispatch format change event
                  const event = new CustomEvent('save-format-change', { 
                    detail: { nodeId, value: e.target.value } 
                  });
                  window.dispatchEvent(event);
                }}
              >
                <option value="auto">Auto-detect</option>
                <option value="png">PNG Image</option>
                <option value="jpg">JPG Image</option>
                <option value="mp4">MP4 Video</option>
                <option value="txt">Text File</option>
                <option value="json">JSON File</option>
              </select>
            </div>
            <p className="mt-2 text-xs text-white/50">File format to save the output as</p>
          </div>
          
          {/* Save path */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-2.5">Save Location</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                  placeholder="/path/to/save"
                  value={saveState.savePath}
                  onChange={(e) => {
                    setSaveState(prev => ({ ...prev, savePath: e.target.value }));
                    
                    // Dispatch save path change event
                    const event = new CustomEvent('save-path-change', { 
                      detail: { nodeId, value: e.target.value } 
                    });
                    window.dispatchEvent(event);
                  }}
                />
              </div>
              <button
                className="px-3 py-1 bg-white/10 rounded-lg border border-white/10 hover:bg-white/15 transition-colors"
                onClick={handleBrowseButtonClick}
              >
                <FolderIcon size={16} className="text-white/70" />
              </button>
            </div>
            <p className="mt-2 text-xs text-white/50">Where to save the output file</p>
          </div>
          
          {/* Status badge */}
          {saveState.saveCount > 0 && (
            <div className="mt-2 flex items-center text-xs text-teal-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span>{saveState.saveCount} file{saveState.saveCount > 1 ? 's' : ''} saved</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // If used through BaseNode, just return the BaseNode with type "save"
  return (
    <BaseNode
      {...baseNodeProps as BaseNodeProps}
      type="save"
      defaultContent={null}
    />
  );
};

export default SaveNode; 