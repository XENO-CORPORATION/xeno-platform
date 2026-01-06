import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, FileText, BrainCircuit, Settings, X, Info, RotateCw, Download, Trash2, CheckCircle, Loader, BookOpen } from 'lucide-react'; // Added BookOpen
// TODO: Create and import a real LLM fine-tuning service
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';

// Mock service for Text LLM Fine-tuning
type MockTextBaseModelId = 'llama-3-8b' | 'gemma-7b' | 'mistral-7b'; // Example LLM base model IDs

const baseTextModels = {
    'llama-3-8b': { provider: 'meta', name: 'Llama 3 8B Instruct' },
    'gemma-7b': { provider: 'google', name: 'Gemma 7B Instruct' },
    'mistral-7b': { provider: 'mistralai', name: 'Mistral 7B Instruct' },
} as const;

const mockTextLLMTrainService = {
  baseModelRegistry: baseTextModels,

  // Simulate LLM fine-tuning process
  trainModel: async (
    settings: any,
    onProgress: (update: { status: string; progress: number; eta?: number; logs?: string[]; current_epoch?: number; total_epochs?: number; current_step?: number; total_steps?: number; loss?: number }) => void
  ): Promise<{ success: boolean; model_id?: string; error?: string; final_logs?: string[] }> => {
    console.log(`[MockLLMTrain] Starting fine-tuning with settings:`, settings);
    let progress = 0;
    const totalEpochs = settings.epochs || 3;
    const stepsPerEpoch = 500; // Mock value
    const totalSteps = totalEpochs * stepsPerEpoch;
    const logs: string[] = ['Fine-tuning initiated (LLM)...'];
    let currentEpoch = 0;
    let currentStepInEpoch = 0;
    let currentLoss = 1.5; // Starting mock loss

    // Simulate progress updates (more detailed for LLM)
    const interval = setInterval(() => {
      currentStepInEpoch++;
      const overallStep = currentEpoch * stepsPerEpoch + currentStepInEpoch;
      progress = (overallStep / totalSteps) * 100;
      progress = Math.min(progress, 100);

      const eta = progress < 100 ? Math.round(((100 - progress) / 100) * (totalSteps * 0.05)) : 0; // Rough ETA simulation
      
      // Simulate loss decrease
      currentLoss *= (0.995 - Math.random() * 0.01);
      currentLoss = Math.max(currentLoss, 0.1); // Floor loss

      const logEntry = `Epoch ${currentEpoch + 1}/${totalEpochs}, Step ${currentStepInEpoch}/${stepsPerEpoch}: Loss = ${currentLoss.toFixed(4)}`;
      logs.push(logEntry);
      if (logs.length > 200) logs.shift(); // Keep logs manageable

      onProgress({ 
          status: 'Fine-tuning LLM...', 
          progress: Math.round(progress), 
          eta: eta, 
          logs: [...logs].slice(-50), // Send only recent logs for UI update
          current_epoch: currentEpoch + 1,
          total_epochs: totalEpochs,
          current_step: currentStepInEpoch,
          total_steps: stepsPerEpoch,
          loss: parseFloat(currentLoss.toFixed(4))
      });

      if (currentStepInEpoch >= stepsPerEpoch) {
          currentStepInEpoch = 0;
          currentEpoch++;
          logs.push(`--- Epoch ${currentEpoch + 1} completed ---`);
          if (currentEpoch >= totalEpochs) {
              progress = 100;
              clearInterval(interval);
          }
      }
      
      if (progress >= 100) {
           clearInterval(interval);
      }

    }, 50); // Faster updates for step-based progress

    // Wait for training to complete
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
    
    // Simulate success or failure
    if (Math.random() < 0.05) {
        logs.push('Fine-tuning failed: Mock error during LLM finalization.');
        return { success: false, error: 'Mock LLM fine-tuning failed', final_logs: logs };
    }

    logs.push('LLM fine-tuning completed successfully!');
    const trainedModelId = `${settings.model_name || 'tuned_llm'}_${Date.now()}`;
    console.log(`[MockLLMTrain] Fine-tuning finished. Model ID: ${trainedModelId}`);
    return { 
        success: true, 
        model_id: trainedModelId, 
        final_logs: logs 
    };
  },

  getBaseModelDefaults: (modelId: string) => {
      if (modelId in mockTextLLMTrainService.baseModelRegistry) {
        return mockTextLLMTrainService.baseModelRegistry[modelId as MockTextBaseModelId];
      }
      return {};
  }
};
const llmTrainService = mockTextLLMTrainService; // Use mock LLM service

