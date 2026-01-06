import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Film, Video, Camera, Music, Tv, Settings, Folder } from 'lucide-react';
import { WORKFLOW_PRESETS, WorkflowType, WorkflowPreset, getAspectRatio } from '../config/workflowPresets';

interface ProjectCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (projectSettings: ProjectSettings, sequenceSettings: SequenceSettings, workflowSettings: WorkflowSettings) => void;
  isCreating: boolean;
}

export interface ProjectSettings {
  // Essential
  name: string;

  // Color Management
  colorSpace: 'rec709' | 'rec2020' | 'dci-p3' | 'srgb';
  workingColorDepth: '8bit' | '10bit' | '16bit';

  // Performance Profile
  targetResolutionTier: 'sd' | 'hd' | '4k' | '8k';
  playbackQuality: 'draft' | 'preview' | 'full';

  // Media Management
  importBehavior: 'reference' | 'copy' | 'copy-transcode';
  fileOrganization: 'original' | 'by-date' | 'by-type';

  // Workspace
  workspaceLayout: 'standard' | 'advanced' | 'minimalist' | 'review';

  // Audio Engine
  masterSampleRate: 44100 | 48000 | 96000;
  masterBitDepth: 16 | 24;
}

export interface SequenceSettings {
  // Editing
  editingMode: string;
  timebase: number; // frames per second

  // Video
  frameWidth: number;
  frameHeight: number;
  pixelAspectRatio: string;
  fields: string;
  videoDisplayFormat: string;

  // Audio
  channelFormat: string;
  numberOfChannels: number;
  sampleRate: number;
  audioDisplayFormat: string;

  // Video Previews
  previewFileFormat: string;
  codec: string;
  previewWidth: number;
  previewHeight: number;
  maximumBitDepth: boolean;
  maximumRenderQuality: boolean;
  compositeInLinearColor: boolean;
}

export interface WorkflowSettings {
  workflowType: WorkflowType;

  // Storage & Performance
  storage: {
    autoSaveInterval: number;
    maxUndoHistory: number;
    proxyMediaResolution: 'none' | '480p' | '720p' | '1080p';
    cacheStrategy: 'minimal' | 'balanced' | 'aggressive';
    backgroundRendering: boolean;
    copyToProjectFolder: boolean;
    organizeByType: boolean;
  };

  // AI & Automation
  ai: {
    thumbnailGeneration: 'auto' | 'manual';
    waveformGeneration: boolean;
    metadataExtraction: boolean;
    aiTagging: boolean;
    autoSceneDetection: boolean;
    speechToText: boolean;
    autoSubtitles: boolean;
    smartReframing: boolean;
    hardwareAcceleration: 'auto' | 'nvidia' | 'cpu-only';
    renderQueuePriority: 'high' | 'normal' | 'low';
  };

  // Export
  export: {
    defaultRenderPreset: 'h264-high' | 'h264-medium' | 'h265-high' | 'prores-422' | 'prores-422hq' | 'dnxhd';
    outputDestination: string;
  };
}

type StepType = 'project' | 'workflow' | 'sequence' | 'storage' | 'ai' | 'export' | 'review';

