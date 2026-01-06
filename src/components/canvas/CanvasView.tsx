import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Share2, Play, RotateCw } from 'lucide-react';
import NodeEditor from './NodeEditor';

interface CanvasViewProps {}

const CanvasView: React.FC<CanvasViewProps> = () => {
  const { labId } = useParams<{ labId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [labName, setLabName] = useState<string>('Untitled Lab');
  const [isSaving, setIsSaving] = useState(false);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  
  // Set lab name if it was passed in the location state
  useEffect(() => {
    if (location.state?.labName) {
      setLabName(location.state.labName);
      setEditingName(location.state.labName);
    }
  }, [location.state]);
  
  // Log lab ID for debugging purposes
  useEffect(() => {
    if (labId) {
      console.log(`Loading lab: ${labId}`);
    }
  }, [labId]);
  
  const handleSave = () => {
    setIsSaving(true);
    
    // Simulate saving with a delay
    setTimeout(() => {
      setIsSaving(false);
      
      // Show a saved notification
      const notification = document.getElementById('save-notification');
      if (notification) {
        notification.classList.remove('opacity-0');
        notification.classList.add('opacity-100');
        
        setTimeout(() => {
          notification.classList.remove('opacity-100');
          notification.classList.add('opacity-0');
        }, 2000);
      }
    }, 800);
  };
  
  const handleNameEdit = () => {
    setIsNameEditing(true);
    setEditingName(labName);
  };
  
  const handleNameSave = () => {
    if (editingName.trim()) {
      setLabName(editingName);
    }
    setIsNameEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setIsNameEditing(false);
      setEditingName(labName);
    }
  };
  
  const handleExit = () => {
    setShowExitConfirm(true);
  };
  
  const confirmExit = () => {
  navigate('/overview');
  };
  
  const handleRunWorkflow = () => {
    if (isRunning) return;
    
    setIsRunning(true);
    // In a real app, this would trigger the actual workflow execution
    
    // Simulate completion after a delay
    setTimeout(() => {
      setIsRunning(false);
    }, 5000);
  };
  
  return (
    <div className="fixed inset-0 w-screen h-screen bg-primary-bg flex flex-col z-50 overflow-hidden">
      {/* Minimal header with essential controls */}
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-4 bg-[rgba(20,20,20,0.95)] backdrop-blur-md">
        <div className="flex items-center">
          <button 
            onClick={handleExit}
            className="mr-4 p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Exit canvas"
          >
            <ArrowLeft size={18} />
          </button>
          
          {isNameEditing ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleKeyDown}
              className="bg-white/10 text-white px-3 py-1 rounded-lg border border-white/20 focus:outline-none focus:ring-1 focus:ring-white/30"
              autoFocus
            />
          ) : (
            <h1 
              className="text-lg font-semibold text-white cursor-pointer hover:bg-white/5 px-3 py-1 rounded-lg"
              onClick={handleNameEdit}
            >
              {labName}
            </h1>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center space-x-1 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-white transition-colors text-sm"
          >
            {isSaving ? (
              <div className="animate-spin w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full mr-2"></div>
            ) : (
              <Save size={16} className="mr-1" />
            )}
            <span>Save</span>
          </button>
          
          <button
            className="flex items-center space-x-1 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-white transition-colors text-sm"
          >
            <Share2 size={16} className="mr-1" />
            <span>Share</span>
          </button>
          
          <button
            onClick={handleRunWorkflow}
            disabled={isRunning}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium ${
              isRunning 
                ? 'bg-white/30 text-white cursor-not-allowed' 
                : 'bg-white text-primary-bg hover:bg-white/90'
            }`}
          >
            {isRunning ? (
              <>
                <RotateCw size={16} className="mr-1 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play size={16} className="mr-1" />
                <span>Run</span>
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Main canvas area - takes up all available space */}
      <div className="flex-1 relative overflow-hidden" style={{ height: `calc(100vh - 3.5rem)` }}>
        <NodeEditor className="w-full h-full" />
        
        {/* Save notification */}
        <div 
          id="save-notification" 
          className="fixed top-4 right-4 bg-green-500/90 text-white px-4 py-2 rounded-lg shadow-lg opacity-0 transition-opacity duration-300"
        >
          Lab saved successfully
        </div>
      </div>
      
      {/* Exit confirmation dialog */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[rgba(30,30,30,0.95)] border border-white/10 rounded-xl p-6 max-w-md shadow-lg">
            <h2 className="text-lg font-semibold text-white mb-3">Exit Canvas</h2>
            <p className="text-white/70 mb-6">
              Are you sure you want to exit? Any unsaved changes will be lost.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmExit}
                className="px-4 py-2 rounded-lg bg-red-500/90 hover:bg-red-500 text-white transition-colors"
              >
                Exit Without Saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasView;