import { useState, useRef, useCallback, useEffect } from 'react';
import { 
  ChatMessage, 
  ImageGenerationSession, 
  AttachedFile, 
  RecentFile, 
  CanvasStyle,
  EditMode,
  ImageEditHistoryItem,
  SegmentationPoint,
  SegmentationMask
} from '../core/types';
import { SAM2SegmentationEngine } from '../core/segmentation.engine';
import { useImagePreloader } from '../core/utils';

export const useImageStudio = () => {
  // Session Management
  const [sessions, setSessions] = useState<ImageGenerationSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([]);

  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gpt-4o' | 'flux-kontext'>('flux-kontext');

  // File Management
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [showRecentFiles, setShowRecentFiles] = useState(false);

  // Image Generation Settings
  const [seed, setSeed] = useState('');
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [numImages, setNumImages] = useState(1);
  const [enableSeed, setEnableSeed] = useState(false);

  // Style Management
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [styleReferenceImage, setStyleReferenceImage] = useState<File | null>(null);
  const [styleImagePreview, setStyleImagePreview] = useState<string | null>(null);
  const [savedStyle, setSavedStyle] = useState<CanvasStyle | null>(null);

  // Full Screen Image Viewer
  const [fullScreenImageUrl, setFullScreenImageUrl] = useState<string | null>(null);
  const [showEditTools, setShowEditTools] = useState(false);
  const [isAnimatingTools, setIsAnimatingTools] = useState(false);
  const [isClosingTools, setIsClosingTools] = useState(false);
  const [selectedEditMode, setSelectedEditMode] = useState<EditMode | null>(null);
  const [imageEditText, setImageEditText] = useState('');
  const [imageEditHistory, setImageEditHistory] = useState<ImageEditHistoryItem[]>([]);

  // Segmentation State
  const segmenterRef = useRef<SAM2SegmentationEngine | null>(null);
  const [segmentationPoints, setSegmentationPoints] = useState<SegmentationPoint[]>([]);
  const [segmentationMask, setSegmentationMask] = useState<SegmentationMask | null>(null);
  const [isSegmentationLoading, setIsSegmentationLoading] = useState(false);
  const [segmentationInitialized, setSegmentationInitialized] = useState(false);

  // Chat and Editing
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [likedMessages, setLikedMessages] = useState<Set<string>>(new Set());
  const [dislikedMessages, setDislikedMessages] = useState<Set<string>>(new Set());

  // Session deletion
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState('');

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Custom hooks
  const { preloadAllConversationImages } = useImagePreloader();

  // Initialize segmentation engine
  useEffect(() => {
    const initSegmentation = async () => {
      if (!segmenterRef.current) {
        segmenterRef.current = new SAM2SegmentationEngine({
          modelSize: 'tiny',
          useGPU: true,
          threshold: 0.5
        });
        
        const success = await segmenterRef.current.initialize();
        setSegmentationInitialized(success);
      }
    };

    initSegmentation();
  }, []);

  // Session Management Functions
  const handleNewSession = useCallback(() => {
    const newSessionId = `session_${Date.now()}`;
    const newSession: ImageGenerationSession = {
      id: newSessionId,
      title: 'New Conversation',
      timestamp: Date.now(),
      messages: [],
      settings: {
        model: selectedModel,
        seed: enableSeed ? seed : undefined,
        guidanceScale,
        aspectRatio,
        numImages
      }
    };

    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSessionId);
    setCurrentMessages([]);
    setShowHistory(false);
  }, [selectedModel, seed, enableSeed, guidanceScale, aspectRatio, numImages]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      handleNewSession();
    }
    setSessionToDelete(null);
  }, [currentSessionId, handleNewSession]);

  const handleSaveSessionTitle = useCallback(() => {
    if (editingTitleText.trim()) {
      setSessions(prev => prev.map(session => 
        session.id === currentSessionId 
          ? { ...session, title: editingTitleText.trim() }
          : session
      ));
    }
    setIsEditingTitle(false);
    setEditingTitleText('');
  }, [editingTitleText, currentSessionId]);

  // File Management Functions
  const handleFileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const newFile: AttachedFile = {
      id: `file_${Date.now()}`,
      name: file.name,
      type: file.type,
      fileObject: file
    };

    setAttachedFiles(prev => [...prev, newFile]);
    
    // Add to recent files
    const recentFile: RecentFile = {
      id: newFile.id,
      name: file.name,
      type: file.type,
      size: file.size,
      lastUsed: Date.now()
    };
    
    setRecentFiles(prev => [recentFile, ...prev.filter(f => f.name !== file.name)].slice(0, 10));
    
    if (event.target) {
      event.target.value = '';
    }
  }, []);

  const handleRemoveAttachedFile = useCallback((fileId: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  // Style Management Functions
  const handleStyleImageUpload = useCallback(() => {
    styleFileInputRef.current?.click();
  }, []);

  const handleStyleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setStyleReferenceImage(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setStyleImagePreview(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);

    if (event.target) {
      event.target.value = '';
    }
  }, []);

  const handleClearStyle = useCallback(() => {
    setStyleReferenceImage(null);
    setStyleImagePreview(null);
    setSavedStyle(null);
  }, []);

  const handleStyleSave = useCallback(() => {
    if (styleReferenceImage) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          setSavedStyle({
            type: 'image',
            content: reader.result as string,
            name: styleReferenceImage.name
          });
          setIsStyleModalOpen(false);
        }
      };
      reader.readAsDataURL(styleReferenceImage);
    }
  }, [styleReferenceImage]);

  // Chat Functions
  const handleEditUserMessage = useCallback((messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditText(currentText);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingMessageId && editText.trim()) {
      setCurrentMessages(prev => prev.map(msg =>
        msg.id === editingMessageId
          ? { ...msg, text: editText.trim() }
          : msg
      ));
    }
    setEditingMessageId(null);
    setEditText('');
  }, [editingMessageId, editText]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditText('');
  }, []);

  const handleCopy = useCallback((textToCopy: string | undefined, messageId: string) => {
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  }, []);

  const handleLike = useCallback((messageId: string) => {
    setLikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
        setDislikedMessages(prevDisliked => {
          const newDisliked = new Set(prevDisliked);
          newDisliked.delete(messageId);
          return newDisliked;
        });
      }
      return newSet;
    });
  }, []);

  const handleDislike = useCallback((messageId: string) => {
    setDislikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
        setLikedMessages(prevLiked => {
          const newLiked = new Set(prevLiked);
          newLiked.delete(messageId);
          return newLiked;
        });
      }
      return newSet;
    });
  }, []);

  // Segmentation Functions
  const initializeSegmentation = useCallback(async () => {
    if (!segmenterRef.current) {
      segmenterRef.current = new SAM2SegmentationEngine({
        modelSize: 'tiny',
        useGPU: true,
        threshold: 0.5
      });
      const success = await segmenterRef.current.initialize();
      setSegmentationInitialized(success);
    }
  }, []);

  const handleSegmentationClick = useCallback(async (point: { x: number; y: number }) => {
    if (!segmentationInitialized || !segmenterRef.current) return;

    setIsSegmentationLoading(true);
    try {
      const mask = await segmenterRef.current.generateRealSegmentation(point);
      setSegmentationMask(mask);
      
      const newPoint: SegmentationPoint = {
        x: point.x,
        y: point.y,
        type: 1, // positive point
        id: `point_${Date.now()}`
      };
      setSegmentationPoints(prev => [...prev, newPoint]);
    } catch (error) {
      console.error('Segmentation error:', error);
    } finally {
      setIsSegmentationLoading(false);
    }
  }, [segmentationInitialized]);

  const clearSegmentationPoints = useCallback(() => {
    setSegmentationPoints([]);
    setSegmentationMask(null);
  }, []);

  // Utility Functions
  const generateRandomSeed = useCallback(() => {
    setSeed(Math.floor(Math.random() * 1000000).toString());
  }, []);

  const toggleAttachMenu = useCallback(() => {
    setIsAttachMenuOpen(prev => !prev);
    setShowRecentFiles(false);
  }, []);

  const toggleSettingsMenu = useCallback(() => {
    setIsSettingsMenuOpen(prev => !prev);
  }, []);

  const toggleModelDropdown = useCallback(() => {
    setIsModelDropdownOpen(prev => !prev);
  }, []);

  const toggleHistory = useCallback(() => {
    setShowHistory(prev => !prev);
  }, []);

  const toggleStyleModal = useCallback(() => {
    setIsStyleModalOpen(prev => !prev);
  }, []);

  return {
    // State
    sessions,
    currentSessionId,
    currentMessages,
    isGenerating,
    isAttachMenuOpen,
    isSettingsMenuOpen,
    isModelDropdownOpen,
    showHistory,
    selectedModel,
    attachedFiles,
    recentFiles,
    showRecentFiles,
    seed,
    guidanceScale,
    aspectRatio,
    numImages,
    enableSeed,
    isStyleModalOpen,
    styleReferenceImage,
    styleImagePreview,
    savedStyle,
    fullScreenImageUrl,
    showEditTools,
    isAnimatingTools,
    isClosingTools,
    selectedEditMode,
    imageEditText,
    imageEditHistory,
    segmentationPoints,
    segmentationMask,
    isSegmentationLoading,
    segmentationInitialized,
    editingMessageId,
    editText,
    copiedMessageId,
    likedMessages,
    dislikedMessages,
    sessionToDelete,
    isEditingTitle,
    editingTitleText,

    // Setters
    setSessions,
    setCurrentSessionId,
    setCurrentMessages,
    setIsGenerating,
    setSelectedModel,
    setSeed,
    setGuidanceScale,
    setAspectRatio,
    setNumImages,
    setEnableSeed,
    setFullScreenImageUrl,
    setShowEditTools,
    setIsAnimatingTools,
    setIsClosingTools,
    setSelectedEditMode,
    setImageEditText,
    setImageEditHistory,
    setSegmentationPoints,
    setSegmentationMask,
    setEditText,
    setSessionToDelete,
    setIsEditingTitle,
    setEditingTitleText,
    setShowRecentFiles,

    // Handlers
    handleNewSession,
    handleDeleteSession,
    handleSaveSessionTitle,
    handleFileUpload,
    handleFileSelected,
    handleRemoveAttachedFile,
    handleStyleImageUpload,
    handleStyleFileSelected,
    handleClearStyle,
    handleStyleSave,
    handleEditUserMessage,
    handleSaveEdit,
    handleCancelEdit,
    handleCopy,
    handleLike,
    handleDislike,
    initializeSegmentation,
    handleSegmentationClick,
    clearSegmentationPoints,
    generateRandomSeed,
    toggleAttachMenu,
    toggleSettingsMenu,
    toggleModelDropdown,
    toggleHistory,
    toggleStyleModal,

    // Refs
    fileInputRef,
    styleFileInputRef,
    abortControllerRef,
    segmenterRef
  };
}; 