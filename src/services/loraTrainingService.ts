import { postXenoRequest } from './xenoProxyRequest';

export interface LoraTrainingOptions {
  instanceData: string;
  task: 'face' | 'object' | 'style';

  numSteps?: number;
  learningRate?: number;
  batchSize?: number;
  resolution?: number;

  loraRank?: number;
  unetLr?: number;
  textEncoderLr?: number;
  instancePrompt?: string;
  classPrompt?: string;
  maxTrainSteps?: number;

  hfToken?: string;
  hfModelRepo?: string;

  onProgress?: (progress: number) => void;
}

export interface LoraTrainingResponse {
  modelUrl: string;
  trainingId: string;
  completedAt: string;
  modelType: string;
  baseModel: string;
  metadata: {
    task: string;
    steps: number;
    learningRate: number;
    resolution: number;
    batchSize: number;
    loraRank?: number;
    [key: string]: any;
  };
}

export class LoraTrainingService {
  async trainLora(options: LoraTrainingOptions): Promise<LoraTrainingResponse> {
    throw new Error('LoRA training is not currently supported');
  }

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
    try {
      const response = await postXenoRequest('/images/generate', {
        model: 'auto',
        prompt: prompt,
        width: width,
        height: height,
        seed: seed === -1 ? undefined : seed,
      });

      const imageUrl = response.data[0]?.url;

      if (!imageUrl) {
        throw new Error('No image URL returned from Xeno API');
      }

      return imageUrl;
    } catch (error: any) {
      throw error;
    }
  }

  getAdvancedTrainingOptions(task: 'face' | 'object' | 'style'): Partial<LoraTrainingOptions> {
    switch (task) {
      case 'face':
        return {
          numSteps: 500,
          learningRate: 0.0004,
          resolution: 512,
          batchSize: 1,
          loraRank: 32,
          instancePrompt: "a photo of a sks person",
          classPrompt: "a photo of a person"
        };

      case 'object':
        return {
          numSteps: 750,
          learningRate: 0.0004,
          resolution: 512,
          batchSize: 1,
          loraRank: 32,
          instancePrompt: "a photo of a sks object",
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

export const loraTrainingService = new LoraTrainingService();

export default loraTrainingService;
