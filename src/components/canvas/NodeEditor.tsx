import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, BrainCircuit, Image, Video, Trash2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, PlayCircle, RotateCw, Zap, ArrowUpRight, Search, X, VideoIcon } from 'lucide-react';
import AgentPanel, { NodeTemplate } from './AgentPanel';
import NodeConfigPanel from './NodeConfigPanel';
import { createNode } from '../nodes';

interface NodeData {
  id: number;
  title: string;
  icon: React.ReactNode;
  description: string;
  type: string;
  position: { x: number; y: number };
  inputs: ConnectionPoint[];
  outputs: ConnectionPoint[];
  isExecuting?: boolean;
  executionProgress?: number;
}

interface ConnectionPoint {
  id: string;
  type: string;
  label: string;
}

interface Connection {
  id: string;
  sourceId: number;
  sourceOutput: string;
  targetId: number;
  targetInput: string;
  path: string;
  type?: string;
  active?: boolean;
}

interface NodeEditorProps {
  className?: string;
}

// Add this interface for tutorial data at the top with other interfaces
interface TutorialData {
  id: string;
  title: string;
  description: string;
  gifUrl: string;
}

// Import node templates directly from AgentPanel
import { nodeTemplates as agentPanelNodeTemplates } from './AgentPanel';

const NodeEditor: React.FC<NodeEditorProps> = ({ className = '' }) => {
  // Refs to prevent renders
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const nextNodeIdRef = useRef(1);
  const nextConnectionIdRef = useRef(1);
  const draggingConnectionRef = useRef<{
    sourceId: number;
    sourceOutput: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    type?: string;
  } | null>(null);
  const connectionStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const panningRef = useRef(false);
  const panStartRef = useRef<{x: number, y: number} | null>(null);
  const viewportOffsetRef = useRef<{x: number, y: number}>({x: 0, y: 0});
  const isDraggingNodeRef = useRef(false);

  // State management
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<{nodeId: number, outputId: string, type?: string} | null>(null);
  const [mousePosition, setMousePosition] = useState<{x: number, y: number} | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [currentExecutingNodeId, setCurrentExecutingNodeId] = useState<number | null>(null);
  const [showNodeConfig, setShowNodeConfig] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [showNodeSearch, setShowNodeSearch] = useState(false);
  const [searchPosition, setSearchPosition] = useState<{x: number, y: number}>({x: 0, y: 0});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NodeTemplate[]>([]);
  const [selectedSearchResultIndex, setSelectedSearchResultIndex] = useState(0);
  
  // Container selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{x: number, y: number} | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{x: number, y: number} | null>(null);
  const [containers, setContainers] = useState<NodeContainer[]>([]);
  const [runningContainerId, setRunningContainerId] = useState<string | null>(null);
  
  // Container interface
  interface NodeContainer {
    id: string;
    title: string;
    color: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    nodeIds: number[];
  }
  
  // New state management for containers
  const nextContainerIdRef = useRef(1);
  const isSelectingRef = useRef(false);
  
  // New state for Controls Panel
  const [showControlsPanel, setShowControlsPanel] = useState(false);
  
  // Add new state for the tutorial modal
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [currentTutorial, setCurrentTutorial] = useState<TutorialData | null>(null);
  
  // Add state for debug mode
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  
  // Add state for guide text visibility
  const [showGuideText, setShowGuideText] = useState(true);
  
  // Function to get the vertical position class
  const getPanelVerticalPositionClass = () => {
    return "top-[12%]"; // Fixed position at 12% from the top
  };
  
  // Tracking whether initial sample nodes were loaded
  const initialNodesLoadedRef = useRef(false);

  // Add new state for search
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Optimize updateConnectionPaths with debounce for smoother drag operations
  const updateConnectionRef = useRef<number | null>(null);

  // Force update helper
  const [, forceUpdateState] = useState({});
  const forceUpdate = () => forceUpdateState({});

  // Add state to control button visibility
  const [showControlsButton, setShowControlsButton] = useState(false);
  
  // Show controls button after a slight delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowControlsButton(true);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, []);

  // Handle space key press/release
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isSpacePressed) {
        e.preventDefault(); // Prevent page scroll
        setIsSpacePressed(true);
        if (canvasRef.current) {
          canvasRef.current.style.cursor = 'grab';
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        if (canvasRef.current) {
          canvasRef.current.style.cursor = '';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpacePressed]);

  // Handle mouse wheel for zooming
  useEffect(() => {
    if (!canvasRef.current) return;

    const handleWheel = (e: WheelEvent) => {
      // Only zoom when space is pressed or Ctrl is held
      if (isSpacePressed || e.ctrlKey) {
        e.preventDefault();

        // Get mouse position relative to canvas
        const canvasRect = canvasRef.current!.getBoundingClientRect();
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;

        // Calculate zoom change
        const delta = -e.deltaY;
        const zoomChange = delta > 0 ? 0.1 : -0.1;
        const newZoom = Math.min(Math.max(zoom + zoomChange, 0.1), 3);

        // Calculate new viewport offset to zoom towards mouse position
        if (newZoom !== zoom) {
          const zoomPoint = {
            x: (mouseX - viewportOffset.x) / zoom,
            y: (mouseY - viewportOffset.y) / zoom
          };

          const newOffset = {
            x: mouseX - zoomPoint.x * newZoom,
            y: mouseY - zoomPoint.y * newZoom
          };

          setZoom(newZoom);
          setViewportOffset(newOffset);
          viewportOffsetRef.current = newOffset;
        }
      }
    };

    const canvas = canvasRef.current;
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [zoom, isSpacePressed, viewportOffset]);

  // Update canvas panning to work with space key
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const handleMouseDown = (e: MouseEvent) => {
      // Only start panning if space is pressed or middle mouse button
      if (isDraggingNodeRef.current) return;
      
      if (e.button === 1 || (isSpacePressed && e.button === 0)) {
        e.preventDefault();
        panningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        if (canvasRef.current) {
          canvasRef.current.style.cursor = 'grabbing';
        }
      }
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (panningRef.current && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        
        viewportOffsetRef.current = {
          x: viewportOffsetRef.current.x + dx / zoom,
          y: viewportOffsetRef.current.y + dy / zoom
        };
        
        setViewportOffset(viewportOffsetRef.current);
        panStartRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    
    const handleMouseUp = () => {
      if (panningRef.current) {
        panningRef.current = false;
        panStartRef.current = null;
        if (canvasRef.current) {
          canvasRef.current.style.cursor = isSpacePressed ? 'grab' : '';
        }
      }
    };

    const canvas = canvasRef.current;
    canvas.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoom, isSpacePressed]);

  // ResizeObserver to track canvas size
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Initialize canvas size - removed setCanvasSize
    const updateCanvasSize = () => {
      // We still get the rect for potential future use, but don't store it in state
      if (canvasRef.current) {
        canvasRef.current.getBoundingClientRect();
        // Size is accessed directly when needed
      }
    };
    
    // Update initially
    updateCanvasSize();
    
    // Create ResizeObserver
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(canvasRef.current);
    
    // Clean up
    return () => {
      observer.disconnect();
    };
  }, []);

  // Track mouse position for drawing active connection
  useEffect(() => {
    if (!isConnecting || !canvasRef.current) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      // Use utility function to get consistent mouse position
      const position = screenToCanvasPosition(e.clientX, e.clientY);
      setMousePosition(position);
      
      if (draggingConnectionRef.current) {
        draggingConnectionRef.current.endX = position.x;
        draggingConnectionRef.current.endY = position.y;
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isConnecting, zoom, viewportOffset]);
  
  // Load sample nodes for demo purposes
  useEffect(() => {
    if (!initialNodesLoadedRef.current && nodes.length === 0) {
      const demoNodes: NodeData[] = [
        {
          id: 1,
          title: 'Text Generator',
          icon: <BrainCircuit size={16} />,
          description: 'Generate structured text based on your input',
          type: 'llm',
          position: { x: 200, y: 200 },
          inputs: [
            { id: "prompt", type: "text", label: "Text Input" }
          ],
          outputs: [
            { id: "text", type: "text", label: "Generated Text" }
          ]
        },
        {
          id: 2,
          title: 'Image Generator',
          icon: <Image size={16} />,
          description: 'Create images from text descriptions',
          type: 'image',
          position: { x: 500, y: 350 },
          inputs: [
            { id: "prompt", type: "text", label: "Text Input" }
          ],
          outputs: [
            { id: "image", type: "image", label: "Generated Image" }
          ]
        },
        {
          id: 3,
          title: 'Image Enhancer',
          icon: <ArrowUpRight size={16} />,
          description: 'Upscale and enhance image quality',
          type: 'upscale-image',
          position: { x: 800, y: 200 },
          inputs: [
            { id: "image", type: "image", label: "Image Input" }
          ],
          outputs: [
            { id: "image", type: "image", label: "Enhanced Image" }
          ]
        }
      ];
      
      // Create a connection from node 1 to node 2
      const demoConnection: Connection = {
        id: '1',
        sourceId: 1,
        sourceOutput: 'text',
        targetId: 2,
        targetInput: 'prompt',
        path: '',
        type: 'text'
      };
      
      // Calculate path for connection
      const sourcePath = demoNodes[0];
      const targetPath = demoNodes[1];
      
      const path = calculateConnectionPath(
        { x: sourcePath.position.x + 230, y: sourcePath.position.y + 100 },
        { x: targetPath.position.x, y: targetPath.position.y + 100 }
      );
      
      demoConnection.path = path;
      
      setNodes(demoNodes);
      setConnections([demoConnection]);
      nextNodeIdRef.current = 4;
      nextConnectionIdRef.current = 2;
      initialNodesLoadedRef.current = true;
    }
  }, [nodes.length]);

  // Panel toggle function
  const togglePanel = () => {
    setIsPanelOpen(!isPanelOpen);
  };

  // Add a new node to the canvas from a template
  const handleAddNodeFromPanel = (template: NodeTemplate) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect() || { width: 1000, height: 800, left: 0, top: 0 };
    
    // Calculate the center of the canvas in workspace coordinates using utility function
    const canvasCenter = screenToCanvasPosition(
      canvasRect.left + canvasRect.width / 2,
      canvasRect.top + canvasRect.height / 2
    );
    
    console.log('Adding node at center:', { canvasCenter, zoom, viewportOffset });
    
    // Add some randomness to position to avoid perfect overlap
    const randomOffset = () => Math.random() * 100 - 50;
    
    const newNode: NodeData = {
      id: nextNodeIdRef.current++,
      title: template.title,
      icon: template.icon,
      description: template.description,
      type: template.type,
      position: { 
        x: canvasCenter.x + randomOffset(), 
        y: canvasCenter.y + randomOffset() 
      },
      inputs: template.inputs,
      outputs: template.outputs
    };
    
    setNodes([...nodes, newNode]);
    setSelectedNodeId(newNode.id);
  };

  // Handle node position changes with optimizations for smooth dragging
  const handleNodePositionChange = (id: number, position: { x: number; y: number }) => {
    console.log('NodeEditor received position change for node:', id, position);
    
    // Use functional update to avoid stale state
    setNodes(prevNodes => {
      // Find the node being moved
      const updatedNodes = prevNodes.map(node => 
        node.id === id ? { ...node, position } : node
      );
      
      // Update affected connections immediately for real-time movement
      const movedNode = updatedNodes.find(node => node.id === id);
      if (movedNode) {
        const affectedConnectionIndexes: number[] = [];
        
        // Find connections attached to this node
        connections.forEach((conn, index) => {
          if (conn.sourceId === id || conn.targetId === id) {
            affectedConnectionIndexes.push(index);
          }
        });
        
        // If we have affected connections, update them directly
        if (affectedConnectionIndexes.length > 0) {
          console.log('Updating affected connections:', affectedConnectionIndexes.length);
          
          // If we're actively dragging, the update will happen via the
          // animation frame in handleNodeDragStateChange
          // If not, we'll do a one-time update
          if (!isDraggingNodeRef.current) {
            requestAnimationFrame(() => {
              updateConnectionPathsDebounced();
            });
          }
        }
      }
      
      return updatedNodes;
    });
  };

  // Update node settings (from configuration panel)
  const handleUpdateNode = (nodeId: number, updates: any) => {
    setNodes(prevNodes => 
      prevNodes.map(node => 
        node.id === nodeId ? { ...node, ...updates } : node
      )
    );
  };

  // Handle node selection
  const handleNodeSelect = (id: number) => {
    if (isConnecting) return; // Don't select during connecting
    
    setSelectedNodeId(id);
  };

  // Handle starting a connection from an output pin
  const handleStartConnection = (nodeId: number, outputId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Use utility function to get consistent position
    const { x: startX, y: startY } = screenToCanvasPosition(e.clientX, e.clientY);
    
    // Get the actual position of the output pin
    const outputPinPosition = getOutputPinPosition(nodeId, outputId);
    
    // Store the output pin position in the ref - this is where the connection line should start from
    connectionStartPointRef.current = outputPinPosition || { x: startX, y: startY };
    
    // Set connection state
    setIsConnecting(true);
    const sourceNode = nodes.find(n => n.id === nodeId);
    const outputPoint = sourceNode?.outputs.find(o => o.id === outputId);
    setConnectingFrom({
      nodeId,
      outputId,
      type: outputPoint?.type
    });
    
    // Store in ref for performance
    draggingConnectionRef.current = {
      sourceId: nodeId,
      sourceOutput: outputId,
      startX: outputPinPosition?.x || startX,
      startY: outputPinPosition?.y || startY,
      endX: startX,
      endY: startY,
      type: outputPoint?.type
    };
    
    // Set initial mouse position
    setMousePosition({ x: startX, y: startY });
  };

  // Complete connection to an input
  const handleCompleteConnection = (nodeId: number, inputId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Only complete if we're in connecting mode and have a source
    if (!isConnecting || !connectingFrom || !draggingConnectionRef.current) return;
    
    // Don't connect to self
    if (connectingFrom.nodeId === nodeId) {
      handleCancelConnection();
      return;
    }
    
    // Check if target input already has a connection
    const existingConnection = connections.find(
      conn => conn.targetId === nodeId && conn.targetInput === inputId
    );
    
    if (existingConnection) {
      // Remove existing connection
      setConnections(connections.filter(conn => conn.id !== existingConnection.id));
    }
    
    // Get input type from target node
    const targetNode = nodes.find(node => node.id === nodeId);
    if (!targetNode) {
      handleCancelConnection();
      return;
    }
    
    const input = targetNode.inputs.find(i => i.id === inputId);
    const inputType = input?.type;
    
    // Get source type
    const sourceType = connectingFrom.type;
    
    // Allow all connections regardless of type
    const isCompatible = true;
    
    // Find the target connector position
    const inputElement = document.getElementById(`node-${nodeId}-input-${inputId}`);
    if (!inputElement) {
      console.log(`Could not find input element with ID: node-${nodeId}-input-${inputId}`);
      handleCancelConnection();
      return;
    }
    
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) {
      handleCancelConnection();
      return;
    }
    
    // Calculate connector position in canvas coordinates
    const inputRect = inputElement.getBoundingClientRect();
    const endX = (inputRect.left + inputRect.width / 2 - canvasRect.left - viewportOffset.x) / zoom;
    const endY = (inputRect.top + inputRect.height / 2 - canvasRect.top - viewportOffset.y) / zoom;
    
    // Create the connection
    const newConnection: Connection = {
      id: `conn-${nextConnectionIdRef.current++}`,
      sourceId: connectingFrom.nodeId,
      sourceOutput: connectingFrom.outputId,
      targetId: nodeId,
      targetInput: inputId,
      path: calculateConnectionPath(
        { x: draggingConnectionRef.current.startX, y: draggingConnectionRef.current.startY },
        { x: endX, y: endY }
      ),
      type: connectingFrom.type
    };
    
    // Add the new connection
    setConnections([...connections, newConnection]);
    
    // Ensure connections are properly updated
    setTimeout(() => {
      ensureConnectionsAreAccurate(10, 50);
    }, 50);
    
    // Reset connection state
    handleCancelConnection();
  };

  // Cancel current connection attempt
  const handleCancelConnection = () => {
    setIsConnecting(false);
    setConnectingFrom(null);
    setMousePosition(null);
    draggingConnectionRef.current = null;
    connectionStartPointRef.current = null;
    setShowNodeSearch(false);
  };

  // Optimize updateConnectionPaths with debounce for smoother drag operations
  const updateConnectionPathsDebounced = useCallback(() => {
    if (updateConnectionRef.current) {
      cancelAnimationFrame(updateConnectionRef.current);
    }
    
    updateConnectionRef.current = requestAnimationFrame(() => {
      updateConnectionPaths();
    });
  }, [connections, showNodeSearch, connectingFrom]);

  const updateConnectionPaths = () => {
    // Only update if we have canvas ref
    if (!canvasRef.current) return;
    
    // Update search container connection if search is open
    if (showNodeSearch && connectingFrom) {
      updateSearchContainerConnection();
      return; // Only update the search connection to avoid flicker
    }
    
    // Create an array to store updates
    const updatedConnections = [...connections];
    let hasUpdates = false;
    
    // Loop through each connection
    for (let i = 0; i < updatedConnections.length; i++) {
      const connection = updatedConnections[i];
      
      // Skip temp search connection as we handle it separately
      if (connection.id === 'temp-search-connection') continue;
      
      // Get source node and output element directly
      const sourceNode = nodes.find(n => n.id === connection.sourceId);
      if (!sourceNode) continue;
      
      const outputEl = document.getElementById(`node-${connection.sourceId}-output-${connection.sourceOutput}`);
      if (!outputEl) {
        console.log(`Output element not found for connection ${connection.id}: node-${connection.sourceId}-output-${connection.sourceOutput}`);
        continue;
      }
      
      // Get target node and input element directly
      const targetNode = nodes.find(n => n.id === connection.targetId);
      if (!targetNode) continue;
      
      const inputEl = document.getElementById(`node-${connection.targetId}-input-${connection.targetInput}`);
      if (!inputEl) {
        console.log(`Input element not found for connection ${connection.id}: node-${connection.targetId}-input-${connection.targetInput}`);
        continue;
      }
      
      // Get element positions using utility functions
      const startPos = elementToCanvasPosition(outputEl);
      const endPos = elementToCanvasPosition(inputEl);
      
      if (!startPos || !endPos) {
        console.log(`Could not calculate positions for connection ${connection.id}`);
        continue;
      }
      
      // Generate the SVG path
      const path = calculateConnectionPath(startPos, endPos);
      
      // Update path if it has changed
      if (connection.path !== path) {
        updatedConnections[i] = { ...connection, path };
        hasUpdates = true;
      }
    }
    
    // Update connections state if changes were made
    if (hasUpdates) {
      setConnections(updatedConnections);
    }
  };

  // Calculate a nice bezier curve for connection
  const calculateConnectionPath = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    
    // Calculate distance between points
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Adjust control point offset based on distance
    const controlPointOffset = Math.min(Math.abs(dx) * 0.5, Math.abs(dy) * 0.5, distance * 0.5, 150);
    
    // Create a smoother curve with adjusted control points
    return `M ${start.x} ${start.y} C ${start.x + controlPointOffset} ${start.y}, ${end.x - controlPointOffset} ${end.y}, ${end.x} ${end.y}`;
  };

  // Dragging a node onto the canvas
  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Dropping a node onto the canvas
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    
    try {
      // Get drop position in canvas coordinates using utility function
      const { x: dropX, y: dropY } = screenToCanvasPosition(e.clientX, e.clientY);
      
      console.log('Drop position:', { dropX, dropY, zoom, viewportOffset });
      
      // Get template data from drag event
      const jsonData = e.dataTransfer.getData('application/json');
      if (!jsonData) return;
      
      const template = JSON.parse(jsonData);
      
      // Convert icon string back to React component
      let icon: React.ReactNode;
      switch (template.icon) {
        case 'llm':
          icon = <BrainCircuit size={16} />;
          break;
        case 'image':
          icon = <Image size={16} />;
          break;
        case 'video':
          icon = <Video size={16} />;
          break;
        case 'upscale-image':
        case 'upscale-video':
          icon = <ArrowUpRight size={16} />;
          break;
        case 'utility':
          icon = <Zap size={16} />;
          break;
        default:
          icon = <Plus size={16} />;
      }
      
      // Create new node
      const newNode: NodeData = {
        id: nextNodeIdRef.current++,
        title: template.title,
        icon,
        description: template.description,
        type: template.type,
        position: { x: dropX - 115, y: dropY - 50 }, // Center the node on drop position
        inputs: template.inputs,
        outputs: template.outputs
      };
      
      setNodes([...nodes, newNode]);
      setSelectedNodeId(newNode.id);
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  };

  // Run the workflow
  const runWorkflow = () => {
    if (isRunning || nodes.length === 0) return;
    
    setIsRunning(true);
    
    // Simple topological sort for demo purpose - in a real app, this would be more complex
    const nodeMap = new Map<number, NodeData>();
    nodes.forEach(node => nodeMap.set(node.id, node));
    
    const inDegree = new Map<number, number>();
    nodes.forEach(node => inDegree.set(node.id, 0));
    
    connections.forEach(conn => {
      const target = inDegree.get(conn.targetId) || 0;
      inDegree.set(conn.targetId, target + 1);
    });
    
    const queue: number[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) queue.push(nodeId);
    });
    
    // Simple simulation of execution
    let currentIndex = 0;
    
    const processNext = () => {
      if (currentIndex >= queue.length) {
        setIsRunning(false);
        setCurrentExecutingNodeId(null);
        return;
      }
      
      const nodeId = queue[currentIndex++];
      const node = nodeMap.get(nodeId);
      
      if (!node) {
        processNext();
        return;
      }
      
      // Mark node as executing
      setCurrentExecutingNodeId(nodeId);
      
      // Update node progress
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 10;
        
        setNodes(prev => 
          prev.map(n => 
            n.id === nodeId 
              ? { ...n, isExecuting: true, executionProgress: progress } 
              : n
          )
        );
        
        if (progress >= 100) {
          clearInterval(progressInterval);
          
          // Mark node as complete
          setNodes(prev => 
            prev.map(n => 
              n.id === nodeId 
                ? { ...n, isExecuting: false, executionProgress: 0 } 
                : n
            )
          );
          
          // Add outgoing nodes to queue
          const outgoingConnections = connections.filter(conn => conn.sourceId === nodeId);
          outgoingConnections.forEach(conn => {
            const targetInDegree = inDegree.get(conn.targetId) || 0;
            inDegree.set(conn.targetId, targetInDegree - 1);
            
            if (targetInDegree - 1 === 0) {
              queue.push(conn.targetId);
            }
          });
          
          // Process next node
          setTimeout(processNext, 300);
        }
      }, 100);
    };
    
    // Start processing
    processNext();
  };

  // Close node configuration
  const handleCloseConfig = () => {
    setShowNodeConfig(false);
  };

  // Zoom controls
  const handleZoomIn = () => {
    setZoom(Math.min(zoom + 0.1, 3));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom - 0.1, 0.1));
  };

  const handleResetView = () => {
    setZoom(1);
    setViewportOffset({ x: 0, y: 0 });
    viewportOffsetRef.current = { x: 0, y: 0 };
  };

  // Clear canvas
  const handleClearCanvas = () => {
    if (nodes.length === 0 && containers.length === 0) return;
    
    if (confirm('Are you sure you want to clear the canvas? This action cannot be undone.')) {
      setNodes([]);
      setConnections([]);
      setContainers([]);
      setSelectedNodeId(null);
      handleCloseConfig();
    }
  };

  // Handle node drag state changing
  const handleNodeDragStateChange = (isDragging: boolean) => {
    console.log('Node drag state changed to:', isDragging);
    isDraggingNodeRef.current = isDragging;
    
    // Add/remove node-dragging class on the canvas container when a node is being dragged
    if (canvasRef.current) {
      if (isDragging) {
        canvasRef.current.classList.add('node-dragging');
        console.log('Added node-dragging class to canvas');
        
        // Prioritize performance for dragging operations
        document.body.classList.add('node-drag-active');
        
        // Reset throttled update timer to ensure we get immediate feedback
        if (updateConnectionRef.current) {
          cancelAnimationFrame(updateConnectionRef.current);
        }
        
        // Start a high-frequency connection path update loop during drag operations
        const updateDuringDrag = () => {
          if (isDraggingNodeRef.current) {
      updateConnectionPaths();
            updateConnectionRef.current = requestAnimationFrame(updateDuringDrag);
          }
        };
        // Start the loop immediately
        updateConnectionRef.current = requestAnimationFrame(updateDuringDrag);
      } else {
        // Cleanup when dragging ends
        canvasRef.current.classList.remove('node-dragging');
        console.log('Removed node-dragging class from canvas');
        
        document.body.classList.remove('node-drag-active');
        
        // Final update to ensure connections are accurate
        if (updateConnectionRef.current) {
          cancelAnimationFrame(updateConnectionRef.current);
          updateConnectionRef.current = null;
        }
        
        // Do a final update with a small delay to ensure all DOM updates are complete
        setTimeout(() => {
          updateConnectionPaths();
        }, 5);
      }
    }
  };

  // Handle node deletion
  const handleDeleteNode = (nodeId: number) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setConnections(prev => prev.filter(c => c.sourceId !== nodeId && c.targetId !== nodeId));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  };

  // Handle node execution
  const handleRunNode = (nodeId: number) => {
    setNodes(prev => prev.map(node => 
      node.id === nodeId 
        ? { ...node, isExecuting: true, executionProgress: 0 }
        : node
    ));

    // Simulate node execution
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setNodes(prev => prev.map(node =>
        node.id === nodeId
          ? { ...node, executionProgress: progress }
          : node
      ));

      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setNodes(prev => prev.map(node =>
            node.id === nodeId
              ? { ...node, isExecuting: false, executionProgress: 0 }
              : node
          ));
        }, 500);
      }
    }, 100);
  };

  // Compute canvas container style based on zoom and pan
  const canvasContainerStyle = {
    transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px) scale(${zoom})`,
    transformOrigin: '0 0',
    willChange: 'transform',
  };

  // Render a node
  const renderNode = (node: NodeData) => {
    const nodeProps = {
      key: `node-${node.id}`,
      id: node.id,
      title: node.title,
      icon: node.icon,
      description: node.description,
      type: node.type,
      initialPosition: node.position,
      onPositionChange: handleNodePositionChange,
      onNodeSelect: handleNodeSelect,
      onDragStateChange: handleNodeDragStateChange,
      isSelected: selectedNodeId === node.id,
      isConnecting: isConnecting,
      isConnectionSource: connectingFrom?.nodeId === node.id,
      isExecuting: node.isExecuting || false,
      executionProgress: node.executionProgress || 0,
            inputs: node.inputs,
      outputs: node.outputs,
      onStartConnection: (outputId: string, e: React.MouseEvent) => handleStartConnection(node.id, outputId, e),
      onCompleteConnection: (inputId: string, e: React.MouseEvent) => handleCompleteConnection(node.id, inputId, e),
      onDelete: () => handleDeleteNode(node.id),
      onRun: () => handleRunNode(node.id)
    };

    return createNode(nodeProps);
  };

  // Render all connections with optimizations
  const renderConnections = () => {
    return (
      <svg 
        className="absolute inset-0 z-10 overflow-visible" 
        xmlns="http://www.w3.org/2000/svg"
        style={{ pointerEvents: 'none' }}
      >
        {/* Fixed connections */}
        {connections.map(conn => {
          // Identify if this is the temp search connection
          const isSearchConnection = conn.id === 'temp-search-connection';
          
          // Get source and target nodes
          const sourceNode = nodes.find(node => node.id === conn.sourceId);
          const targetNode = nodes.find(node => node.id === conn.targetId);
          
          // Get source and target types
          const sourceOutput = sourceNode?.outputs.find(o => o.id === conn.sourceOutput);
          const targetInput = targetNode?.inputs.find(i => i.id === conn.targetInput);
          const sourceType = sourceOutput?.type || 'default';
          const targetType = targetInput?.type || 'default';
          
          // Check if this is a cross-type connection
          const isCrossTypeConnection = sourceType !== targetType && 
                                       sourceType !== 'any' && 
                                       targetType !== 'any';
          
          // Get style based on source node type
          const typeStyle = sourceNode ? getTypeStyles(sourceNode.type) : getTypeStyles('default');
          
          // Determine connection styling
          const isActive = conn.active !== undefined ? conn.active : true;
          const strokeWidth = isSearchConnection ? 3 : (isActive ? 2 : 1.5);
          const strokeOpacity = isSearchConnection ? 1 : (isActive ? 0.8 : 0.4);
          
          // For cross-type connections, use a gradient or special styling
          const strokeColor = isSearchConnection 
            ? '#ffffff' 
            : (isCrossTypeConnection 
                ? typeStyle?.progressColor || '#ffffff' 
                : typeStyle?.progressColor || '#ffffff');
          
          // All completed connections should be solid lines
          // Only use dashed lines for cross-type connections if specifically configured
          const strokeDasharray = isSearchConnection 
            ? 'none' 
            : (isActive 
                ? 'none'  // Always use solid lines for active connections
                : '5,5'); // Only use dashed for inactive connections
      
      return (
        <path
          key={conn.id}
          id={`conn-${conn.id}`}
          d={conn.path}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          className={`connection-path ${isSearchConnection ? 'search-connection-path' : ''} ${isCrossTypeConnection ? 'cross-type-connection' : ''}`}
          shapeRendering="geometricPrecision"
          pointerEvents="stroke"
          onMouseEnter={() => {
            // Highlight the connection on hover
            const pathElement = document.getElementById(`conn-${conn.id}`);
            if (pathElement) {
              pathElement.style.strokeWidth = '3px';
              pathElement.style.filter = 'drop-shadow(0 0 3px rgba(255, 255, 255, 0.5))';
            }
          }}
          onMouseLeave={() => {
            // Reset the connection styling on mouse leave
            const pathElement = document.getElementById(`conn-${conn.id}`);
            if (pathElement) {
              pathElement.style.strokeWidth = `${strokeWidth}px`;
              pathElement.style.filter = isCrossTypeConnection 
                ? 'drop-shadow(0 0 3px rgba(255, 255, 255, 0.3))' 
                : 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.1))';
            }
          }}
            />
          );
        })}
        
        {/* Draw the in-progress connection line that follows the cursor */}
        {isConnecting && mousePosition && connectionStartPointRef.current && !showNodeSearch && (
          <path
            d={calculateConnectionPath(
        connectionStartPointRef.current,
        mousePosition
            )}
            fill="none"
            stroke={getTypeStyles(nodes.find(n => n.id === connectingFrom?.nodeId)?.type || 'default').progressColor}
            strokeOpacity="0.6"
            strokeWidth="2"
            strokeDasharray="5,5"
            shapeRendering="geometricPrecision"
          />
        )}
      </svg>
    );
  };

  // Handle canvas click while connecting
  const handleCanvasClick = (e: React.MouseEvent) => {
    // If search is visible and click is outside, close it
    if (showNodeSearch) {
      // Check if the click is on the search container itself
      const isClickOnSearchContainer = e.target instanceof Element && 
        (e.target.closest('.node-search-container') !== null);
      
      // If the click is not on the search container, close it
      if (!isClickOnSearchContainer) {
        console.log('Click detected outside search container, closing search');
        handleCancelSearch();
        return;
      }
    }
    
    // Only show search if we're currently connecting
    if (isConnecting && connectingFrom) {
      // Use utility function to get consistent position
      const position = screenToCanvasPosition(e.clientX, e.clientY);
      
      console.log('Canvas click during connection at:', { position, zoom, viewportOffset });
      
      // Store the source node and output type for later use
      const sourceNode = nodes.find(n => n.id === connectingFrom.nodeId);
      const sourceOutput = sourceNode?.outputs.find(o => o.id === connectingFrom.outputId);
      
      if (sourceNode && sourceOutput) {
        console.log(`Connection source: ${sourceNode.title}, output: ${sourceOutput.label} (${sourceOutput.type})`);
        
        // Store the connection type in the connectingFrom object for later use
        setConnectingFrom({
          nodeId: connectingFrom.nodeId,
          outputId: connectingFrom.outputId,
          type: sourceOutput.type
        });
        
        // Also update the local ref for immediate use
        connectingFrom.type = sourceOutput.type;
      }
      
      // Show search at click position
      setSearchPosition(position);
      setShowNodeSearch(true);
      setSearchQuery('');
      setSelectedSearchResultIndex(0);
      
      // Create a temporary connection immediately using the original output pin position
      if (connectionStartPointRef.current) {
        console.log('Creating initial search connection');
        createSearchContainerConnection(connectionStartPointRef.current, position);
      }
      
      // Focus search input after it renders
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 100);
      
      e.stopPropagation();
    }
  };

  // Create a temporary connection to the search container
  const createSearchContainerConnection = (startPos: { x: number, y: number }, endPos: { x: number, y: number }) => {
    if (!connectingFrom) return;
    
    console.log('Creating search container connection from', startPos, 'to', endPos);
    
    // Create a straight path from output to search input (will be updated when search container renders)
    const path = calculateConnectionPath(startPos, endPos);
    
    // Create or update temporary connection
    const tempConnection: Connection = {
      id: 'temp-search-connection',
      sourceId: connectingFrom.nodeId,
      sourceOutput: connectingFrom.outputId,
      targetId: -999, // Special ID for search container
      targetInput: 'search-input',
      path,
      type: connectingFrom.type,
      active: true
    };
    
    console.log('Created temporary connection:', tempConnection);
    
    // Remove any existing temp connection and add the new one
    setConnections(prev => {
      const filteredConnections = prev.filter(c => c.id !== 'temp-search-connection');
      return [...filteredConnections, tempConnection];
    });
    
    // Force a re-render to ensure the connection is visible
    forceUpdate();
  };
  
  // Handle only the search container connection specifically - updating the connection path
  const updateSearchContainerConnection = () => {
    if (!showNodeSearch || !connectingFrom || !canvasRef.current || !connectionStartPointRef.current) {
      console.log('Missing required refs for search connection:', { 
        showNodeSearch, 
        hasConnectingFrom: !!connectingFrom, 
        hasCanvasRef: !!canvasRef.current, 
        hasStartPoint: !!connectionStartPointRef.current 
      });
      return;
    }
    
    // Try to find the search container using multiple selectors
    const searchContainer = canvasRef.current.querySelector('.node-search-container') || 
                           document.querySelector('.node-search-container');
    
    if (!searchContainer) {
      console.log('Search container not found, retrying...');
      // Try again shortly - the container might still be rendering
      setTimeout(() => updateSearchContainerConnection(), 50);
      return;
    }
    
    // Try to find the input pin using multiple selectors
    const searchInput = searchContainer.querySelector('.search-input-pin') || 
                       document.getElementById('search-container-input-pin');
    
    if (!searchInput) {
      console.log('Search input pin not found, retrying...');
      // Try again shortly - the pin might still be rendering
      setTimeout(() => updateSearchContainerConnection(), 50);
      return;
    }
    
    // Get the output pin position
    const outputEl = document.getElementById(`node-${connectingFrom.nodeId}-output-${connectingFrom.outputId}`);
    if (!outputEl) {
      console.log('Output element not found for search connection');
      return;
    }
    
    // Get positions using utility functions
    const startPos = elementToCanvasPosition(outputEl);
    const endPos = elementToCanvasPosition(searchInput as HTMLElement);
    
    if (!startPos || !endPos) {
      console.log('Could not calculate positions for search connection');
      return;
    }
    
    // Generate the SVG path
    const path = calculateConnectionPath(startPos, endPos);
    
    // Update the temporary connection
    setConnections(prev => {
      const updatedConnections = prev.map(conn => {
        if (conn.id === 'temp-search-connection') {
          return { ...conn, path };
        }
        return conn;
      });
      return updatedConnections;
    });
  };

  // Handle ESC key to cancel search and connection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isConnecting) {
          handleCancelConnection();
        } else if (showNodeSearch) {
          handleCancelSearch();
        } else if (showControlsPanel) {
          setShowControlsPanel(false);
          setShowTutorialModal(false);
        }
      } else if (e.key === 'k' && !isConnecting && !showNodeSearch && !isRunning) {
        // Toggle Controls Panel when pressing K
        e.preventDefault();
        setShowControlsPanel(prev => !prev);
        if (!showControlsPanel) {
          setShowTutorialModal(false);
        }
      } else if (e.key === 'd' && showControlsPanel && e.altKey) {
        // Toggle debug info when pressing Alt+D and Controls Panel is open
        e.preventDefault();
        setShowDebugInfo(prev => !prev);
      } else if (e.key === 'g' && showControlsPanel && e.altKey) {
        // Toggle guide text when pressing Alt+G and Controls Panel is open
        e.preventDefault();
        setShowGuideText(prev => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isRunning && nodes.length > 0) {
        // Run workflow with Ctrl+Enter
        e.preventDefault();
        runWorkflow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConnecting, showNodeSearch, showControlsPanel, isRunning, nodes.length]);

  // Define available node templates
  const allNodeTemplates: NodeTemplate[] = agentPanelNodeTemplates;

  // Update search results when query changes
  useEffect(() => {
    if (searchQuery.trim() === '') {
      // Show all templates when search is empty
      setSearchResults(allNodeTemplates);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filteredResults = allNodeTemplates.filter(template =>
      template.title.toLowerCase().includes(query) ||
      template.description.toLowerCase().includes(query) ||
      template.category.toLowerCase().includes(query)
    );
    
    setSearchResults(filteredResults);
    setSelectedSearchResultIndex(0);
  }, [searchQuery]);
  
  // Handle keyboard navigation in search results
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showNodeSearch) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSearchResultIndex(prev => 
          (prev + 1) % searchResults.length
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSearchResultIndex(prev => 
          (prev - 1 + searchResults.length) % searchResults.length
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (searchResults.length > 0) {
          handleSelectSearchResult(searchResults[selectedSearchResultIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleCancelSearch();
        break;
    }
  };
  
  // Handle selecting a node from search results
  const handleSelectSearchResult = (template: NodeTemplate) => {
    // Create the new node at the search position
    const newNodeId = nextNodeIdRef.current++;
    
    // Create a proper node data object from the template
    const newNode: NodeData = {
      id: newNodeId,
      title: template.title,
      icon: template.icon,
      description: template.description,
      type: template.type,
      position: searchPosition,
      inputs: template.inputs,
      outputs: template.outputs
    };
    
    // First add the new node to the nodes array
    setNodes(prev => [...prev, newNode]);
    
    // Check if the source node is in a container
    let containerToUpdate = null;
    if (connectingFrom) {
      containerToUpdate = containers.find(container => 
        container.nodeIds.includes(connectingFrom.nodeId)
      );
      
      if (containerToUpdate) {
        console.log(`Source node is in container: ${containerToUpdate.title}`);
      }
    }
    
    // If we're in connecting mode, create a connection
    if (isConnecting && connectingFrom && connectionStartPointRef.current) {
      console.log('Creating connection to new node from search', { connectingFrom, newNodeId });
      
      // Remove the temporary search connection
      const filteredConnections = connections.filter(c => c.id !== 'temp-search-connection');
      
      // We'll set this connection after the node is created and rendered
      let finalConnection: Connection | null = null;
      
      // Only create a connection if the template has inputs
      if (template.inputs && template.inputs.length > 0) {
        // Get the source node and output to determine the output type
        const sourceNode = nodes.find(n => n.id === connectingFrom.nodeId);
        const sourceOutput = sourceNode?.outputs.find(o => o.id === connectingFrom.outputId);
        const sourceType = sourceOutput?.type || connectingFrom.type || 'any';
        
        console.log('Source output type:', sourceType);
        console.log('Available inputs:', template.inputs);
        
        // Find the first compatible input
        const compatibleInput = template.inputs.find(input => 
          input.type === sourceType || input.type === 'any' || sourceType === 'any'
        );
        
        if (compatibleInput) {
          console.log(`Creating connection from ${connectingFrom.nodeId}:${connectingFrom.outputId} to ${newNodeId}:${compatibleInput.id}`);
          
          finalConnection = {
            id: `${connectingFrom.nodeId}-${connectingFrom.outputId}-to-${newNodeId}-${compatibleInput.id}`,
            sourceId: connectingFrom.nodeId,
            sourceOutput: connectingFrom.outputId,
            targetId: newNodeId,
            targetInput: compatibleInput.id,
            path: '',
            type: sourceType,
            active: true
          };
        } else {
          console.log('No compatible input found for connection');
        }
      } else {
        console.log('New node has no inputs, cannot create connection');
      }
      
      // Update connections array with the new final connection (if created)
      if (finalConnection) {
        console.log('Adding final connection:', finalConnection);
        setConnections([...filteredConnections, finalConnection]);
      } else {
        setConnections(filteredConnections);
      }
      
      // Clean up search and connecting state
      handleCancelSearch();
      setIsConnecting(false);
      setConnectingFrom(null);
      draggingConnectionRef.current = null;
    } else {
      // Just clean up search if we're not connecting
      handleCancelSearch();
    }
    
    // If the source node is in a container, add the new node to the container
    // and update its size to include the new node
    if (containerToUpdate) {
      // We need to wait for the node to be rendered before we can expand the container
      setTimeout(() => {
        // Add the new node to the container
        console.log(`Adding new node ${newNodeId} to container ${containerToUpdate.title}`);
        
        // Calculate the necessary container size to include the new node
        const nodeWidth = 250; // Approximate node width
        const nodeHeight = 120; // Approximate node height
        
        const newNodeRight = searchPosition.x + nodeWidth;
        const newNodeBottom = searchPosition.y + nodeHeight;
        
        // Calculate new container bounds
        const newContainerX = Math.min(containerToUpdate.position.x, searchPosition.x);
        const newContainerY = Math.min(containerToUpdate.position.y, searchPosition.y);
        const newContainerWidth = Math.max(
          containerToUpdate.position.x + containerToUpdate.size.width - newContainerX,
          newNodeRight - newContainerX
        );
        const newContainerHeight = Math.max(
          containerToUpdate.position.y + containerToUpdate.size.height - newContainerY,
          newNodeBottom - newContainerY
        );
        
        // Add padding around the container
        const padding = 20;
        const updatedContainer = {
          ...containerToUpdate,
          position: { 
            x: newContainerX - padding, 
            y: newContainerY - padding 
          },
          size: { 
            width: newContainerWidth + (padding * 2), 
            height: newContainerHeight + (padding * 2) 
          },
          nodeIds: [...containerToUpdate.nodeIds, newNodeId]
        };
        
        console.log('Updating container:', {
          before: containerToUpdate,
          after: updatedContainer
        });
        
        // Update the container in state
        setContainers(prev => prev.map(container => 
          container.id === containerToUpdate.id ? updatedContainer : container
        ));
      }, 100);
    }
    
    // Select the new node
    setSelectedNodeId(newNodeId);
    
    // Try to update the connection paths repeatedly until pins are found
    // Use a more aggressive approach to ensure connections are updated
    setTimeout(() => {
      ensureConnectionsAreAccurate(10, 100);
    }, 50);
    
    // Add additional update attempts with increasing delays
    setTimeout(() => {
      updateConnectionPaths();
    }, 200);
    
    setTimeout(() => {
      updateConnectionPaths();
    }, 500);
    
    setTimeout(() => {
      updateConnectionPaths();
    }, 1000);
  };
  
  // Cancel search and connecting
  const handleCancelSearch = () => {
    console.log('Cancelling search and cleaning up...');
    
    // Remove the temporary connection first
    setConnections(prev => prev.filter(c => c.id !== 'temp-search-connection'));
    
    // Clean up any debug elements
    const debugElement = document.getElementById('debug-search-connection');
    if (debugElement) {
      debugElement.remove();
    }
    
    // Then close the search
    setShowNodeSearch(false);
    setSearchQuery('');
    setSelectedSearchResultIndex(0);
    
    // Also clear the connecting state to remove the wire
    setIsConnecting(false);
    setConnectingFrom(null);
    connectionStartPointRef.current = null;
    
    // Log for debugging
    console.log('Search cancelled, connection removed, connecting state cleared');
  };

  // Update connection paths when search container appears or disappears
  useEffect(() => {
    if (showNodeSearch && connectionStartPointRef.current && searchPosition) {
      // Small delay to make sure the DOM is updated and the input pin is properly positioned
      const timer = setTimeout(() => {
        // Just update the existing connection, don't create a new one
        updateSearchContainerConnection();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showNodeSearch]);

  // Helper function to get the position of an output pin
  const getOutputPinPosition = (nodeId: number, outputId: string): {x: number, y: number} | null => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;
    
    const outputEl = document.getElementById(`node-${nodeId}-output-${outputId}`);
    if (!outputEl) return null;
    
    return elementToCanvasPosition(outputEl);
  };

  // Helper function to get the position of an input pin
  const getInputPinPosition = (nodeId: number, inputId: string): {x: number, y: number} | null => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;
    
    const inputEl = document.getElementById(`node-${nodeId}-input-${inputId}`);
    if (!inputEl) return null;
    
    return elementToCanvasPosition(inputEl);
  };

  // Add a mechanism to keep updating connections until they're properly positioned
  const ensureConnectionsAreAccurate = (maxAttempts = 5, interval = 50) => {
    let attempts = 0;
    
    const updateUntilAccurate = () => {
      attempts++;
      console.log(`Connection update attempt ${attempts}/${maxAttempts}`);
      updateConnectionPaths();
      
      // Check if all connections have found their pins
      const allConnectionsHavePins = connections.every(conn => {
        // Skip temp connections
        if (conn.id === 'temp-search-connection') return true;
        
        const startPos = getOutputPinPosition(conn.sourceId, conn.sourceOutput);
        const endPos = getInputPinPosition(conn.targetId, conn.targetInput);
        
        const hasPositions = startPos && endPos;
        if (!hasPositions) {
          console.log(`Connection ${conn.id} missing positions:`, { 
            startPos: startPos ? 'found' : 'missing', 
            endPos: endPos ? 'found' : 'missing' 
          });
        }
        
        return hasPositions;
      });
      
      // If we haven't found all pins and haven't exceeded max attempts, try again
      if (!allConnectionsHavePins && attempts < maxAttempts) {
        console.log(`Not all connections have pins, retrying in ${interval}ms`);
        setTimeout(updateUntilAccurate, interval);
      } else if (allConnectionsHavePins) {
        console.log('All connections have pins, update complete');
      } else {
        console.log(`Max attempts (${maxAttempts}) reached, some connections may not be accurate`);
      }
    };
    
    updateUntilAccurate();
  };

  // Get type styles for connections from node types
  const getTypeStyles = (type: string) => {
    const typeStyles: Record<string, any> = {
      llm: {
        progressColor: 'rgba(234, 179, 8, 0.8)',
      },
      image: {
        progressColor: 'rgba(34, 197, 94, 0.8)',
      },
      video: {
        progressColor: 'rgba(59, 130, 246, 0.8)',
      },
      'upscale-image': {
        progressColor: 'rgba(236, 72, 153, 0.8)',
      },
      'upscale-video': {
        progressColor: 'rgba(236, 72, 153, 0.8)',
      },
      utility: {
        progressColor: 'rgba(168, 85, 247, 0.8)',
      },
      default: {
        progressColor: 'rgba(255, 255, 255, 0.8)',
      }
    };

    return typeStyles[type] || typeStyles.default;
  };

  // Add a useEffect to monitor new nodes and update their connections
  useEffect(() => {
    if (nodes.length > 0) {
      // Allow time for the DOM to update with the new node
      const timer = setTimeout(() => {
        updateConnectionPaths();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);

  // Optimization: Prevent full component rerenders for node drag operations
  useEffect(() => {
    // Set a flag on the canvas element that can be used for optimization
    if (canvasRef.current) {
      canvasRef.current.setAttribute('data-scale', zoom.toString());
    }
  }, [zoom]);

  // Add mouse tracker for debugging
  useEffect(() => {
    // Create a mouse tracker element
    const tracker = document.createElement('div');
    tracker.id = 'mouse-debug-tracker';
    tracker.style.position = 'fixed';
    tracker.style.width = '10px';
    tracker.style.height = '10px';
    tracker.style.borderRadius = '50%';
    tracker.style.backgroundColor = 'red';
    tracker.style.pointerEvents = 'none';
    tracker.style.zIndex = '9999';
    tracker.style.opacity = '0.7';
    tracker.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(tracker);
    
    // Track mouse movement
    const trackMouse = (e: MouseEvent) => {
      tracker.style.left = `${e.clientX}px`;
      tracker.style.top = `${e.clientY}px`;
    };
    
    // Add event listener
    document.addEventListener('mousemove', trackMouse);
    
    // Cleanup
    return () => {
      document.removeEventListener('mousemove', trackMouse);
      document.body.removeChild(tracker);
    };
  }, []);

  // Handle canvas right-click to close or open search container
  const handleCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent default context menu
    
    // If search is already visible, close it
    if (showNodeSearch) {
      console.log('Right-click detected while search is open, closing search container');
      handleCancelSearch();
      return;
    }
    
    // Check if the click is on a node (don't open search if clicking on a node)
    const isClickOnNode = e.target instanceof Element && 
      (e.target.closest('[id^="node-"]') !== null);
      
    if (isClickOnNode) {
      console.log('Right-click detected on a node, not opening search');
      return;
    }
    
    // Open search at right-click position
    console.log('Right-click detected on empty canvas, opening search container');
    
    // Get the click position relative to the canvas
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - viewportOffset.x / zoom;
    const y = (e.clientY - rect.top) / zoom - viewportOffset.y / zoom;
    
    console.log('Right-click canvas position:', { x, y });
    
    // Show search at right-click position
    setSearchPosition({ x, y });
    setShowNodeSearch(true);
    setSearchQuery('');
    setSelectedSearchResultIndex(0);
    
    // Focus search input after it renders
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 100);
  };

  // Add tutorial data
  const tutorials: TutorialData[] = [
    {
      id: 'pan-canvas',
      title: 'Pan Canvas',
      description: 'Hold the Space key and drag with your mouse to pan around the canvas. This allows you to navigate through your workflow freely.',
      gifUrl: 'https://i.imgur.com/example-pan.gif', // Replace with actual GIF URLs
    },
    {
      id: 'zoom',
      title: 'Zoom In/Out',
      description: 'Hold Ctrl (or Cmd on Mac) and scroll up or down to zoom in and out of the canvas. This helps focus on specific parts of your workflow.',
      gifUrl: 'https://i.imgur.com/example-zoom.gif',
    },
    {
      id: 'node-search',
      title: 'Open Node Search',
      description: 'Right-click anywhere on the canvas to open the node search. Type to find nodes, navigate with arrow keys, and press Enter to add the selected node.',
      gifUrl: 'https://i.imgur.com/example-search.gif',
    },
    {
      id: 'add-connection',
      title: 'Add Connection',
      description: 'Click and drag from an output pin of one node to an input pin of another node to create a connection between them.',
      gifUrl: 'https://i.imgur.com/example-connection.gif',
    },
    {
      id: 'delete-node',
      title: 'Delete Node',
      description: 'Select a node and press Delete or Backspace to remove it from the canvas along with all its connections.',
      gifUrl: 'https://i.imgur.com/example-delete.gif',
    },
    {
      id: 'run-workflow',
      title: 'Run Workflow',
      description: 'Press Ctrl+Enter to execute your entire workflow from start to finish, or use the Run button at the top of the canvas.',
      gifUrl: 'https://i.imgur.com/example-run.gif',
    },
    {
      id: 'toggle-controls',
      title: 'Toggle Controls',
      description: 'Press K at any time to open or close this Controls Panel, which shows all available shortcuts and features.',
      gifUrl: 'https://i.imgur.com/example-toggle.gif',
    },
    {
      id: 'close-panels',
      title: 'Close Panels',
      description: 'Press Esc to close any open panel or dialog, including the Controls Panel, Node Search, and connection process.',
      gifUrl: 'https://i.imgur.com/example-close.gif',
    },
  ];

  // Function to open tutorial
  const handleOpenTutorial = (tutorialId: string) => {
    const tutorial = tutorials.find(t => t.id === tutorialId);
    if (tutorial) {
      setCurrentTutorial(tutorial);
      setShowTutorialModal(true);
    }
  };

  // Update connections when nodes change
  useEffect(() => {
    if (nodes.length > 0 && connections.length > 0) {
      // Wait for nodes to be rendered
      setTimeout(() => {
        ensureConnectionsAreAccurate(10, 50);
      }, 100);
    }
  }, [nodes, connections.length]);

  // Handle canvas mousedown for selection with Ctrl key
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only start selection with Ctrl key
    if (e.ctrlKey) {
      e.preventDefault();
      
      // Use utility function to get consistent position
      const position = screenToCanvasPosition(e.clientX, e.clientY);
      
      // Start selection
      console.log('Starting selection at:', { position, zoom, viewportOffset });
      setIsSelecting(true);
      isSelectingRef.current = true;
      setSelectionStart(position);
      setSelectionEnd(position);
    }
  };
  
  // Handle mouse move during selection
  useEffect(() => {
    if (!isSelecting || !selectionStart || !canvasRef.current) return;
    
    const handleSelectionMouseMove = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;
      
      // Use utility function to get consistent position
      const position = screenToCanvasPosition(e.clientX, e.clientY);
      
      // Update selection end point
      setSelectionEnd(position);
      
      // Debug selection area
      console.log('Selection area:', { 
        start: selectionStart, 
        end: position,
        width: Math.abs(position.x - selectionStart.x),
        height: Math.abs(position.y - selectionStart.y),
        zoom,
        viewportOffset
      });
    };
    
    // Handle mouse up to complete selection
    const handleSelectionMouseUp = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;
      
      // Use utility function to get consistent position
      const position = screenToCanvasPosition(e.clientX, e.clientY);
      
      // Calculate selection bounds
      const minX = Math.min(selectionStart.x, position.x);
      const minY = Math.min(selectionStart.y, position.y);
      const maxX = Math.max(selectionStart.x, position.x);
      const maxY = Math.max(selectionStart.y, position.y);
      const width = maxX - minX;
      const height = maxY - minY;
      
      // If selection is too small, ignore it
      if (width < 10 / zoom || height < 10 / zoom) {
        console.log('Selection too small, ignoring');
        setIsSelecting(false);
        isSelectingRef.current = false;
        setSelectionStart(null);
        setSelectionEnd(null);
        return;
      }
      
      // Find nodes within the selection area
      const selectedNodes = nodes.filter(node => {
        // Approximate node bounds (we don't have actual node dimensions)
        const nodeLeft = node.position.x;
        const nodeTop = node.position.y;
        // Use more conservative default sizes that are a better approximation of node dimensions
        const nodeWidth = 250; // Approximate standard node width
        const nodeHeight = 120; // Approximate standard node height
        const nodeRight = nodeLeft + nodeWidth;
        const nodeBottom = nodeTop + nodeHeight;
        
        // Check if any part of the node is within selection (more lenient approach)
        // This considers a node selected if any part of it overlaps with the selection rectangle
        return (
          (nodeLeft <= maxX && nodeRight >= minX) && // Horizontal overlap
          (nodeTop <= maxY && nodeBottom >= minY)    // Vertical overlap
        );
      });
      
      console.log('Selected nodes:', selectedNodes.map(n => n.title));
      
      // If we found nodes, create a container
      if (selectedNodes.length > 0) {
        createNodeContainer(selectedNodes, minX, minY, width, height);
      }
      
      // Reset selection state
      setIsSelecting(false);
      isSelectingRef.current = false;
      setSelectionStart(null);
      setSelectionEnd(null);
    };
    
    document.addEventListener('mousemove', handleSelectionMouseMove);
    document.addEventListener('mouseup', handleSelectionMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleSelectionMouseMove);
      document.removeEventListener('mouseup', handleSelectionMouseUp);
    };
  }, [isSelecting, selectionStart, zoom, nodes]);
  
  // Function to create a new node container
  const createNodeContainer = (selectedNodes: NodeData[], x: number, y: number, width: number, height: number) => {
    // Generate a random color for the container
    const colors = [
      '#3B82F6', // Blue
      '#10B981', // Green
      '#F59E0B', // Amber
      '#EF4444', // Red
      '#8B5CF6', // Purple
      '#EC4899'  // Pink
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Create the container
    const newContainer: NodeContainer = {
      id: `container-${nextContainerIdRef.current++}`,
      title: `Container ${nextContainerIdRef.current - 1}`,
      color: randomColor,
      position: { x, y },
      size: { width, height },
      nodeIds: selectedNodes.map(node => node.id)
    };
    
    console.log('Created container:', newContainer);
    
    // Add the container to state
    setContainers(prev => [...prev, newContainer]);
  };

  // Function to render node containers
  const renderContainers = () => {
    return containers.map(container => {
      const { id, title, color, position, size, nodeIds } = container;
      
      // Check if this container is running
      const isContainerRunning = isRunning && runningContainerId === id;
      
      // Add handler for deleting a container
      const handleDeleteContainer = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering drag events
        e.preventDefault();
        
        console.log(`Deleting container: ${title}`);
        
        // Remove the container from state
        setContainers(prev => prev.filter(c => c.id !== id));
      };
      
      // Add handler for running container workflow
      const handleRunContainerWorkflow = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering drag events
        e.preventDefault();
        runContainerWorkflow(container);
      };
      
      // Container resize handler
      const handleContainerResize = (e: React.MouseEvent, direction: string) => {
        e.stopPropagation();
        e.preventDefault();
        
        console.log(`Started resizing container: ${title} in direction: ${direction}`);
        
        // Track initial mouse position
        const startPos = screenToCanvasPosition(e.clientX, e.clientY);
        
        // Store initial container dimensions
        const initialPosition = { ...position };
        const initialSize = { ...size };
        
        // Track resizing state for visual feedback
        const containerEl = document.getElementById(`container-${id}`);
        if (containerEl) {
          containerEl.classList.add('resizing');
        }
        
        // Handle mouse movement during resize
        const handleResizeMove = (moveEvent: MouseEvent) => {
          // Get current mouse position
          const currentPos = screenToCanvasPosition(moveEvent.clientX, moveEvent.clientY);
          
          // Calculate delta
          const deltaX = currentPos.x - startPos.x;
          const deltaY = currentPos.y - startPos.y;
          
          // Create new container dimensions based on resize direction
          let newPosition = { ...initialPosition };
          let newSize = { ...initialSize };
          
          switch (direction) {
            case 'n': // North (top)
              newPosition.y = Math.min(initialPosition.y + deltaY, initialPosition.y + initialSize.height - 50);
              newSize.height = Math.max(initialSize.height - deltaY, 50);
              break;
              
            case 's': // South (bottom)
              newSize.height = Math.max(initialSize.height + deltaY, 50);
              break;
              
            case 'e': // East (right)
              newSize.width = Math.max(initialSize.width + deltaX, 50);
              break;
              
            case 'w': // West (left)
              newPosition.x = Math.min(initialPosition.x + deltaX, initialPosition.x + initialSize.width - 50);
              newSize.width = Math.max(initialSize.width - deltaX, 50);
              break;
              
            case 'ne': // Northeast
              newPosition.y = Math.min(initialPosition.y + deltaY, initialPosition.y + initialSize.height - 50);
              newSize.height = Math.max(initialSize.height - deltaY, 50);
              newSize.width = Math.max(initialSize.width + deltaX, 50);
              break;
              
            case 'nw': // Northwest
              newPosition.y = Math.min(initialPosition.y + deltaY, initialPosition.y + initialSize.height - 50);
              newPosition.x = Math.min(initialPosition.x + deltaX, initialPosition.x + initialSize.width - 50);
              newSize.height = Math.max(initialSize.height - deltaY, 50);
              newSize.width = Math.max(initialSize.width - deltaX, 50);
              break;
              
            case 'se': // Southeast
              newSize.height = Math.max(initialSize.height + deltaY, 50);
              newSize.width = Math.max(initialSize.width + deltaX, 50);
              break;
              
            case 'sw': // Southwest
              newPosition.x = Math.min(initialPosition.x + deltaX, initialPosition.x + initialSize.width - 50);
              newSize.width = Math.max(initialSize.width - deltaX, 50);
              newSize.height = Math.max(initialSize.height + deltaY, 50);
              break;
          }
          
          // Update container in state with new dimensions
          setContainers(prev => prev.map(c => 
            c.id === id ? { ...c, position: newPosition, size: newSize } : c
          ));
        };
        
        // Handle mouse up to end resizing
        const handleResizeEnd = () => {
          console.log(`Finished resizing container: ${title}`);
          
          // Remove resizing class for visual feedback
          const containerEl = document.getElementById(`container-${id}`);
          if (containerEl) {
            containerEl.classList.remove('resizing');
          }
          
          document.removeEventListener('mousemove', handleResizeMove);
          document.removeEventListener('mouseup', handleResizeEnd);
        };
        
        // Add event listeners
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
      };
      
      // Container header drag handlers
      const handleContainerHeaderMouseDown = (e: React.MouseEvent) => {
        // Don't start dragging if we clicked on a button
        if (e.target instanceof Element && 
            (e.target.tagName === 'BUTTON' || 
             e.target.closest('button') !== null)) {
          return;
        }
        
        e.stopPropagation(); // Prevent canvas from handling this event
        e.preventDefault();
        
        console.log(`Started dragging container: ${title}`);
        
        // Track dragging state for visual feedback
        const containerEl = document.getElementById(`container-${id}`);
        if (containerEl) {
          containerEl.classList.add('dragging');
        }
        
        // Initial cursor position
        const startX = e.clientX;
        const startY = e.clientY;
        
        // Initial container position
        const initialContainerPos = { ...position };
        
        // Get initial positions of all contained nodes
        const initialNodePositions = nodeIds.map(nodeId => {
          const node = nodes.find(n => n.id === nodeId);
          return {
            id: nodeId,
            position: node ? { ...node.position } : { x: 0, y: 0 }
          };
        });
        
        // Handler for mouse movement during container drag
        const handleContainerDragMove = (moveEvent: MouseEvent) => {
          // Calculate delta movement
          const dx = (moveEvent.clientX - startX) / zoom;
          const dy = (moveEvent.clientY - startY) / zoom;
          
          // Debug
          console.log(`Container drag delta: ${dx}, ${dy}`);
          
          // Update container position
          const newContainerPos = {
            x: initialContainerPos.x + dx,
            y: initialContainerPos.y + dy
          };
          
          // Update all contained nodes with the same delta
          const updatedNodes = nodes.map(node => {
            // If node is in this container, update its position
            if (nodeIds.includes(node.id)) {
              // Find initial position
              const initialPos = initialNodePositions.find(n => n.id === node.id)?.position || node.position;
              
              return {
                ...node,
                position: {
                  x: initialPos.x + dx,
                  y: initialPos.y + dy
                }
              };
            }
            return node;
          });
          
          // Update container position in state
          setContainers(prev => prev.map(c => 
            c.id === id ? { ...c, position: newContainerPos } : c
          ));
          
          // Update all nodes in state
          setNodes(updatedNodes);
        };
        
        // Handler for mouse up to end dragging
        const handleContainerDragEnd = () => {
          console.log(`Finished dragging container: ${title}`);
          
          // Remove dragging class for visual feedback
          const containerEl = document.getElementById(`container-${id}`);
          if (containerEl) {
            containerEl.classList.remove('dragging');
          }
          
          document.removeEventListener('mousemove', handleContainerDragMove);
          document.removeEventListener('mouseup', handleContainerDragEnd);
        };
        
        // Add event listeners
        document.addEventListener('mousemove', handleContainerDragMove);
        document.addEventListener('mouseup', handleContainerDragEnd);
      };
      
      // Generate cursors for different resize directions
      const getCursorForDirection = (direction: string) => {
        switch (direction) {
          case 'n': case 's': return 'ns-resize';
          case 'e': case 'w': return 'ew-resize';
          case 'ne': case 'sw': return 'nesw-resize';
          case 'nw': case 'se': return 'nwse-resize';
          default: return 'move';
        }
      };
      
      return (
        <div
          key={id}
          id={`container-${id}`}
          className={`absolute rounded-lg transition-all duration-100 group node-container ${
            isContainerRunning ? 'container-running' : ''
          }`}
          style={{
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height,
            backgroundColor: `${color}15`, // Slightly more visible background
            border: `2px solid ${color}`,
            boxShadow: isContainerRunning ? `0 0 20px ${color}60` : `0 0 10px ${color}20`,
            zIndex: 0, // Set to 0 to be below nodes
            pointerEvents: 'none', // Make containers non-interactive so they don't block node interactions
          }}
        >
          {/* Container header - draggable */}
          <div 
            className="absolute -top-8 left-2 bg-black/90 px-3 py-1.5 rounded-t-lg border-t border-l border-r opacity-90 hover:opacity-100 transition-all text-sm flex items-center gap-2 pointer-events-auto cursor-move"
            style={{ 
              color,
              borderColor: color,
              boxShadow: `0 -2px 10px ${color}30`
            }}
            onMouseDown={handleContainerHeaderMouseDown}
            onMouseEnter={() => {
              // Highlight container on header hover
              const containerEl = document.getElementById(`container-${id}`);
              if (containerEl) {
                containerEl.style.backgroundColor = `${color}25`;
                containerEl.style.boxShadow = `0 0 15px ${color}30`;
              }
            }}
            onMouseLeave={() => {
              // Reset container highlight when not hovering
              const containerEl = document.getElementById(`container-${id}`);
              if (containerEl && !containerEl.classList.contains('dragging')) {
                containerEl.style.backgroundColor = `${color}15`;
                containerEl.style.boxShadow = isContainerRunning ? `0 0 20px ${color}60` : `0 0 10px ${color}20`;
              }
            }}
          >
            <span className="font-semibold">{title}</span>
            <span className="text-xs text-white/60">({nodeIds.length} nodes)</span>
            
            {/* Run Container Workflow button */}
            <button
              className={`ml-auto text-white/60 hover:text-white rounded-sm px-1.5 py-0.5 cursor-pointer transition-colors text-xs font-medium flex items-center gap-1 ${
                isContainerRunning ? 'bg-green-600/30' : 'hover:bg-green-500/20'
              }`}
              onClick={handleRunContainerWorkflow}
              title="Run only the nodes in this container"
              disabled={isRunning}
            >
              {isContainerRunning ? (
                <>
                  <RotateCw size={12} className="animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <PlayCircle size={12} />
                  Run
                </>
              )}
            </button>
            
            {/* Delete button */}
            <button
              className="ml-2 text-white/60 hover:text-white hover:bg-red-500/20 rounded-sm p-0.5 cursor-pointer transition-colors"
              onClick={handleDeleteContainer}
              title="Delete container"
              disabled={isRunning}
            >
              <X size={14} />
            </button>
          </div>
          
          {/* Resize handles */}
          {/* North (top) */}
          <div 
            className="absolute top-0 left-0 right-0 h-2 pointer-events-auto cursor-ns-resize hover:bg-white/10"
            style={{ marginTop: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'n')}
          />
          
          {/* South (bottom) */}
          <div 
            className="absolute bottom-0 left-0 right-0 h-2 pointer-events-auto cursor-ns-resize hover:bg-white/10"
            style={{ marginBottom: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 's')}
          />
          
          {/* East (right) */}
          <div 
            className="absolute top-0 right-0 bottom-0 w-2 pointer-events-auto cursor-ew-resize hover:bg-white/10"
            style={{ marginRight: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'e')}
          />
          
          {/* West (left) */}
          <div 
            className="absolute top-0 left-0 bottom-0 w-2 pointer-events-auto cursor-ew-resize hover:bg-white/10"
            style={{ marginLeft: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'w')}
          />
          
          {/* Northeast corner */}
          <div 
            className="absolute top-0 right-0 w-4 h-4 pointer-events-auto cursor-nesw-resize hover:bg-white/10"
            style={{ marginTop: '-2px', marginRight: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'ne')}
          />
          
          {/* Northwest corner */}
          <div 
            className="absolute top-0 left-0 w-4 h-4 pointer-events-auto cursor-nwse-resize hover:bg-white/10"
            style={{ marginTop: '-2px', marginLeft: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'nw')}
          />
          
          {/* Southeast corner */}
          <div 
            className="absolute bottom-0 right-0 w-4 h-4 pointer-events-auto cursor-nwse-resize hover:bg-white/10"
            style={{ marginBottom: '-2px', marginRight: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'se')}
          />
          
          {/* Southwest corner */}
          <div 
            className="absolute bottom-0 left-0 w-4 h-4 pointer-events-auto cursor-nesw-resize hover:bg-white/10"
            style={{ marginBottom: '-2px', marginLeft: '-2px' }}
            onMouseDown={(e) => handleContainerResize(e, 'sw')}
          />
        </div>
      );
    });
  };

  // Add CSS for container dragging state
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .node-container.dragging {
        border-width: 3px !important;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.2) !important;
        opacity: 0.9;
        transition: none !important;
      }
      .node-container.dragging::after {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.05);
        pointer-events: none;
        border-radius: 6px;
      }
      .node-container.resizing {
        border-width: 3px !important;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.3) !important;
        opacity: 0.9;
        transition: none !important;
      }
      .node-container.resizing::after {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.07);
        pointer-events: none;
        border-radius: 6px;
      }
      .node-container.container-running {
        opacity: 1;
        transition: box-shadow 0.3s ease;
      }
      .node-container.container-running::after {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.05);
        pointer-events: none;
        border-radius: 6px;
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { opacity: 0.1; }
        50% { opacity: 0.2; }
        100% { opacity: 0.1; }
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Run just the nodes within a container
  const runContainerWorkflow = (container: NodeContainer) => {
    if (isRunning || container.nodeIds.length === 0) return;
    
    console.log(`Running workflow for container: ${container.title}`);
    
    setIsRunning(true);
    setRunningContainerId(container.id);
    
    // Get only the nodes and connections within this container
    const containerNodes = nodes.filter(node => container.nodeIds.includes(node.id));
    
    // Get only connections between nodes within the container
    const containerConnections = connections.filter(conn => 
      container.nodeIds.includes(conn.sourceId) && container.nodeIds.includes(conn.targetId)
    );
    
    // Simple topological sort for the container nodes
    const nodeMap = new Map<number, NodeData>();
    containerNodes.forEach(node => nodeMap.set(node.id, node));
    
    const inDegree = new Map<number, number>();
    containerNodes.forEach(node => inDegree.set(node.id, 0));
    
    containerConnections.forEach(conn => {
      const target = inDegree.get(conn.targetId) || 0;
      inDegree.set(conn.targetId, target + 1);
    });
    
    // Find nodes with no incoming edges (entry points)
    const queue: number[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) queue.push(nodeId);
    });
    
    // If no entry points are found, run all nodes in parallel
    if (queue.length === 0) {
      console.log('No entry points found, running all container nodes in parallel');
      containerNodes.forEach(node => queue.push(node.id));
    }
    
    // Simple simulation of execution
    let currentIndex = 0;
    
    const processNext = () => {
      if (currentIndex >= queue.length) {
        setIsRunning(false);
        setCurrentExecutingNodeId(null);
        setRunningContainerId(null);
        console.log(`Finished running workflow for container: ${container.title}`);
        return;
      }
      
      const nodeId = queue[currentIndex++];
      const node = nodeMap.get(nodeId);
      
      if (!node) {
        processNext();
        return;
      }
      
      // Mark node as executing
      setCurrentExecutingNodeId(nodeId);
      
      // Update node progress
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 10;
        
        setNodes(prev => 
          prev.map(n => 
            n.id === nodeId 
              ? { ...n, isExecuting: true, executionProgress: progress } 
              : n
          )
        );
        
        if (progress >= 100) {
          clearInterval(progressInterval);
          
          // Mark node as complete
          setNodes(prev => 
            prev.map(n => 
              n.id === nodeId 
                ? { ...n, isExecuting: false, executionProgress: 0 } 
                : n
            )
          );
          
          // Add outgoing nodes to queue (only from within this container)
          const outgoingConnections = containerConnections.filter(conn => conn.sourceId === nodeId);
          outgoingConnections.forEach(conn => {
            const targetInDegree = inDegree.get(conn.targetId) || 0;
            inDegree.set(conn.targetId, targetInDegree - 1);
            
            if (targetInDegree - 1 === 0) {
              queue.push(conn.targetId);
            }
          });
          
          // Process next node
          setTimeout(processNext, 300);
        }
      }, 100);
    };
    
    // Start processing
    processNext();
  };

  // Utility functions for consistent position calculation
  
  // Convert screen position to canvas position (accounting for zoom and viewport)
  const screenToCanvasPosition = (screenX: number, screenY: number): {x: number, y: number} => {
    if (!canvasRef.current) {
      console.error('Canvas ref not available for position calculation');
      return { x: 0, y: 0 };
    }
    
    const canvasRect = canvasRef.current.getBoundingClientRect();
    
    // First convert to position relative to canvas element
    const canvasRelativeX = screenX - canvasRect.left;
    const canvasRelativeY = screenY - canvasRect.top;
    
    // Then apply zoom and viewport transformations in correct order
    // We divide by zoom because when zoomed in, the position needs to be scaled down
    const x = (canvasRelativeX / zoom) - (viewportOffset.x / zoom);
    const y = (canvasRelativeY / zoom) - (viewportOffset.y / zoom);
    
    return { x, y };
  };
  
  // Convert canvas position to screen position (for reverse calculations if needed)
  const canvasToScreenPosition = (canvasX: number, canvasY: number): {x: number, y: number} => {
    if (!canvasRef.current) {
      console.error('Canvas ref not available for position calculation');
      return { x: 0, y: 0 };
    }
    
    const canvasRect = canvasRef.current.getBoundingClientRect();
    
    // Apply the same transformations in reverse
    const x = (canvasX + viewportOffset.x / zoom) * zoom + canvasRect.left;
    const y = (canvasY + viewportOffset.y / zoom) * zoom + canvasRect.top;
    
    return { x, y };
  };
  
  // Get position of a DOM element relative to canvas
  const elementToCanvasPosition = (element: HTMLElement): {x: number, y: number} | null => {
    if (!canvasRef.current || !element) return null;
    
    const elementRect = element.getBoundingClientRect();
    const canvasRect = canvasRef.current.getBoundingClientRect();
    
    // Get center of element
    const centerX = elementRect.left + elementRect.width / 2;
    const centerY = elementRect.top + elementRect.height / 2;
    
    // Convert to canvas position
    return screenToCanvasPosition(centerX, centerY);
  };

  return (
    <div className={`flex flex-col h-full relative ${className}`}>
      {/* Debug logger */}
      <div 
        className="absolute top-0 left-0 bg-black/70 text-white text-xs p-2 z-50 pointer-events-none" 
        style={{ maxWidth: '300px' }}
      >
        <div>Nodes: {nodes.length}</div>
        <div>Connections: {connections.length}</div>
        <div>Containers: {containers.length}</div>
        <div>Dragging: {isDraggingNodeRef.current ? 'Yes' : 'No'}</div>
        <div>Selecting: {isSelecting ? 'Yes' : 'No'}</div>
        <div>Canvas scale: {zoom}</div>
      </div>
      
      {/* Main workspace with Agent Panel and Canvas */}
      <div className="flex h-full">
        {/* Agent Panel - collapsible */}
        <div 
          className={`agent-panel bg-[rgba(20,20,20,0.95)] border-r border-[rgba(255,255,255,0.1)] backdrop-blur-[10px] h-full overflow-y-auto transition-all duration-300`}
          style={{ width: isPanelOpen ? '280px' : '0px' }}
        >
          {isPanelOpen && (
            <AgentPanel 
              onAddNode={handleAddNodeFromPanel}
              className="h-full"
            />
          )}
        </div>
        
        {/* Panel toggle button */}
        <button 
          onClick={togglePanel}
          className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-[rgba(20,20,20,0.9)] border-y border-r border-white/10 z-20 p-1 rounded-r-md hover:bg-[rgba(30,30,30,0.9)] transition-colors"
        >
          {isPanelOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
        
        {/* Run workflow button */}
        <button 
          onClick={runWorkflow}
          disabled={isRunning || nodes.length === 0}
          className={`absolute top-4 right-4 z-20 flex items-center space-x-2 px-4 py-2 rounded-lg transition-all transform-gpu ${
            isRunning || nodes.length === 0 
              ? 'bg-white/20 text-white/50 cursor-not-allowed' 
              : 'bg-white text-primary-bg hover:bg-white/90 hover:scale-[1.02]'
          }`}
        >
          {isRunning ? (
            <>
              <RotateCw size={16} className="animate-spin" />
              <span>Running...</span>
            </>
          ) : (
            <>
              <PlayCircle size={16} />
              <span>Run Workflow</span>
            </>
          )}
        </button>
        
        {/* Canvas viewport - handles drag and drop */}
        <div 
          ref={canvasRef}
          className="flex-1 relative overflow-hidden node-canvas-container canvas-container bg-[#0B0B0B] cursor-default"
          style={{ cursor: isSpacePressed ? 'grab' : 'default' }}
          onClick={handleCanvasClick}
          onContextMenu={handleCanvasContextMenu}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          onMouseDown={handleCanvasMouseDown}
        >
          {/* Guide text for canvas controls */}
          {showGuideText && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-3 z-30 pointer-events-none bg-[rgba(20,20,20,0.8)] rounded-full px-4 py-2 border border-white/10">
              <div className="text-[#E0E0E0] text-xs opacity-80 flex items-center gap-1">
                <span className="text-white/40">Space+Drag:</span>
                <span>Pan</span>
              </div>
              <div className="h-3 w-px bg-white/20"></div>
              <div className="text-[#E0E0E0] text-xs opacity-80 flex items-center gap-1">
                <span className="text-white/40">Ctrl+Scroll:</span>
                <span>Zoom</span>
              </div>
              <div className="h-3 w-px bg-white/20"></div>
              <div className="text-[#E0E0E0] text-xs opacity-80 flex items-center gap-1">
                <span className="text-white/40">K:</span>
                <span>Controls</span>
              </div>
            </div>
          )}
          
          {/* Controls Panel toggle button - always visible on the edge */}
          <button
            onClick={() => setShowControlsPanel(true)}
            className={`absolute top-4 right-8 bg-[rgba(20,20,20,0.95)] border border-white/10 z-40 p-2 px-3 rounded-md hover:bg-[rgba(30,30,30,0.9)] transition-all duration-300 flex items-center gap-2 text-xs shadow-md ${
              showControlsButton ? 'opacity-80 translate-x-0' : 'opacity-0 translate-x-4'
            }`}
          >
            <ZoomIn size={16} className="text-white/70" />
            <span className="text-white/80 font-medium">Controls</span>
          </button>
          
          {/* Controls Panel - floating modal with animation */}
          <div 
            className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity duration-300 ${
              showControlsPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => {
              setShowControlsPanel(false);
              setShowTutorialModal(false);
            }}
          >
            {/* Tutorial Modal - shown alongside the Controls Panel */}
            {showTutorialModal && currentTutorial && (
              <div 
                className={`absolute ${getPanelVerticalPositionClass()} right-[calc(26rem)] transform -translate-y-1/2 bg-[rgba(20,20,20,0.95)] border border-[rgba(255,255,255,0.1)] rounded-lg shadow-2xl transition-all duration-300 overflow-hidden ${
                  showTutorialModal ? 'slide-in-left opacity-100' : 'translate-x-20 scale-95 opacity-0'
                }`}
                onClick={e => e.stopPropagation()}
                style={{
                  width: "550px",
                  minWidth: "450px",
                  maxWidth: "calc(50vw - 12rem)",
                  boxShadow: "0 0 30px rgba(0, 0, 0, 0.6)",
                  height: "auto", 
                  maxHeight: "70vh",
                  borderRight: "4px solid rgba(59, 130, 246, 0.3)"
                }}
              >
                {/* Visual connector to Controls Panel */}
                <div 
                  className="absolute top-1/2 right-0 transform translate-x-[calc(100%+4px)] -translate-y-1/2 w-4 h-16 bg-gradient-to-r from-blue-500/30 to-transparent"
                  style={{ borderTopLeftRadius: "4px", borderBottomLeftRadius: "4px" }}
                ></div>
                
                {/* Modal Header */}
                <div className="bg-[#1A1A1A] border-b border-[rgba(255,255,255,0.1)] px-6 py-4 flex justify-between items-center rounded-t-lg">
                  <div className="flex items-center">
                    <VideoIcon size={18} className="text-blue-400 mr-2" />
                    <h2 className="text-white text-lg font-semibold">{currentTutorial.title} Tutorial</h2>
                  </div>
                  <button 
                    onClick={() => setShowTutorialModal(false)}
                    className="text-white/70 hover:text-white hover:bg-[rgba(255,255,255,0.1)] p-1 rounded-full transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                
                {/* Video Container - 16:9 ratio */}
                <div className="w-full aspect-video tutorial-video-container flex items-center justify-center overflow-hidden relative">
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(0,0,0,0.3)] pointer-events-none z-10"></div>
                  <img 
                    src={currentTutorial.gifUrl} 
                    alt={`${currentTutorial.title} tutorial`}
                    className="max-w-full max-h-full object-contain tutorial-video"
                    onError={(e) => {
                      e.currentTarget.src = 'https://placehold.co/800x450/1a1a1a/ffffff?text=Tutorial+Coming+Soon';
                    }}
                  />
                  <div className="absolute bottom-3 right-3 bg-blue-500/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs text-white/90 border border-blue-500/30 z-20">
                    <div className="flex items-center">
                      <div className="w-2 h-2 rounded-full bg-blue-400 mr-2 animate-pulse"></div>
                      Tutorial
                    </div>
                  </div>
                </div>
                
                {/* Description */}
                <div className="p-6 bg-[rgba(15,15,15,0.8)] max-h-[20vh] overflow-y-auto border-t border-[rgba(255,255,255,0.1)]">
                  <h3 className="text-white text-md font-semibold mb-2 flex items-center">
                    <ChevronRight size={16} className="text-blue-400 mr-1" />
                    How it works:
                  </h3>
                  <p className="text-white/80 text-sm leading-relaxed ml-5">{currentTutorial.description}</p>
                </div>
              </div>
            )}
            
            {/* Controls Panel */}
            <div 
              className={`absolute ${getPanelVerticalPositionClass()} right-8 transform -translate-y-1/2 bg-[rgba(20,20,20,0.95)] border border-[rgba(255,255,255,0.1)] rounded-lg shadow-2xl transition-all duration-300 w-96 max-w-[90vw] ${
                showControlsPanel ? 'slide-in-right opacity-100' : 'translate-x-20 scale-95 opacity-0'
              }`}
              onClick={e => e.stopPropagation()}
              style={{
                boxShadow: "0 0 30px rgba(0, 0, 0, 0.6)",
                borderLeft: showTutorialModal ? "4px solid rgba(59, 130, 246, 0.3)" : "none"
              }}
            >
              {/* Visual connector to Tutorial Modal (only when tutorial is open) */}
              {showTutorialModal && (
                <div 
                  className="absolute top-1/2 left-0 transform -translate-x-[calc(100%+4px)] -translate-y-1/2 w-4 h-16 bg-gradient-to-l from-blue-500/30 to-transparent"
                  style={{ borderTopRightRadius: "4px", borderBottomRightRadius: "4px" }}
                ></div>
              )}
              
              {/* Title bar with close button */}
              <div className="bg-[#1A1A1A] border-b border-[rgba(255,255,255,0.1)] px-6 py-4 flex justify-between items-center rounded-t-lg">
                <div className="flex items-center">
                  <ZoomIn size={18} className="text-blue-400 mr-2" />
                  <h2 className="text-white text-lg font-semibold">Canvas Controls</h2>
                </div>
                <div className="flex items-center">
                  {/* Debug toggle button */}
                  <button 
                    onClick={() => setShowDebugInfo(prev => !prev)}
                    className={`mr-2 p-1 rounded-full transition-colors ${showDebugInfo ? 'bg-blue-500/30 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10'}`}
                    title="Toggle Debug Info (Alt+D)"
                  >
                    <div className="w-4 h-4 flex items-center justify-center text-xs font-mono">
                      D
                    </div>
                  </button>
                  
                  <button 
                    onClick={() => {
                      setShowControlsPanel(false);
                      setShowTutorialModal(false);
                    }}
                    className="text-white/70 hover:text-white hover:bg-[rgba(255,255,255,0.1)] p-1 rounded-full transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              
              {/* Panel content */}
              <div className="p-6 max-h-[70vh] overflow-y-auto">
                <div className="mb-6 animate-in" style={{ animationDelay: '100ms' }}>
                  <h3 className="text-white text-md font-semibold mb-3 flex items-center">
                    <ChevronRight size={16} className="text-blue-400 mr-1" />
                    Keyboard Shortcuts
                  </h3>
                  <div className="space-y-3 text-sm ml-2">
                    <div className="flex justify-between items-center transition-all duration-300" style={{ transitionDelay: '50ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('pan-canvas')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-blue-400" />
                        </button>
                        <span className="text-white/70">Pan Canvas</span>
                      </div>
                      <kbd className="px-2 py-1 bg-black/30 rounded text-white/60 border border-white/10">Space + Drag</kbd>
                    </div>
                    
                    <div className="flex justify-between items-center transition-all duration-300" style={{ transitionDelay: '100ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('zoom')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-blue-400" />
                        </button>
                        <span className="text-white/70">Zoom In/Out</span>
                      </div>
                      <span className="text-white font-mono bg-[rgba(255,255,255,0.1)] px-2 py-0.5 rounded">Ctrl + Scroll</span>
                    </div>
                    <div className="flex justify-between items-center transition-opacity duration-300" style={{ transitionDelay: '100ms' }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('node-search')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-blue-400" />
                        </button>
                        <span className="text-white/70">Search Nodes</span>
                      </div>
                      <kbd className="px-2 py-1 bg-black/30 rounded text-white/60 border border-white/10">Ctrl+F</kbd>
                    </div>
                    <div className="flex justify-between items-center transition-opacity duration-300" style={{ transitionDelay: '150ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('add-connection')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-blue-400" />
                        </button>
                        <span className="text-white/70">Connect Nodes</span>
                      </div>
                      <kbd className="px-2 py-1 bg-black/30 rounded text-white/60 border border-white/10">Click + Drag</kbd>
                    </div>
                    <div className="flex justify-between items-center transition-opacity duration-300" style={{ transitionDelay: '200ms' }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('delete-node')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-red-400" />
                        </button>
                        <span className="text-white/70">Delete Node</span>
                      </div>
                      <span className="text-white font-mono bg-[rgba(255,255,255,0.1)] px-2 py-0.5 rounded">Delete / Backspace</span>
                    </div>
                    <div className="flex justify-between items-center transition-opacity duration-300" style={{ transitionDelay: '250ms' }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('run-workflow')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-purple-400" />
                        </button>
                        <span className="text-white/70">Run Workflow</span>
                      </div>
                      <span className="text-white font-mono bg-[rgba(255,255,255,0.1)] px-2 py-0.5 rounded">Ctrl + Enter</span>
                    </div>
                    <div className="flex justify-between items-center transition-opacity duration-300" style={{ transitionDelay: '300ms' }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('toggle-controls')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-orange-400" />
                        </button>
                        <span className="text-white/70">Toggle Controls</span>
                      </div>
                      <span className="text-white font-mono bg-[rgba(255,255,255,0.1)] px-2 py-0.5 rounded">K</span>
                    </div>
                    <div className="flex justify-between items-center transition-opacity duration-300" style={{ transitionDelay: '350ms' }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('close-panels')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-teal-400" />
                        </button>
                        <span className="text-white/70">Close Panels</span>
                      </div>
                      <span className="text-white font-mono bg-[rgba(255,255,255,0.1)] px-2 py-0.5 rounded">Esc</span>
                    </div>
                    <div className="flex justify-between items-center transition-all duration-300" style={{ transitionDelay: '400ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="flex items-center">
                        <button 
                          onClick={() => handleOpenTutorial('close-panels')}
                          className="mr-2 text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10 tutorial-button animate-pulse-subtle"
                          title="Watch Tutorial"
                        >
                          <VideoIcon size={14} className="text-blue-400" />
                        </button>
                        <span className="text-white/70">Close Panels</span>
                      </div>
                      <kbd className="px-2 py-1 bg-black/30 rounded text-white/60 border border-white/10">Esc</kbd>
                    </div>
                    
                    <div className="flex justify-between items-center transition-all duration-300" style={{ transitionDelay: '500ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="flex items-center">
                        <span className="text-white/70">Toggle Debug Info</span>
                      </div>
                      <kbd className="px-2 py-1 bg-black/30 rounded text-white/60 border border-white/10">Alt+D</kbd>
                    </div>
                    
                    <div className="flex justify-between items-center transition-all duration-300" style={{ transitionDelay: '550ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="flex items-center">
                        <span className="text-white/70">Toggle Guide Text</span>
                      </div>
                      <kbd className="px-2 py-1 bg-black/30 rounded text-white/60 border border-white/10">Alt+G</kbd>
                    </div>
                  </div>
                </div>
                
                <div className="mt-8 animate-in" style={{ animationDelay: '200ms' }}>
                  <h3 className="text-white text-md font-semibold mb-3 flex items-center">
                    <ChevronRight size={16} className="text-blue-400 mr-1" />
                    Node Types
                  </h3>
                  <div className="space-y-3 ml-2">
                    <div className="flex items-center transition-all duration-300" style={{ transitionDelay: '450ms', opacity: showControlsPanel ? 1 : 0 }}>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mr-3 shadow-md">
                        <BrainCircuit size={16} className="text-white" />
                      </div>
                      <div>
                        <div className="text-white font-medium">Text/LLM</div>
                        <div className="text-white/60 text-xs">Processes inputs using AI models</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center transition-opacity duration-300" style={{ transitionDelay: '50ms' }}>
                      <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                      <span className="text-white/70">Image</span>
                    </div>
                    <div className="flex items-center transition-opacity duration-300" style={{ transitionDelay: '100ms' }}>
                      <div className="w-3 h-3 rounded-full bg-purple-500 mr-2"></div>
                      <span className="text-white/70">Video</span>
                    </div>
                    <div className="flex items-center transition-opacity duration-300" style={{ transitionDelay: '150ms' }}>
                      <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
                      <span className="text-white/70">Utility</span>
                    </div>
                  </div>
                </div>
                
                {/* Debug Information */}
                {showDebugInfo && (
                  <div className="mt-8 border-t border-white/10 pt-4 animate-in">
                    <h3 className="text-white text-md font-semibold mb-3 flex items-center">
                      <div className="w-4 h-4 bg-blue-500/30 rounded-sm flex items-center justify-center text-xs font-mono mr-2">D</div>
                      Debug Information
                    </h3>
                    <div className="bg-black/30 rounded-md p-3 font-mono text-xs max-h-[200px] overflow-y-auto">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-white/50">Panel Position:</div>
                        <div className="text-blue-400 font-semibold">
                          TOP (FIXED)
                        </div>
                        
                        <div className="text-white/50">Position Value:</div>
                        <div className="text-yellow-400">
                          12% from top
                        </div>
                        
                        <div className="text-white/50">Position Class:</div>
                        <div className="text-orange-400">{getPanelVerticalPositionClass()}</div>
                        
                        <div className="text-white/50">Tutorial Modal:</div>
                        <div className={showTutorialModal ? 'text-green-400' : 'text-red-400'}>
                          {showTutorialModal ? 'OPEN' : 'CLOSED'}
                        </div>
                        
                        <div className="text-white/50">Current Tutorial:</div>
                        <div className="text-cyan-400">
                          {currentTutorial ? currentTutorial.id : 'NONE'}
                        </div>
                        
                        <div className="text-white/50">Zoom Level:</div>
                        <div className="text-orange-400">
                          {(zoom * 100).toFixed(0)}%
                        </div>
                        
                        <div className="text-white/50">Canvas Offset:</div>
                        <div className="text-purple-400">
                          X: {viewportOffset.x.toFixed(0)}, Y: {viewportOffset.y.toFixed(0)}
                        </div>
                        
                        <div className="text-white/50">Node Count:</div>
                        <div className="text-green-400">
                          {nodes.length}
                        </div>
                        
                        <div className="text-white/50">Connection Count:</div>
                        <div className="text-blue-400">
                          {connections.length}
                        </div>
                        
                        <div className="text-white/50">Selected Node:</div>
                        <div className="text-amber-400">
                          {selectedNodeId !== null ? `#${selectedNodeId}` : 'NONE'}
                        </div>
                        
                        <div className="text-white/50">Is Running:</div>
                        <div className={isRunning ? 'text-green-400' : 'text-red-400'}>
                          {isRunning ? 'YES' : 'NO'}
                        </div>
                        
                        <div className="text-white/50">Bottom Nav:</div>
                        <div className="text-orange-400">
                          bottom-6 (24px from bottom)
                        </div>
                        
                        <div className="text-white/50">Guide Text:</div>
                        <div className="text-red-400 flex items-center justify-between">
                          <span>bottom-4 (16px from bottom)</span>
                          <button 
                            onClick={() => setShowGuideText(prev => !prev)}
                            className={`ml-2 px-2 py-0.5 rounded text-xs ${showGuideText ? 'bg-red-500/30 text-white' : 'bg-green-500/30 text-white'}`}
                          >
                            {showGuideText ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        
                        <div className="text-white/50">Panel Bottom Space:</div>
                        <div className="text-green-400">
                          Sufficient
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Grid background - always visible regardless of zoom */}
          <div className="absolute inset-0 pointer-events-none" 
            style={{
              backgroundSize: '24px 24px',
              backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
              backgroundPosition: 'center center'
            }}
          />
          
          {/* Canvas content container - scales with zoom */}
          <div 
            ref={canvasContainerRef}
            className="absolute inset-0 origin-center canvas-content"
            style={canvasContainerStyle}
          >
            {/* Node containers rendered below nodes */}
            {renderContainers()}
            
            {/* Connection lines */}
            {renderConnections()}
            
            {/* Nodes */}
            {nodes.map(node => renderNode(node))}
            
            {/* Selection rectangle */}
            {isSelecting && selectionStart && selectionEnd && (
              <div
                className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
                style={{
                  left: Math.min(selectionStart.x, selectionEnd.x),
                  top: Math.min(selectionStart.y, selectionEnd.y),
                  width: Math.abs(selectionEnd.x - selectionStart.x),
                  height: Math.abs(selectionEnd.y - selectionStart.y),
                  zIndex: 30
                }}
              />
            )}
          </div>
          
          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[#E0E0E0] text-center">
              <div className="max-w-xs">
                <p className="mb-4">Your canvas is empty. Use the Agent Library panel to add nodes or the menu at the bottom to create your AI workflow.</p>
              </div>
            </div>
          )}
          
          {/* Workflow execution indicator */}
          {isRunning && currentExecutingNodeId && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-[rgba(20,20,20,0.95)] border border-white/10 rounded-lg px-4 py-2 z-50 flex items-center space-x-2">
              <RotateCw size={16} className="animate-spin text-white/60" />
              <span>Processing node: {nodes.find(n => n.id === currentExecutingNodeId)?.title || 'Node'}</span>
            </div>
          )}
          
          {/* Node configuration panel */}
          {showNodeConfig && selectedNodeId !== null && (
            <NodeConfigPanel
              node={nodes.find(n => n.id === selectedNodeId) || {
                id: 0,
                type: 'unknown',
                title: 'Unknown',
                inputs: [],
                outputs: []
              }}
              onClose={handleCloseConfig}
              onUpdateNode={handleUpdateNode}
            />
          )}
          
          {/* Node search container */}
          {showNodeSearch && searchPosition && (
            <div 
              className="absolute z-50 bg-[#1A1A1A] border border-[rgba(255,255,255,0.1)] rounded-lg shadow-xl w-72 transform-gpu transition-all duration-200 animate-in node-search-container"
              style={{
                left: `${searchPosition.x * zoom + viewportOffset.x}px`,
                top: `${searchPosition.y * zoom + viewportOffset.y}px`,
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Input pin for the search container - styled like standard input pins */}
              <div 
                className="absolute -left-3 top-[27px] w-6 h-6 flex items-center justify-center search-input-pin"
                id="search-container-input-pin"
                data-testid="search-input-pin"
                style={{ transform: 'translateY(-50%)' }}
              >
                <div className="w-4 h-4 rounded-full bg-[#333333] border-2 border-[rgba(255,255,255,0.5)]"></div>
              </div>
              
              <div className="p-2 border-b border-[rgba(255,255,255,0.1)]">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                    <Search size={16} className="text-white/50" />
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search for nodes..."
                    className="w-full bg-[#252525] text-white py-2 pl-9 pr-3 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                </div>
              </div>
              
              <div className="max-h-60 overflow-y-auto py-1">
                {searchResults.length > 0 ? (
                  searchResults.map((template, index) => (
                    <div
                      key={template.id}
                      className={`px-3 py-2 cursor-pointer flex items-center ${
                        index === selectedSearchResultIndex ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                      onClick={() => handleSelectSearchResult(template)}
                      onMouseEnter={() => setSelectedSearchResultIndex(index)}
                    >
                      <div className="mr-2 text-white/70">{template.icon}</div>
                      <div>
                        <div className="text-sm font-medium text-white">{template.title}</div>
                        <div className="text-xs text-white/50">{template.description}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-white/50 text-sm">
                    No matching nodes found
                  </div>
                )}
              </div>
              <div className="px-3 py-2 border-t border-[rgba(255,255,255,0.1)] text-xs text-white/50 flex justify-between items-center">
                <span>↑↓ to navigate</span>
                <span>Enter to select</span>
                <span>Esc to cancel</span>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Floating Menu Island with Node Categories */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50 floating-menu-island">
        <div className="bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] py-3 px-6 rounded-full border border-[rgba(255,255,255,0.1)] shadow-[0_4px_30px_rgba(0,0,0,0.1)] flex items-center space-x-6 hover:shadow-[0_4px_30px_rgba(0,0,0,0.2)] transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] hover:scale-[1.02]">
          {/* Language Models Button */}
          <div className="flex flex-col">
          <button 
            onClick={() => handleAddNodeFromPanel({
              id: 'llm-gpt4',
              title: 'GPT-4 Agent',
              icon: <BrainCircuit size={16} />,
              description: 'Advanced language model with strong reasoning capabilities',
              type: 'llm',
              category: 'Language Models',
              inputs: [
                { id: "prompt", type: "text", label: "Text Input" },
                { id: "style", type: "parameter", label: "Style Parameters" }
              ],
              outputs: [
                { id: "text", type: "text", label: "Refined Prompt" }
              ]
            })}
              className="flex items-center space-x-2 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95 mb-1"
          >
            <BrainCircuit size={16} className="text-yellow-400" />
              <span className="font-medium text-sm">GPT-4</span>
          </button>
            
            <button 
              onClick={() => handleAddNodeFromPanel({
                id: 'llm-gemini',
                title: 'Gemini 2.0 Flash',
                icon: <BrainCircuit size={16} />,
                description: 'Fast and efficient language model with excellent reasoning capabilities',
                type: 'llm',
                category: 'Language Models',
                inputs: [
                  { id: "prompt", type: "text", label: "Text Input" },
                  { id: "style", type: "parameter", label: "Style Parameters" }
                ],
                outputs: [
                  { id: "text", type: "text", label: "Refined Prompt" }
                ]
              })}
              className="flex items-center space-x-2 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95"
            >
              <BrainCircuit size={16} className="text-blue-400" />
              <span className="font-medium text-sm">Gemini 2.0</span>
            </button>
          </div>
          
          {/* Image Models Button */}
          <button 
            onClick={() => handleAddNodeFromPanel({
              id: 'image-sd',
              title: 'Stable Diffusion',
              icon: <Image size={16} />,
              description: 'High-quality image generation from text prompts',
              type: 'image',
              category: 'Image Generation',
              inputs: [
                { id: "prompt", type: "text", label: "Text Prompt" },
                { id: "style", type: "parameter", label: "Style Settings" }
              ],
              outputs: [
                { id: "image", type: "image", label: "Generated Image" }
              ]
            })}
            className="flex items-center space-x-2 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95"
          >
            <Image size={16} className="text-green-400" />
            <span className="font-medium text-sm">Image</span>
          </button>
          
          {/* Video Models Button */}
          <button 
            onClick={() => handleAddNodeFromPanel({
              id: 'video-gen2',
              title: 'Runway Gen-2',
              icon: <Video size={16} />,
              description: 'Transform images into dynamic video sequences',
              type: 'video',
              category: 'Video Generation',
              inputs: [
                { id: "image", type: "image", label: "Image Input" },
                { id: "motion", type: "parameter", label: "Motion Parameters" }
              ],
              outputs: [
                { id: "video", type: "video", label: "Generated Video" }
              ]
            })}
            className="flex items-center space-x-2 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95"
          >
            <Video size={16} className="text-blue-400" />
            <span className="font-medium text-sm">Video</span>
          </button>
          
          {/* Divider */}
          <div className="h-5 w-px bg-white/10"></div>
          
          {/* Canvas Controls */}
          <button 
            onClick={handleZoomIn}
            className="flex items-center space-x-1 p-1.5 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95 text-white"
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          
          <button 
            onClick={handleZoomOut}
            className="flex items-center space-x-1 p-1.5 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95 text-white"
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          
          <button 
            onClick={handleResetView}
            className="flex items-center space-x-1 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95 text-white"
            title="Reset View"
          >
            <span className="text-xs font-medium">Reset View</span>
          </button>
          
          {/* Divider */}
          <div className="h-5 w-px bg-white/10"></div>
          
          {/* Clear Canvas Button */}
          <button 
            onClick={handleClearCanvas}
            className="flex items-center space-x-2 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] active:scale-95 text-white"
            title="Clear Canvas"
          >
            <Trash2 size={16} className="text-white" />
            <span className="font-medium text-sm">Clear</span>
          </button>
          
          {/* Run Workflow Button */}
          <button 
            onClick={runWorkflow}
            disabled={isRunning || nodes.length === 0}
            className={`flex items-center space-x-2 py-1 px-3 rounded-lg ${
              isRunning || nodes.length === 0 
                ? 'bg-white/20 text-white/50 cursor-not-allowed' 
                : 'bg-white text-primary-bg hover:bg-white/90 active:scale-95'
            } transition-all duration-300`}
          >
            {isRunning ? <RotateCw size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            <span className="font-medium text-sm">{isRunning ? 'Running...' : 'Run'}</span>
          </button>
          
          {/* Zoom Level Indicator */}
          <div className="bg-[rgba(255,255,255,0.08)] px-2 py-1 rounded-lg text-xs text-white">
            {Math.round(zoom * 100)}%
          </div>
        </div>
      </div>
      
      {/* Node containers are already rendered inside the canvas content */}
    </div>
  );
};

export default NodeEditor;