// Interface for Text LLM fine-tuning settings
interface TextTrainSettings {
    dataset_url: string; // URL to text dataset (.jsonl, .csv, .txt)
    data_format: 'jsonl' | 'csv' | 'txt' | 'auto';
    base_model: string;
    model_name: string;
    epochs: number;
    learning_rate: number;
    batch_size: number;
    max_sequence_length: number;
    // Add other relevant LLM hyperparameters (e.g., optimizer, scheduler, weight decay)
}

// Interface for LLM training progress updates
interface TextTrainUpdate {
    status: string;
    progress: number;
    eta?: number;
    logs: string[];
    current_epoch?: number;
    total_epochs?: number;
    current_step?: number;
    total_steps?: number;
    loss?: number;
}

// Interface for LLM fine-tuning history items
interface TextTrainHistoryItem {
    id: string;
    modelName: string;
    baseModel: string;
    status: 'Completed' | 'Failed' | 'In Progress';
    timestamp: Date;
    datasetInfo?: string; // Filename or description
    settings?: Partial<TextTrainSettings>;
    finalLoss?: number; // Optional: Record final metric
}

// Simple notification helper (reuse)
const notifications = {
  error: (message: string) => { console.error(`Error: ${message}`); alert("Error: " + message); },
  success: (message: string) => { console.log(`Success: ${message}`); /* No alert */ }
};

