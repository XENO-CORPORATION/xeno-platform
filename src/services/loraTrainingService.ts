import { API_TOKENS, API_ENDPOINTS } from '../config/apiConfig';

export interface LoraTrainingOptions {
  // Required parameters
  instanceData: string;  // URL to zip file containing training images
  task: 'face' | 'object' | 'style'; // Type of concept to train
  
  // Optional parameters with defaults
  numSteps?: number;     // Number of training steps (default depends on task)
  learningRate?: number; // Learning rate for training (default: 0.0004)
  batchSize?: number;    // Batch size for training (default: 1)
  resolution?: number;   // Training resolution (default: 512)
  
  // Advanced parameters
  loraRank?: number;     // LoRA rank dimensionality (default: 32)
  unetLr?: number;       // U-Net learning rate
  textEncoderLr?: number; // Text encoder learning rate
  instancePrompt?: string; // Instance prompt for training
  classPrompt?: string;   // Class prompt for prior preservation
  maxTrainSteps?: number; // Maximum number of training steps
  
  // Hugging Face integration
  hfToken?: string;       // Hugging Face API token for saving model
  hfModelRepo?: string;   // Repository name to save model to
  
  // Optional callback for progress updates
  onProgress?: (progress: number) => void;
}

export interface LoraTrainingResponse {
  modelUrl: string;      // URL to the trained model weights file
  trainingId: string;    // ID of the training run
  completedAt: string;   // Timestamp when training completed
  modelType: string;     // Type of model trained (e.g., "lora")
  baseModel: string;     // Base model used for training
  metadata: {
    task: string;
    steps: number;
    learningRate: number;
    resolution: number;
    batchSize: number;
    loraRank?: number;
    [key: string]: any;  // Other metadata
  };
}

/**
 * LoRA Training Service for fine-tuning models using the Replicate API
 */
export class LoraTrainingService {
  private readonly apiToken: string;
  private readonly apiEndpoint: string;
  
  constructor() {
    this.apiToken = API_TOKENS.REPLICATE_API_TOKEN || '';
    this.apiEndpoint = API_ENDPOINTS.REPLICATE_API || 'https://api.replicate.com';
    
    if (!this.apiToken) {
      console.warn('Replicate API token is not configured. LoRA training will not work.');
    }
  }
  
