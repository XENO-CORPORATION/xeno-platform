import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Video, BrainCircuit, Settings, X, Info, RotateCw, Download, Trash2, CheckCircle, Loader } from 'lucide-react'; // Changed icon to Video
// TODO: Create and import a real LoRa video training service
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';

// Mock service for LoRa Video Training
type MockVideoBaseModelId = 'svd' | 'svd-xt' | 'animatediff-v1.5'; // Example video base model IDs

const mockLoRaVideoTrainService = {
  baseModelRegistry: {
    'svd': { provider: 'mock', name: 'Stable Video Diffusion' },
    'svd-xt': { provider: 'mock', name: 'Stable Video Diffusion XT' },
    'animatediff-v1.5': { provider: 'mock', name: 'AnimateDiff v1.5 (SD 1.5)' },
  } as const,

  // Simulate training process for video
  trainModel: async (
    settings: any,
    onProgress: (update: { status: string; progress: number; eta?: number; logs?: string[]; samples?: string[] }) => void // Samples are video URLs
  ): Promise<{ success: boolean; model_id?: string; error?: string; final_logs?: string[] }> => {
    console.log(`[MockLoRaVideoTrain] Starting training with settings:`, settings);
    let progress = 0;
    const totalSteps = settings.max_train_steps || 1000; // Fewer steps for video typically
    const logs: string[] = ['Training initiated (Video LoRa)...'];
    const samples: string[] = []; // Placeholder for sample video URLs

    // Simulate progress updates
    const interval = setInterval(() => {
      progress += Math.random() * (100 / (totalSteps / 50)); // Simulate variable progress
      progress = Math.min(progress, 100);
      const eta = progress < 100 ? Math.round(((100 - progress) / 100) * (totalSteps * 0.2)) : 0; // Rough ETA simulation (video takes longer)
      
      logs.push(`Step ${Math.round((progress/100)*totalSteps)}/${totalSteps}: Loss = ${(Math.random() * 0.8 + 0.2).toFixed(4)}`);
      if (logs.length > 100) logs.shift(); // Keep logs manageable

      // Simulate occasional sample generation (video)
      if (Math.random() < 0.08 && progress < 95) { // Less frequent samples
          // Placeholder sample video URL - replace with actual generation if possible
          // In a real scenario, this would be a URL to a short generated .mp4 or .gif
          samples.push(`https://via.placeholder.com/128x72/00FF00/FFFFFF?text=Sample+Video+${samples.length + 1}`); 
          if (samples.length > 2) samples.shift(); // Keep last 2 samples
          logs.push("Generated sample video.")
      }

      onProgress({ 
          status: 'Training Video LoRa...', 
          progress: Math.round(progress), 
          eta: eta, 
          logs: logs.length > 0 ? [...logs] : [],
          samples: samples.length > 0 ? [...samples] : []
      });

      if (progress >= 100) {
        clearInterval(interval);
      }
    }, 350); // Slower update interval for video

    // Wait for training to complete (progress >= 100)
     await new Promise<void>(resolve => {
        const checkCompletion = () => {
            if (progress >= 100) {
                resolve();
            } else {
                setTimeout(checkCompletion, 150);
            }
        };
        checkCompletion();
    });
    
    // Simulate success or failure at the end
    if (Math.random() < 0.15) { // Slightly higher failure chance for complex video
        logs.push('Training failed: Mock error during video LoRa finalization.');
      return { success: false, error: 'Mock video training failed', final_logs: logs };
    }

    logs.push('Video LoRa training completed successfully!');
    const trainedModelId = `${settings.model_name || 'trained_video_lora'}_${Date.now()}`;
    console.log(`[MockLoRaVideoTrain] Training finished. Model ID: ${trainedModelId}`);
    return { 
        success: true, 
        model_id: trainedModelId, 
        final_logs: logs 
    };
  },

  getBaseModelDefaults: (modelId: string) => {
      if (modelId in mockLoRaVideoTrainService.baseModelRegistry) {
        return mockLoRaVideoTrainService.baseModelRegistry[modelId as MockVideoBaseModelId];
      }
      return {};
  }
};
const loraVideoTrainService = mockLoRaVideoTrainService; // Use mock video service

// Interface for video LoRa training settings
interface LoRaVideoTrainSettings {
    dataset_url: string; // URL to zip file of frames or video file
    instance_prompt: string; // Still needed for concept association
    base_model: string;
    model_name: string;
    max_train_steps: number;
    learning_rate: number;
    resolution_width: number; // Video dimensions
    resolution_height: number;
    batch_size: number; // Often smaller for video
    video_length?: number; // Number of frames per clip
    fps?: number;
    motion_bucket_id?: number; // For SVD models
    // Add other relevant video hyperparameters (e.g., motion scale)
}

// Interface for video training progress updates (samples are video URLs)
interface VideoTrainingProgress {
    status: string;
    progress: number;
    eta?: number;
    logs: string[];
    samples?: string[]; // URLs of sample videos
}

// Interface for video training history items
interface VideoTrainingRun {
    id: string;
    modelName: string;
    baseModel: string;
    status: 'Completed' | 'Failed' | 'In Progress';
    timestamp: Date;
    datasetInfo?: string; // Could be filename or description
    settings?: Partial<LoRaVideoTrainSettings>;
}

// Simple notification helper (reuse)
const notifications = {
  error: (message: string) => { console.error(`Error: ${message}`); alert("Error: " + message); },
  success: (message: string) => { console.log(`Success: ${message}`); /* No alert */ }
};

