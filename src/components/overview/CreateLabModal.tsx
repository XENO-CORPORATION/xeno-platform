import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Beaker, Layers, GitBranch } from 'lucide-react';
import Modal from '../ui/Modal';

interface CreateLabModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreateLabModal: React.FC<CreateLabModalProps> = ({ isOpen, onClose }) => {
  const [labName, setLabName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();
  
  const handleCreateLab = () => {
    if (!labName.trim()) return;
    
    setIsCreating(true);
    
    // Simulate API call with timeout
    setTimeout(() => {
      // Generate a random lab ID
      const labId = `lab-${Date.now()}`;
      
      // Close modal and navigate to the canvas view
      onClose();
  navigate(`/overview/labs/${labId}/canvas`, { state: { labName } });
      
      // Reset state for next time
      setLabName('');
      setIsCreating(false);
    }, 800);
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Lab">
      <div className="space-y-6">
        <p className="text-white/70">
          Labs allow you to design and deploy AI workflows by connecting nodes in a visual canvas.
        </p>
        
        {/* Lab name input */}
        <div className="space-y-2">
          <label htmlFor="lab-name" className="block text-sm font-medium text-white/70">
            Lab Name
          </label>
          <input
            id="lab-name"
            type="text"
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            placeholder="Enter a name for your lab"
            className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-white/20"
            autoFocus
          />
        </div>
        
        {/* Lab templates */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-white/70 mb-3">Templates</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-white/10 rounded-lg p-3 bg-white/5 hover:bg-white/8 cursor-pointer transition-all">
              <div className="flex items-start mb-2">
                <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center mr-3 mt-1">
                  <Layers size={16} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-medium">Empty Canvas</h3>
                  <p className="text-white/50 text-xs">Start with a blank canvas</p>
                </div>
              </div>
            </div>
            
            <div className="border border-white/10 rounded-lg p-3 bg-white/5 hover:bg-white/8 cursor-pointer transition-all">
              <div className="flex items-start mb-2">
                <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center mr-3 mt-1">
                  <GitBranch size={16} className="text-purple-400" />
                </div>
                <div>
                  <h3 className="text-white font-medium">Text-to-Image</h3>
                  <p className="text-white/50 text-xs">Basic text to image workflow</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex justify-end space-x-4 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateLab}
            disabled={!labName.trim() || isCreating}
            className={`px-4 py-2 rounded-lg bg-white text-primary-bg font-medium flex items-center space-x-2 transition-all transform-gpu ${
              !labName.trim() || isCreating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/90 hover:scale-[1.02]'
            }`}
          >
            {isCreating ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-primary-bg border-t-transparent rounded-full mr-2"></div>
                <span>Creating...</span>
              </>
            ) : (
              <>
                <Beaker size={16} />
                <span>Create Lab</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateLabModal;