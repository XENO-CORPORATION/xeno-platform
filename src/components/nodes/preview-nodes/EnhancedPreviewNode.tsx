import React, { useState, useEffect } from 'react';
import BaseNode, { BaseNodeProps } from '../BaseNode';
import { Eye } from 'lucide-react';
import { getPreviewNodeImplementation, getAvailablePreviewNodeNames } from './ModelRegistry';
import { PreviewNodeInterface, PreviewSettings } from './PreviewNodeInterface';

interface EnhancedPreviewNodeProps extends BaseNodeProps {
  initialModel?: string;
  contentUrl?: string;
  contentType?: string;
}

const EnhancedPreviewNode: React.FC<EnhancedPreviewNodeProps> = (props) => {
  const { initialModel, contentUrl, contentType, ...nodeProps } = props;
  const availableModels = getAvailablePreviewNodeNames();

  // Determine initial model based on contentType if provided, otherwise use initialModel
  const getInitialModelName = () => {
    if (contentType && !initialModel) {
      // Find a model that matches the content type
      const matchingModels = Array.from(availableModels).filter(
        (modelName) => {
          const model = getPreviewNodeImplementation(modelName);
          return model && model.previewType.toLowerCase() === contentType.toLowerCase();
        }
      );
      return matchingModels.length > 0 ? matchingModels[0] : availableModels[0] || '';
    }
    return initialModel && availableModels.includes(initialModel)
      ? initialModel
      : availableModels[0] || '';
  };

  const [selectedModelName, setSelectedModelName] = useState<string>(getInitialModelName());
  const [modelImplementation, setModelImplementation] = useState<PreviewNodeInterface | null>(null);
  const [settings, setSettings] = useState<PreviewSettings>({
    autoRefresh: false,
    refreshInterval: 5,
    displayMode: 'fit',
    showMetadata: true,
    showControls: true,
    theme: 'dark'
  });
  const [previewContentUrl, setPreviewContentUrl] = useState<string | null>(contentUrl || null);
  const [refreshTimer, setRefreshTimer] = useState<number | null>(null);
  const [refreshingPreview, setRefreshingPreview] = useState<boolean>(false);

  // Load the model implementation when the selected model changes
  useEffect(() => {
    if (selectedModelName) {
      const implementation = getPreviewNodeImplementation(selectedModelName);
      setModelImplementation(implementation);
      
      // Reset settings to the default for the newly selected model
      if (implementation) {
        setSettings(implementation.defaultSettings);
      }
    }
  }, [selectedModelName]);

  // Handle auto refresh
  useEffect(() => {
    // Clear any existing refresh timer
    if (refreshTimer) {
      clearInterval(refreshTimer);
      setRefreshTimer(null);
    }

    // Set up auto refresh if enabled
    if (settings.autoRefresh && settings.refreshInterval && contentUrl && modelImplementation) {
      const timer = setInterval(() => {
        handleRefresh();
      }, settings.refreshInterval * 1000);
      
      setRefreshTimer(timer);
    }

    // Clean up on unmount
    return () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    };
  }, [settings.autoRefresh, settings.refreshInterval, contentUrl, modelImplementation]);

  // Handle setting changes
  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Handle model selection change
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModelName(e.target.value);
  };

  // Enhanced refresh functionality
  const handleRefresh = async () => {
    if (!contentUrl && !previewContentUrl) {
      // If no content is available, load a sample demo image
      loadDemoContent();
      return;
    }
    
    if (contentUrl && modelImplementation) {
      try {
        // Show loading state
        setRefreshingPreview(true);
        
        const result = await modelImplementation.generatePreview(contentUrl, settings);
        if (result.success && result.previewUrl) {
          setPreviewContentUrl(result.previewUrl);
        }
      } catch (error) {
        console.error('Error generating preview:', error);
      } finally {
        // Hide loading state
        setRefreshingPreview(false);
      }
    }
  };

  // Add a demonstration feature to show sample content
  const loadDemoContent = () => {
    setRefreshingPreview(true);
    
    // Choose appropriate demo content based on selected model type
    let demoUrl = '';
    
    switch (selectedModelName.toLowerCase()) {
      case 'image preview':
        // Random Unsplash image
        demoUrl = 'https://source.unsplash.com/random/800x600/?nature';
        break;
      case 'video preview':
        // Public domain video
        demoUrl = 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4';
        break;
      case 'text preview':
        // Generate sample text
        const loremText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam auctor, nisl eget ultricies lacinia, nisl nisl aliquet nisl, eget ultricies nisl nisl eget nisl.';
        
        // Create a data URL for the text
        const textBlob = new Blob([loremText], {type: 'text/plain'});
        demoUrl = URL.createObjectURL(textBlob);
        break;
      case 'audio preview':
        // Public domain audio
        demoUrl = 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3';
        break;
      default:
        demoUrl = 'https://source.unsplash.com/random/800x600/?abstract';
    }
    
    // Set a timeout to simulate loading
    setTimeout(() => {
      setPreviewContentUrl(demoUrl);
      setRefreshingPreview(false);
    }, 1000);
  };

  return (
    <BaseNode {...nodeProps} icon={props.icon || <Eye size={16} />}>
      <div className="space-y-4">
        {/* Model Selection */}
        <div className="bg-black/20 rounded-lg p-4 dropdown-container">
          <div className="node-select-wrapper">
            <label className="block text-xs font-medium text-white/70 mb-2">Preview Type</label>
            <select 
              value={selectedModelName}
              onChange={handleModelChange}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
            >
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-white/70">
              {modelImplementation?.description || 'Choose a preview type'}
            </p>
          </div>
        </div>

        {/* Preview Content */}
        {modelImplementation && (
          <div className="space-y-4">
            {modelImplementation.renderPreview(previewContentUrl, settings, handleSettingChange)}
            
            {/* Manual Refresh Button */}
            <div className="flex justify-center">
              <button
                onClick={handleRefresh}
                className="px-4 py-2 bg-blue-600/30 hover:bg-blue-600/50 text-white rounded-lg text-sm transition-colors flex items-center space-x-2"
                disabled={refreshingPreview}
              >
                {refreshingPreview ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                    </svg>
                    <span>{previewContentUrl ? "Refresh Preview" : "Load Sample"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Settings Section */}
        {modelImplementation && (
          <div className="border-t border-white/10 pt-4 mt-6">
            <h3 className="text-sm font-medium text-white/80 mb-4">Preview Settings</h3>
            {modelImplementation.renderSettings(settings, handleSettingChange)}
          </div>
        )}
      </div>
    </BaseNode>
  );
};

export default EnhancedPreviewNode; 