// --- Base Model Selector --- (Adapted for Video)
const VideoBaseModelSelector = ({ 
  selectedModel,
  onChange,
  disabled
}: {
  selectedModel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  const getSelectedModelName = () => {
    if (!selectedModel) return 'Select Base Video Model';
    return loraVideoTrainService.baseModelRegistry[selectedModel as MockVideoBaseModelId]?.name || 'Select Base Video Model';
  };

  return (
    <select
      value={selectedModel}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none pr-8 bg-no-repeat bg-right px-2"
      style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23aaa" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundPosition: 'right 0.5rem center', backgroundSize: '1.2em' }}
    >
      <option value="" disabled>Select Base Video Model</option>
      {Object.entries(loraVideoTrainService.baseModelRegistry).map(([id, model]) => (
        <option key={id} value={id}>
          {model.name}
        </option>
      ))}
    </select>
  );
};

// --- Main LoRa Video Training Interface Component ---
const LoRaVideoTrainComponent: React.FC = () => {
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [datasetUrl, setDatasetUrl] = useState<string>(''); // Store uploaded file URL/ref
  const [instancePrompt, setInstancePrompt] = useState<string>('a video of sks character'); // Adjusted prompt
  const [modelName, setModelName] = useState<string>('my-video-lora-model');
  const [baseModel, setBaseModel] = useState<string>('svd'); // Default video model

  // Video Training parameters
  const [maxTrainSteps, setMaxTrainSteps] = useState<number>(1000);
  const [learningRate, setLearningRate] = useState<number>(0.00005); // Often lower for video
  const [resolutionWidth, setResolutionWidth] = useState<number>(576); // Common SVD size
  const [resolutionHeight, setResolutionHeight] = useState<number>(1024);
  const [batchSize, setBatchSize] = useState<number>(1); // Often 1 for video due to memory
  const [videoLength, setVideoLength] = useState<number>(14); // Frames
  const [fps, setFps] = useState<number>(7);
  const [motionBucketId, setMotionBucketId] = useState<number>(127); // SVD parameter

  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<VideoTrainingProgress | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainedModelId, setTrainedModelId] = useState<string | null>(null);

  const [history, setHistory] = useState<VideoTrainingRun[]>([]);
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<VideoTrainingRun | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Scroll logs to bottom automatically
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [trainingProgress?.logs]);

  // --- File Handling ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Basic validation (zip of frames or video file)
      if (!file.name.endsWith('.zip') && !file.type.startsWith('video/')) {
        notifications.error('Please upload a zip file (frames) or a video file.');
        return;
      }
      setDatasetFile(file);
      setDatasetUrl(URL.createObjectURL(file)); // Create a temporary URL for display/reference
      console.log('Video dataset file selected:', file.name);
      setTrainingError(null); // Clear error on new file
    } else {
        setDatasetFile(null);
        setDatasetUrl('');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const removeDataset = () => {
    setDatasetFile(null);
    if (datasetUrl) {
        URL.revokeObjectURL(datasetUrl);
    }
    setDatasetUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // --- Training Logic ---
  const handleStartTraining = async () => {
    if (!datasetFile) {
      notifications.error('Please upload a video dataset file (.zip or video).');
      return;
    }
    if (!instancePrompt.trim()) {
        notifications.error('Please provide an instance prompt (trigger word/phrase).');
        return;
    }
     if (!modelName.trim()) {
        notifications.error('Please provide a name for your trained model.');
        return;
    }
    if (!baseModel) {
        notifications.error('Please select a base video model.');
        return;
    }

    setIsTraining(true);
    setTrainingError(null);
    setTrainingProgress({ status: 'Preparing...', progress: 0, logs: ['Preparing video training environment...'] });
    setTrainedModelId(null);

    try {
      // ** TODO: Replace with actual service call to upload file and start video training **
      const dataset_url_for_service = `mock_upload_path/${datasetFile.name}`; // Placeholder
      
      const settings: LoRaVideoTrainSettings = {
        dataset_url: dataset_url_for_service, 
        instance_prompt: instancePrompt,
        base_model: baseModel,
        model_name: modelName,
        max_train_steps: maxTrainSteps,
        learning_rate: learningRate,
        resolution_width: resolutionWidth,
        resolution_height: resolutionHeight,
        batch_size: batchSize,
        video_length: videoLength,
        fps: fps,
        motion_bucket_id: motionBucketId,
      };

      const currentRun: VideoTrainingRun = {
        id: `train_video_${Date.now()}`,
        modelName: modelName,
        baseModel: loraVideoTrainService.baseModelRegistry[baseModel as MockVideoBaseModelId]?.name || baseModel,
        status: 'In Progress',
        timestamp: new Date(),
        datasetInfo: datasetFile.name, // Store filename for history
        settings: { // Store key settings
            max_train_steps: maxTrainSteps, 
            learning_rate: learningRate, 
            resolution_width: resolutionWidth,
            resolution_height: resolutionHeight,
            video_length: videoLength
        }
      };
      setHistory(prev => [currentRun, ...prev].slice(0, 20));
      setSelectedHistoryRun(currentRun);

      // Call the mock video service
      const result = await loraVideoTrainService.trainModel(settings, (update) => {
        setTrainingProgress(prev => {
            const currentLogs = prev?.logs ?? [];
            // Append new logs - Ensure update.logs is an array
            const newLogs = Array.isArray(update.logs) ? update.logs : [];
            const combinedLogs = [...currentLogs, ...newLogs].slice(-200); // Keep last 200 logs

            // Update samples - Ensure update.samples is an array
             const currentSamples = prev?.samples ?? [];
             const newSamples = Array.isArray(update.samples) ? update.samples : [];
             // Only update samples if new samples were provided
             const combinedSamples = newSamples.length > 0 ? newSamples : currentSamples; 


            return {
                status: update.status ?? prev?.status ?? 'Updating...',
                progress: update.progress ?? prev?.progress ?? 0,
                eta: update.eta ?? prev?.eta,
                logs: combinedLogs,
                samples: combinedSamples,
            };
        });
      });


      if (result.success && result.model_id) {
        setTrainedModelId(result.model_id);
        notifications.success(`Video LoRa Training completed! Model ID: ${result.model_id}`);
        setHistory(prev => prev.map(run => run.id === currentRun.id ? { ...run, status: 'Completed' } : run));
        setSelectedHistoryRun(prev => prev?.id === currentRun.id ? { ...prev, status: 'Completed' } : prev);
      } else {
        setTrainingError(result.error || 'Video LoRa training failed.');
        notifications.error(`Video LoRa training failed: ${result.error || 'Unknown error'}`);
        setHistory(prev => prev.map(run => run.id === currentRun.id ? { ...run, status: 'Failed' } : run));
        setSelectedHistoryRun(prev => prev?.id === currentRun.id ? { ...prev, status: 'Failed' } : prev);
      }
      // Final progress update with final logs
        setTrainingProgress(prev => ({ 
           ...(prev ?? { status: 'Finished', progress: 100, logs: [], samples: [] }), 
           logs: [...(prev?.logs || []), ...(result.final_logs || [])].slice(-200)
       }));


    } catch (error) {
      console.error('Error starting video training:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setTrainingError(message);
      notifications.error(`Error: ${message}`);
       const currentRunId = history[0]?.id; // Assume latest run failed if error occurs early
       if (currentRunId) {
           setHistory(prev => prev.map(run => run.id === currentRunId ? { ...run, status: 'Failed' } : run));
           setSelectedHistoryRun(prev => prev?.id === currentRunId ? { ...prev, status: 'Failed' } : prev);
       }
       setTrainingProgress(prev => ({ 
           ...(prev ?? { status: 'Failed', progress: 0, logs: [], samples: [] }), 
           status: 'Failed',
           logs: [...(prev?.logs || []), `Error: ${message}`].slice(-200)
       }));
    } finally {
      setIsTraining(false);
      // Set progress to null only if there was no error and no trained model ID
        if (!trainingError && !trainedModelId) {
             setTimeout(() => setTrainingProgress(null), 2000); // Keep final state visible briefly
        } else if (trainingError) {
             // Keep progress showing the error state
        } else if (trainedModelId) {
             // Keep progress showing completion state
        }
    }
  };

  // --- History Management ---
  const handleSelectHistory = (run: VideoTrainingRun) => {
      setSelectedHistoryRun(run);
      setTrainingProgress(null); 
      setTrainingError(null);
      setTrainedModelId(null);
      // Pre-fill settings from history (optional)
      setModelName(run.modelName);
      const baseModelKey = Object.entries(loraVideoTrainService.baseModelRegistry).find(
          ([_, model]) => model.name === run.baseModel
      )?.[0];
      if (baseModelKey) setBaseModel(baseModelKey);
      if (run.settings) {
         if(run.settings.max_train_steps) setMaxTrainSteps(run.settings.max_train_steps);
         if(run.settings.learning_rate) setLearningRate(run.settings.learning_rate);
         if(run.settings.resolution_width) setResolutionWidth(run.settings.resolution_width);
         if(run.settings.resolution_height) setResolutionHeight(run.settings.resolution_height);
         if(run.settings.video_length) setVideoLength(run.settings.video_length);
         // Add others if needed
      }
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear the video training history?')) {
      setHistory([]);
      setSelectedHistoryRun(null);
      setTrainingProgress(null);
    }
  };

 const handleDeleteHistoryItem = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setHistory(prev => prev.filter(h => h.id !== id));
        if (selectedHistoryRun?.id === id) {
            setSelectedHistoryRun(null);
            setTrainingProgress(null);
        }
  };


  // --- Render ---
  return (
    <div className="flex flex-col h-full">
      {/* Optional: Add API Token Notice */}
      {/* <ApiTokenNotice serviceKey="your_video_training_service_key" /> */}

      <div className="flex flex-col lg:flex-row h-full relative gap-2">
        {/* Left Panel (Controls) */}
        <div className="lg:w-[30%] lg:max-w-[350px]">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-3 space-y-3 h-full flex flex-col">

            {/* Training Data Input */} 
            <div className="space-y-2">
              <label className="text-xs font-medium text-white/70">Training Dataset (Video or ZIP)</label>
              {!datasetUrl ? (
                <button
                  onClick={handleUploadClick}
                  className="w-full h-24 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors"
                  disabled={isTraining}
                >
                  <UploadCloud size={24} className="mb-1" />
                  <span className="text-sm">Upload .zip or .mp4</span>
                  <span className="text-xs mt-0.5">(Drag & drop ok)</span>
                </button>
              ) : (
                <div className="relative bg-black/30 rounded-lg p-2 border border-white/10 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-white/80">
                      <Video size={16} className="mr-2 text-purple-400 flex-shrink-0" /> {/* Video Icon */}
                      <span className="text-xs truncate" title={datasetFile?.name}>{
                        datasetFile?.name || 'Uploaded Dataset'
                      }</span>
                    </div>
                    <button
                      onClick={removeDataset}
                      className="p-1 text-red-500 hover:text-red-400 disabled:opacity-50"
                      title="Remove Dataset"
                      disabled={isTraining}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".zip,video/*" // Accept zip or any video format
                className="hidden"
                disabled={isTraining}
              />
            </div>

            {/* Training Prompts & Naming */} 
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="text-xs font-medium text-white/70">Prompts & Naming</label>
              <input
                type="text"
                value={instancePrompt}
                onChange={(e) => setInstancePrompt(e.target.value)}
                placeholder="Instance Prompt (e.g., a video of sks style)"
                className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={isTraining}
              />
               <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="Output Model Name (e.g., my-cool-video-lora)"
                className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={isTraining}
              />
            </div>

            {/* Training Parameters */} 
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="text-xs font-medium text-white/70">Training Parameters</label>
              <VideoBaseModelSelector
                selectedModel={baseModel}
                onChange={setBaseModel}
                disabled={isTraining}
              />
              {/* Resolution */}
              <div className="grid grid-cols-2 gap-2">
                 <div>
                      <label className="block text-xs text-white/60 mb-1">Width</label>
                       <input 
                        type="number"
                        value={resolutionWidth}
                        onChange={e => setResolutionWidth(Math.max(64, parseInt(e.target.value) || 64))}
                        className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                        disabled={isTraining}
                        step={8} // Usually multiple of 8
                      />
                 </div>
                 <div>
                     <label className="block text-xs text-white/60 mb-1">Height</label>
                      <input 
                        type="number"
                        value={resolutionHeight}
                        onChange={e => setResolutionHeight(Math.max(64, parseInt(e.target.value) || 64))}
                        className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                        disabled={isTraining}
                        step={8} // Usually multiple of 8
                      />
                 </div>
              </div>
              {/* Steps & LR */} 
               <div className="grid grid-cols-2 gap-2">
                 <div>
                    <label className="block text-xs text-white/60 mb-1">Train Steps</label>
                    <input 
                       type="number"
                       value={maxTrainSteps}
                       onChange={e => setMaxTrainSteps(Math.max(100, parseInt(e.target.value) || 100))}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={50}
                    />
                </div>
                <div>
                    <label className="block text-xs text-white/60 mb-1">Learning Rate</label>
                     <input 
                       type="number"
                       value={learningRate}
                       onChange={e => setLearningRate(parseFloat(e.target.value) || 0.00005)}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={0.00001}
                       min={0.000001}
                       max={0.001}
                       pattern="[0-9]+([.][0-9]+)?"
                       title="e.g., 0.00005 or 5e-5"
                    />
                 </div>
              </div>
               {/* Video Specific */}
               <div className="grid grid-cols-3 gap-2">
                 <div>
                    <label className="block text-xs text-white/60 mb-1">Batch Size</label>
                     <select
                        value={batchSize}
                        onChange={(e) => setBatchSize(Number(e.target.value))}
                        disabled={isTraining}
                         className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none pr-6 bg-no-repeat bg-right"
                         style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23aaa" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundPosition: 'right 0.3rem center', backgroundSize: '1em' }}
                    >
                        <option value={1}>1</option>
                        <option value={2}>2 (High VRAM)</option>
                    </select>
                </div>
                 <div>
                    <label className="block text-xs text-white/60 mb-1">Video Len (f)</label>
                    <input 
                       type="number"
                       value={videoLength}
                       onChange={e => setVideoLength(Math.max(4, parseInt(e.target.value) || 4))}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={1}
                    />
                </div>
                 <div>
                    <label className="block text-xs text-white/60 mb-1">FPS</label>
                     <input 
                       type="number"
                       value={fps}
                       onChange={e => setFps(Math.max(1, parseInt(e.target.value) || 1))}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={1}
                       max={30}
                    />
                 </div>
              </div>
               {/* Motion Bucket ID (Conditional for SVD) */}
                {(baseModel === 'svd' || baseModel === 'svd-xt') && (
                   <div>
                       <label className="block text-xs text-white/60 mb-1">Motion Bucket ID (SVD)</label>
                       <input 
                          type="number"
                          value={motionBucketId}
                          onChange={e => setMotionBucketId(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                          disabled={isTraining}
                          step={1}
                          min={1}
                          max={511} // Check SVD docs for exact range
                       />
                    </div>
                )}
            </div>

            {/* Start Training Button */} 
            <div className="mt-auto pt-3">
                <button
                  onClick={handleStartTraining}
                  disabled={isTraining || !datasetFile}
                  className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-sm font-semibold transition-colors duration-200 ${ isTraining ? 'bg-black/50 cursor-not-allowed' : !datasetFile ? 'bg-zinc-800/40 border border-zinc-700/40 opacity-60 cursor-not-allowed' : 'bg-purple-700 hover:bg-purple-600 border border-purple-600 hover:border-purple-500' }`} // Changed color scheme
                >
                {isTraining ? (
                    <> <RotateCw size={16} className="mr-2 animate-spin" /> Training Video... ({trainingProgress?.progress || 0}%) </> 
                ) : (
                    <> <BrainCircuit size={16} className="mr-2" /> Start Video Training </> 
                )}
              </button>
              {trainingError && <p className="text-red-500 text-xs mt-2 text-center">Error: {trainingError}</p>}
              {trainedModelId && !isTraining && (
                  <div className="mt-2 text-center text-green-400 text-xs p-2 bg-green-900/30 border border-green-700/50 rounded-md">
                      Video Training Complete! Model ID: {trainedModelId}
                  </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel (Status/Logs, Samples & History) */} 
        <div className="flex-1 flex flex-col gap-2">
          {/* Container 1: Training Status & Logs */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col flex-grow" style={{ minHeight: '300px' }}>
             <div className="flex justify-between items-center mb-2 flex-shrink-0">
                 <h3 className="text-sm font-medium text-white/90">Video Training Status</h3>
                 {/* Add pause/cancel buttons here */} 
            </div>
             {/* Progress Bar & Status */} 
            {trainingProgress && (
              <div className="mb-3 flex-shrink-0">
                <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-white/70 font-medium">{trainingProgress.status}</span>
                    <span className="text-white/60">
                        {trainingProgress.progress}% {trainingProgress.eta !== undefined && trainingProgress.eta > 0 ? `(ETA: ~${trainingProgress.eta}s)` : ''}
                    </span>
                </div>
                <div className="w-full bg-black/30 rounded-full h-2 overflow-hidden border border-white/10">
                    <div 
                       className="bg-purple-600 h-full rounded-full transition-all duration-300 ease-out" // Changed color
                       style={{ width: `${trainingProgress.progress}%` }}
                    ></div>
                </div>
             </div>
            )}
            {/* Log Output Area */}
             <div 
                ref={logsContainerRef} 
                className="flex-1 bg-black/40 rounded-lg p-3 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mb-3 text-xs font-mono text-white/70 leading-relaxed"
             >
                {trainingProgress?.logs && trainingProgress.logs.length > 0 ? (
                 trainingProgress.logs.map((log, index) => <div key={index}>{log}</div>)
                ) : (
                 <div className="text-center text-white/40 italic">{isTraining ? 'Waiting for video logs...' : 'Video logs will appear here...'}</div>
                )}
            </div>
          </div>

          {/* NEW Container 2: Sample Videos */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 flex flex-col" style={{ height: '130px', minHeight: '130px' }}>
            <div className="text-xs text-white/60 mb-1 px-1 flex-shrink-0">Sample Videos</div>
             <div className="flex-1 flex space-x-2 h-full bg-black/20 rounded p-1 border border-white/10 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
             {trainingProgress?.samples && trainingProgress.samples.length > 0 ? (
                // In a real app, render <video> tags or proper video previews
                 trainingProgress.samples.map((url, index) => (
                     <div key={index} className="h-full aspect-video bg-black flex items-center justify-center text-white text-xs rounded flex-shrink-0">
                         <a href={url} target="_blank" rel="noopener noreferrer" title="Open sample video">
                             Sample Video {index + 1} (mock)
                         </a>
                     </div>
                     // Example with placeholder image:
                     // <img key={index} src={url} alt={`Sample Video ${index + 1}`} className="h-full aspect-video object-cover rounded" />
                 ))
             ) : (
                  <div className="flex items-center justify-center w-full h-full text-white/40 text-sm italic">{isTraining ? 'Generating video samples...' : 'No video samples yet'}</div>
             )}
            </div>
          </div>

          {/* Container 3: Training History */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 flex flex-col" style={{ height: '130px', minHeight: '130px' }}>
            <div className="flex justify-between items-center mb-1 px-1 flex-shrink-0">
              <div className="text-xs text-white/60">Video Training History</div>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-red-500/70 hover:text-red-500 transition-colors flex items-center"
                  title="Clear History"
                >
                  <Trash2 size={12} className="mr-0.5" /> Clear
                </button>
              )}
            </div>
            <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              <div className="flex space-x-2 h-full pb-1">
                {history.length > 0 ? (
                  history.map((run) => (
                    <div
                      key={run.id}
                      className={`relative flex-shrink-0 h-full w-44 border rounded-lg overflow-hidden cursor-pointer group bg-black/30 p-2 flex flex-col justify-between transition-all ${ selectedHistoryRun?.id === run.id ? 'border-purple-500 border-2' : 'border-white/10 hover:border-white/30' }`} // Changed color
                      onClick={() => handleSelectHistory(run)}
                      title={`Trained Video: ${run.modelName} on ${run.baseModel}`}
                    >
                      <div>
                          <div className="flex items-center justify-between mb-1">
                             <span className="text-white/90 text-xs font-medium block truncate" title={run.modelName}>{run.modelName}</span>
                                {run.status === 'Completed' && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
                                {run.status === 'Failed' && <X size={12} className="text-red-500 flex-shrink-0" />}
                                {run.status === 'In Progress' && <Loader size={12} className="text-purple-500 flex-shrink-0 animate-spin" />}
                          </div>
                          <span className="text-white/60 text-[10px] block truncate">Base: {run.baseModel}</span>
                           <span className="text-white/50 text-[9px] block mt-0.5 truncate" title={run.datasetInfo}>Data: {run.datasetInfo || 'N/A'}</span>
                           {run.settings && (
                                <span className="text-white/50 text-[9px] block mt-0.5 truncate" title={`Steps: ${run.settings.max_train_steps}, Len: ${run.settings.video_length}, Res: ${run.settings.resolution_width}x${run.settings.resolution_height}`}>
                                    {run.settings.max_train_steps} steps, {run.settings.video_length}f, {run.settings.resolution_width}x{run.settings.resolution_height}
                                </span>
                           )}
                      </div>
                        <span className="text-white/50 text-[9px] block mt-1 text-right">{run.timestamp.toLocaleDateString()}</span>
                      <button
                        onClick={(e) => handleDeleteHistoryItem(run.id, e)}
                        className="absolute top-0.5 right-0.5 p-0.5 bg-red-600/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                        title="Delete Run"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
                    <p>Video training runs will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoRaVideoTrainComponent;

// Optional: Add global Window type extension if needed
declare global {
  interface Window {
    // Define any specific API keys your training service might need
  }
}


