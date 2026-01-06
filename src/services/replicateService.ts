import { ImageGenerationResponse } from '../components/nodes/image-models/ImageModelInterface';
import { API_TOKENS, API_ENDPOINTS } from '../config/apiConfig';

// Define the model configurations
export const ReplicateModels = {
  STABLE_DIFFUSION_XL: {
    model: "stability-ai/sdxl",
    version: "a00d0b7dcbb9c3fbb34ba87d2d5b46c56969c84a628bf778a7fdaec30b1b99c5",
    description: "Stable Diffusion XL 1.0 by Stability AI"
  },
  FLUX_DEV: {
    model: "black-forest-labs/flux-dev",
    version: "93d72f81bd019dde2bfcba9585a6f74e600b13a43a96eb01a42da54f5ab4df6a",
    description: "Flux Dev - 12B parameter rectified flow transformer for high-quality image generation"
  },
  FLUX_PRO: {
    model: "black-forest-labs/flux-1.1-pro",
    version: "b744535cf2bf3c4cf2130d0cc75cd4795b280215f8275b041015fb4f9917cbcd",
    description: "Flux 1.1 Pro - Faster generation with excellent image quality, prompt adherence, and output diversity"
  },
  LUMA_PHOTON: {
    model: "luma/photon",
    version: "fe142c037cf359764f2058c3a42ef0dc750d908311d02868cbc7769fe800b648",
    description: "Photon - advanced image generation with reference capabilities"
  },
  RECRAFT_V3: {
    model: "recraft-ai/recraft-v3",
    version: "e06217725b21e2c059a09b3f44b4aef56574173aee9976c9726bdc0f474d7f46",
    description: "Recraft V3 - versatile image generation with multiple styles"
  },
  // ByteDance Seedream Models
  SEEDREAM_4_5: {
    model: "bytedance/seedream-4.5",
    version: "latest",
    description: "Seedream 4.5 - ByteDance's latest image generation model with enhanced spatial understanding"
  },
  SEEDREAM_4: {
    model: "bytedance/seedream-4",
    version: "latest",
    description: "Seedream 4.0 - Unified generation and editing model with 4K output support"
  },
  // Alibaba Z-Image
  Z_IMAGE_TURBO: {
    model: "prunaai/z-image-turbo",
    version: "latest",
    description: "Z-Image Turbo - 6B parameter ultra-fast text-to-image with Chinese/English support"
  },
  // OpenAI Models (requires user's OpenAI API key)
  DALLE_3: {
    model: "openai/dall-e-3",
    version: "latest",
    description: "DALL-E 3 - OpenAI's latest image generation model (requires OpenAI API key)"
  },
  RECRAFT_V3_SVG: {
    model: "recraft-ai/recraft-v3-svg",
    version: "16f118e8ee05d9a03a2845fe533f0d45cbc6a7774f126bfb3dfbe857a4feec6b",
    description: "Recraft V3 SVG - vector graphics generation in SVG format"
  },
  // Image Upscalers
  CLARITY_UPSCALER: {
    model: "philz1337x/clarity-upscaler",
    version: "dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e",
    description: "Clarity Upscaler - high-quality image upscaling with fine detail preservation"
  },
  ULTIMATE_SD_UPSCALE: {
    model: "fewjative/ultimate-sd-upscale",
    version: "5daf1012d946160622cd1bd45ed8f12d9675d24659276ccfe24804035f3b3ad7",
    description: "Ultimate SD Upscale - detail-enhancing upscaler based on Stable Diffusion"
  },
  RECRAFT_CRISP_UPSCALE: {
    model: "recraft-ai/recraft-crisp-upscale",
    version: "71b4b8f299dd300f7199ec7eb433fa15cc1f493abca86719505d2021a21a5892",
    description: "Recraft Crisp Upscale - sharp and crisp detail preservation for image upscaling"
  },
  RECRAFT_CREATIVE_UPSCALE: {
    model: "recraft-ai/recraft-creative-upscale",
    version: "7fb71bc9d9a83e5abdced71bfced475c057aae6f7c349bc4c229d9c02cdabb4d",
    description: "Recraft Creative Upscale - creative enhancement upscaler that adds details while maintaining style"
  },
  REAL_ESRGAN: {
    model: "nightmareai/real-esrgan",
    version: "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
    description: "Real-ESRGAN - general-purpose image restoration AI for upscaling images with natural textures"
  },
  // Video Upscalers
  REAL_ESRGAN_VIDEO: {
    model: "lucataco/real-esrgan-video",
    version: "c23768236472c41b7a121ee735c8073e29080c01b32907740cfada61bff75320",
    description: "Real-ESRGAN Video - high-quality video upscaling model for enhancing video resolution and quality"
  },
  // Video Models
  KLING_V1_6_STANDARD: {
    model: "kwaivgi/kling-v1.6-standard",
    version: "7e324e5fcb9479696f15ab6da262390cddf5a1efa2e11374ef9d1f85fc0f82da",
    description: "Kling - AI video generation with image-to-video capabilities"
  },
  LUMA_RAY_2_720P: {
    model: "luma/ray-2-720p",
    version: "6b879f80de0e85e255a6a29dc2f7242d8c567a5f64f33bf15be80ab0f9382fbe",
    description: "Ray 2 - Luma's high-fidelity 720p video generation model"
  },
  HUNYUAN_VIDEO: {
    model: "tencent/hunyuan-video",
    version: "6c9132aee14409cd6568d030453f1ba50f5f3412b844fe67f78a9eb62d55664f",
    description: "Hunyuan Video - Tencent's video generation model"
  },
  WAN_2_1_1_3B: {
    model: "wan-video/wan-2.1-1.3b",
    version: "121bbb762bf449889f090d36e3598c72c50c7a8cc2ce250433bc521a562aae61",
    description: "Wan 2.1 - High-quality video generation model"
  },
  GOOGLE_VEO_2: {
    model: "google/veo-2",
    version: "7e4f9a37b1c51d52d01f8b9850749ba57fb90bb029d0a6df12224bffdb444716",
    description: "Veo 2 - Google's advanced video generation model"
  },
  MINIMAX_VIDEO_01: {
    model: "minimax/video-01",
    version: "c8bcc4751328608bb75043b3af7bed4eabcf1a6c0a478d50a4cf57fa04bd5101",
    description: "Video-01 - Minimax's text-to-video generation model"
  }
};

