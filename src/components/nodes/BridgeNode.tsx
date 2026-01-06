import React, { useState, useEffect } from 'react';
import { ExternalLinkIcon, GitForkIcon, ComponentIcon } from 'lucide-react';
import { useNodeContent } from './BaseNode';
import BaseNode, { BaseNodeProps } from './BaseNode';

// Define the component props
interface BridgeNodeProps {
  nodeId: string | number;
  initialState?: {
    bridgeMode?: 'Pass-through' | 'Reroute';
    bridgeLabel?: string;
    direction?: 'input' | 'output' | 'bidirectional';
    pairId?: string;
  };
}

// Define the extended props that include BaseNodeProps
interface EnhancedBridgeNodeProps extends BaseNodeProps {
  nodeId?: string | number;
  initialState?: {
    bridgeMode?: 'Pass-through' | 'Reroute';
    bridgeLabel?: string;
    direction?: 'input' | 'output' | 'bidirectional';
    pairId?: string;
  };
}

const BridgeNode: React.FC<BridgeNodeProps | EnhancedBridgeNodeProps> = (props) => {
  const { nodeId, initialState = {}, ...baseNodeProps } = props;
  
  // Check if this component is being used directly or through BaseNode
  const isDirectUsage = !('type' in props);
  
  // If used directly, render with internal state
  if (isDirectUsage) {
    // State for bridge options
    const [bridgeState, setBridgeState] = useState({
      bridgeMode: initialState.bridgeMode || 'Pass-through',
      bridgeLabel: initialState.bridgeLabel || '',
      direction: initialState.direction || 'bidirectional',
      pairId: initialState.pairId || `bridge-${Math.random().toString(36).substring(2, 11)}`,
      isConnected: false,
      connectedNodeId: '',
      dataType: '',
      lastData: null as any,
      isActive: false
    });
    
    const { isExpanded } = useNodeContent();
    
    // Event listeners for bridge-related events
    useEffect(() => {
      // Listen for bridge mode change
      const handleModeChange = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number; value: string }>;
        if (detail.nodeId !== nodeId) return;
        
        setBridgeState(prev => ({
          ...prev,
          bridgeMode: detail.value as 'Pass-through' | 'Reroute'
        }));
      };
      
      // Listen for bridge label change
      const handleLabelChange = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ nodeId: string | number; value: string }>;
        if (detail.nodeId !== nodeId) return;
        
        setBridgeState(prev => ({
          ...prev,
          bridgeLabel: detail.value
        }));
      };
      
      // Listen for bridge connection event
      const handleBridgeConnection = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ 
          nodeId: string | number; 
          connectedNodeId: string | number;
          dataType: string;
        }>;
        
        if (detail.nodeId !== nodeId) return;
        
        // Update state when bridge is connected
        setBridgeState(prev => ({
          ...prev,
          isConnected: true,
          connectedNodeId: detail.connectedNodeId.toString(),
          dataType: detail.dataType
        }));
      };
      
      // Listen for bridge data flow event
      const handleBridgeData = (e: CustomEvent) => {
        const { detail } = e as CustomEvent<{ 
          nodeId: string | number;
          data: any;
        }>;
        
        if (detail.nodeId !== nodeId) return;
        
        // Update state with data flowing through the bridge
        setBridgeState(prev => ({
          ...prev,
          lastData: detail.data,
          isActive: true
        }));
        
        // Reset active state after a brief delay
        setTimeout(() => {
          setBridgeState(prev => ({
            ...prev,
            isActive: false
          }));
        }, 1500);
      };
      
      // Register event listeners
      window.addEventListener('bridge-mode-change', handleModeChange as EventListener);
      window.addEventListener('bridge-label-change', handleLabelChange as EventListener);
      window.addEventListener('bridge-connection', handleBridgeConnection as EventListener);
      window.addEventListener('bridge-data-flow', handleBridgeData as EventListener);
      
      // Cleanup
      return () => {
        window.removeEventListener('bridge-mode-change', handleModeChange as EventListener);
        window.removeEventListener('bridge-label-change', handleLabelChange as EventListener);
        window.removeEventListener('bridge-connection', handleBridgeConnection as EventListener);
        window.removeEventListener('bridge-data-flow', handleBridgeData as EventListener);
      };
    }, [nodeId]);
    
    // Get data type label
    const getDataTypeLabel = () => {
      switch (bridgeState.dataType) {
        case 'text':
          return 'Text';
        case 'image':
          return 'Image';
        case 'video':
          return 'Video';
        case 'json':
          return 'JSON';
        case 'parameter':
          return 'Parameters';
        default:
          return bridgeState.dataType || 'Any';
      }
    };
    
    // Get data type icon
    const getDataTypeIcon = () => {
      switch (bridgeState.dataType) {
        case 'text':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          );
        case 'image':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          );
        case 'video':
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
              <line x1="7" y1="2" x2="7" y2="22"></line>
              <line x1="17" y1="2" x2="17" y2="22"></line>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <line x1="2" y1="7" x2="7" y2="7"></line>
              <line x1="2" y1="17" x2="7" y2="17"></line>
              <line x1="17" y1="17" x2="22" y2="17"></line>
              <line x1="17" y1="7" x2="22" y2="7"></line>
            </svg>
          );
        default:
          return (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          );
      }
    };
    
    // Enhanced bridge mode functionality
    const handleBridgeModeChange = (mode: 'Pass-through' | 'Reroute') => {
      setBridgeState(prev => ({ ...prev, bridgeMode: mode }));
      
      // Dispatch mode change event
      const event = new CustomEvent('bridge-mode-change', { 
        detail: { nodeId, value: mode } 
      });
      window.dispatchEvent(event);
      
      // Simulate bridge connection if not already connected
      if (!bridgeState.isConnected) {
        simulateConnection();
      } else {
        // Simulate data flow to show the effect of changing modes
        simulateDataFlow();
      }
    };

    // Simulate a connection to the bridge
    const simulateConnection = () => {
      // Random data types to simulate
      const dataTypes = ['text', 'image', 'video', 'json', 'parameter'];
      const randomType = dataTypes[Math.floor(Math.random() * dataTypes.length)];
      
      setTimeout(() => {
        // Update bridge state with connection information
        setBridgeState(prev => ({
          ...prev,
          isConnected: true,
          connectedNodeId: `node-${Math.floor(Math.random() * 1000)}`,
          dataType: randomType
        }));
        
        // Dispatch bridge connection event
        const connectionEvent = new CustomEvent('bridge-connection', { 
          detail: { 
            nodeId, 
            connectedNodeId: `node-${Math.floor(Math.random() * 1000)}`,
            dataType: randomType
          } 
        });
        window.dispatchEvent(connectionEvent);
        
        // After connection, simulate data flow
        simulateDataFlow();
      }, 800);
    };

    // Simulate data flowing through the bridge
    const simulateDataFlow = () => {
      // Create mock data based on the data type
      let mockData;
      
      switch (bridgeState.dataType) {
        case 'text':
          mockData = "Sample text flowing through the bridge";
          break;
        case 'image':
          mockData = { width: 1024, height: 768, format: "png", url: "https://example.com/image.png" };
          break;
        case 'video':
          mockData = { duration: 15.4, format: "mp4", resolution: "1080p", url: "https://example.com/video.mp4" };
          break;
        case 'json':
          mockData = { id: "data-123", parameters: { alpha: 0.8, beta: 1.2 }, timestamp: new Date().toISOString() };
          break;
        case 'parameter':
          mockData = { temperature: 0.7, topP: 0.9, maxTokens: 1024 };
          break;
        default:
          mockData = "Unknown data type";
      }
      
      // Set the bridge to active state to display the animation
      setBridgeState(prev => ({
        ...prev,
        isActive: true,
        lastData: mockData
      }));
      
      // Dispatch bridge data flow event
      const dataEvent = new CustomEvent('bridge-data-flow', { 
        detail: { nodeId, data: mockData } 
      });
      window.dispatchEvent(dataEvent);
      
      // Reset active state after animation completes
      setTimeout(() => {
        setBridgeState(prev => ({
          ...prev,
          isActive: false
        }));
      }, 1500);
    };
    
    // The expanded view provides more controls and information
    if (isExpanded) {
      return (
        <div className="bridge-node-expanded">
          <div className="space-y-4">
            {/* Bridge Mode Selection */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Bridge Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {['Pass-through', 'Reroute'].map((mode) => (
                  <button
                    key={mode}
                    className={`flex items-center justify-center py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                      ${bridgeState.bridgeMode === mode 
                        ? 'bg-white/10 border-white/30 text-white' 
                        : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                    onClick={() => {
                      handleBridgeModeChange(mode as 'Pass-through' | 'Reroute');
                    }}
                  >
                    {mode === 'Pass-through' ? (
                      <ExternalLinkIcon size={14} className="mr-1.5" />
                    ) : (
                      <GitForkIcon size={14} className="mr-1.5" />
                    )}
                    {mode}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">
                {bridgeState.bridgeMode === 'Pass-through' 
                  ? 'Simply forwards data without modification' 
                  : 'Redirects data flow to different parts of the graph'}
              </p>
            </div>
            
            {/* Bridge Label */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Bridge Label</label>
              <input
                type="text"
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                placeholder="Enter a descriptive label..."
                value={bridgeState.bridgeLabel}
                onChange={(e) => {
                  setBridgeState(prev => ({ ...prev, bridgeLabel: e.target.value }));
                  
                  // Dispatch label change event
                  const event = new CustomEvent('bridge-label-change', { 
                    detail: { nodeId, value: e.target.value } 
                  });
                  window.dispatchEvent(event);
                }}
              />
              <p className="mt-2 text-xs text-white/50">Add a label to identify this bridge point</p>
            </div>
            
            {/* Direction Selection */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Data Flow Direction</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'input', label: 'Input', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline></svg> },
                  { value: 'bidirectional', label: 'Both', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg> },
                  { value: 'output', label: 'Output', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><polyline points="17 11 12 6 7 11"></polyline><polyline points="17 18 12 13 7 18"></polyline></svg> }
                ].map((dir) => (
                  <button
                    key={dir.value}
                    className={`flex items-center justify-center py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                      ${bridgeState.direction === dir.value 
                        ? 'bg-white/10 border-white/30 text-white' 
                        : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                    onClick={() => {
                      setBridgeState(prev => ({ ...prev, direction: dir.value as 'input' | 'output' | 'bidirectional' }));
                    }}
                  >
                    {dir.icon}
                    {dir.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">Control how data flows through this bridge</p>
            </div>
            
            {/* Connection and Data Type Info */}
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-medium text-white/70">Bridge Status</div>
                <div className={`text-xs px-2 py-1 rounded-full flex items-center gap-1.5 ${bridgeState.isConnected ? 'bg-indigo-900/30 text-indigo-300' : 'bg-white/10 text-white/50'}`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${bridgeState.isConnected ? 'bg-indigo-400' : 'bg-white/20'}`}></span>
                  {bridgeState.isConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
              
              {bridgeState.isConnected && (
                <>
                  <div className="flex items-center text-xs text-white/60 mb-3">
                    <span className="mr-2">Data Type:</span>
                    <div className="flex items-center bg-black/30 rounded-full px-2 py-1">
                      <span className="mr-1.5">{getDataTypeIcon()}</span>
                      <span className="font-medium">{getDataTypeLabel()}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center text-xs text-white/60 mb-3">
                    <span className="mr-2">Bridge ID:</span>
                    <span className="font-mono bg-black/30 px-2 py-1 rounded">{bridgeState.pairId}</span>
                  </div>
                  
                  {bridgeState.lastData && (
                    <div>
                      <div className="text-xs text-white/60 mb-1.5">Last Data Transferred:</div>
                      <div className="bg-black/30 rounded p-3 text-xs text-white/70 font-mono max-h-16 overflow-auto">
                        {typeof bridgeState.lastData === 'object' 
                          ? JSON.stringify(bridgeState.lastData, null, 2)
                          : String(bridgeState.lastData)
                        }
                      </div>
                    </div>
                  )}
                </>
              )}
              
              {!bridgeState.isConnected && (
                <div className="p-4 bg-black/20 rounded-lg flex flex-col items-center justify-center text-center text-white/40 text-xs">
                  <ComponentIcon size={24} className="mb-2 opacity-40" />
                  <p>Bridge not connected to any node.</p>
                  <p className="mt-1">Connect input and output points to establish a data pathway.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    // Default/collapsed view
    return (
      <div className="bridge-node-default">
        <div className="space-y-4">
          {/* Bridge Mode selection */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-2.5">Bridge Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {['Pass-through', 'Reroute'].map((mode) => (
                <button
                  key={mode}
                  className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                    ${bridgeState.bridgeMode === mode 
                      ? 'bg-white/10 border-white/30 text-white' 
                      : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                  onClick={() => {
                    handleBridgeModeChange(mode as 'Pass-through' | 'Reroute');
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/50">How data flows through the bridge</p>
          </div>
          
          {/* Bridge Label input */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-2.5">Bridge Label</label>
            <input
              type="text"
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
              placeholder="Enter bridge label..."
              value={bridgeState.bridgeLabel}
              onChange={(e) => {
                setBridgeState(prev => ({ ...prev, bridgeLabel: e.target.value }));
                
                // Dispatch label change event
                const event = new CustomEvent('bridge-label-change', { 
                  detail: { nodeId, value: e.target.value } 
                });
                window.dispatchEvent(event);
              }}
            />
            <p className="mt-2 text-xs text-white/50">Optional label to identify this bridge point</p>
          </div>
          
          {/* Status and activity indicator */}
          <div className={`flex items-center justify-between px-3 py-1.5 rounded-md ${bridgeState.isActive ? 'bg-indigo-900/30' : 'bg-black/30'}`}>
            <div className="flex items-center text-xs">
              <div className={`w-2 h-2 rounded-full mr-2 ${bridgeState.isConnected 
                ? (bridgeState.isActive ? 'bg-indigo-400 animate-pulse' : 'bg-indigo-400') 
                : 'bg-white/20'}`}
              ></div>
              <span className={bridgeState.isConnected ? 'text-indigo-300' : 'text-white/40'}>
                {bridgeState.isConnected 
                  ? (bridgeState.isActive ? 'Data flowing' : 'Connected') 
                  : 'Disconnected'}
              </span>
            </div>
            {bridgeState.isConnected && bridgeState.dataType && (
              <div className="flex items-center text-xs text-white/60 bg-black/30 rounded-full px-2 py-0.5">
                {getDataTypeLabel()}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  // If used through BaseNode, just return the BaseNode with type "bridge"
  return (
    <BaseNode
      {...baseNodeProps as BaseNodeProps}
      type="bridge"
      defaultContent={null}
    />
  );
};

export default BridgeNode; 