  /**
   * Train a LoRA model with the given options
   */
  async trainLora(options: LoraTrainingOptions): Promise<LoraTrainingResponse> {
    if (!this.apiToken) {
      throw new Error('Replicate API token is not configured');
    }
    
    // Validate required parameters
    if (!options.instanceData) {
      throw new Error('Instance data URL is required');
    }
    
    if (!options.task) {
      throw new Error('Task type is required (face, object, or style)');
    }
    
    // Set model version based on task
    const modelVersion = "b2a308762e36ac48d16bfadc03a65493fe6e799f429f7941639a6acec5b276cc"; // replicate/lora-training latest version
    
    // Create input payload
    const inputPayload: Record<string, any> = {
      instance_data: options.instanceData,
      task: options.task,
    };
    
    // Add optional parameters if provided
    if (options.numSteps) inputPayload.num_steps = options.numSteps;
    if (options.learningRate) inputPayload.learning_rate = options.learningRate;
    if (options.batchSize) inputPayload.batch_size = options.batchSize;
    if (options.resolution) inputPayload.resolution = options.resolution;
    if (options.loraRank) inputPayload.lora_rank = options.loraRank;
    if (options.unetLr) inputPayload.unet_lr = options.unetLr;
    if (options.textEncoderLr) inputPayload.text_encoder_lr = options.textEncoderLr;
    if (options.instancePrompt) inputPayload.instance_prompt = options.instancePrompt;
    if (options.classPrompt) inputPayload.class_prompt = options.classPrompt;
    if (options.maxTrainSteps) inputPayload.max_train_steps = options.maxTrainSteps;
    if (options.hfToken) inputPayload.hf_token = options.hfToken;
    if (options.hfModelRepo) inputPayload.hf_model_repo = options.hfModelRepo;
    
    try {
      console.log(`Starting LoRA training with options:`, JSON.stringify(inputPayload, null, 2));
      
      // Create prediction with proper CORS handling
      const response = await fetch(`${this.apiEndpoint}/v1/predictions`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiToken}`
        },
        body: JSON.stringify({
          version: modelVersion,
          input: inputPayload
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetail = `HTTP error ${response.status}`;
        
        try {
          const errorData = JSON.parse(errorText);
          errorDetail = errorData.detail || errorData.error || errorText;
        } catch (e) {
          // If parsing fails, use the raw text
          errorDetail = errorText || errorDetail;
        }
        
        console.error(`Replicate API error:`, errorDetail);
        throw new Error(`Failed to start LoRA training: ${errorDetail}`);
      }

      const prediction = await response.json();
      const predictionId = prediction.id;

      console.log(`Started LoRA training with ID: ${predictionId}`);

      // Poll until the prediction is complete with proper CORS handling
      let finalPrediction: any = null;
      let status = prediction.status || 'starting';
      
      while (status !== 'succeeded' && status !== 'failed' && status !== 'canceled') {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds between poll requests
        
        const pollResponse = await fetch(`${this.apiEndpoint}/v1/predictions/${predictionId}`, {
          mode: 'cors',
          credentials: 'same-origin',
          headers: {
            'Authorization': `Token ${this.apiToken}`
          }
        });
        
        if (!pollResponse.ok) {
          throw new Error(`Failed to check training status: ${pollResponse.status}`);
        }
        
        const currentPrediction = await pollResponse.json();
        finalPrediction = currentPrediction;
        status = currentPrediction.status;
        
        console.log(`Training status: ${status}, progress: ${currentPrediction.progress || 'unknown'}`);
        
        // Call progress callback if provided
        if (options.onProgress && currentPrediction.progress) {
          options.onProgress(parseFloat(currentPrediction.progress) * 100);
        }
        
        if (status === 'failed') {
          const errorMessage = currentPrediction.error || 'LoRA training failed';
          console.error(`Training failed:`, errorMessage);
          throw new Error(errorMessage);
        }
        
        if (status === 'canceled') {
          console.error(`Training was canceled by the user or system`);
          throw new Error('LoRA training was canceled');
        }
      }

      // Check if we have a valid result
      if (!finalPrediction) {
        console.error('No prediction data received');
        throw new Error('Failed to train LoRA: No prediction data received');
      }
      
      if (!finalPrediction.output) {
        console.error('No output generated from Replicate model');
        throw new Error('Failed to train LoRA: No output received from the model');
      }      // Log the result - truncate if it contains text content
      const outputForLogging = JSON.stringify(finalPrediction.output);
      console.log('Training completed successfully (truncated if text):', 
        outputForLogging.length > 200 ? outputForLogging.substring(0, 200) + '... [output truncated for logging]' : outputForLogging);
      
      // The output is the URL to the trained model
      const modelUrl = finalPrediction.output;
      
      return {
        modelUrl,
        trainingId: finalPrediction.id,
        completedAt: finalPrediction.completed_at || new Date().toISOString(),
        modelType: 'lora',
        baseModel: 'stable-diffusion-v1-5',
        metadata: {
          task: options.task,
          steps: options.numSteps || (options.task === 'style' ? 1000 : 500),
          learningRate: options.learningRate || 0.0004,
          resolution: options.resolution || 512,
          batchSize: options.batchSize || 1,
          loraRank: options.loraRank,
          trainingTime: finalPrediction.metrics?.predict_time || 0,
        }
      };
    } catch (error: any) {
      console.error('Replicate API error during LoRA training:', error);
      throw error;
    }
  }
  
  /**
   * Generate an image using a trained LoRA model
   */
  async generateWithLora(
    prompt: string,
    loraUrls: string | string[],
    numInferenceSteps: number = 50,
    guidanceScale: number = 7.5,
    negativePrompt: string = "",
    width: number = 512,
    height: number = 512,
    seed: number = -1
  ): Promise<string> {
    if (!this.apiToken) {
      throw new Error('Replicate API token is not configured');
    }
    
    // Format lora_urls for the API
    const formattedLoraUrls = Array.isArray(loraUrls) ? loraUrls.join('|') : loraUrls;
    
    // Create input payload
    const inputPayload = {
      prompt,
      lora_urls: formattedLoraUrls,
      num_inference_steps: numInferenceSteps,
      guidance_scale: guidanceScale,
      negative_prompt: negativePrompt,
      width,
      height,
      seed: seed === -1 ? Math.floor(Math.random() * 2147483647) : seed
    };
    
    try {
      console.log(`Generating image with LoRA:`, JSON.stringify(inputPayload, null, 2));
      
      // Use the standard LoRA inference model
      const modelVersion = "97ec1b97e5e6a6476e45ba7211d368509bbf39c30a927e39637f3cb98b36ac91"; // replicate/lora latest version
      
      // Create prediction with proper CORS handling
      const response = await fetch(`${this.apiEndpoint}/v1/predictions`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiToken}`
        },
        body: JSON.stringify({
          version: modelVersion,
          input: inputPayload
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetail = `HTTP error ${response.status}`;
        
        try {
          const errorData = JSON.parse(errorText);
          errorDetail = errorData.detail || errorData.error || errorText;
        } catch (e) {
          // If parsing fails, use the raw text
          errorDetail = errorText || errorDetail;
        }
        
        console.error(`Replicate API error:`, errorDetail);
        throw new Error(`Failed to generate with LoRA: ${errorDetail}`);
      }

      const prediction = await response.json();
      const predictionId = prediction.id;

      console.log(`Started LoRA inference with ID: ${predictionId}`);

      // Poll until the prediction is complete
      let finalPrediction: any = null;
      let status = prediction.status || 'starting';
      
      while (status !== 'succeeded' && status !== 'failed' && status !== 'canceled') {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
        
        const pollResponse = await fetch(`${this.apiEndpoint}/v1/predictions/${predictionId}`, {
          mode: 'cors',
          credentials: 'same-origin',
          headers: {
            'Authorization': `Token ${this.apiToken}`
          }
        });
        
        if (!pollResponse.ok) {
          throw new Error(`Failed to check inference status: ${pollResponse.status}`);
        }
        
        const currentPrediction = await pollResponse.json();
        finalPrediction = currentPrediction;
        status = currentPrediction.status;
        
        console.log(`Inference status: ${status}`);
        
        if (status === 'failed') {
          const errorMessage = currentPrediction.error || 'LoRA inference failed';
          console.error(`Inference failed:`, errorMessage);
          throw new Error(errorMessage);
        }
        
        if (status === 'canceled') {
          console.error(`Inference was canceled by the user or system`);
          throw new Error('LoRA inference was canceled');
        }
      }

      // The output should be a URL to the generated image
      if (!finalPrediction || !finalPrediction.output) {
        throw new Error('Failed to generate image with LoRA: No output received');
      }
      
      const imageUrl = Array.isArray(finalPrediction.output) ? finalPrediction.output[0] : finalPrediction.output;
      
      console.log(`Successfully generated image with LoRA: ${imageUrl}`);
      return imageUrl;
    } catch (error: any) {
      console.error('Replicate API error during LoRA inference:', error);
      throw error;
    }
  }
  
  /**
   * Get advanced LoRA training options for specific use cases
   */
  getAdvancedTrainingOptions(task: 'face' | 'object' | 'style'): Partial<LoraTrainingOptions> {
    // Optimized default settings for different tasks
    switch (task) {
      case 'face':
        return {
          numSteps: 500,
          learningRate: 0.0004,
          resolution: 512,
          batchSize: 1,
          loraRank: 32,
          instancePrompt: "a photo of a sks person", // 'sks' is a placeholder token
          classPrompt: "a photo of a person"
        };
        
      case 'object':
        return {
          numSteps: 750,
          learningRate: 0.0004,
          resolution: 512,
          batchSize: 1,
          loraRank: 32,
          instancePrompt: "a photo of a sks object", // 'sks' is a placeholder token
          classPrompt: "a photo of a object"
        };
        
      case 'style':
        return {
          numSteps: 1000,
          learningRate: 0.000125,
          resolution: 512, 
          batchSize: 2,
          loraRank: 64
        };
        
      default:
        return {
          numSteps: 650,
          learningRate: 0.0004,
          resolution: 512,
          batchSize: 1,
          loraRank: 32
        };
    }
  }
}

// Singleton instance
export const loraTrainingService = new LoraTrainingService();

export default loraTrainingService; 