// Interface for Replicate's API responses
interface ReplicatePrediction {
  id: string;
  status: string;
  output: string[] | Record<string, any>[] | Record<string, any> | null;
  error: string | null;
  created_at: string;
  completed_at?: string;
  metrics: {
    predict_time?: number;
  };
}

// Interface for Replicate API settings
interface ReplicateSettings {
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  seed?: number;
  [key: string]: any;
}

// Rate limiting handling
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests

/**
 * Generate an image using Replicate API with rate limiting and error handling
 * Requests are proxied through the backend server to avoid CORS issues
 */
export async function generateImage(
  modelConfig: { model: string; version: string; description: string },
  prompt: string,
  settings: ReplicateSettings
): Promise<ImageGenerationResponse> {
  // Apply rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  try {
    console.log(`Calling Replicate API for model: ${modelConfig.model} with version: ${modelConfig.version}`);
    console.log(`API URL: ${API_ENDPOINTS.REPLICATE_API}/predictions`);

    // Check if this is a model that's not available on Replicate
    if (modelConfig.model === 'openai/dall-e-3') {
      throw new Error('DALL-E 3 is not available on Replicate. Please use a different model or configure OpenAI API directly.');
    }

    // Create the request payload
    // Use 'model' for "latest" version, use 'version' for specific version hashes
    const requestPayload: any = {
      input: {
        prompt: prompt,
        ...settings
      }
    };

    if (modelConfig.version === 'latest') {
      // Use model-based API for models without specific version
      requestPayload.model = modelConfig.model;
    } else {
      // Use version-based API for models with specific version hash
      requestPayload.version = modelConfig.version;
    }

    console.log(`Request payload:`, JSON.stringify(requestPayload, null, 2));

    // Create prediction through backend proxy (no Authorization header needed - backend handles it)
    const response = await fetch(`${API_ENDPOINTS.REPLICATE_API}/predictions`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload)
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
      throw new Error(`Failed to start image generation: ${errorDetail}`);
    }

    const prediction = await response.json();
    const predictionId = prediction.id;

    console.log(`Started prediction with ID: ${predictionId}`);

    // Poll until the prediction is complete through backend proxy
    let finalPrediction: ReplicatePrediction | null = null;
    let status = 'starting';

    while (status !== 'succeeded' && status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second

      const pollResponse = await fetch(`${API_ENDPOINTS.REPLICATE_API}/predictions/${predictionId}`, {
        credentials: 'include'
      });
      
      if (!pollResponse.ok) {
        throw new Error(`Failed to check prediction status: ${pollResponse.status}`);
      }
      
      const currentPrediction = await pollResponse.json();
      finalPrediction = currentPrediction; // Always update the final prediction
      status = currentPrediction.status;
      console.log(`Prediction status: ${status}`);
      
      if (status === 'failed') {
        const errorMessage = currentPrediction.error || 'Image generation failed';
        console.error(`Prediction failed:`, errorMessage);
        throw new Error(errorMessage);
      }
    }

    // Check if we have a valid result
    if (!finalPrediction) {
      console.error('No prediction data received');
      throw new Error('Failed to generate image: No prediction data received');
    }
    
    if (!finalPrediction.output || finalPrediction.output.length === 0) {
      console.error('No output generated from Replicate model');
      throw new Error('Failed to generate image: No output received from the model');
    }

    // Debug the output format - truncate if it's text content
    const outputForLogging = JSON.stringify(finalPrediction.output);
    console.log('Raw output from model (truncated if text):', outputForLogging.length > 200 ? 
      outputForLogging.substring(0, 200) + '... [output truncated for logging]' : outputForLogging);

    // For Luma Photon, the output might be structured differently
    let imageUrl: string;
    if (modelConfig.model === 'luma/photon') {
      // Check if output is an array of objects with 'image' property
      if (Array.isArray(finalPrediction.output) && 
          finalPrediction.output.length > 0 &&
          typeof finalPrediction.output[0] === 'object' && 
          finalPrediction.output[0] !== null &&
          'image' in finalPrediction.output[0]) {
        imageUrl = (finalPrediction.output[0] as {image: string}).image;
      } 
      // Check if output is an object with 'image' property
      else if (finalPrediction.output && 
               typeof finalPrediction.output === 'object' && 
               !Array.isArray(finalPrediction.output) &&
               'image' in finalPrediction.output) {
        imageUrl = (finalPrediction.output as {image: string}).image;
      }
      // Check if output is an array of strings but first element is very short (likely not a URL)
      else if (Array.isArray(finalPrediction.output) && 
               finalPrediction.output.length > 0 &&
               typeof finalPrediction.output[0] === 'string' && 
               finalPrediction.output[0].length < 10 &&
               finalPrediction.output.length > 1) {
        // Try the second element if available
        imageUrl = finalPrediction.output[1];
      }
      else {
        // Default fallback
        imageUrl = Array.isArray(finalPrediction.output) ? 
          finalPrediction.output[0] as string : 
          finalPrediction.output as unknown as string;
      }
    } else {
      // Standard handling for other models
      imageUrl = Array.isArray(finalPrediction.output) ? 
        finalPrediction.output[0] as string : 
        finalPrediction.output as unknown as string;
    }
    
    // Validate the URL
    if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.length < 10) {
      console.error('Invalid image URL received:', imageUrl);
      throw new Error('Failed to generate image: Invalid URL received from the model');
    }
    
    console.log(`Successfully generated image: ${imageUrl}`);

    // Calculate generation time 
    const generationTime = finalPrediction.completed_at && finalPrediction.created_at
      ? (new Date(finalPrediction.completed_at).getTime() - new Date(finalPrediction.created_at).getTime()) / 1000
      : finalPrediction.metrics?.predict_time || 0;

    // Return the image and metadata
    return {
      imageUrl: imageUrl,
      metadata: {
        id: finalPrediction.id,
        generationTime: generationTime,
        modelVersion: `${modelConfig.description} (Replicate)`,
        steps: settings.num_inference_steps,
        guidance: settings.guidance_scale,
        seed: settings.seed,
        width: settings.width,
        height: settings.height,
        prompt: prompt,
        negativePrompt: settings.negative_prompt
      }
    };
  } catch (error: any) {
    // Handle specific error types
    if (error.message?.includes('rate limit')) {
      console.log('Rate limit hit, waiting before retrying...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      return generateImage(modelConfig, prompt, settings);
    }
    
    console.error('Replicate API error:', error);
    throw error;
  }
}