const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({
  isOpen,
  onClose,
  onCreateProject,
  isCreating
}) => {
  // Modal state
  const [currentStep, setCurrentStep] = useState<StepType>('project');
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType | null>(null);

  // Project Settings State
  const [projectName, setProjectName] = useState('Untitled');

  // Color Management
  const [colorSpace, setColorSpace] = useState<'rec709' | 'rec2020' | 'dci-p3' | 'srgb'>('rec709');
  const [workingColorDepth, setWorkingColorDepth] = useState<'8bit' | '10bit' | '16bit'>('8bit');

  // Performance Profile
  const [targetResolutionTier, setTargetResolutionTier] = useState<'sd' | 'hd' | '4k' | '8k'>('hd');
  const [playbackQuality, setPlaybackQuality] = useState<'draft' | 'preview' | 'full'>('preview');

  // Media Management
  const [importBehavior, setImportBehavior] = useState<'reference' | 'copy' | 'copy-transcode'>('reference');
  const [fileOrganization, setFileOrganization] = useState<'original' | 'by-date' | 'by-type'>('by-type');

  // Workspace
  const [workspaceLayout, setWorkspaceLayout] = useState<'standard' | 'advanced' | 'minimalist' | 'review'>('standard');

  // Audio Engine
  const [masterSampleRate, setMasterSampleRate] = useState<44100 | 48000 | 96000>(48000);
  const [masterBitDepth, setMasterBitDepth] = useState<16 | 24>(16);

  // Sequence Settings State
  const [editingMode, setEditingMode] = useState('Custom');
  const [timebase, setTimebase] = useState(29.97);
  const [frameWidth, setFrameWidth] = useState(1920);
  const [frameHeight, setFrameHeight] = useState(1080);
  const [pixelAspectRatio, setPixelAspectRatio] = useState('Square Pixels (1.0)');
  const [fields, setFields] = useState('No Fields (Progressive Scan)');
  const [seqVideoDisplayFormat, setSeqVideoDisplayFormat] = useState('29.97 fps Drop-Frame Timecode');
  const [channelFormat, setChannelFormat] = useState('Stereo');
  const [numberOfChannels, setNumberOfChannels] = useState(2);
  const [sampleRate, setSampleRate] = useState(48000);
  const [seqAudioDisplayFormat, setSeqAudioDisplayFormat] = useState('Audio Samples');
  const [previewFileFormat, setPreviewFileFormat] = useState('QuickTime');
  const [codec, setCodec] = useState('H.264');
  const [previewWidth, setPreviewWidth] = useState(1920);
  const [previewHeight, setPreviewHeight] = useState(1080);
  const [maximumBitDepth, setMaximumBitDepth] = useState(false);
  const [maximumRenderQuality, setMaximumRenderQuality] = useState(true);
  const [compositeInLinearColor, setCompositeInLinearColor] = useState(true);

  // Storage Settings State
  const [autoSaveInterval, setAutoSaveInterval] = useState(60);
  const [maxUndoHistory, setMaxUndoHistory] = useState(100);
  const [proxyMediaResolution, setProxyMediaResolution] = useState<'none' | '480p' | '720p' | '1080p'>('720p');
  const [cacheStrategy, setCacheStrategy] = useState<'minimal' | 'balanced' | 'aggressive'>('balanced');
  const [backgroundRendering, setBackgroundRendering] = useState(true);
  const [copyToProjectFolder, setCopyToProjectFolder] = useState(false);
  const [organizeByType, setOrganizeByType] = useState(true);

  // AI Settings State
  const [thumbnailGeneration, setThumbnailGeneration] = useState<'auto' | 'manual'>('auto');
  const [waveformGeneration, setWaveformGeneration] = useState(true);
  const [metadataExtraction, setMetadataExtraction] = useState(true);
  const [aiTagging, setAiTagging] = useState(true);
  const [autoSceneDetection, setAutoSceneDetection] = useState(true);
  const [speechToText, setSpeechToText] = useState(true);
  const [autoSubtitles, setAutoSubtitles] = useState(true);
  const [smartReframing, setSmartReframing] = useState(false);
  const [hardwareAcceleration, setHardwareAcceleration] = useState<'auto' | 'nvidia' | 'cpu-only'>('auto');
  const [renderQueuePriority, setRenderQueuePriority] = useState<'high' | 'normal' | 'low'>('normal');

  // Export Settings State
  const [defaultRenderPreset, setDefaultRenderPreset] = useState<'h264-high' | 'h264-medium' | 'h265-high' | 'prores-422' | 'prores-422hq' | 'dnxhd'>('h264-high');
  const [outputDestination, setOutputDestination] = useState('/renders');

  // Apply workflow preset when selected
  useEffect(() => {
    if (selectedWorkflow && selectedWorkflow !== 'custom') {
      const preset = WORKFLOW_PRESETS[selectedWorkflow];
      if (preset) {
        // Apply sequence settings
        setTimebase(preset.sequence.timebase);
        setFrameWidth(preset.sequence.frameWidth);
        setFrameHeight(preset.sequence.frameHeight);
        setPixelAspectRatio(preset.sequence.pixelAspectRatio);
        setFields(preset.sequence.fields);
        setSampleRate(preset.sequence.sampleRate);
        setChannelFormat(preset.sequence.channelFormat);
        setCodec(preset.sequence.codec);
        setPreviewWidth(preset.sequence.frameWidth);
        setPreviewHeight(preset.sequence.frameHeight);

        // Apply storage settings
        setAutoSaveInterval(preset.storage.autoSaveInterval);
        setMaxUndoHistory(preset.storage.maxUndoHistory);
        setProxyMediaResolution(preset.storage.proxyMediaResolution);
        setCacheStrategy(preset.storage.cacheStrategy);
        setBackgroundRendering(preset.storage.backgroundRendering);
        setCopyToProjectFolder(preset.storage.copyToProjectFolder);
        setOrganizeByType(preset.storage.organizeByType);

        // Apply AI settings
        setThumbnailGeneration(preset.ai.thumbnailGeneration);
        setWaveformGeneration(preset.ai.waveformGeneration);
        setMetadataExtraction(preset.ai.metadataExtraction);
        setAiTagging(preset.ai.aiTagging);
        setAutoSceneDetection(preset.ai.autoSceneDetection);
        setSpeechToText(preset.ai.speechToText);
        setAutoSubtitles(preset.ai.autoSubtitles);
        setSmartReframing(preset.ai.smartReframing);
        setHardwareAcceleration(preset.ai.hardwareAcceleration);
        setRenderQueuePriority(preset.ai.renderQueuePriority);

        // Apply export settings
        setDefaultRenderPreset(preset.export.defaultRenderPreset);
        setOutputDestination(preset.export.outputDestination);
      }
    }
  }, [selectedWorkflow]);

  const getStepNumber = (step: StepType): number => {
    const steps: StepType[] = ['project', 'workflow', 'sequence', 'storage', 'ai', 'export', 'review'];
    return steps.indexOf(step) + 1;
  };

  const handleNext = () => {
    if (currentStep === 'project') setCurrentStep('workflow');
    else if (currentStep === 'workflow') setCurrentStep('sequence');
    else if (currentStep === 'sequence') setCurrentStep('storage');
    else if (currentStep === 'storage') setCurrentStep('ai');
    else if (currentStep === 'ai') setCurrentStep('export');
    else if (currentStep === 'export') setCurrentStep('review');
  };

  const handleBack = () => {
    if (currentStep === 'review') setCurrentStep('export');
    else if (currentStep === 'export') setCurrentStep('ai');
    else if (currentStep === 'ai') setCurrentStep('storage');
    else if (currentStep === 'storage') setCurrentStep('sequence');
    else if (currentStep === 'sequence') setCurrentStep('workflow');
    else if (currentStep === 'workflow') setCurrentStep('project');
  };

  const handleCreate = () => {
    const projectSettings: ProjectSettings = {
      name: projectName,
      colorSpace,
      workingColorDepth,
      targetResolutionTier,
      playbackQuality,
      importBehavior,
      fileOrganization,
      workspaceLayout,
      masterSampleRate,
      masterBitDepth
    };

    const sequenceSettings: SequenceSettings = {
      editingMode,
      timebase,
      frameWidth,
      frameHeight,
      pixelAspectRatio,
      fields,
      videoDisplayFormat: seqVideoDisplayFormat,
      channelFormat,
      numberOfChannels,
      sampleRate,
      audioDisplayFormat: seqAudioDisplayFormat,
      previewFileFormat,
      codec,
      previewWidth,
      previewHeight,
      maximumBitDepth,
      maximumRenderQuality,
      compositeInLinearColor
    };

    const workflowSettings: WorkflowSettings = {
      workflowType: selectedWorkflow || 'custom',
      storage: {
        autoSaveInterval,
        maxUndoHistory,
        proxyMediaResolution,
        cacheStrategy,
        backgroundRendering,
        copyToProjectFolder,
        organizeByType
      },
      ai: {
        thumbnailGeneration,
        waveformGeneration,
        metadataExtraction,
        aiTagging,
        autoSceneDetection,
        speechToText,
        autoSubtitles,
        smartReframing,
        hardwareAcceleration,
        renderQueuePriority
      },
      export: {
        defaultRenderPreset,
        outputDestination
      }
    };

    onCreateProject(projectSettings, sequenceSettings, workflowSettings);
  };

  const getStepTitle = (step: StepType): string => {
    const titles = {
      project: 'New Project',
      workflow: 'Choose Workflow',
      sequence: 'Sequence Settings',
      storage: 'Storage & Performance',
      ai: 'AI & Automation',
      export: 'Export Settings',
      review: 'Review & Create'
    };
    return titles[step];
  };

  const getStepDescription = (step: StepType): string => {
    const descriptions = {
      project: 'Configure project details',
      workflow: 'Select optimal preset for your use case',
      sequence: 'Configure sequence parameters',
      storage: 'Configure storage and performance',
      ai: 'Configure AI and automation features',
      export: 'Configure export and render settings',
      review: 'Review all settings and create project'
    };
    return descriptions[step];
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[1100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Container - Compact & Monochromatic */}
      <div className="relative z-[1101] w-full max-w-2xl bg-black/90 backdrop-blur-md border border-white/10 rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

        {/* Header - Compact */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-white/80">
              <span className="text-xs font-semibold">{getStepNumber(currentStep)}</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {getStepTitle(currentStep)}
              </h3>
              <p className="text-xs text-white/50">
                {getStepDescription(currentStep)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {currentStep === 'project' && (
            // PROJECT FUNDAMENTALS STEP
            <div className="space-y-5">
              {/* ESSENTIAL SECTION */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-white/90 uppercase tracking-wider">Essential</h4>

                {/* Project Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Project Name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    placeholder="Untitled Project"
                  />
                </div>
              </div>

              {/* COLOR MANAGEMENT SECTION */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white/90 uppercase tracking-wider">Color Management</h4>
                  <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">Professional</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Color Space */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Color Space</label>
                    <select
                      value={colorSpace}
                      onChange={(e) => setColorSpace(e.target.value as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="rec709">Rec. 709 (HD/Web)</option>
                      <option value="rec2020">Rec. 2020 (HDR/UHD)</option>
                      <option value="dci-p3">DCI-P3 (Cinema)</option>
                      <option value="srgb">sRGB (Web Safe)</option>
                    </select>
                  </div>

                  {/* Working Color Depth */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Color Depth</label>
                    <select
                      value={workingColorDepth}
                      onChange={(e) => setWorkingColorDepth(e.target.value as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="8bit">8-bit (Standard)</option>
                      <option value="10bit">10-bit (HDR)</option>
                      <option value="16bit">16-bit (Cinema)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* PERFORMANCE PROFILE SECTION */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white/90 uppercase tracking-wider">Performance Profile</h4>
                  <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">Optimization</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Target Resolution Tier */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Max Resolution</label>
                    <select
                      value={targetResolutionTier}
                      onChange={(e) => setTargetResolutionTier(e.target.value as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="sd">SD (720×480)</option>
                      <option value="hd">HD (1920×1080)</option>
                      <option value="4k">4K (3840×2160)</option>
                      <option value="8k">8K (7680×4320)</option>
                    </select>
                  </div>

                  {/* Playback Quality */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Preview Quality</label>
                    <select
                      value={playbackQuality}
                      onChange={(e) => setPlaybackQuality(e.target.value as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="draft">Draft (1/4)</option>
                      <option value="preview">Preview (1/2)</option>
                      <option value="full">Full Quality</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* MEDIA MANAGEMENT SECTION */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white/90 uppercase tracking-wider">Media Management</h4>
                  <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">Storage</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Import Behavior */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Import Mode</label>
                    <select
                      value={importBehavior}
                      onChange={(e) => setImportBehavior(e.target.value as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="reference">Reference (Link)</option>
                      <option value="copy">Copy to Project</option>
                      <option value="copy-transcode">Copy + Transcode</option>
                    </select>
                  </div>

                  {/* File Organization */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Organization</label>
                    <select
                      value={fileOrganization}
                      onChange={(e) => setFileOrganization(e.target.value as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="original">Keep Original</option>
                      <option value="by-date">By Date</option>
                      <option value="by-type">By Media Type</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* AUDIO ENGINE SECTION */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white/90 uppercase tracking-wider">Audio Engine</h4>
                  <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">Professional</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Master Sample Rate */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Sample Rate</label>
                    <select
                      value={masterSampleRate}
                      onChange={(e) => setMasterSampleRate(Number(e.target.value) as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="44100">44.1 kHz (CD)</option>
                      <option value="48000">48 kHz (Pro)</option>
                      <option value="96000">96 kHz (Hi-Res)</option>
                    </select>
                  </div>

                  {/* Master Bit Depth */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Bit Depth</label>
                    <select
                      value={masterBitDepth}
                      onChange={(e) => setMasterBitDepth(Number(e.target.value) as any)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="16">16-bit (Standard)</option>
                      <option value="24">24-bit (Professional)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* WORKSPACE LAYOUT SECTION */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white/90 uppercase tracking-wider">Workspace Layout</h4>
                  <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">UI Preference</span>
                </div>

                <select
                  value={workspaceLayout}
                  onChange={(e) => setWorkspaceLayout(e.target.value as any)}
                  className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                >
                  <option value="standard">Standard (3-Panel)</option>
                  <option value="advanced">Advanced (4-Panel + Mixer)</option>
                  <option value="minimalist">Minimalist (Viewer + Timeline)</option>
                  <option value="review">Review Mode (Large Viewer)</option>
                </select>
              </div>
            </div>
          )}

          {currentStep === 'workflow' && (
            // WORKFLOW PRESET SELECTION STEP
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Film Production */}
                <button
                  onClick={() => setSelectedWorkflow('film')}
                  className={`p-4 rounded-md border transition-all ${
                    selectedWorkflow === 'film'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-2xl mb-2">🎬</div>
                  <div className="text-sm font-semibold text-white mb-1">Film Production</div>
                  <div className="text-xs text-white/60">4K, 24fps, ProRes - Cinematic quality</div>
                </button>

                {/* YouTube */}
                <button
                  onClick={() => setSelectedWorkflow('youtube')}
                  className={`p-4 rounded-md border transition-all ${
                    selectedWorkflow === 'youtube'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-2xl mb-2">▶️</div>
                  <div className="text-sm font-semibold text-white mb-1">YouTube</div>
                  <div className="text-xs text-white/60">1080p, 60fps, H.264 - Optimized for web</div>
                </button>

                {/* Instagram */}
                <button
                  onClick={() => setSelectedWorkflow('instagram')}
                  className={`p-4 rounded-md border transition-all ${
                    selectedWorkflow === 'instagram'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-2xl mb-2">📸</div>
                  <div className="text-sm font-semibold text-white mb-1">Instagram</div>
                  <div className="text-xs text-white/60">1080x1080, 30fps - Square & Stories</div>
                </button>

                {/* TikTok */}
                <button
                  onClick={() => setSelectedWorkflow('tiktok')}
                  className={`p-4 rounded-md border transition-all ${
                    selectedWorkflow === 'tiktok'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-2xl mb-2">🎵</div>
                  <div className="text-sm font-semibold text-white mb-1">TikTok</div>
                  <div className="text-xs text-white/60">1080x1920, 30fps - Vertical video</div>
                </button>

                {/* Podcast */}
                <button
                  onClick={() => setSelectedWorkflow('podcast')}
                  className={`p-4 rounded-md border transition-all ${
                    selectedWorkflow === 'podcast'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-2xl mb-2">🎙️</div>
                  <div className="text-sm font-semibold text-white mb-1">Podcast</div>
                  <div className="text-xs text-white/60">1080p, 30fps - Audio-focused with visuals</div>
                </button>

                {/* Broadcast */}
                <button
                  onClick={() => setSelectedWorkflow('broadcast')}
                  className={`p-4 rounded-md border transition-all ${
                    selectedWorkflow === 'broadcast'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-2xl mb-2">📺</div>
                  <div className="text-sm font-semibold text-white mb-1">Broadcast</div>
                  <div className="text-xs text-white/60">1080i, 29.97fps - TV/Broadcast standard</div>
                </button>

                {/* Custom */}
                <button
                  onClick={() => setSelectedWorkflow('custom')}
                  className={`p-4 rounded-md border transition-all col-span-2 ${
                    selectedWorkflow === 'custom'
                      ? 'bg-white/20 border-white/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-center gap-3">
                    <Settings size={20} className="text-white/70" />
                    <div>
                      <div className="text-sm font-semibold text-white mb-1">Custom Workflow</div>
                      <div className="text-xs text-white/60">Configure all settings manually</div>
                    </div>
                  </div>
                </button>
              </div>

              {selectedWorkflow && selectedWorkflow !== 'custom' && WORKFLOW_PRESETS[selectedWorkflow] && (
                <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-md">
                  <div className="text-xs font-semibold text-white/70 mb-2">Preview Settings:</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-white/60">
                    <div>Resolution: {WORKFLOW_PRESETS[selectedWorkflow]!.sequence.frameWidth}x{WORKFLOW_PRESETS[selectedWorkflow]!.sequence.frameHeight}</div>
                    <div>FPS: {WORKFLOW_PRESETS[selectedWorkflow]!.sequence.timebase}</div>
                    <div>Codec: {WORKFLOW_PRESETS[selectedWorkflow]!.sequence.codec}</div>
                    <div>Audio: {WORKFLOW_PRESETS[selectedWorkflow]!.sequence.channelFormat}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 'sequence' && (
            // SEQUENCE SETTINGS STEP
            <div className="space-y-4">
              {/* Editing Mode & Timebase */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Editing Mode</label>
                  <select
                    value={editingMode}
                    onChange={(e) => setEditingMode(e.target.value)}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  >
                    <option value="Custom">Custom</option>
                    <option value="DV NTSC">DV NTSC</option>
                    <option value="DV PAL">DV PAL</option>
                    <option value="HDV 720p">HDV 720p</option>
                    <option value="HDV 1080i">HDV 1080i</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Timebase (FPS)</label>
                  <input
                    type="number"
                    value={timebase}
                    onChange={(e) => setTimebase(parseFloat(e.target.value))}
                    step="0.01"
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  />
                </div>
              </div>

              {/* Video Section */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-white/10"></div>
                  <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Video</span>
                  <div className="h-px flex-1 bg-white/10"></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Frame Width</label>
                    <input
                      type="number"
                      value={frameWidth}
                      onChange={(e) => setFrameWidth(parseInt(e.target.value))}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Frame Height</label>
                    <input
                      type="number"
                      value={frameHeight}
                      onChange={(e) => setFrameHeight(parseInt(e.target.value))}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Pixel Aspect Ratio</label>
                    <select
                      value={pixelAspectRatio}
                      onChange={(e) => setPixelAspectRatio(e.target.value)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="Square Pixels (1.0)">Square (1.0)</option>
                      <option value="D1/DV NTSC (0.9091)">D1/DV NTSC (0.9091)</option>
                      <option value="D1/DV PAL (1.0940)">D1/DV PAL (1.0940)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Fields</label>
                    <select
                      value={fields}
                      onChange={(e) => setFields(e.target.value)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="No Fields (Progressive Scan)">Progressive</option>
                      <option value="Upper Field First">Upper First</option>
                      <option value="Lower Field First">Lower First</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Audio Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-white/10"></div>
                  <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Audio</span>
                  <div className="h-px flex-1 bg-white/10"></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Channel Format</label>
                    <select
                      value={channelFormat}
                      onChange={(e) => setChannelFormat(e.target.value)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="Mono">Mono</option>
                      <option value="Stereo">Stereo</option>
                      <option value="5.1">5.1</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Sample Rate (Hz)</label>
                    <select
                      value={sampleRate}
                      onChange={(e) => setSampleRate(parseInt(e.target.value))}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="32000">32000</option>
                      <option value="44100">44100</option>
                      <option value="48000">48000</option>
                      <option value="96000">96000</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Preview Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-white/10"></div>
                  <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Preview</span>
                  <div className="h-px flex-1 bg-white/10"></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">File Format</label>
                    <select
                      value={previewFileFormat}
                      onChange={(e) => setPreviewFileFormat(e.target.value)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="QuickTime">QuickTime</option>
                      <option value="AVI">AVI</option>
                      <option value="I-Frame Only MPEG">I-Frame MPEG</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Codec</label>
                    <select
                      value={codec}
                      onChange={(e) => setCodec(e.target.value)}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    >
                      <option value="H.264">H.264</option>
                      <option value="H.265">H.265</option>
                      <option value="ProRes">ProRes</option>
                      <option value="DNxHD">DNxHD</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Preview Width</label>
                    <input
                      type="number"
                      value={previewWidth}
                      onChange={(e) => setPreviewWidth(parseInt(e.target.value))}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-white/70">Preview Height</label>
                    <input
                      type="number"
                      value={previewHeight}
                      onChange={(e) => setPreviewHeight(parseInt(e.target.value))}
                      className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    />
                  </div>
                </div>

                {/* Checkboxes */}
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={maximumBitDepth}
                      onChange={(e) => setMaximumBitDepth(e.target.checked)}
                      className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                      Maximum Bit Depth
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={maximumRenderQuality}
                      onChange={(e) => setMaximumRenderQuality(e.target.checked)}
                      className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                      Maximum Render Quality
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={compositeInLinearColor}
                      onChange={(e) => setCompositeInLinearColor(e.target.checked)}
                      className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                      Composite in Linear Color
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {currentStep === 'storage' && (
            // STORAGE & PERFORMANCE STEP
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Auto-Save Interval (seconds)</label>
                  <input
                    type="number"
                    value={autoSaveInterval}
                    onChange={(e) => setAutoSaveInterval(parseInt(e.target.value))}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Max Undo History</label>
                  <input
                    type="number"
                    value={maxUndoHistory}
                    onChange={(e) => setMaxUndoHistory(parseInt(e.target.value))}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Proxy Media Resolution</label>
                  <select
                    value={proxyMediaResolution}
                    onChange={(e) => setProxyMediaResolution(e.target.value as 'none' | '480p' | '720p' | '1080p')}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  >
                    <option value="none">None</option>
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Cache Strategy</label>
                  <select
                    value={cacheStrategy}
                    onChange={(e) => setCacheStrategy(e.target.value as 'minimal' | 'balanced' | 'aggressive')}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  >
                    <option value="minimal">Minimal</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={backgroundRendering}
                    onChange={(e) => setBackgroundRendering(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Enable Background Rendering
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={copyToProjectFolder}
                    onChange={(e) => setCopyToProjectFolder(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Copy media to project folder
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={organizeByType}
                    onChange={(e) => setOrganizeByType(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Organize media by type
                  </span>
                </label>
              </div>
            </div>
          )}

          {currentStep === 'ai' && (
            // AI & AUTOMATION STEP
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Thumbnail Generation</label>
                  <select
                    value={thumbnailGeneration}
                    onChange={(e) => setThumbnailGeneration(e.target.value as 'auto' | 'manual')}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  >
                    <option value="auto">Automatic</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70">Hardware Acceleration</label>
                  <select
                    value={hardwareAcceleration}
                    onChange={(e) => setHardwareAcceleration(e.target.value as 'auto' | 'nvidia' | 'cpu-only')}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  >
                    <option value="auto">Auto</option>
                    <option value="nvidia">NVIDIA GPU</option>
                    <option value="cpu-only">CPU Only</option>
                  </select>
                </div>

                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-medium text-white/70">Render Queue Priority</label>
                  <select
                    value={renderQueuePriority}
                    onChange={(e) => setRenderQueuePriority(e.target.value as 'high' | 'normal' | 'low')}
                    className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={waveformGeneration}
                    onChange={(e) => setWaveformGeneration(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Generate audio waveforms
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={metadataExtraction}
                    onChange={(e) => setMetadataExtraction(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Extract metadata automatically
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={aiTagging}
                    onChange={(e) => setAiTagging(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    AI-powered tagging
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={autoSceneDetection}
                    onChange={(e) => setAutoSceneDetection(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Automatic scene detection
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={speechToText}
                    onChange={(e) => setSpeechToText(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Speech to text transcription
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={autoSubtitles}
                    onChange={(e) => setAutoSubtitles(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Automatic subtitle generation
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={smartReframing}
                    onChange={(e) => setSmartReframing(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/5 border border-white/10 checked:bg-white/20 checked:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">
                    Smart reframing for different aspect ratios
                  </span>
                </label>
              </div>
            </div>
          )}

          {currentStep === 'export' && (
            // EXPORT SETTINGS STEP
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/70">Default Render Preset</label>
                <select
                  value={defaultRenderPreset}
                  onChange={(e) => setDefaultRenderPreset(e.target.value as any)}
                  className="w-full h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                >
                  <option value="h264-high">H.264 High Quality</option>
                  <option value="h264-medium">H.264 Medium Quality</option>
                  <option value="h265-high">H.265 (HEVC) High Quality</option>
                  <option value="prores-422">ProRes 422</option>
                  <option value="prores-422hq">ProRes 422 HQ</option>
                  <option value="dnxhd">DNxHD</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/70">Output Destination</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={outputDestination}
                    onChange={(e) => setOutputDestination(e.target.value)}
                    className="flex-1 h-8 px-2.5 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-colors"
                    placeholder="/renders"
                  />
                  <button className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors flex items-center justify-center">
                    <Folder size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/70 mb-3">Summary</div>
                <div className="space-y-2 text-xs text-white/60">
                  <div className="flex justify-between">
                    <span>Project:</span>
                    <span className="text-white/80 font-medium">{projectName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Workflow:</span>
                    <span className="text-white/80 font-medium capitalize">{selectedWorkflow || 'Custom'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolution:</span>
                    <span className="text-white/80 font-medium">{frameWidth}x{frameHeight} @ {timebase}fps</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Codec:</span>
                    <span className="text-white/80 font-medium">{codec}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Audio:</span>
                    <span className="text-white/80 font-medium">{channelFormat} @ {sampleRate}Hz</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 'review' && (
            // REVIEW & CONFIRM STEP
            <div className="space-y-4">
              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">📋 Project Overview</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-1">
                    <span className="text-white/60">Project Name:</span>
                    <span className="text-white/90 font-medium">{projectName}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-white/60">Workflow Preset:</span>
                    <span className="text-white/90 font-medium capitalize">{selectedWorkflow || 'Custom'}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">🎨 Color & Performance</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Color Space:</span>
                    <span className="text-white/90 font-medium">{colorSpace.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Color Depth:</span>
                    <span className="text-white/90 font-medium">{workingColorDepth}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Max Resolution:</span>
                    <span className="text-white/90 font-medium">{targetResolutionTier.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Preview Quality:</span>
                    <span className="text-white/90 font-medium capitalize">{playbackQuality}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">🎬 Sequence Settings</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Resolution:</span>
                    <span className="text-white/90 font-medium">{frameWidth}×{frameHeight}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Frame Rate:</span>
                    <span className="text-white/90 font-medium">{timebase} fps</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Codec:</span>
                    <span className="text-white/90 font-medium">{codec}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Editing Mode:</span>
                    <span className="text-white/90 font-medium">{editingMode}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">💾 Storage & Media</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Import Mode:</span>
                    <span className="text-white/90 font-medium capitalize">{importBehavior.replace('-', ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Organization:</span>
                    <span className="text-white/90 font-medium capitalize">{fileOrganization.replace('-', ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Auto-save:</span>
                    <span className="text-white/90 font-medium">{autoSaveInterval}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Undo History:</span>
                    <span className="text-white/90 font-medium">{maxUndoHistory} steps</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">🤖 AI & Automation</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Thumbnails:</span>
                    <span className="text-white/90 font-medium capitalize">{thumbnailGeneration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Waveforms:</span>
                    <span className="text-white/90 font-medium">{waveformGeneration ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Metadata:</span>
                    <span className="text-white/90 font-medium">{metadataExtraction ? 'Auto' : 'Manual'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">GPU Accel:</span>
                    <span className="text-white/90 font-medium capitalize">{hardwareAcceleration}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">🔊 Audio Engine</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Sample Rate:</span>
                    <span className="text-white/90 font-medium">{masterSampleRate / 1000} kHz</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Bit Depth:</span>
                    <span className="text-white/90 font-medium">{masterBitDepth}-bit</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Channel Format:</span>
                    <span className="text-white/90 font-medium">{channelFormat}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Audio Display:</span>
                    <span className="text-white/90 font-medium">{seqAudioDisplayFormat}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-md">
                <div className="text-xs font-semibold text-white/90 mb-2 uppercase tracking-wider">📤 Export Settings</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Render Preset:</span>
                    <span className="text-white/90 font-medium">{defaultRenderPreset.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Output Path:</span>
                    <span className="text-white/90 font-medium">{outputDestination}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                <div className="text-xs text-blue-200/90">
                  ✨ Ready to create your project with these settings. Click <span className="font-semibold">Create Project</span> to continue.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer - Compact Action Buttons */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 bg-white/5">
          <div className="text-xs text-white/50">
            Step {getStepNumber(currentStep)} of 7
          </div>

          <div className="flex items-center gap-2">
            {currentStep !== 'project' && (
              <button
                onClick={handleBack}
                className="h-8 px-3 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors flex items-center gap-1.5 text-sm font-medium"
              >
                <ChevronLeft size={14} />
                <span>Back</span>
              </button>
            )}

            {currentStep !== 'review' ? (
              <button
                onClick={handleNext}
                disabled={currentStep === 'workflow' && !selectedWorkflow}
                className="h-8 px-3 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors flex items-center gap-1.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="h-8 px-4 rounded-md bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-white transition-colors flex items-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <span>Create Project</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectCreationModal;
