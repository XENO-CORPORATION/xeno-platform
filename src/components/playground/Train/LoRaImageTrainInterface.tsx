import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, FileText, BrainCircuit, Settings, X, Info, RotateCw, Download, Trash2, CheckCircle, Loader } from 'lucide-react'; // Adjusted icons
// TODO: Create and import a LoRa training service
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';

// Mock service for LoRa Image Training
type MockBaseModelId = 'sd-1.5' | 'sdxl-1.0'; // Example base model IDs

const mockLoRaImageTrainService = {
  baseModelRegistry: {
    'sd-1.5': { provider: 'mock', name: 'Stable Diffusion 1.5' },
    'sdxl-1.0': { provider: 'mock', name: 'Stable Diffusion XL 1.0' },
  } as const,

  // Simulate training process
  trainModel: async (
    settings: any,
    onProgress: (update: { status: string; progress: number; eta?: number; logs?: string[]; samples?: string[] }) => void
  ): Promise<{ success: boolean; model_id?: string; error?: string; final_logs?: string[] }> => {
    console.log(`[MockLoRaTrain] Starting training with settings:`, settings);
    let progress = 0;
    const totalSteps = settings.max_train_steps || 1500;
    const logs: string[] = ['Training initiated...'];
    const samples: string[] = []; // Placeholder for sample image URLs

    // Simulate progress updates
    const interval = setInterval(() => {
      progress += Math.random() * (100 / (totalSteps / 50)); // Simulate variable progress
      progress = Math.min(progress, 100);
      const eta = progress < 100 ? Math.round(((100 - progress) / 100) * (totalSteps * 0.1)) : 0; // Rough ETA simulation
      
      logs.push(`Step ${Math.round((progress/100)*totalSteps)}/${totalSteps}: Loss = ${(Math.random() * 0.5 + 0.1).toFixed(4)}`);
      if (logs.length > 100) logs.shift(); // Keep logs manageable

      // Simulate occasional sample generation
      if (Math.random() < 0.1 && progress < 95) {
          // Placeholder sample image - replace with actual generation if possible
          samples.push(`https://via.placeholder.com/128/0000FF/FFFFFF?text=Sample+${samples.length + 1}`);
          if (samples.length > 4) samples.shift(); // Keep last 4 samples
          logs.push("Generated sample image.")
      }

      onProgress({ 
          status: 'Training...', 
          progress: Math.round(progress), 
          eta: eta, 
          logs: logs.length > 0 ? [...logs] : [],
          samples: samples.length > 0 ? [...samples] : []
      });

      if (progress >= 100) {
        clearInterval(interval);
        // Resolve promise after interval cleared
      }
    }, 200); // Update every 200ms

    // Wait for training to complete (progress >= 100)
    await new Promise<void>(resolve => {
        const checkCompletion = () => {
            if (progress >= 100) {
                resolve();
            } else {
                setTimeout(checkCompletion, 100);
            }
        };
        checkCompletion();
    });
    
    // Simulate success or failure at the end
    if (Math.random() < 0.1) {
        logs.push('Training failed: Mock error during finalization.');
      return { success: false, error: 'Mock training failed', final_logs: logs };
    }

    logs.push('Training completed successfully!');
    const trainedModelId = `${settings.model_name || 'trained_lora'}_${Date.now()}`;
    console.log(`[MockLoRaTrain] Training finished. Model ID: ${trainedModelId}`);
    return { 
        success: true, 
        model_id: trainedModelId, 
        final_logs: logs 
    };
  },

  getBaseModelDefaults: (modelId: string) => {
      if (modelId in mockLoRaImageTrainService.baseModelRegistry) {
        return mockLoRaImageTrainService.baseModelRegistry[modelId as MockBaseModelId];
      }
      return {};
  }
};
const loraTrainService = mockLoRaImageTrainService; // Use mock service

// Interface for training settings
interface LoRaTrainSettings {
    dataset_url: string; // URL to zip file or similar
    instance_prompt: string;
    class_prompt?: string;
    base_model: string;
    model_name: string;
    max_train_steps: number;
    learning_rate: number;
    resolution: number;
    batch_size: number;
    // Add other relevant hyperparameters
}

// Interface for training progress updates
interface TrainingProgress {
    status: string;
    progress: number;
    eta?: number;
    logs: string[];
    samples?: string[]; // URLs of sample images
}

// Interface for training history items
interface TrainingRun {
    id: string;
    modelName: string;
    baseModel: string;
    status: 'Completed' | 'Failed' | 'In Progress';
    timestamp: Date;
    datasetUrl?: string;
    settings?: Partial<LoRaTrainSettings>;
}