/**
 * Get the appropriate model settings for Replicate based on our internal settings
 */
export function getReplicateSettings(internalSettings: any, modelId?: string): ReplicateSettings {
  // Flux Pro 1.1 uses a different API schema
  if (modelId === 'black-forest-labs/flux-1.1-pro') {
    // Extract width and height from resolution
    const [width, height] = (internalSettings.resolution || '1024x1024').split('x').map(Number);
    
    // Calculate aspect ratio from width and height
    let aspectRatio = "1:1"; // Default
    
    // Map common resolutions to their aspect ratios
    const aspectRatioMap: Record<string, string> = {
      "1024x1024": "1:1",
      "768x768": "1:1", 
      "1152x896": "9:7",
      "1344x768": "16:9",
      "768x1344": "9:16",
      "832x1216": "2:3",
      "1216x832": "3:2"
    };
    
    if (internalSettings.resolution && aspectRatioMap[internalSettings.resolution]) {
      aspectRatio = aspectRatioMap[internalSettings.resolution];
    } else if (width && height) {
      aspectRatio = "custom";
    }
    
    return {
      // Core parameters
      aspect_ratio: aspectRatio,
      
      // Only include width/height if using custom aspect ratio
      ...(aspectRatio === "custom" ? { 
        width: width, 
        height: height 
      } : {}),
      
      // Optional parameters
      seed: internalSettings.seed === -1 ? undefined : internalSettings.seed,
      output_format: internalSettings.outputFormat === 'jpeg' ? 'jpg' : internalSettings.outputFormat || 'jpg',
      safety_tolerance: internalSettings.safety_tolerance || 2,
      prompt_upsampling: internalSettings.promptStyle === 'creative',
      
      // Include optional output quality if provided
      ...(internalSettings.qualitySetting === 'premium' ? { output_quality: 100 } : { output_quality: 85 })
    };
  }
  
  // Luma Photon uses a different API schema
  if (modelId === 'luma/photon') {
    // Map resolutions to aspect ratios supported by Photon
    const resolutionToAspectRatio: Record<string, string> = {
      "1024x1024": "1:1",
      "768x1024": "3:4",
      "1024x768": "4:3",
      "576x1024": "9:16",
      "1024x576": "16:9",
      "448x1024": "9:21",
      "1024x448": "21:9"
    };
    
    // Default to 16:9 if not found
    let aspectRatio = "16:9";
    
    if (internalSettings.resolution && resolutionToAspectRatio[internalSettings.resolution]) {
      aspectRatio = resolutionToAspectRatio[internalSettings.resolution];
    }
    
    return {
      // Core parameters
      prompt: internalSettings.prompt,
      aspect_ratio: aspectRatio,
      
      // Optional parameters
      seed: internalSettings.seed === -1 ? undefined : internalSettings.seed,
      
      // Reference image parameters if available
      ...(internalSettings.imageReferenceUrl ? { 
        image_reference_url: internalSettings.imageReferenceUrl,
        image_reference_weight: internalSettings.imageReferenceWeight || 0.85
      } : {}),
      
      ...(internalSettings.styleReferenceUrl ? { 
        style_reference_url: internalSettings.styleReferenceUrl,
        style_reference_weight: internalSettings.styleReferenceWeight || 0.85
      } : {}),
      
      ...(internalSettings.characterReferenceUrl ? { 
        character_reference_url: internalSettings.characterReferenceUrl
      } : {})
    };
  }
  
  // Recraft V3 uses a different API schema
  if (modelId === 'recraft-ai/recraft-v3') {
    return {
      // Core parameters
      prompt: internalSettings.prompt,
      size: internalSettings.resolution || "1024x1024",
      style: internalSettings.style || "any",
      
      // Optional parameters
      ...(internalSettings.seed !== undefined && internalSettings.seed !== -1 ? {
        seed: internalSettings.seed
      } : {})
    };
  }
  
  // Recraft V3 SVG uses the same schema as Recraft V3
  if (modelId === 'recraft-ai/recraft-v3-svg') {
    return {
      // Core parameters
      prompt: internalSettings.prompt,
      // Ensure size is properly set with the exact format from the schema
      size: internalSettings.size || internalSettings.resolution || "1024x1024",
      style: internalSettings.style || "any",
      
      // Optional parameters
      ...(internalSettings.seed !== undefined && internalSettings.seed !== -1 ? {
        seed: internalSettings.seed
      } : {})
    };
  }
  
  // Default settings for other models
  return {
    negative_prompt: internalSettings.negativePrompt || "",
    width: parseInt(internalSettings.resolution?.split('x')?.[0] || internalSettings.width?.toString() || "1024"),
    height: parseInt(internalSettings.resolution?.split('x')?.[1] || internalSettings.height?.toString() || "1024"),
    num_inference_steps: internalSettings.steps || 30,
    guidance_scale: internalSettings.guidance || 7.5,
    seed: internalSettings.seed === -1 ? undefined : internalSettings.seed
  };
} 