// --- Base Model Selector --- (Adapted for Text LLMs)
const TextBaseModelSelector = ({ 
  selectedModel,
  onChange,
  disabled
}: {
  selectedModel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  return (
    <select
      value={selectedModel}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none pr-8 bg-no-repeat bg-right px-2"
      style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23aaa" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundPosition: 'right 0.5rem center', backgroundSize: '1.2em' }}
    >
      <option value="" disabled>Select Base LLM</option>
      {Object.entries(llmTrainService.baseModelRegistry).map(([id, model]) => (
        <option key={id} value={id}>
          {model.name} ({model.provider})
        </option>
      ))}
    </select>
  );
};

// --- Text LLM Fine-tuning Component ---
export function TextLLMTrainComponent() {
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [datasetUrl, setDatasetUrl] = useState<string>('');
  const [modelName, setModelName] = useState<string>('my-tuned-llm');
  const [baseModel, setBaseModel] = useState<string>('llama-3-8b');

  // LLM Training parameters
  const [epochs, setEpochs] = useState<number>(3);
  const [learningRate, setLearningRate] = useState<number>(0.00002); // Common starting point for LLMs
  const [batchSize, setBatchSize] = useState<number>(4); // Depends heavily on GPU memory
  const [maxSeqLength, setMaxSeqLength] = useState<number>(1024);
  const [dataFormat, setDataFormat] = useState<'jsonl' | 'csv' | 'txt' | 'auto'>('auto');

  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<TextTrainUpdate | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainedModelId, setTrainedModelId] = useState<string | null>(null);

  const [history, setHistory] = useState<TextTrainHistoryItem[]>([]);
  const [availableBaseModels, setAvailableBaseModels] = useState<typeof baseTextModels>(baseTextModels);
  const [trainingDataPreview, setTrainingDataPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const lastLogTimestamp = useRef<number>(0);
  const logAccumulator = useRef<string[]>([]);

  // Fetch available models on mount (if dynamic)
  // useEffect(() => {
  //   llmTrainService.getBaseModels().then(setAvailableBaseModels);
  // }, []);

  // Debounced log update to prevent excessive re-renders
  useEffect(() => {
      if (logAccumulator.current.length > 0) {
          const now = Date.now();
          // Update immediately if more than 500ms passed or many logs accumulated
          if (now - lastLogTimestamp.current > 500 || logAccumulator.current.length > 10) {
              setTrainingProgress(prev => ({
                  ...(prev ?? { status: 'Fine-tuning LLM...', progress: 0, logs: [] }), // Provide default structure
                  logs: [...(prev?.logs ?? []), ...logAccumulator.current].slice(-200) // Append accumulated logs
              }));
              logAccumulator.current = []; // Clear accumulator
              lastLogTimestamp.current = now;
          } else {
              // Schedule an update if needed
              const timerId = setTimeout(() => {
                  if (logAccumulator.current.length > 0) {
                    setTrainingProgress(prev => ({
                        ...(prev ?? { status: 'Fine-tuning LLM...', progress: 0, logs: [] }),
                        logs: [...(prev?.logs ?? []), ...logAccumulator.current].slice(-200)
                    }));
                     logAccumulator.current = [];
                     lastLogTimestamp.current = Date.now();
                  }
              }, 500); // Update after 500ms delay
              return () => clearTimeout(timerId);
          }
      }
  }, [trainingProgress?.status]); // Re-evaluate when status might change, indicating new log streams

  // Scroll logs to bottom automatically
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [trainingProgress?.logs]); // Trigger scroll when logs *actually* update state

  // --- File Handling ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Basic validation
      const allowedTypes = ['.jsonl', '.csv', '.txt'];
      const fileExtension = file.name.substring(file.name.lastIndexOf('.'));
      if (!allowedTypes.includes(fileExtension)) {
        notifications.error(`Invalid file type. Please upload ${allowedTypes.join(', ')}`);
        return;
      }
      setDatasetFile(file);
      setDatasetUrl(URL.createObjectURL(file)); // Temporary URL
      console.log('Dataset file selected:', file.name);
      setTrainingError(null);

      // Auto-detect format if set to 'auto'
      if (dataFormat === 'auto') {
          if (fileExtension === '.jsonl') setDataFormat('jsonl');
          else if (fileExtension === '.csv') setDataFormat('csv');
          else if (fileExtension === '.txt') setDataFormat('txt');
      }
      
      // Optional: Show small preview of text file
      if (file.type.startsWith('text/') || fileExtension === '.jsonl') {
          const reader = new FileReader();
          reader.onload = (event) => {
              const text = event.target?.result as string;
              setTrainingDataPreview(text.substring(0, 500) + (text.length > 500 ? '...' : ''));
          };
          reader.readAsText(file.slice(0, 512)); // Read first 512 bytes for preview
      } else {
          setTrainingDataPreview(null);
      }

    } else {
        setDatasetFile(null);
        setDatasetUrl('');
        setTrainingDataPreview(null);
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
    setTrainingDataPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // --- Training Logic ---
  const handleTrainModel = async () => {
    if (!datasetFile) {
      notifications.error('Please upload a dataset file (.jsonl, .csv, .txt).');
      return;
    }
    if (!modelName.trim()) {
        notifications.error('Please provide a name for your fine-tuned model.');
        return;
    }
    if (!baseModel) {
        notifications.error('Please select a base LLM.');
        return;
    }

    setIsTraining(true);
    setTrainingError(null);
    setTrainedModelId(null);
    // Reset logs and progress for new run
    logAccumulator.current = [];
    setTrainingProgress({ status: 'Preparing...', progress: 0, logs: ['Preparing LLM fine-tuning environment...'] });
    lastLogTimestamp.current = Date.now();

    try {
      // ** TODO: Replace with actual service call **
      const dataset_url_for_service = `mock_upload_path/${datasetFile.name}`; // Placeholder
      
      const settings: TextTrainSettings = {
        dataset_url: dataset_url_for_service, 
        data_format: dataFormat,
        base_model: baseModel,
        model_name: modelName,
        epochs: epochs,
        learning_rate: learningRate,
        batch_size: batchSize,
        max_sequence_length: maxSeqLength
      };

      const currentRun: TextTrainHistoryItem = {
        id: `tune_${Date.now()}`,
        modelName: modelName,
        baseModel: llmTrainService.baseModelRegistry[baseModel as MockTextBaseModelId]?.name || baseModel,
        status: 'In Progress',
        timestamp: new Date(),
        datasetInfo: datasetFile.name,
        settings: { 
            epochs: epochs, 
            learning_rate: learningRate, 
            batch_size: batchSize, 
            max_sequence_length: maxSeqLength, 
            data_format: dataFormat 
        },
      };
      setHistory(prev => [currentRun, ...prev].slice(0, 20));
      setSelectedHistoryRun(currentRun);

      // Call the mock service
      const result = await llmTrainService.trainModel(settings, (update) => {
        // Accumulate logs instead of setting state directly
         if (update.logs && update.logs.length > 0) {
             logAccumulator.current.push(...update.logs);
         }
         // Update non-log progress directly (less frequent)
          setTrainingProgress(prev => ({
              ...(prev ?? { status: 'Fine-tuning LLM...', progress: 0, logs: [] }), // Ensure prev exists
              status: update.status,
              progress: update.progress,
              eta: update.eta,
              current_epoch: update.current_epoch,
              total_epochs: update.total_epochs,
              current_step: update.current_step,
              total_steps: update.total_steps,
              loss: update.loss,
              // Keep existing logs until accumulator flushes
              logs: prev?.logs ?? [], 
          }));
      });

      // Final flush of any remaining logs
        if (logAccumulator.current.length > 0) {
            setTrainingProgress(prev => ({
                ...(prev ?? { status: 'Finished', progress: 100, logs: [] }),
                logs: [...(prev?.logs ?? []), ...logAccumulator.current, ...(result.final_logs || [])].slice(-200)
            }));
            logAccumulator.current = [];
        } else {
             setTrainingProgress(prev => ({ 
               ...(prev ?? { status: 'Finished', progress: 100, logs: [] }), 
               logs: [...(prev?.logs || []), ...(result.final_logs || [])].slice(-200)
           }));
        }


      if (result.success && result.model_id) {
        setTrainedModelId(result.model_id);
        notifications.success(`Fine-tuning completed! Model ID: ${result.model_id}`);
        const finalLoss = trainingProgress?.loss; // Capture last known loss
        setHistory(prev => prev.map(run => run.id === currentRun.id ? { ...run, status: 'Completed', finalLoss } : run));
        setSelectedHistoryRun(prev => prev?.id === currentRun.id ? { ...prev, status: 'Completed', finalLoss } : prev);
         setTrainingProgress(prev => ({ ...(prev ?? { status: 'Finished', progress: 100, logs: [] }), status: 'Completed', progress: 100 }));

      } else {
        setTrainingError(result.error || 'Fine-tuning failed.');
        notifications.error(`Fine-tuning failed: ${result.error || 'Unknown error'}`);
        setHistory(prev => prev.map(run => run.id === currentRun.id ? { ...run, status: 'Failed' } : run));
        setSelectedHistoryRun(prev => prev?.id === currentRun.id ? { ...prev, status: 'Failed' } : prev);
         setTrainingProgress(prev => ({ ...(prev ?? { status: 'Failed', progress: 0, logs: [] }), status: 'Failed' }));
      }

    } catch (error) {
      console.error('Error starting fine-tuning:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setTrainingError(message);
      notifications.error(`Error: ${message}`);
       const currentRunId = history[0]?.id; // Assume latest run failed
       if (currentRunId) {
           setHistory(prev => prev.map(run => run.id === currentRunId ? { ...run, status: 'Failed' } : run));
           setSelectedHistoryRun(prev => prev?.id === currentRunId ? { ...prev, status: 'Failed' } : prev);
       }
       setTrainingProgress(prev => ({ 
           ...(prev ?? { status: 'Failed', progress: 0, logs: [] }), 
           status: 'Failed',
           logs: [...(prev?.logs || []), `Error: ${message}`]
       }));
    } finally {
      setIsTraining(false);
       // Keep final state visible unless starting new training
    }
  };

  // --- History Management ---
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<TextTrainHistoryItem | null>(null);

  const handleSelectHistory = (run: TextTrainHistoryItem) => {
      setSelectedHistoryRun(run);
      setTrainingProgress(null); 
      setTrainingError(null);
      setTrainedModelId(null);
      // Pre-fill settings (optional)
      setModelName(run.modelName);
      const baseModelKey = Object.entries(llmTrainService.baseModelRegistry).find(
          ([_, model]) => model.name === run.baseModel
      )?.[0];
      if (baseModelKey) setBaseModel(baseModelKey);
      if (run.settings) {
          if(run.settings.epochs) setEpochs(run.settings.epochs);
          if(run.settings.learning_rate) setLearningRate(run.settings.learning_rate);
          if(run.settings.batch_size) setBatchSize(run.settings.batch_size);
          if(run.settings.max_sequence_length) setMaxSeqLength(run.settings.max_sequence_length);
          if(run.settings.data_format) setDataFormat(run.settings.data_format);
      }
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear the LLM fine-tuning history?')) {
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
      {/* <ApiTokenNotice serviceKey="your_llm_training_service_key" /> */}

      <div className="flex flex-col lg:flex-row h-full relative gap-2">
        {/* Left Panel (Controls) */} 
        <div className="lg:w-[30%] lg:max-w-[350px]">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-3 space-y-3 h-full flex flex-col">

            {/* Training Data Input */} 
            <div className="space-y-2">
              <label className="text-xs font-medium text-white/70">Training Dataset (Text)</label>
              {!datasetUrl ? (
                <button
                  onClick={handleUploadClick}
                  className="w-full h-24 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors"
                  disabled={isTraining}
                >
                  <UploadCloud size={24} className="mb-1" />
                  <span className="text-sm">Upload .jsonl, .csv, .txt</span>
                  <span className="text-xs mt-0.5">(Drag & drop ok)</span>
                </button>
              ) : (
                <div className="relative bg-black/30 rounded-lg p-2 border border-white/10 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-white/80">
                      <FileText size={16} className="mr-2 text-green-400 flex-shrink-0" />
                      <span className="text-xs truncate" title={datasetFile?.name}>{datasetFile?.name}</span>
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
                  {trainingDataPreview && (
                      <div className="mt-2 border-t border-white/10 pt-1">
                          <p className="text-xs text-white/50 mb-1">Preview:</p>
                          <p className="text-[10px] text-white/60 font-mono bg-black/20 p-1 rounded overflow-hidden whitespace-pre-wrap break-words max-h-16 overflow-y-auto">
                              {trainingDataPreview}
                          </p>
                      </div>
                  )}
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".jsonl,.csv,.txt"
                className="hidden"
                disabled={isTraining}
              />
            </div>

            {/* Model Naming */} 
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="text-xs font-medium text-white/70">Model & Naming</label>
              <TextBaseModelSelector
                selectedModel={baseModel}
                onChange={setBaseModel}
                disabled={isTraining}
              />
               <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="Output Model Name (e.g., my-tuned-llm)"
                className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={isTraining}
              />
            </div>

            {/* Training Parameters */} 
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="text-xs font-medium text-white/70">Fine-tuning Parameters</label>
                {/* Epochs & LR */} 
               <div className="grid grid-cols-2 gap-2">
                 <div>
                    <label className="block text-xs text-white/60 mb-1">Epochs</label>
                    <input 
                       type="number"
                       value={epochs}
                       onChange={e => setEpochs(Math.max(1, parseInt(e.target.value) || 1))}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={1}
                       min={1}
                    />
                </div>
                <div>
                    <label className="block text-xs text-white/60 mb-1">Learning Rate</label>
                     <input 
                       type="number"
                       value={learningRate}
                       onChange={e => setLearningRate(parseFloat(e.target.value) || 0.00002)}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={0.000001}
                       min={0.0000001}
                       max={0.001}
                       pattern="[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?" // Allow scientific notation
                       title="e.g., 0.00002 or 2e-5"
                    />
                 </div>
              </div>
              {/* Batch Size & Seq Length */} 
               <div className="grid grid-cols-2 gap-2">
                 <div>
                    <label className="block text-xs text-white/60 mb-1">Batch Size</label>
                    <input 
                       type="number"
                       value={batchSize}
                       onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value) || 1))}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={1}
                       min={1}
                    />
                </div>
                <div>
                    <label className="block text-xs text-white/60 mb-1">Max Seq Length</label>
                     <input 
                       type="number"
                       value={maxSeqLength}
                       onChange={e => setMaxSeqLength(Math.max(128, parseInt(e.target.value) || 128))}
                       className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isTraining}
                       step={64}
                       min={128}
                    />
                 </div>
              </div>
              {/* Data Format */} 
                 <div>
                      <label className="block text-xs text-white/60 mb-1">Data Format</label>
                     <select
                        value={dataFormat}
                        onChange={(e) => setDataFormat(e.target.value as typeof dataFormat)}
                        disabled={isTraining}
                        className="w-full bg-black/30 border border-white/10 rounded-md p-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none pr-6 bg-no-repeat bg-right"
                        style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23aaa" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundPosition: 'right 0.3rem center', backgroundSize: '1em' }}
                     >
                        <option value="auto">Auto-detect</option>
                        <option value="jsonl">JSONL</option>
                        <option value="csv">CSV</option>
                        <option value="txt">Plain Text</option>
                    </select>
                 </div>
            </div>

            {/* Start Training Button */} 
            <div className="mt-auto pt-3">
                <button
                  onClick={handleTrainModel}
                  disabled={isTraining || !datasetFile}
                  className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-sm font-semibold transition-colors duration-200 ${ isTraining ? 'bg-black/50 cursor-not-allowed' : !datasetFile ? 'bg-zinc-800/40 border border-zinc-700/40 opacity-60 cursor-not-allowed' : 'bg-green-700 hover:bg-green-600 border border-green-600 hover:border-green-500' }`} // Green theme
                >
                {isTraining ? (
                    <> <RotateCw size={16} className="mr-2 animate-spin" /> Fine-tuning... ({trainingProgress?.progress || 0}%) </> 
                ) : (
                    <> <BookOpen size={16} className="mr-2" /> Start Fine-tuning </> 
                )}
              </button>
              {trainingError && <p className="text-red-500 text-xs mt-2 text-center">Error: {trainingError}</p>}
              {trainedModelId && !isTraining && (
                  <div className="mt-2 text-center text-green-400 text-xs p-2 bg-green-900/30 border border-green-700/50 rounded-md">
                      Fine-tuning Complete! Model ID: {trainedModelId}
                  </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel (Status/Logs & History) */} 
        <div className="flex-1 flex flex-col gap-2">
          {/* Container 1: Training Status & Logs */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col flex-grow" style={{ minHeight: '400px' }}> {/* Adjusted minHeight */} 
             <div className="flex justify-between items-center mb-2 flex-shrink-0">
                 <h3 className="text-sm font-medium text-white/90">Fine-tuning Status</h3>
                 {/* Add pause/cancel buttons here */} 
            </div>
             {/* Progress Bar & Status */} 
            {trainingProgress && (
              <div className="mb-3 flex-shrink-0">
                <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-white/70 font-medium">
                        {trainingProgress.status} 
                        {trainingProgress.current_epoch && ` (Epoch ${trainingProgress.current_epoch}/${trainingProgress.total_epochs || '?'})`}
                        {trainingProgress.current_step && ` (Step ${trainingProgress.current_step}/${trainingProgress.total_steps || '?'})`}
                    </span>
                    <span className="text-white/60">
                        {trainingProgress.loss !== undefined && `Loss: ${trainingProgress.loss.toFixed(4)} | `}
                        {trainingProgress.progress}% 
                        {trainingProgress.eta !== undefined && trainingProgress.eta > 0 ? ` (ETA: ~${trainingProgress.eta}s)` : ''}
                    </span>
                </div>
                <div className="w-full bg-black/30 rounded-full h-2 overflow-hidden border border-white/10">
                    <div 
                       className="bg-green-600 h-full rounded-full transition-all duration-300 ease-out" // Green theme
                       style={{ width: `${trainingProgress.progress}%` }}
                    ></div>
                </div>
             </div>
            )}
            {/* Log Output Area */} 
             <div 
                ref={logsContainerRef} 
                className="flex-1 bg-black/40 rounded-lg p-3 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent text-xs font-mono text-white/70 leading-relaxed"
             >
                {trainingProgress?.logs && trainingProgress.logs.length > 0 ? (
                 trainingProgress.logs.map((log, index) => <div key={index}>{log}</div>)
                ) : (
                 <div className="text-center text-white/40 italic">{isTraining ? 'Waiting for fine-tuning logs...' : 'Logs will appear here...'}</div>
                )}
            </div>
            {/* No Sample container needed for LLM */} 
          </div>

          {/* Container 2: Training History */} 
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 flex flex-col" style={{ height: '130px', minHeight: '130px' }}>
            <div className="flex justify-between items-center mb-1 px-1 flex-shrink-0">
              <div className="text-xs text-white/60">LLM Fine-tuning History</div>
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
                      className={`relative flex-shrink-0 h-full w-48 border rounded-lg overflow-hidden cursor-pointer group bg-black/30 p-2 flex flex-col justify-between transition-all ${ selectedHistoryRun?.id === run.id ? 'border-green-500 border-2' : 'border-white/10 hover:border-white/30' }`} // Green theme
                      onClick={() => handleSelectHistory(run)}
                      title={`Tuned: ${run.modelName} on ${run.baseModel}`}
                    >
                      <div>
                          <div className="flex items-center justify-between mb-1">
                             <span className="text-white/90 text-xs font-medium block truncate" title={run.modelName}>{run.modelName}</span>
                                {run.status === 'Completed' && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
                                {run.status === 'Failed' && <X size={12} className="text-red-500 flex-shrink-0" />}
                                {run.status === 'In Progress' && <Loader size={12} className="text-green-500 flex-shrink-0 animate-spin" />}
                          </div>
                          <span className="text-white/60 text-[10px] block truncate">Base: {run.baseModel}</span>
                           <span className="text-white/50 text-[9px] block mt-0.5 truncate" title={run.datasetInfo}>Data: {run.datasetInfo || 'N/A'} ({run.settings?.data_format || 'N/A'})</span>
                           {run.settings && (
                                <span className="text-white/50 text-[9px] block mt-0.5 truncate" title={`Epochs: ${run.settings.epochs}, BS: ${run.settings.batch_size}, LR: ${run.settings.learning_rate}, SeqLen: ${run.settings.max_sequence_length}`}>
                                    {run.settings.epochs} E, BS {run.settings.batch_size}, LR {run.settings.learning_rate?.toExponential(1)}, Seq {run.settings.max_sequence_length}
                                </span>
                           )}
                           {run.status === 'Completed' && run.finalLoss !== undefined && (
                               <span className="text-green-400/70 text-[9px] block mt-0.5">Final Loss: {run.finalLoss.toFixed(4)}</span>
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
                    <p>LLM fine-tuning runs will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TextLLMTrainComponent;

// Optional: Define global types if needed
declare global {
  interface Window {
    // ...
  }
}
 