// Simple notification helper (reuse)
const notifications = {
  error: (message: string) => { console.error(`Error: ${message}`); alert("Error: " + message); },
  success: (message: string) => { console.log(`Success: ${message}`); /* No alert */ }
};

// --- Base Model Selector --- (Adapted from ImageGenerationInterface)
const BaseModelSelector = ({ 
  selectedModel,
  onChange,
  disabled
}: {
  selectedModel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  const getSelectedModelName = () => {
    if (!selectedModel) return 'Select Base Model';
    return loraTrainService.baseModelRegistry[selectedModel as MockBaseModelId]?.name || 'Select Base Model';
  };

  return (
    <select
      value={selectedModel}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none pr-8 bg-no-repeat bg-right px-2"
      style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23aaa" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundPosition: 'right 0.5rem center', backgroundSize: '1.2em' }}
    >
      <option value="" disabled>Select Base Model</option>
      {Object.entries(loraTrainService.baseModelRegistry).map(([id, model]) => (
        <option key={id} value={id}>
          {model.name}
        </option>
      ))}
    </select>
  );
};

// --- Main LoRa Image Training Interface Component ---
const LoRaImageTrainComponent: React.FC = () => {
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [datasetUrl, setDatasetUrl] = useState<string>(''); // Store uploaded file URL/ref
  const [instancePrompt, setInstancePrompt] = useState<string>('photo of sks character');
  const [classPrompt, setClassPrompt] = useState<string>('photo of a character');
  const [modelName, setModelName] = useState<string>('my-lora-model');
  const [baseModel, setBaseModel] = useState<string>('sdxl-1.0');

  // Training parameters
  const [maxTrainSteps, setMaxTrainSteps] = useState<number>(1500);
  const [learningRate, setLearningRate] = useState<number>(0.0001);
  const [resolution, setResolution] = useState<number>(768);
  const [batchSize, setBatchSize] = useState<number>(4);

  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainedModelId, setTrainedModelId] = useState<string | null>(null);

  const [history, setHistory] = useState<TrainingRun[]>([]);
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<TrainingRun | null>(null);

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
      // Basic validation (e.g., check for zip)
      if (!file.name.endsWith('.zip')) {
        notifications.error('Please upload a zip file containing your images.');
        return;
      }
      setDatasetFile(file);
      setDatasetUrl(URL.createObjectURL(file)); // Create a temporary URL for display/reference
      console.log('Dataset file selected:', file.name);
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
      notifications.error('Please upload a dataset zip file.');
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
        notifications.error('Please select a base model.');
        return;
    }

    setIsTraining(true);
    setTrainingError(null);
    setTrainingProgress({ status: 'Preparing...', progress: 0, logs: ['Preparing training environment...'] });
    setTrainedModelId(null);

    try {
      // ** TODO: Replace with actual service call to upload file and start training **
      // In a real app, you'd upload `datasetFile` to a storage service (e.g., S3)
      // get a permanent URL, and pass that URL along with other settings.
      const dataset_url_for_service = `mock_upload_path/${datasetFile.name}`; // Placeholder
      
      const settings: LoRaTrainSettings = {
        dataset_url: dataset_url_for_service, 
        instance_prompt: instancePrompt,
        class_prompt: classPrompt || undefined, // Only include if provided
        base_model: baseModel,
        model_name: modelName,
        max_train_steps: maxTrainSteps,
        learning_rate: learningRate,
        resolution: resolution,
        batch_size: batchSize,
      };

      const currentRun: TrainingRun = {
        id: `train_${Date.now()}`,
        modelName: modelName,
        baseModel: baseModel,
        status: 'In Progress',
        timestamp: new Date(),
        datasetUrl: datasetFile.name, // Store filename for history
        settings: { max_train_steps: maxTrainSteps, learning_rate: learningRate, resolution: resolution, batch_size: batchSize }
      };
      setHistory(prev => [currentRun, ...prev].slice(0, 20));
      setSelectedHistoryRun(currentRun);

      // Call the mock service
      const result = await loraTrainService.trainModel(settings, (update) => {
        setTrainingProgress(prev => {
            const currentLogs = prev?.logs ?? [];
            const currentSamples = prev?.samples ?? [];
            return {
                ...(prev ?? {}),
                ...update,
                logs: update.logs ? [...currentLogs, ...update.logs] : currentLogs,
                samples: update.samples ? [...currentSamples, ...update.samples] : currentSamples,
            };
        });
      });

      if (result.success && result.model_id) {
        setTrainedModelId(result.model_id);
        notifications.success(`Training completed! Model ID: ${result.model_id}`);
        // Update history item status
        setHistory(prev => prev.map(run => run.id === currentRun.id ? { ...run, status: 'Completed' } : run));
        setSelectedHistoryRun(prev => prev?.id === currentRun.id ? { ...prev, status: 'Completed' } : prev);
      } else {
        setTrainingError(result.error || 'Training failed.');
        notifications.error(`Training failed: ${result.error || 'Unknown error'}`);
         // Update history item status
        setHistory(prev => prev.map(run => run.id === currentRun.id ? { ...run, status: 'Failed' } : run));
        setSelectedHistoryRun(prev => prev?.id === currentRun.id ? { ...prev, status: 'Failed' } : prev);
      }
       // Final progress update with final logs
       setTrainingProgress(null);

    } catch (error) {
      console.error('Error starting training:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setTrainingError(message);
      notifications.error(`Error: ${message}`);
       setHistory(prev => prev.map(run => run.id === history[0].id ? { ...run, status: 'Failed' } : run));
       setSelectedHistoryRun(prev => prev?.id === history[0].id ? { ...prev, status: 'Failed' } : prev);
        setTrainingProgress(prev => ({ 
           ...(prev ?? { status: 'Failed', progress: 0, logs: [] }), 
           status: 'Failed',
           logs: [...(prev?.logs || []), `Error: ${message}`]
       }));
    } finally {
      setIsTraining(false);
    }
  };

  // --- History Management ---
  const handleSelectHistory = (run: TrainingRun) => {
      setSelectedHistoryRun(run);
      // Potentially load logs or details if stored/available
      setTrainingProgress(null); // Clear current progress when viewing history
      setTrainingError(null);
      setTrainedModelId(null);
      // You might want to pre-fill settings based on the selected run
      // setModelName(run.modelName);
      // setBaseModel(run.baseModel);
      // ...etc
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear the training history?')) {
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
      {/*!apiTokenAvailable && <ApiTokenNotice serviceKey="your_training_service_key" />*/}

      <div className="flex flex-col lg:flex-row h-full relative gap-2">
        {/* Left Panel (Controls) */} 
        <div className="lg:w-[30%] lg:max-w-[350px]">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-3 space-y-3 h-full flex flex-col">

            {/* Training Data Input */} 
            <div className="space-y-2">
              <label className="text-xs font-medium text-white/70">Training Dataset (Images)</label>
              {!datasetUrl ? (
                <button
                  onClick={handleUploadClick}
                  className="w-full h-24 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors"
                  disabled={isTraining}
                >
                  <UploadCloud size={24} className="mb-1" />
                  <span className="text-sm">Upload .zip</span>
                  <span className="text-xs mt-0.5">(Drag & drop ok)</span>
                </button>
              ) : (
                <div className="relative bg-black/30 rounded-lg p-2 border border-white/10 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-white/80">
                      <FileText size={16} className="mr-2 text-blue-400 flex-shrink-0" />
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
                accept=".zip"
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
                placeholder="Instance Prompt (e.g., a photo of sks dog)"
                className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={isTraining}
              />
              <input
                type="text"
                value={classPrompt}
                onChange={(e) => setClassPrompt(e.target.value)}
                placeholder="Class Prompt (optional, e.g., a photo of a dog)"
                className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={isTraining}
              />
               <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="Output Model Name (e.g., my-dog-lora)"
                className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={isTraining}
              />
            </div>

            {/* Training Parameters */} 
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="text-xs font-medium text-white/70">Training Parameters</label>
              <BaseModelSelector
                selectedModel={baseModel}
                onChange={setBaseModel}
                disabled={isTraining}
              />
              <div className="grid grid-cols-2 gap-2">
                 {/* Resolution */} 
                 <div>
                      <label className="block text-xs text-white/60 mb-1">Resolution</label>
                     <select
                        value={resolution}
                        onChange={(e) => setResolution(Number(e.target.value))}
                        disabled={isTraining}
                        className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none pr-6 bg-no-repeat bg-right"
                        style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23aaa" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundPosition: 'right 0.3rem center', backgroundSize: '1em' }}
                     >
                        <option value={512}>512x512</option>
                        <option value={768}>768x768</option>
                        <option value={1024}>1024x1024</option>
                    </select>
                 </div>
                 {/* Batch Size */} 
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
                        <option value={2}>2</option>
                        <option value={4}>4</option>
                        <option value={8}>8</option>
                    </select>
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
                       step={100}
                    />
                </div>
                <div>
                    <label className="block text-xs text-white/60 mb-1">Learning Rate</label>
                     <input 
                       type="number"
                       value={learningRate}
                       onChange={e => setLearningRate(parseFloat(e.target.value) || 0.0001)}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={0.00001}
                       min={0.000001}
                       max={0.001}
                       pattern="[0-9]+([.][0-9]+)?"
                       title="e.g., 0.0001 or 1e-4"
                    />
                 </div>
              </div>
            </div>

            {/* Start Training Button */} 
            <div className="mt-auto pt-3">
                <button
                  onClick={handleStartTraining}
                  disabled={isTraining || !datasetFile}
                  className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-sm font-semibold transition-colors duration-200 ${ isTraining ? 'bg-black/50 cursor-not-allowed' : !datasetFile ? 'bg-zinc-800/40 border border-zinc-700/40 opacity-60 cursor-not-allowed' : 'bg-blue-700 hover:bg-blue-600 border border-blue-600 hover:border-blue-500' }`}
                >
                {isTraining ? (
                    <> <RotateCw size={16} className="mr-2 animate-spin" /> Training... ({trainingProgress?.progress || 0}%) </> 
                ) : (
                    <> <BrainCircuit size={16} className="mr-2" /> Start Training </> 
                )}
              </button>
              {trainingError && <p className="text-red-500 text-xs mt-2 text-center">Error: {trainingError}</p>}
              {trainedModelId && !isTraining && (
                  <div className="mt-2 text-center text-green-400 text-xs p-2 bg-green-900/30 border border-green-700/50 rounded-md">
                      Training Complete! Model ID: {trainedModelId}
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
                 <h3 className="text-sm font-medium text-white/90">Training Status</h3>
                 {/* Can add pause/cancel buttons here */} 
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
                       className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                       style={{ width: `${trainingProgress.progress}%` }}
                    ></div>
                </div>
             </div>
            )}
            {/* Log Output Area */}
             <div 
                ref={logsContainerRef} 
                className="flex-1 bg-black/40 rounded-lg p-3 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mb-3 text-xs font-mono text-white/70 leading-relaxed"
                 // style={{ maxHeight: 'calc(100% - 80px)' }} // Removed explicit max height
             >
                {trainingProgress?.logs && trainingProgress.logs.length > 0 ? (
                 trainingProgress.logs.map((log, index) => <div key={index}>{log}</div>)
                ) : (
                 <div className="text-center text-white/40 italic">{isTraining ? 'Waiting for logs...' : 'Logs will appear here...'}</div>
                )}
            </div>
            {/* Sample Images Section Removed from here */}
          </div>

          {/* NEW Container 2: Sample Images */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 flex flex-col" style={{ height: '130px', minHeight: '130px' }}>
            <div className="text-xs text-white/60 mb-1 px-1 flex-shrink-0">Sample Images</div>
             <div className="flex-1 flex space-x-2 h-full bg-black/20 rounded p-1 border border-white/10 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
             {trainingProgress?.samples && trainingProgress.samples.length > 0 ? (
                 trainingProgress.samples.map((url, index) => (
                     <img key={index} src={url} alt={`Sample ${index + 1}`} className="h-full aspect-square object-cover rounded flex-shrink-0" />
                 ))
             ) : (
                  <div className="flex items-center justify-center w-full h-full text-white/40 text-sm italic">{isTraining ? 'Generating samples...' : 'No samples yet'}</div>
             )}
            </div>
          </div>

          {/* Container 3: Training History */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 flex flex-col" style={{ height: '130px', minHeight: '130px' }}>
            <div className="flex justify-between items-center mb-1 px-1 flex-shrink-0">
              <div className="text-xs text-white/60">Training History</div>
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
                      className={`relative flex-shrink-0 h-full w-40 border rounded-lg overflow-hidden cursor-pointer group bg-black/30 p-2 flex flex-col justify-between transition-all ${ selectedHistoryRun?.id === run.id ? 'border-blue-500 border-2' : 'border-white/10 hover:border-white/30' }`}
                      onClick={() => handleSelectHistory(run)}
                      title={`Trained: ${run.modelName} on ${run.baseModel}`}
                    >
                      <div>
                          <div className="flex items-center justify-between mb-1">
                             <span className="text-white/90 text-xs font-medium block truncate" title={run.modelName}>{run.modelName}</span>
                                {run.status === 'Completed' && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
                                {run.status === 'Failed' && <X size={12} className="text-red-500 flex-shrink-0" />}
                                {run.status === 'In Progress' && <Loader size={12} className="text-blue-500 flex-shrink-0 animate-spin" />}
                          </div>
                          <span className="text-white/60 text-[10px] block truncate">Base: {run.baseModel}</span>
                           <span className="text-white/50 text-[9px] block mt-0.5 truncate" title={run.datasetUrl}>Data: {run.datasetUrl || 'N/A'}</span>
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
                    <p>Training runs will appear here</p>
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

export default LoRaImageTrainComponent;

// Optional: Add global Window type extension if needed
declare global {
  interface Window {
    // Define any specific API keys your training service might need
  }
} 