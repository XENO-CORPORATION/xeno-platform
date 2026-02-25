import React, { useState, useEffect, useRef } from 'react';
import { Image, Send, Download, Trash2, Sparkles, Plus, X, Info, RotateCw, Wand2, Settings, ArrowUpRight, ZoomIn, ZoomOut, Maximize, Minus } from 'lucide-react';
// TODO: Create and import an imageUpscaleService similar to imageGenerationService
// import imageUpscaleService from '../../../services/imageUpscaleService';

import { postXenoRequest } from '../../../services/xenoProxyRequest';

const recraftUpscaleService = {
  async upscale(imageUrl: string, modelType: 'creative' | 'crisp', options: { sync_mode?: boolean; enable_safety_checker?: boolean } = {}) {
    const response = await postXenoRequest('/images/edit', {
      image: imageUrl,
      prompt: 'upscale',
      model: 'auto',
    });

    if (!response.data[0]?.url) {
      throw new Error(`Recraft ${modelType} upscale failed`);
    }

    return {
      image: {
        url: response.data[0].url,
        file_size: 0,
        content_type: 'image/jpeg',
      }
    };
  }
};

const falCreativeUpscalerService = {
  async upscale(imageUrl: string, options: {
    prompt?: string;
    scale?: number;
    creativity?: number;
    detail?: number;
    shape_preservation?: number;
    model_type?: 'SD_1_5' | 'SDXL';
    guidance_scale?: number;
    num_inference_steps?: number;
    negative_prompt?: string;
    seed?: number;
    enable_safety_checks?: boolean;
  } = {}) {
    const response = await postXenoRequest('/images/edit', {
      image: imageUrl,
      prompt: options.prompt || 'upscale, enhance details',
      model: 'auto',
    });

    if (!response.data[0]?.url) {
      throw new Error('Creative upscaler failed');
    }

    return {
      image: {
        url: response.data[0].url,
        file_size: 0,
        content_type: 'image/jpeg',
        width: 0,
        height: 0,
      },
      seed: options.seed || 0,
    };
  }
};

const falDrctSuperResolutionService = {
  async upscale(imageUrl: string, options: {
    upscaling_factor?: number;
  } = {}) {
    const response = await postXenoRequest('/images/edit', {
      image: imageUrl,
      prompt: 'upscale 4x',
      model: 'auto',
    });

    if (!response.data[0]?.url) {
      throw new Error('DRCT Super Resolution failed');
    }

    return {
      image: {
        url: response.data[0].url,
        file_size: 0,
        content_type: 'image/jpeg',
        width: 0,
        height: 0,
      }
    };
  }
};

const falClarityUpscalerService = {
  async upscale(imageUrl: string, options: {
    prompt?: string;
    resemblance?: number;
    creativity?: number;
    upscale_factor?: number;
    guidance_scale?: number;
    num_inference_steps?: number;
    seed?: number;
    negative_prompt?: string;
    enable_safety_checker?: boolean;
  } = {}) {
    const response = await postXenoRequest('/images/edit', {
      image: imageUrl,
      prompt: options.prompt || 'upscale, masterpiece, best quality, highres',
      model: 'auto',
    });

    if (!response.data[0]?.url) {
      throw new Error('Clarity upscaler failed');
    }

    return {
      image: {
        url: response.data[0].url,
        file_size: 0,
        content_type: 'image/jpeg',
        width: 0,
        height: 0,
      },
      seed: options.seed || 0,
    };
  }
};

const falCCSRService = {
  async upscale(imageUrl: string, options: {
    scale?: number;
    tile_diffusion?: 'none' | 'mix' | 'gaussian';
    tile_diffusion_size?: number;
    tile_diffusion_stride?: number;
    tile_vae?: boolean;
    tile_vae_decoder_size?: number;
    tile_vae_encoder_size?: number;
    steps?: number;
    t_max?: number;
    t_min?: number;
    color_fix_type?: 'none' | 'wavelet' | 'adain';
    seed?: number;
  } = {}) {
    const response = await postXenoRequest('/images/edit', {
      image: imageUrl,
      prompt: 'upscale with cascaded refinement',
      model: 'auto',
    });

    if (!response.data[0]?.url) {
      throw new Error('CCSR upscaler failed');
    }

    return {
      image: {
        url: response.data[0].url,
        file_size: 0,
        content_type: 'image/jpeg',
        width: 0,
        height: 0,
      },
      seed: options.seed || 0,
    };
  }
};

const falIdeogramUpscaleService = {
  async upscale(imageUrl: string, options: {
    prompt?: string;
    detail?: number;
    resemblance?: number;
    expand_prompt?: boolean;
    seed?: number;
  } = {}) {
    const response = await postXenoRequest('/images/edit', {
      image: imageUrl,
      prompt: options.prompt || 'upscale, intelligent enhancement',
      model: 'auto',
    });

    if (!response.data[0]?.url) {
      throw new Error('Ideogram upscaler failed');
    }

    return {
      images: [{
        url: response.data[0].url,
        file_size: 0,
        content_type: 'image/jpeg',
        file_name: 'upscaled.jpg',
      }],
      seed: options.seed || 0,
    };
  }
};
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';
import { useLayout } from '../../../pages/Overview';

// Mock service for now
// Define allowed model IDs as keys
type MockModelId = 'real-esrgan-x4plus' | 'real-esrgan-general-x4v3' | 'stable-diffusion-x2-latent-upscaler' | 'fal-ai/recraft/upscale/creative' | 'fal-ai/recraft/upscale/crisp' | 'fal-ai/creative-upscaler' | 'fal-ai/drct-super-resolution' | 'fal-ai/clarity-upscaler' | 'fal-ai/ccsr' | 'fal-ai/ideogram/upscale';

const mockUpscaleService = {
  modelRegistry: {
    'real-esrgan-x4plus': { provider: 'mock', name: 'Real-ESRGAN x4+', defaultScale: 4, supportsFaceEnhance: true },
    'real-esrgan-general-x4v3': { provider: 'mock', name: 'Real-ESRGAN General x4 v3', defaultScale: 4, supportsFaceEnhance: false },
    'stable-diffusion-x2-latent-upscaler': { provider: 'mock', name: 'SD Latent Upscaler x2', defaultScale: 2, supportsFaceEnhance: false },
    'fal-ai/recraft/upscale/creative': { provider: 'fal-ai', name: 'Recraft Creative Upscale', defaultScale: 4, supportsFaceEnhance: false, isCreative: true },
    'fal-ai/recraft/upscale/crisp': { provider: 'fal-ai', name: 'Recraft Crisp Upscale', defaultScale: 4, supportsFaceEnhance: false, isCrisp: true },
    'fal-ai/creative-upscaler': { provider: 'fal-ai', name: 'FAL Creative Upscaler', defaultScale: 2, supportsFaceEnhance: false, isAdvanced: true },
    'fal-ai/drct-super-resolution': { provider: 'fal-ai', name: 'DRCT Super Resolution', defaultScale: 4, supportsFaceEnhance: false, isSuperRes: true },
    'fal-ai/clarity-upscaler': { provider: 'fal-ai', name: 'Clarity Upscaler', defaultScale: 2, supportsFaceEnhance: false, isClarity: true },
    'fal-ai/ccsr': { provider: 'fal-ai', name: 'CCSR', defaultScale: 2, supportsFaceEnhance: false, isCCSR: true },
    'fal-ai/ideogram/upscale': { provider: 'fal-ai', name: 'Ideogram Upscale', defaultScale: 4, supportsFaceEnhance: false, isIdeogram: true },
  } as const, // Use 'as const' for stricter typing
  upscaleImage: async (modelId: string, settings: any): Promise<{ success: boolean; images?: { url: string; scale?: number }[]; error?: string; metadata?: any }> => {
    console.log(`[UpscaleService] Upscaling with ${modelId}`, settings);
    
    // Use real FAL Creative Upscaler API if available
    if (modelId === 'fal-ai/creative-upscaler') {
      try {
        console.log('[FAL Creative] Using real API');
        const result = await falCreativeUpscalerService.upscale(settings.image_url, {
          prompt: settings.prompt,
          scale: settings.scale,
          creativity: settings.creativity,
          detail: settings.detail,
          shape_preservation: settings.shape_preservation,
          model_type: settings.model_type,
          guidance_scale: settings.guidance_scale,
          num_inference_steps: settings.num_inference_steps,
          negative_prompt: settings.negative_prompt,
          seed: settings.seed,
          enable_safety_checks: true,
        });
        
        // Handle the response based on FAL Creative Upscaler API structure
        if (result.image && result.image.url) {
          return {
            success: true,
            images: [{ url: result.image.url, scale: settings.scale }],
            metadata: {
              generationTime: 3.0, // Estimated for creative upscaling
              latency: 0.1,
              model: modelId,
              enhancement_type: 'creative_advanced',
              provider: 'fal',
              seed: result.seed,
              file_size: result.image.file_size,
              content_type: result.image.content_type,
              width: result.image.width,
              height: result.image.height,
              creativity: settings.creativity,
              detail: settings.detail,
              shape_preservation: settings.shape_preservation,
            }
          };
        } else {
          throw new Error('Invalid response from FAL Creative Upscaler API');
        }
      } catch (error) {
        console.error('[FAL Creative] API Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'FAL Creative Upscaler API error';
        return { success: false, error: errorMessage };
      }
    }
    
    // Use real FAL DRCT Super Resolution API if available
    else if (modelId === 'fal-ai/drct-super-resolution') {
      try {
        console.log('[FAL DRCT] Using real API');
        const result = await falDrctSuperResolutionService.upscale(settings.image_url, {
          upscaling_factor: 4, // Fixed at 4x
        });
        
        // Handle the response based on FAL DRCT API structure
        if (result.image && result.image.url) {
          return {
            success: true,
            images: [{ url: result.image.url, scale: 4 }],
            metadata: {
              generationTime: 2.8, // Estimated for super resolution
              latency: 0.1,
              model: modelId,
              enhancement_type: 'super_resolution',
              provider: 'fal',
              file_size: result.image.file_size,
              content_type: result.image.content_type,
              width: result.image.width,
              height: result.image.height,
              upscaling_factor: 4,
            }
          };
        } else {
          throw new Error('Invalid response from FAL DRCT Super Resolution API');
        }
      } catch (error) {
        console.error('[FAL DRCT] API Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'FAL DRCT Super Resolution API error';
        return { success: false, error: errorMessage };
      }
    }
    
    // Use real FAL Clarity Upscaler API if available
    else if (modelId === 'fal-ai/clarity-upscaler') {
      try {
        console.log('[FAL Clarity] Using real API');
        const result = await falClarityUpscalerService.upscale(settings.image_url, {
          prompt: settings.prompt,
          resemblance: settings.resemblance,
          creativity: settings.creativity,
          upscale_factor: settings.scale,
          guidance_scale: settings.guidance_scale,
          num_inference_steps: settings.num_inference_steps,
          negative_prompt: settings.negative_prompt,
          seed: settings.seed,
          enable_safety_checker: settings.enable_safety_checker,
        });
        
        // Handle the response based on FAL Clarity API structure
        if (result.image && result.image.url) {
          return {
            success: true,
            images: [{ url: result.image.url, scale: settings.scale }],
            metadata: {
              generationTime: 3.2, // Estimated for clarity upscaling
              latency: 0.1,
              model: modelId,
              enhancement_type: 'clarity_controlled',
              provider: 'fal',
              seed: result.seed,
              file_size: result.image.file_size,
              content_type: result.image.content_type,
              width: result.image.width,
              height: result.image.height,
              resemblance: settings.resemblance,
              creativity: settings.creativity,
              guidance_scale: settings.guidance_scale,
              num_inference_steps: settings.num_inference_steps,
            }
          };
        } else {
          throw new Error('Invalid response from FAL Clarity Upscaler API');
        }
      } catch (error) {
        console.error('[FAL Clarity] API Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'FAL Clarity Upscaler API error';
        return { success: false, error: errorMessage };
      }
    }
    
    // Use real FAL CCSR API if available
    else if (modelId === 'fal-ai/ccsr') {
      try {
        console.log('[FAL CCSR] Using real API');
        const result = await falCCSRService.upscale(settings.image_url, {
          scale: settings.scale,
          tile_diffusion: settings.tile_diffusion,
          tile_diffusion_size: settings.tile_diffusion_size,
          tile_diffusion_stride: settings.tile_diffusion_stride,
          tile_vae: settings.tile_vae,
          tile_vae_decoder_size: settings.tile_vae_decoder_size,
          tile_vae_encoder_size: settings.tile_vae_encoder_size,
          steps: settings.steps,
          t_max: settings.t_max,
          t_min: settings.t_min,
          color_fix_type: settings.color_fix_type,
          seed: settings.seed,
        });
        
        // Handle the response based on FAL CCSR API structure
        if (result.image && result.image.url) {
          return {
            success: true,
            images: [{ url: result.image.url, scale: settings.scale }],
            metadata: {
              generationTime: 4.5, // Estimated for CCSR processing
              latency: 0.1,
              model: modelId,
              enhancement_type: 'cascaded_refinement',
              provider: 'fal',
              seed: result.seed,
              file_size: result.image.file_size,
              content_type: result.image.content_type,
              width: result.image.width,
              height: result.image.height,
              tile_diffusion: settings.tile_diffusion,
              tile_vae: settings.tile_vae,
              steps: settings.steps,
              color_fix_type: settings.color_fix_type,
            }
          };
        } else {
          throw new Error('Invalid response from FAL CCSR API');
        }
      } catch (error) {
        console.error('[FAL CCSR] API Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'FAL CCSR API error';
        return { success: false, error: errorMessage };
      }
    }
    
    // Use real FAL Ideogram Upscale API if available
    else if (modelId === 'fal-ai/ideogram/upscale') {
      try {
        console.log('[FAL Ideogram] Using real API');
        const result = await falIdeogramUpscaleService.upscale(settings.image_url, {
          prompt: settings.prompt,
          detail: settings.ideogram_detail,
          resemblance: settings.resemblance,
          expand_prompt: settings.expand_prompt,
          seed: settings.seed,
        });
        
        // Handle the response based on FAL Ideogram API structure
        if (result.images && result.images.length > 0 && result.images[0].url) {
          return {
            success: true,
            images: [{ url: result.images[0].url, scale: 4 }], // Ideogram typically does intelligent upscaling
            metadata: {
              generationTime: 3.8, // Estimated for Ideogram processing
              latency: 0.1,
              model: modelId,
              enhancement_type: 'intelligent_upscale',
              provider: 'fal',
              seed: result.seed,
              file_size: result.images[0].file_size,
              content_type: result.images[0].content_type,
              file_name: result.images[0].file_name,
              detail: settings.ideogram_detail,
              resemblance: settings.resemblance,
              expand_prompt: settings.expand_prompt,
            }
          };
        } else {
          throw new Error('Invalid response from FAL Ideogram Upscale API');
        }
      } catch (error) {
        console.error('[FAL Ideogram] API Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'FAL Ideogram Upscale API error';
        return { success: false, error: errorMessage };
      }
    }
    
    // Use real Recraft API if available and model is Recraft
    else if (modelId === 'fal-ai/recraft/upscale/creative' || modelId === 'fal-ai/recraft/upscale/crisp') {
      try {
        console.log('[Recraft] Using real API');
        const modelType = modelId.includes('/creative') ? 'creative' : 'crisp';
        const result = await recraftUpscaleService.upscale(settings.image_url, modelType, {
          sync_mode: true, // Use sync mode for immediate results
          enable_safety_checker: false, // Adjust as needed
        });
        
        // Handle the response based on Recraft API structure
        if (result.image && result.image.url) {
          return {
            success: true,
            images: [{ url: result.image.url, scale: 4 }], // Recraft typically does 4x upscale
            metadata: {
              generationTime: 2.5, // Estimated
              latency: 0.1,
              model: modelId,
              enhancement_type: modelType,
              creative_enhancement: modelType === 'creative',
              crisp_enhancement: modelType === 'crisp',
              provider: 'recraft',
              file_size: result.image.file_size,
              content_type: result.image.content_type,
            }
          };
        } else {
          throw new Error('Invalid response from Recraft API');
        }
      } catch (error) {
        console.error('[Recraft] API Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Recraft API error';
        return { success: false, error: errorMessage };
      }
    }
    
    // Fallback to mock simulation for other models or when API key is not available
    console.log(`[MockUpscale] Using mock service for ${modelId}`);
    const processingTime = modelId.includes('recraft') ? 2500 
                         : modelId === 'fal-ai/creative-upscaler' ? 3000
                         : modelId === 'fal-ai/drct-super-resolution' ? 2800
                         : modelId === 'fal-ai/clarity-upscaler' ? 3200
                         : modelId === 'fal-ai/ccsr' ? 4500
                         : modelId === 'fal-ai/ideogram/upscale' ? 3800
                         : 1500;
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Simulate success or failure (lower failure rate for premium models)
    const failureRate = modelId.includes('recraft') || modelId === 'fal-ai/creative-upscaler' || modelId === 'fal-ai/drct-super-resolution' || modelId === 'fal-ai/clarity-upscaler' || modelId === 'fal-ai/ccsr' || modelId === 'fal-ai/ideogram/upscale' ? 0.05 : 0.1;
    if (Math.random() < failureRate) {
        const errorType = modelId.includes('/creative') ? 'Creative processing error' 
                         : modelId.includes('/crisp') ? 'Crisp processing error'
                         : modelId === 'fal-ai/creative-upscaler' ? 'Advanced creative processing error'
                         : modelId === 'fal-ai/drct-super-resolution' ? 'Super resolution processing error'
                         : modelId === 'fal-ai/clarity-upscaler' ? 'Clarity processing error'
                         : modelId === 'fal-ai/ccsr' ? 'CCSR processing error'
                         : modelId === 'fal-ai/ideogram/upscale' ? 'Ideogram processing error'
                         : 'Random error';
        return { success: false, error: `Mock upscale failed: ${errorType}` };
    }
    
    // Simulate output image URL
    const outputUrl = settings.image_url; // For simplicity, return the input URL
    
    // Add model-specific metadata
    const metadata = {
      generationTime: processingTime / 1000,
      latency: 0.1,
      model: modelId,
      provider: 'mock',
      ...(modelId === 'fal-ai/recraft/upscale/creative' && {
        enhancement_type: 'creative',
        creative_enhancement: true,
        sync_mode: settings.sync_mode || false,
        safety_checker: settings.enable_safety_checker || false,
        quality_boost: 'enhanced'
      }),
      ...(modelId === 'fal-ai/recraft/upscale/crisp' && {
        enhancement_type: 'crisp',
        crisp_enhancement: true,
        sync_mode: settings.sync_mode || false,
        safety_checker: settings.enable_safety_checker || false,
        quality_boost: 'crisp'
      }),
      ...(modelId === 'fal-ai/creative-upscaler' && {
        enhancement_type: 'creative_advanced',
        creative_upscaler: true,
        creativity: settings.creativity || 0.5,
        detail: settings.detail || 1,
        shape_preservation: settings.shape_preservation || 0.25,
        model_type: settings.model_type || 'SD_1_5',
        guidance_scale: settings.guidance_scale || 7.5,
        num_inference_steps: settings.num_inference_steps || 20,
        quality_boost: 'advanced'
      }),
      ...(modelId === 'fal-ai/drct-super-resolution' && {
        enhancement_type: 'super_resolution',
        super_resolution: true,
        upscaling_factor: 4,
        quality_boost: 'super_res'
      }),
      ...(modelId === 'fal-ai/clarity-upscaler' && {
        enhancement_type: 'clarity_controlled',
        clarity_upscaler: true,
        resemblance: settings.resemblance || 0.6,
        creativity: settings.creativity || 0.35,
        guidance_scale: settings.guidance_scale || 4,
        num_inference_steps: settings.num_inference_steps || 18,
        quality_boost: 'clarity'
      }),
      ...(modelId === 'fal-ai/ccsr' && {
        enhancement_type: 'cascaded_refinement',
        ccsr: true,
        tile_diffusion: settings.tile_diffusion || 'none',
        tile_vae: settings.tile_vae || false,
        steps: settings.steps || 50,
        color_fix_type: settings.color_fix_type || 'adain',
        t_max: settings.t_max || 0.6667,
        t_min: settings.t_min || 0.3333,
        quality_boost: 'cascaded'
      }),
      ...(modelId === 'fal-ai/ideogram/upscale' && {
        enhancement_type: 'intelligent_upscale',
        ideogram: true,
        detail: settings.ideogram_detail || 50,
        resemblance: settings.resemblance || 50,
        expand_prompt: settings.expand_prompt || false,
        magic_prompt: settings.expand_prompt || false,
        quality_boost: 'intelligent'
      })
    };
    
    return {
      success: true,
      images: [{ url: outputUrl, scale: settings.scale }],
      metadata
    };
  },
  getModelDefaults: (modelId: string) => {
      // Check if modelId is a valid key before accessing
      if (modelId in mockUpscaleService.modelRegistry) {
        return mockUpscaleService.modelRegistry[modelId as MockModelId];
      }
      return {}; // Return empty object if not found
  }
};
const imageUpscaleService = mockUpscaleService; // Use mock service

// Interface for upscaled image results
interface UpscaledImage {
    url: string;
    scale?: number; // Scale factor used
    // Add other relevant metadata if needed
}

// Interface for upscale settings
interface ImageUpscaleSettings {
    image_url: string; // Input image data URL
    model: string;
    scale: number; // Upscale factor (e.g., 2, 4)
    face_enhance?: boolean; // Optional face enhancement flag
    prompt?: string; // Optional prompt for guidance
    // FAL Creative Upscaler specific settings
    creativity?: number;
    detail?: number;
    shape_preservation?: number;
    model_type?: 'SD_1_5' | 'SDXL';
    guidance_scale?: number;
    num_inference_steps?: number;
    negative_prompt?: string;
    // FAL Clarity Upscaler specific settings
    resemblance?: number;
    enable_safety_checker?: boolean;
    seed?: number;
    // FAL CCSR specific settings
    tile_diffusion?: 'none' | 'mix' | 'gaussian';
    tile_diffusion_size?: number;
    tile_diffusion_stride?: number;
    tile_vae?: boolean;
    tile_vae_decoder_size?: number;
    tile_vae_encoder_size?: number;
    steps?: number;
    t_max?: number;
    t_min?: number;
    color_fix_type?: 'none' | 'wavelet' | 'adain';
    // FAL Ideogram specific settings
    ideogram_detail?: number;
    expand_prompt?: boolean;
    // Add other model-specific settings
}

// Create a custom event for when an image is upscaled
export const IMAGE_UPSCALED_EVENT = 'image_upscaled';

// Simple notification helper
const notifications = {
  error: (message: string) => {
    console.error(`Error: ${message}`);
    alert("Error: " + message);
  },
  success: (message: string) => {
    console.log(`Success: ${message}`);
    // No alert dialog
  }
};

// --- Placeholder Model Definitions (Adapt for actual upscale models) ---
interface UpscaleModelFamily {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
  submodels: UpscaleSubModel[];
}

interface UpscaleSubModel {
  id: string; // This ID should match the key in the imageUpscaleService registry
  name: string;
  description: string;
  defaultScale?: number;
  supportsFaceEnhance?: boolean;
  isNew?: boolean;
  isBeta?: boolean;
}

// Placeholder upscale models (replace with actual models from your service)
const upscaleModelFamilies: UpscaleModelFamily[] = [
  {
    id: 'real-esrgan',
    name: 'Real-ESRGAN',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Sparkles size={16} className="text-green-400" /></div>,
    description: "General-purpose image restoration and enhancement models.",
    submodels: [
      {
        id: 'real-esrgan-x4plus',
        name: 'ESRGAN x4+',
        description: "High-quality 4x upscaling, good for general images.",
        defaultScale: 4,
        supportsFaceEnhance: true,
        isNew: true,
      },
      {
        id: 'real-esrgan-general-x4v3',
        name: 'ESRGAN General x4 v3',
        description: "Alternative 4x model for general photos.",
        defaultScale: 4,
        supportsFaceEnhance: false,
      },
    ]
  },
    {
    id: 'stable-diffusion-upscalers',
    name: 'Stable Diffusion Upscalers',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Image size={16} className="text-sky-400" /></div>,
    description: "Latent diffusion based upscalers.",
    submodels: [
      {
        id: 'stable-diffusion-x2-latent-upscaler',
        name: 'SD Latent Upscaler x2',
        description: "Fast 2x upscaling using latent diffusion.",
        defaultScale: 2,
        supportsFaceEnhance: false,
        isBeta: true,
      },
    ]
  },
  {
    id: 'recraft-upscalers',
    name: 'Recraft AI',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Wand2 size={16} className="text-purple-400" /></div>,
    description: "AI-powered upscaling with creative and crisp enhancement modes.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/recraft/upscale/creative',
        name: 'Creative Upscale',
        description: "AI-powered creative upscaling with artistic enhancement and detail preservation.",
        defaultScale: 4,
        supportsFaceEnhance: false,
        isNew: true,
      },
      {
        id: 'fal-ai/recraft/upscale/crisp',
        name: 'Crisp Upscale',
        description: "AI-powered crisp upscaling focused on clean, sharp detail enhancement.",
        defaultScale: 4,
        supportsFaceEnhance: false,
        isNew: true,
      },
    ]
  },
  {
    id: 'fal-creative-upscalers',
    name: 'FAL Creative AI',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Sparkles size={16} className="text-amber-400" /></div>,
    description: "Advanced AI-powered creative upscaling with extensive customization options.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/creative-upscaler',
        name: 'Creative Upscaler',
        description: "Advanced creative upscaling with customizable creativity, detail, and shape preservation controls.",
        defaultScale: 2,
        supportsFaceEnhance: false,
        isNew: true,
      },
      {
        id: 'fal-ai/clarity-upscaler',
        name: 'Clarity Upscaler',
        description: "Controlled AI upscaling with resemblance and creativity balance for optimal clarity enhancement.",
        defaultScale: 2,
        supportsFaceEnhance: false,
        isNew: true,
      },
    ]
  },
  {
    id: 'super-resolution',
    name: 'Super Resolution',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><ArrowUpRight size={16} className="text-indigo-400" /></div>,
    description: "Specialized models for high-quality super resolution upscaling with advanced technical control.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/drct-super-resolution',
        name: 'DRCT Super Resolution',
        description: "State-of-the-art 4x super resolution model optimized for high-quality detail enhancement.",
        defaultScale: 4,
        supportsFaceEnhance: false,
        isNew: true,
      },
      {
        id: 'fal-ai/ccsr',
        name: 'CCSR',
        description: "Cascaded Channel and Spatial Refinement with advanced tile processing and color correction controls.",
        defaultScale: 2,
        supportsFaceEnhance: false,
        isNew: true,
      },
    ]
  },
  {
    id: 'ideogram-ai',
    name: 'Ideogram AI',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Sparkles size={16} className="text-rose-400" /></div>,
    description: "Intelligent AI upscaling with prompt-guided enhancement and MagicPrompt technology.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/ideogram/upscale',
        name: 'Ideogram Upscale',
        description: "Intelligent AI upscaling with detail and resemblance control, powered by MagicPrompt technology.",
        defaultScale: 4,
        supportsFaceEnhance: false,
        isNew: true,
      },
    ]
  },
  // Add more model families and submodels as needed
];

// --- Model Selector Component (Updated to match ImageGenerationInterface style) ---
const UpscaleModelSelector = ({
  selectedModel,
  onChange,
  disabled
}: {
  selectedModel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Helper function to determine input type for each upscale model
  const getModelInputType = (modelId: string): { type: 'Enhancement' | 'Super-Res' | 'Creative'; color: string } => {
    switch (modelId) {
      case 'fal-ai/recraft/upscale/creative':
      case 'fal-ai/creative-upscaler':
        return { type: 'Creative', color: 'bg-purple-500/30 text-purple-300 border-purple-500/40' };
      case 'fal-ai/drct-super-resolution':
      case 'fal-ai/ccsr':
        return { type: 'Super-Res', color: 'bg-indigo-500/30 text-indigo-300 border-indigo-500/40' };
      default:
        return { type: 'Enhancement', color: 'bg-blue-500/30 text-blue-300 border-blue-500/40' };
    }
  };

  // Custom CSS for the animations - horizontal slide from left
  const animationStyles = isVisible ? {
    opacity: 1,
    transform: 'translateX(0)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
  } : {
    opacity: 0,
    transform: 'translateX(-20px)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
  };

  const findSelectedModelDetails = () => {
    for (const family of upscaleModelFamilies) {
      for (const model of family.submodels) {
        if (model.id === selectedModel) {
          return { family, model };
        }
      }
    }
    return null;
  };

  const selectedDetails = findSelectedModelDetails();

  const togglePanel = () => {
    if (disabled) return;

    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      setTimeout(() => {
        setIsOpen(false);
        setSelectedFamily(null);
      }, 300);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
        setTimeout(() => {
          setIsOpen(false);
          setSelectedFamily(null);
        }, 300);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelectModel = (modelId: string) => {
    onChange(modelId);
    setIsVisible(false);
    setTimeout(() => {
      setIsOpen(false);
      setSelectedFamily(null);
    }, 300);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20 flex justify-between items-center "
        onClick={togglePanel}
        disabled={disabled}
      >
        <div className="flex items-center">
          {selectedDetails ? selectedDetails.family.icon : <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Image size={16} className="text-blue-400" /></div>}
          <span>{selectedDetails ? selectedDetails.model.name : 'Select a model'}</span>
        </div>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={containerRef}
          className="absolute z-50 top-0 left-full ml-9 bg-[rgba(20,20,20,0.95)] border border-white/10 rounded-xl shadow-xl overflow-hidden w-[400px] backdrop-blur-sm"
          style={animationStyles}
        >
          {selectedFamily === null ? (
            <div>
              <div className="p-3 border-b border-white/10 bg-black/20">
                <h3 className="text-sm font-medium text-white/80 text-center">Select Model Family</h3>
              </div>
              <div className="p-2">
                {upscaleModelFamilies.map(family => (
                  <div
                    key={family.id}
                    className="rounded-lg p-3 hover:bg-white/5 cursor-pointer transition-all duration-200 border border-transparent hover:border-white/10"
                    onClick={() => setSelectedFamily(family.id)}
                  >
                    <div className="flex items-center">
                      {family.icon}
                      <div>
                        <div className="text-sm font-medium text-white flex items-center">
                          {family.name}
                          {family.isBeta && <span className="ml-2 px-1.5 py-0.5 text-xs bg-orange-500/30 text-orange-300 rounded">BETA</span>}
                        </div>
                        <div className="text-xs text-white/60 mt-0.5">{family.description}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="p-3 border-b border-white/10 bg-black/20 flex items-center">
                <button
                  className="mr-2 rounded-lg hover:bg-white/10 p-1 transition-colors"
                  onClick={() => setSelectedFamily(null)}
                >
                  <svg
                    className="w-4 h-4 transform rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
                <h3 className="text-sm font-medium text-white/80">
                  {upscaleModelFamilies.find(f => f.id === selectedFamily)?.name || 'Select Model'}
                </h3>
              </div>
              <div className="p-2">
                {upscaleModelFamilies
                  .find(f => f.id === selectedFamily)?.submodels
                  .map((model, index, array) => (
                    <div
                      key={model.id}
                      className={`rounded-lg p-3 cursor-pointer transition-all duration-200 border ${
                        selectedModel === model.id
                          ? 'bg-blue-500/10 border-blue-500/40 shadow-md shadow-blue-500/10'
                          : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                      } ${
                        index < array.length - 1 ? 'mb-2' : ''
                      }`}
                      onClick={() => handleSelectModel(model.id)}
                    >
                      <div className="flex items-center">
                        <div className={`w-4 h-4 rounded-md mr-3 flex-shrink-0 border flex items-center justify-center transition-all duration-200 ${
                          selectedModel === model.id
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-white/40 bg-transparent hover:border-white/60'
                        }`}>
                          {selectedModel === model.id && (
                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center flex-wrap gap-1.5">
                              <span className={`text-sm font-semibold transition-colors ${
                                selectedModel === model.id ? 'text-white' : 'text-white/90'
                              }`}>
                                {model.name}
                              </span>
                              {(() => {
                                const inputType = getModelInputType(model.id);
                                return (
                                  <span className={`px-1.5 py-0.5 text-xs rounded font-medium border ${inputType.color}`}>
                                    {inputType.type}
                                  </span>
                                );
                              })()}
                              {model.isBeta && (
                                <span className="px-1.5 py-0.5 text-xs bg-orange-500/30 text-orange-300 rounded font-medium border border-orange-500/40">
                                  BETA
                                </span>
                              )}
                            </div>
                            {/* Capability indicators */}
                            <div className="flex items-center gap-1 ml-2">
                              {model.supportsFaceEnhance && (
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Face Enhancement"></div>
                              )}
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Image Upscaling"></div>
                            </div>
                          </div>
                          
                          <p className={`text-xs leading-relaxed mb-1.5 transition-colors ${
                            selectedModel === model.id ? 'text-white/75' : 'text-white/65'
                          }`}>
                            {model.description}
                          </p>
                          
                          {/* Model-specific details - Right aligned */}
                          <div className="flex items-center justify-end gap-3 text-xs">
                            {/* Format info */}
                            <span className={`transition-colors ${
                              selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                            }`}>
                              PNG/JPG
                            </span>
                            {/* Credit estimation based on model */}
                            {model.id.includes('recraft') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-purple-300' : 'text-purple-400/80'
                              }`}>
                                • AI Enhancement • ~150 credits
                              </span>
                            )}
                            {model.id.includes('creative-upscaler') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-amber-300' : 'text-amber-400/80'
                              }`}>
                                • Creative AI • ~120 credits
                              </span>
                            )}
                            {model.id.includes('drct-super-resolution') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-indigo-300' : 'text-indigo-400/80'
                              }`}>
                                • Super Resolution • ~180 credits
                              </span>
                            )}
                            {model.id.includes('clarity-upscaler') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-emerald-300' : 'text-emerald-400/80'
                              }`}>
                                • Clarity • ~140 credits
                              </span>
                            )}
                            {model.id.includes('ccsr') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-violet-300' : 'text-violet-400/80'
                              }`}>
                                • Cascaded • ~180 credits
                              </span>
                            )}
                            {model.id.includes('ideogram') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-rose-300' : 'text-rose-400/80'
                              }`}>
                                • Intelligent • ~160 credits
                              </span>
                            )}
                            {model.id.includes('real-esrgan') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-green-300' : 'text-green-400/80'
                              }`}>
                                • Traditional • ~80 credits
                              </span>
                            )}
                            {model.id.includes('stable-diffusion') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-sky-300' : 'text-sky-400/80'
                              }`}>
                                • Latent • ~60 credits
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


// --- Main Image Upscale Interface Component ---
const ImageEnhanceComponent: React.FC = () => {
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [isUpscaling, setIsUpscaling] = useState<boolean>(false);
  const [history, setHistory] = useState<Array<{ id: string; inputUrl: string; outputUrl: string; timestamp: Date; metadata?: any }>>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<{ inputUrl: string; outputUrl: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null); // Show the upscaled output
  const [upscaleError, setUpscaleError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Model and settings
  const [selectedModel, setSelectedModel] = useState<string>(upscaleModelFamilies[0]?.submodels[0]?.id || '');

  // Initialize scaleFactor safely
  const initialModelDefaults = imageUpscaleService.getModelDefaults(selectedModel);
  // Check type explicitly before assigning
  const initialScale = ('defaultScale' in initialModelDefaults && typeof initialModelDefaults.defaultScale === 'number')
    ? initialModelDefaults.defaultScale as number
    : 2; // Fallback to 2 if not found or wrong type
  const [scaleFactor, setScaleFactor] = useState<number>(initialScale);

  const [faceEnhance, setFaceEnhance] = useState<boolean>(false);

  // State for optional prompt input
  const [showPromptInput, setShowPromptInput] = useState<boolean>(false);
  const [upscalePrompt, setUpscalePrompt] = useState<string>('');

  // State for FAL Creative Upscaler advanced settings
  const [creativity, setCreativity] = useState<number>(0.5);
  const [detail, setDetail] = useState<number>(1);
  const [shapePreservation, setShapePreservation] = useState<number>(0.25);
  const [modelType, setModelType] = useState<'SD_1_5' | 'SDXL'>('SD_1_5');
  const [guidanceScale, setGuidanceScale] = useState<number>(7.5);
  const [inferenceSteps, setInferenceSteps] = useState<number>(20);
  const [negativePrompt, setNegativePrompt] = useState<string>('blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisey, grainy');

  // State for FAL Clarity Upscaler settings
  const [resemblance, setResemblance] = useState<number>(0.6);
  const [clarityCreativity, setClarityCreativity] = useState<number>(0.35);
  const [clarityGuidanceScale, setClarityGuidanceScale] = useState<number>(4);
  const [clarityInferenceSteps, setClarityInferenceSteps] = useState<number>(18);
  const [clarityNegativePrompt, setClarityNegativePrompt] = useState<string>('(worst quality, low quality, normal quality:2)');
  const [claritySafetyChecker, setClaritySafetyChecker] = useState<boolean>(true);

  // State for FAL CCSR settings
  const [tileDiffusion, setTileDiffusion] = useState<'none' | 'mix' | 'gaussian'>('none');
  const [tileDiffusionSize, setTileDiffusionSize] = useState<number>(1024);
  const [tileDiffusionStride, setTileDiffusionStride] = useState<number>(512);
  const [tileVae, setTileVae] = useState<boolean>(false);
  const [tileVaeDecoderSize, setTileVaeDecoderSize] = useState<number>(226);
  const [tileVaeEncoderSize, setTileVaeEncoderSize] = useState<number>(1024);
  const [ccsrSteps, setCcsrSteps] = useState<number>(50);
  const [tMax, setTMax] = useState<number>(0.6667);
  const [tMin, setTMin] = useState<number>(0.3333);
  const [colorFixType, setColorFixType] = useState<'none' | 'wavelet' | 'adain'>('adain');

  // State for FAL Ideogram settings
  const [ideogramDetail, setIdeogramDetail] = useState<number>(50);
  const [ideogramResemblance, setIdeogramResemblance] = useState<number>(50);
  const [expandPrompt, setExpandPrompt] = useState<boolean>(false);

  // Zoom/Pan state for the preview image
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // State for before/after slider
  const [dividerPosition, setDividerPosition] = useState<number>(50); // Percentage (0-100)
  const [isDraggingDivider, setIsDraggingDivider] = useState<boolean>(false);

  const [apiTokenAvailable, setApiTokenAvailable] = useState<boolean>(true); // Assume true initially or use checkApiTokens
  const [isCheckingToken, setIsCheckingToken] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false); // For image loading state

  // Effect for handling divider drag
  useEffect(() => {
    const handleGlobalMouseMove = (event: MouseEvent) => {
      if (!isDraggingDivider || !imageContainerRef.current) return;

      const rect = imageContainerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left; // X position within the container
      const width = rect.width;
      
      // Calculate percentage, clamping between 0 and 100
      let newPosition = Math.max(0, Math.min(100, (x / width) * 100));
      setDividerPosition(newPosition);
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingDivider) {
        setIsDraggingDivider(false);
      }
    };

    if (isDraggingDivider) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      // Add user-select none to body to prevent text selection during drag
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      document.body.style.userSelect = ''; // Re-enable text selection
    }

    // Cleanup listeners on unmount
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
       document.body.style.userSelect = '';
    };
  }, [isDraggingDivider]); // Rerun effect when dragging state changes

  // Update settings when model changes
  useEffect(() => {
    const modelDefaults = imageUpscaleService.getModelDefaults(selectedModel);
    // Check if defaultScale exists before setting
    if (modelDefaults && 'defaultScale' in modelDefaults && typeof modelDefaults.defaultScale === 'number') {
      setScaleFactor(modelDefaults.defaultScale);
    } else {
      setScaleFactor(2); // Fallback if not defined for the model
    }
    setFaceEnhance(false); // Reset face enhance
  }, [selectedModel]);

  // Load initial model
  useEffect(() => {
      if (!selectedModel && upscaleModelFamilies.length > 0 && upscaleModelFamilies[0].submodels.length > 0) {
          const initialModelId = upscaleModelFamilies[0].submodels[0].id;
          setSelectedModel(initialModelId);
          // Also update scale factor for the initial model
          const modelDefaults = imageUpscaleService.getModelDefaults(initialModelId);
          if (modelDefaults && 'defaultScale' in modelDefaults && typeof modelDefaults.defaultScale === 'number') {
              setScaleFactor(modelDefaults.defaultScale);
          } else {
               setScaleFactor(2); // Fallback
          }
      }
  }, []); // Run only on mount


  // --- Image Handling ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Basic validation (optional)
    if (!file.type.startsWith('image/')) {
        notifications.error('Please select an image file.');
        return;
      }
    // Could add size validation here too

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setInputImage(dataUrl);
      setPreviewImage(dataUrl); // Show input image initially in preview
      setSelectedHistoryItem(null); // Clear selection when new image uploaded
      resetZoomPan(); // Reset view for new image
    };
    reader.onerror = () => notifications.error("Error reading file");
    reader.readAsDataURL(file);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const removeInputImage = () => {
    setInputImage(null);
    setPreviewImage(null);
    setSelectedHistoryItem(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset file input
    }
    resetZoomPan();
  };

  // --- Upscaling Logic ---
  const handleUpscale = async () => {
    if (!inputImage) {
      notifications.error('Please upload an image to upscale.');
      return;
    }
    if (!selectedModel) {
        notifications.error('Please select an upscale model.');
        return;
    }

    // TODO: Add API token check if needed
    // if (!checkTokenAvailability()) { return; }

    setIsUpscaling(true);
    setUpscaleError(null);
    setIsLoading(true); // Show loading indicator in preview

    try {
      const settings: ImageUpscaleSettings = {
        image_url: inputImage,
        model: selectedModel,
        scale: scaleFactor,
      };

      // Add face enhancement if supported and enabled
      const modelInfo = upscaleModelFamilies.flatMap(f => f.submodels).find(m => m.id === selectedModel);
      if (modelInfo?.supportsFaceEnhance && faceEnhance) {
        settings.face_enhance = true;
      }

      // Add prompt if enabled and not empty
      if (showPromptInput && upscalePrompt.trim()) {
        settings.prompt = upscalePrompt.trim();
      }

      // Add FAL Creative Upscaler specific settings
      if (selectedModel === 'fal-ai/creative-upscaler') {
        settings.creativity = creativity;
        settings.detail = detail;
        settings.shape_preservation = shapePreservation;
        settings.model_type = modelType;
        settings.guidance_scale = guidanceScale;
        settings.num_inference_steps = inferenceSteps;
        settings.negative_prompt = negativePrompt;
      }

      // Add FAL Clarity Upscaler specific settings
      if (selectedModel === 'fal-ai/clarity-upscaler') {
        settings.resemblance = resemblance;
        settings.creativity = clarityCreativity;
        settings.guidance_scale = clarityGuidanceScale;
        settings.num_inference_steps = clarityInferenceSteps;
        settings.negative_prompt = clarityNegativePrompt;
        settings.enable_safety_checker = claritySafetyChecker;
      }

      // Add FAL CCSR specific settings
      if (selectedModel === 'fal-ai/ccsr') {
        settings.tile_diffusion = tileDiffusion;
        settings.tile_diffusion_size = tileDiffusionSize;
        settings.tile_diffusion_stride = tileDiffusionStride;
        settings.tile_vae = tileVae;
        settings.tile_vae_decoder_size = tileVaeDecoderSize;
        settings.tile_vae_encoder_size = tileVaeEncoderSize;
        settings.steps = ccsrSteps;
        settings.t_max = tMax;
        settings.t_min = tMin;
        settings.color_fix_type = colorFixType;
      }

      // Add FAL Ideogram specific settings
      if (selectedModel === 'fal-ai/ideogram/upscale') {
        settings.ideogram_detail = ideogramDetail;
        settings.resemblance = ideogramResemblance;
        settings.expand_prompt = expandPrompt;
      }

      console.log('[ImageUpscale] Request:', settings);
      const result = await imageUpscaleService.upscaleImage(selectedModel, settings);
      console.log('[ImageUpscale] Result:', result);

      if (result.success && result.images && result.images.length > 0) {
        const upscaledImage = result.images[0];

        // Preload the upscaled image before showing it
        preloadImage(upscaledImage.url)
            .then(loadedUrl => {
                setPreviewImage(loadedUrl); // Show the upscaled image in the preview
                resetZoomPan();

                // Add to history
                const newItem = {
                    id: `upscale_${Date.now()}`,
                    inputUrl: inputImage,
                    outputUrl: loadedUrl,
                    timestamp: new Date(),
                    metadata: {
                        model: selectedModel,
                        scale: scaleFactor,
                        faceEnhance: settings.face_enhance,
                        ...(result.metadata || {})
                    }
                };
                setHistory(prev => [newItem, ...prev].slice(0, 20)); // Keep last 20
                setSelectedHistoryItem({ inputUrl: newItem.inputUrl, outputUrl: newItem.outputUrl }); // Select the new item
                 notifications.success('Image upscaled successfully');
            })
            .catch(err => {
                console.error('Failed to preload upscaled image:', err);
                 setPreviewImage(upscaledImage.url); // Show anyway as fallback
                 setUpscaleError('Upscaled image loaded, but preloading failed.');
                 resetZoomPan();
                 // Still add to history
                 const newItem = { id: `upscale_${Date.now()}`, inputUrl: inputImage, outputUrl: upscaledImage.url, timestamp: new Date(), metadata: { model: selectedModel, scale: scaleFactor, faceEnhance: settings.face_enhance, ...(result.metadata || {}) } };
                 setHistory(prev => [newItem, ...prev].slice(0, 20));
                 setSelectedHistoryItem({ inputUrl: newItem.inputUrl, outputUrl: newItem.outputUrl });
             })
             .finally(() => {
                 setIsLoading(false); // Hide loading indicator after preload attempt
             });

      } else {
        setUpscaleError(result.error || 'Upscaling failed.');
        notifications.error(`Error: ${result.error || 'Upscaling failed'}`);
        setIsLoading(false); // Hide loading on error
      }
    } catch (error) {
      console.error('Error upscaling image:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setUpscaleError(message);
      notifications.error(`Error: ${message}`);
       setIsLoading(false); // Hide loading on catch
    } finally {
      setIsUpscaling(false);
    }
  };

  // --- History Management ---
  const handleSelectHistory = (item: { inputUrl: string; outputUrl: string }) => {
     setIsLoading(true); // Show loading while switching
     preloadImage(item.outputUrl) // Preload before showing
        .then(loadedUrl => {
            setInputImage(item.inputUrl); // Set input for context
            setPreviewImage(loadedUrl); // Set output for preview
            setSelectedHistoryItem(item);
            resetZoomPan();
        })
        .catch(err => {
            console.error("Failed to preload history image:", err);
             setInputImage(item.inputUrl);
             setPreviewImage(item.outputUrl); // Fallback
             setSelectedHistoryItem(item);
             resetZoomPan();
             notifications.error('Could not preload history image.');
         })
         .finally(() => setIsLoading(false));
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear the upscale history?')) {
      setHistory([]);
      setSelectedHistoryItem(null);
      // Optionally clear preview if not showing the current input
       if (previewImage !== inputImage) {
           setPreviewImage(inputImage); // Revert preview to current input or clear
       }
    }
  };

    const handleDeleteHistoryItem = (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent selecting the item when deleting
        setHistory(prev => prev.filter(h => h.id !== id));
        // If the deleted item was selected, clear the selection and preview
        const deletedItem = history.find(h => h.id === id);
        if (deletedItem && selectedHistoryItem?.outputUrl === deletedItem.outputUrl) {
            setSelectedHistoryItem(null);
            setPreviewImage(inputImage); // Revert preview to input image
            resetZoomPan();
        }
    };


  // --- Zoom/Pan Logic ---
  const resetZoomPan = () => {
    setZoomLevel(1);
    setPanX(0);
    setPanY(0);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const scaleAmount = -e.deltaY * 0.005; // Adjust sensitivity
    setZoomLevel(prev => Math.max(0.1, Math.min(prev + scaleAmount, 10))); // Clamp zoom level
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
    (e.target as HTMLImageElement).style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return;
      e.preventDefault();
    setPanX(e.clientX - dragStart.x);
    setPanY(e.clientY - dragStart.y);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
       // Find the image element and reset cursor
       const imgElement = e.currentTarget.querySelector('img');
       if (imgElement) {
           imgElement.style.cursor = 'grab';
       }
    }
  };

   const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDragging) {
            handleMouseUp(e); // End drag if mouse leaves container
        }
    };

    // Helper for preloading
    const preloadImage = (url: string): Promise<string> => {
        return new Promise((resolve, reject) => {
        if (!url) {
            reject(new Error('Image URL is empty'));
            return;
        }
        const img = new window.Image();
        img.onload = () => resolve(url);
        img.onerror = (err) => reject(new Error(`Failed to load image: ${url} - ${err.toString()}`));
        img.src = url;
        });
    };

  // --- Render ---
  return (
    <div className="flex flex-col h-full">
      {/* Optional: Add API Token Notice if needed for upscale service */}
      {/*!apiTokenAvailable && (
        <ApiTokenNotice serviceKey="your_upscale_service_key" onTokenSaved={handleTokenSaved} />
      )*/}

      <div className="flex flex-col lg:flex-row h-full relative gap-2">
        {/* Left Panel (Controls) */}
        <div className="lg:w-[30%] lg:max-w-[350px] pr-1 pl-0">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 space-y-2 h-full flex flex-col">
            <h2 className="text-base font-semibold text-white flex items-center"></h2> {/* Keep empty h2 */}
            
            <UpscaleModelSelector
              selectedModel={selectedModel}
              onChange={setSelectedModel}
              disabled={isUpscaling}
            />
            
            <div className="mt-2"></div>
            
            {/* Image Input Area */}
            <div className="mt-2 space-y-2">
              <div className="relative">
                {!inputImage ? (
                  <button
                    onClick={handleUploadClick}
                    className="w-full h-32 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors"
                  >
                    <Image size={32} className="mb-2" />
                    <span className="text-sm">Click to Upload Image</span>
                    <span className="text-xs mt-1">(or drag and drop)</span>
                  </button>
                ) : (
                  <div className="relative bg-black/30 rounded-lg overflow-hidden border border-white/10 group p-2">
                    <div className="flex justify-center">
                      <img 
                        src={inputImage} 
                        alt="Input Preview"
                        className="max-h-20 max-w-full rounded object-contain cursor-pointer"
                        onClick={handleUploadClick}
                      />
                    </div>
                    <button
                      onClick={removeInputImage}
                      className="absolute top-1 right-1 p-1 bg-red-700/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                      title="Remove Image"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="hidden"
                />
              </div>
            </div>
                    
            {/* Upscale Settings */}
            <div className="mt-2">
              {/* Optional Prompt Toggle */}
              <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between py-1">
                  <span className="text-white/70 text-xs flex items-center">
                    <Settings size={12} className="mr-1.5 text-blue-400"/> Add Prompt Guidance
                  </span>
                  <button
                    onClick={() => setShowPromptInput(!showPromptInput)}
                    disabled={isUpscaling}
                    className={`relative inline-flex items-center h-5 rounded-full w-9 transition-colors ${
                      showPromptInput ? 'bg-blue-600' : 'bg-black/40'
                    }`}
                  >
                    <span
                      className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform ${
                        showPromptInput ? 'translate-x-4.5' : 'translate-x-0.5'
                      }`}
                      style={{ transform: showPromptInput ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                    />
                  </button>
                </div>
              </div>
              
              {/* Optional Prompt Input Textarea */}
              {showPromptInput && (
                <div className="mb-2">
                  <textarea
                    value={upscalePrompt}
                    onChange={(e) => setUpscalePrompt(e.target.value)}
                    placeholder="Optional: Describe desired style or changes..."
                    className="w-full h-20 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                    disabled={isUpscaling}
                  />
                </div>
              )}
              
              {/* Scale Factor */}
              <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-white/70 text-xs">Scale Factor</span>
                  {selectedModel === 'fal-ai/recraft/upscale/creative' ? (
                    <div className="flex items-center text-white/60 text-xs">
                      <span className="text-purple-400">Auto-Enhanced</span>
                      <span className="ml-1 text-white/40">(Creative AI)</span>
                    </div>
                  ) : selectedModel === 'fal-ai/recraft/upscale/crisp' ? (
                    <div className="flex items-center text-white/60 text-xs">
                      <span className="text-cyan-400">Auto-Enhanced</span>
                      <span className="ml-1 text-white/40">(Crisp AI)</span>
                    </div>
                  ) : selectedModel === 'fal-ai/drct-super-resolution' ? (
                    <div className="flex items-center text-white/60 text-xs">
                      <span className="text-indigo-400">Fixed 4x</span>
                      <span className="ml-1 text-white/40">(Super Resolution)</span>
                    </div>
                  ) : selectedModel === 'fal-ai/ideogram/upscale' ? (
                    <div className="flex items-center text-white/60 text-xs">
                      <span className="text-rose-400">Intelligent</span>
                      <span className="ml-1 text-white/40">(AI Guided)</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end space-x-1">
                      {[2, 4, 8].map(factor => (
                        <button
                          key={factor}
                          onClick={() => setScaleFactor(factor)}
                          disabled={isUpscaling}
                          className={`px-3 py-1 rounded text-xs transition-colors ${
                            scaleFactor === factor
                              ? 'bg-white/20 text-white'
                              : 'bg-black/30 text-white/70 hover:bg-black/40'
                          }`}
                        >
                          {factor}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Face Enhance (Conditional) */}
              {upscaleModelFamilies.flatMap(f => f.submodels).find(m => m.id === selectedModel)?.supportsFaceEnhance && (
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-white/70 text-xs flex items-center">
                      <Wand2 size={12} className="mr-1.5 text-pink-400"/> Face Enhancement
                    </span>
                    <button
                      onClick={() => setFaceEnhance(!faceEnhance)}
                      disabled={isUpscaling}
                      className={`relative inline-flex items-center h-5 rounded-full w-9 transition-colors ${
                        faceEnhance ? 'bg-green-500' : 'bg-black/40'
                      }`}
                    >
                      <span
                        className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform ${
                          faceEnhance ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`} 
                        style={{ transform: faceEnhance ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                      />
                    </button>
                  </div>
                </div>
              )}
              
              {/* Recraft Creative Upscale Special Options */}
              {selectedModel === 'fal-ai/recraft/upscale/creative' && (
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="text-white/70 text-xs mb-2 flex items-center">
                    <Sparkles size={12} className="mr-1.5 text-purple-400"/> Creative Enhancement
                  </div>
                  <div className="space-y-2 text-xs text-white/60">
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mr-2"></div>
                      <span>Automatic detail enhancement</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mr-2"></div>
                      <span>AI-powered texture improvement</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mr-2"></div>
                      <span>Creative artistic enhancement</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Recraft Crisp Upscale Special Options */}
              {selectedModel === 'fal-ai/recraft/upscale/crisp' && (
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="text-white/70 text-xs mb-2 flex items-center">
                    <ZoomIn size={12} className="mr-1.5 text-cyan-400"/> Crisp Enhancement
                  </div>
                  <div className="space-y-2 text-xs text-white/60">
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mr-2"></div>
                      <span>Sharp detail preservation</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mr-2"></div>
                      <span>Clean edge enhancement</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mr-2"></div>
                      <span>Precise clarity optimization</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* DRCT Super Resolution Special Options */}
              {selectedModel === 'fal-ai/drct-super-resolution' && (
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="text-white/70 text-xs mb-2 flex items-center">
                    <ArrowUpRight size={12} className="mr-1.5 text-indigo-400"/> Super Resolution
                  </div>
                  <div className="space-y-2 text-xs text-white/60">
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-2"></div>
                      <span>Fixed 4x upscaling factor</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-2"></div>
                      <span>State-of-the-art super resolution</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-2"></div>
                      <span>Optimized for detail preservation</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* FAL Clarity Upscaler Advanced Settings */}
              {selectedModel === 'fal-ai/clarity-upscaler' && (
                <div className="space-y-2">
                  {/* Resemblance Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Resemblance</span>
                      <span className="text-emerald-400 text-xs">{resemblance.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={resemblance}
                      onChange={(e) => setResemblance(parseFloat(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How much to preserve original image</div>
                  </div>

                  {/* Creativity Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Creativity</span>
                      <span className="text-emerald-400 text-xs">{clarityCreativity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={clarityCreativity}
                      onChange={(e) => setClarityCreativity(parseFloat(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How much to deviate from original</div>
                  </div>

                  {/* Guidance Scale Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Guidance Scale</span>
                      <span className="text-emerald-400 text-xs">{clarityGuidanceScale.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="0.5"
                      value={clarityGuidanceScale}
                      onChange={(e) => setClarityGuidanceScale(parseFloat(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How closely to follow prompt guidance</div>
                  </div>

                  {/* Inference Steps Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Inference Steps</span>
                      <span className="text-emerald-400 text-xs">{clarityInferenceSteps}</span>
                    </div>
                    <input
                      type="range"
                      min="4"
                      max="50"
                      step="1"
                      value={clarityInferenceSteps}
                      onChange={(e) => setClarityInferenceSteps(parseInt(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">Number of denoising steps</div>
                  </div>

                  {/* Safety Checker Toggle */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-white/70 text-xs flex items-center">
                        <Settings size={12} className="mr-1.5 text-emerald-400"/> Safety Checker
                      </span>
                      <button
                        onClick={() => setClaritySafetyChecker(!claritySafetyChecker)}
                        disabled={isUpscaling}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 transition-colors ${
                          claritySafetyChecker ? 'bg-emerald-600' : 'bg-black/40'
                        }`}
                      >
                        <span
                          className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform ${
                            claritySafetyChecker ? 'translate-x-4.5' : 'translate-x-0.5'
                          }`}
                          style={{ transform: claritySafetyChecker ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {/* FAL CCSR Advanced Settings */}
              {selectedModel === 'fal-ai/ccsr' && (
                <div className="space-y-2">
                  {/* Tile Diffusion Mode */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="text-white/70 text-xs mb-2 flex items-center">
                      <Settings size={12} className="mr-1.5 text-violet-400"/> Tile Diffusion
                    </div>
                    <div className="flex space-x-1">
                      {(['none', 'mix', 'gaussian'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setTileDiffusion(mode)}
                          disabled={isUpscaling}
                          className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors capitalize ${
                            tileDiffusion === mode
                              ? 'bg-violet-600/30 text-violet-300 border border-violet-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tile Processing Controls */}
                  {tileDiffusion !== 'none' && (
                    <>
                      <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white/70 text-xs">Tile Size</span>
                          <span className="text-violet-400 text-xs">{tileDiffusionSize}</span>
                        </div>
                        <input
                          type="range"
                          min="256"
                          max="2048"
                          step="64"
                          value={tileDiffusionSize}
                          onChange={(e) => setTileDiffusionSize(parseInt(e.target.value))}
                          disabled={isUpscaling}
                          className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="text-xs text-white/50 mt-1">Size of processing patches</div>
                      </div>

                      <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white/70 text-xs">Tile Stride</span>
                          <span className="text-violet-400 text-xs">{tileDiffusionStride}</span>
                        </div>
                        <input
                          type="range"
                          min="128"
                          max="1024"
                          step="32"
                          value={tileDiffusionStride}
                          onChange={(e) => setTileDiffusionStride(parseInt(e.target.value))}
                          disabled={isUpscaling}
                          className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="text-xs text-white/50 mt-1">Stride between patches</div>
                      </div>
                    </>
                  )}

                  {/* VAE Tiling */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-white/70 text-xs flex items-center">
                        <Settings size={12} className="mr-1.5 text-violet-400"/> VAE Tiling
                      </span>
                      <button
                        onClick={() => setTileVae(!tileVae)}
                        disabled={isUpscaling}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 transition-colors ${
                          tileVae ? 'bg-violet-600' : 'bg-black/40'
                        }`}
                      >
                        <span
                          className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform ${
                            tileVae ? 'translate-x-4.5' : 'translate-x-0.5'
                          }`}
                          style={{ transform: tileVae ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Processing Steps */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Steps</span>
                      <span className="text-violet-400 text-xs">{ccsrSteps}</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="5"
                      value={ccsrSteps}
                      onChange={(e) => setCcsrSteps(parseInt(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">Number of processing steps</div>
                  </div>

                  {/* Color Fix Type */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="text-white/70 text-xs mb-2 flex items-center">
                      <Settings size={12} className="mr-1.5 text-violet-400"/> Color Correction
                    </div>
                    <div className="flex space-x-1">
                      {(['none', 'wavelet', 'adain'] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setColorFixType(type)}
                          disabled={isUpscaling}
                          className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors capitalize ${
                            colorFixType === type
                              ? 'bg-violet-600/30 text-violet-300 border border-violet-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {/* FAL Ideogram Advanced Settings */}
              {selectedModel === 'fal-ai/ideogram/upscale' && (
                <div className="space-y-2">
                  {/* Detail Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Detail Level</span>
                      <span className="text-rose-400 text-xs">{ideogramDetail}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      step="1"
                      value={ideogramDetail}
                      onChange={(e) => setIdeogramDetail(parseInt(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">Amount of detail enhancement</div>
                  </div>

                  {/* Resemblance Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Resemblance</span>
                      <span className="text-rose-400 text-xs">{ideogramResemblance}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      step="1"
                      value={ideogramResemblance}
                      onChange={(e) => setIdeogramResemblance(parseInt(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How closely to match original image</div>
                  </div>

                  {/* MagicPrompt Toggle */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-white/70 text-xs flex items-center">
                        <Sparkles size={12} className="mr-1.5 text-rose-400"/> MagicPrompt
                      </span>
                      <button
                        onClick={() => setExpandPrompt(!expandPrompt)}
                        disabled={isUpscaling}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 transition-colors ${
                          expandPrompt ? 'bg-rose-600' : 'bg-black/40'
                        }`}
                      >
                        <span
                          className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform ${
                            expandPrompt ? 'translate-x-4.5' : 'translate-x-0.5'
                          }`}
                          style={{ transform: expandPrompt ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                        />
                      </button>
                    </div>
                    {expandPrompt && (
                      <div className="mt-2 text-xs text-rose-300/70">
                        Automatically enhances your prompt for better results
                      </div>
                    )}
                  </div>

                  {/* Ideogram Features Info */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="text-white/70 text-xs mb-2 flex items-center">
                      <Sparkles size={12} className="mr-1.5 text-rose-400"/> Intelligent Features
                    </div>
                    <div className="space-y-2 text-xs text-white/60">
                      <div className="flex items-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mr-2"></div>
                        <span>AI-guided intelligent upscaling</span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mr-2"></div>
                        <span>Prompt-based enhancement control</span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mr-2"></div>
                        <span>Adaptive detail preservation</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* FAL Creative Upscaler Advanced Settings */}
              {selectedModel === 'fal-ai/creative-upscaler' && (
                <div className="space-y-2">
                  {/* Model Type Selection */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="text-white/70 text-xs mb-2 flex items-center">
                      <Settings size={12} className="mr-1.5 text-amber-400"/> Model Type
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setModelType('SD_1_5')}
                        disabled={isUpscaling}
                        className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                          modelType === 'SD_1_5'
                            ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                            : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        SD 1.5
                      </button>
                      <button
                        onClick={() => setModelType('SDXL')}
                        disabled={isUpscaling}
                        className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                          modelType === 'SDXL'
                            ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                            : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        SDXL
                      </button>
                    </div>
                  </div>

                  {/* Creativity Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Creativity</span>
                      <span className="text-amber-400 text-xs">{creativity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={creativity}
                      onChange={(e) => setCreativity(parseFloat(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How much the output can deviate from original</div>
                  </div>

                  {/* Detail Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Detail</span>
                      <span className="text-amber-400 text-xs">{detail.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="5"
                      step="0.1"
                      value={detail}
                      onChange={(e) => setDetail(parseFloat(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How much detail to add</div>
                  </div>

                  {/* Shape Preservation Control */}
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/70 text-xs">Shape Preservation</span>
                      <span className="text-amber-400 text-xs">{shapePreservation.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.05"
                      value={shapePreservation}
                      onChange={(e) => setShapePreservation(parseFloat(e.target.value))}
                      disabled={isUpscaling}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-white/50 mt-1">How much to preserve original shape</div>
                  </div>
                </div>
              )}
            </div>
                    
            {/* Credit Usage Info */}
            <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg px-1.5 py-2.5 mt-2 min-h-[40px] flex items-center">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center text-white/70">
                  <Info size={10} className="mr-1 flex-shrink-0" />
                  <span className="text-xs flex-shrink-0">Credit usage</span>
                </div>
                <div className="text-xs text-right ml-2">
                  {selectedModel === 'fal-ai/recraft/upscale/creative' ? (
                    <>
                      <span className="text-white/90 font-medium">~150 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-purple-400 text-[10px] mt-0.5">Creative AI enhancement</div>
                    </>
                  ) : selectedModel === 'fal-ai/recraft/upscale/crisp' ? (
                    <>
                      <span className="text-white/90 font-medium">~140 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-cyan-400 text-[10px] mt-0.5">Crisp AI enhancement</div>
                    </>
                  ) : selectedModel === 'fal-ai/creative-upscaler' ? (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 60)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-amber-400 text-[10px] mt-0.5">Advanced creative AI</div>
                    </>
                  ) : selectedModel === 'fal-ai/drct-super-resolution' ? (
                    <>
                      <span className="text-white/90 font-medium">~180 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-indigo-400 text-[10px] mt-0.5">Super resolution AI</div>
                    </>
                  ) : selectedModel === 'fal-ai/clarity-upscaler' ? (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 70)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-emerald-400 text-[10px] mt-0.5">Clarity AI upscaling</div>
                    </>
                  ) : selectedModel === 'fal-ai/ccsr' ? (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 90)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-violet-400 text-[10px] mt-0.5">Cascaded refinement</div>
                    </>
                  ) : selectedModel === 'fal-ai/ideogram/upscale' ? (
                    <>
                      <span className="text-white/90 font-medium">~160 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-rose-400 text-[10px] mt-0.5">Intelligent AI upscaling</div>
                    </>
                  ) : selectedModel.includes('real-esrgan') ? (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 20)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-green-400 text-[10px] mt-0.5">Traditional upscaling</div>
                    </>
                  ) : selectedModel.includes('stable-diffusion') ? (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 30)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-sky-400 text-[10px] mt-0.5">AI-powered diffusion</div>
                    </>
                  ) : (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 25)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-purple-400 text-[10px] mt-0.5">Enhancement model</div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Upscale Button */}
            <div className="mt-auto pt-2">
              <button
                onClick={handleUpscale}
                disabled={isUpscaling || !inputImage || !selectedModel}
                className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-xs font-semibold
                  ${
                    isUpscaling
                      ? 'bg-black/50 cursor-not-allowed'
                      : inputImage && selectedModel
                        ? 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600'
                        : 'bg-zinc-800/40 hover:bg-zinc-800/60 border border-zinc-700/40 opacity-60'
                  }
                `}
              >
                {isUpscaling ? (
                  <>
                    <RotateCw size={14} className="mr-1.5 animate-spin" />
                    Upscaling...
                  </>
                ) : (
                  <>
                    <ArrowUpRight size={14} className="mr-1.5" />
                    Upscale Image
                  </>
                )}
              </button>
              {upscaleError && <p className="text-red-500 text-xs mt-2 text-center">Error: {upscaleError}</p>}
            </div>
              </div>
          </div>
          
        {/* Right Panel (Preview & History Bar) */}
        <div className="flex-1 lg:pl-2 lg:pr-0 pt-0 flex flex-col">
          {/* Container 1: Preview Area - Match Video Structure */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col"
               style={{ height: 'calc(100% - 120px - 8px)', minHeight: '400px' }}>
            
            {/* Preview Controls Area */}
            <div className="flex items-center justify-end mb-2 flex-shrink-0">
              {history.length > 0 && (
                <div className="flex space-x-2">
                  <button
                    onClick={handleClearHistory}
                    className="p-2 text-red-500/70 hover:text-red-500 hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Clear History"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </div>

            {/* Preview display area */}
            <div className="flex-1 relative rounded-lg overflow-hidden bg-black/20 flex items-center justify-center">
              <div
                ref={imageContainerRef}
                className="absolute inset-0 flex items-center justify-center"
              >
              {isLoading || isUpscaling ? (
                 <div className="text-center z-10 p-4">
                     <div className="inline-block p-5 bg-blue-900/20 rounded-full shadow-lg mb-3">
                         <RotateCw className="w-8 h-8 animate-spin text-blue-400" />
              </div>
                     <div className="text-sm text-white/80 font-medium">
                         {isUpscaling ? 'Upscaling image...' : 'Loading image...'}
              </div>
            </div>
              ) : previewImage && inputImage && previewImage !== inputImage ? ( // MODIFIED: Show slider only after upscale
                <div 
                  className="absolute inset-0 w-full h-full cursor-grab"
                  style={{
                    transform: `scale(${zoomLevel}) translate(${panX / zoomLevel}px, ${panY / zoomLevel}px)`, 
                    transformOrigin: 'center center'
                  }}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onWheel={handleWheel}
                >
                  {/* Base Layer (Original) */}
                  <div
                    className="absolute inset-0 w-full h-full select-none pointer-events-none"
                        style={{ 
                      backgroundImage: `url(${inputImage})`,
                      backgroundSize: 'contain',
                      backgroundPosition: 'center center',
                      backgroundRepeat: 'no-repeat',
                    }}
                  ></div>
                  
                  {/* Top Layer (Upscaled - Clipped) */}
                  <div 
                    className="absolute inset-0 w-full h-full select-none pointer-events-none"
                      style={{ 
                      backgroundImage: `url(${previewImage})`,
                      backgroundSize: 'contain',
                      backgroundPosition: 'center center',
                      backgroundRepeat: 'no-repeat',
                      clipPath: `inset(0 ${100 - dividerPosition}% 0 0)` // Use clip-path
                    }}
                  ></div>
                  
                  {/* Draggable Divider */}
                  <div 
                    className="absolute top-0 bottom-0 w-1 bg-white/50 cursor-ew-resize z-10 hover:bg-white transition-colors duration-150"
                    style={{ left: `calc(${dividerPosition}% - 2px)` }} // Adjust based on handle style if needed
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsDraggingDivider(true);
                    }}
                  >
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-8 bg-white rounded-sm shadow-md"></div>
                  </div>
                    
                </div> // End zoom/pan wrapper
              ) : previewImage ? ( // MODIFIED: Fallback shows single image if no input OR if preview === input
                <div className="absolute inset-0 w-full h-full cursor-grab" 
                   // Apply zoom/pan to the wrapper div for the single image case too
                   style={{ 
                      transform: `scale(${zoomLevel}) translate(${panX / zoomLevel}px, ${panY / zoomLevel}px)`,
                      transformOrigin: 'center center' // Added transformOrigin
                   }} 
                   onMouseMove={handleMouseMove} // Added handlers
                   onMouseUp={handleMouseUp}
                   onMouseLeave={handleMouseLeave}
                   onWheel={handleWheel}
                 >
                    <div 
                      className="absolute inset-0 w-full h-full"
                      style={{ 
                        backgroundImage: `url(${previewImage})`,
                        backgroundSize: 'contain',
                        backgroundPosition: 'center center',
                        backgroundRepeat: 'no-repeat',
                      }}
                    ></div>
                      </div>
              ) : (
                <div className="flex flex-col items-center text-center p-4 text-white/40">
                  <Image size={64} className="mx-auto mb-4 opacity-50" />
                  <p>Upload an image to start</p>
                  <p className="text-sm mt-1">Upscaled preview will appear here</p>
                    </div>
              )}
              {previewImage && (
                 <div className="absolute top-1 right-1 flex space-x-0.5 bg-black/70 p-0.5 rounded-md z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                     className="p-1 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
                     onClick={() => setZoomLevel(prev => Math.min(prev * 1.2, 10))}
                     title="Zoom In"
                   >
                     <ZoomIn size={14} />
                    </button>
                    <button
                     className="p-1 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
                     onClick={() => setZoomLevel(prev => Math.max(0.1, prev / 1.2))}
                     title="Zoom Out"
                   >
                     <ZoomOut size={14} />
                    </button>
                    <button
                     className="p-1 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
                     onClick={resetZoomPan}
                     title="Reset View"
                    >
                     <Maximize size={14} />
                    </button>
                    <button
                     className="p-1 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
                     onClick={async () => {
                       if (previewImage) {
                         try {
                           const response = await fetch(previewImage);
                           const blob = await response.blob();
                           const url = window.URL.createObjectURL(blob);
                           const a = document.createElement('a');
                           a.style.display = 'none';
                           a.href = url;
                           // Create filename
                           const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                           const modelName = selectedModel.split('/').pop()?.replace(/[^a-z0-9]/gi, '-') || 'upscaled';
                           const filenameGuess = `${modelName}_${scaleFactor}x_${timestamp}`;
                           const finalFilename = filenameGuess.includes('.') ? filenameGuess : `${filenameGuess}.png`;
                           a.download = finalFilename;
                           document.body.appendChild(a);
                           a.click();
                           window.URL.revokeObjectURL(url);
                           notifications.success('Image downloaded');
                         } catch (err) {
                           console.error('Download failed:', err);
                           notifications.error('Failed to download image.');
                         }
                       }
                     }}
                     title="Download Image"
                   >
                     <Download size={14} />
                    </button>
                </div>
              )}
              </div>
            </div>
          </div>
          
          {/* Container 2: History Area */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 mt-2 overflow-hidden flex flex-col"
               style={{ height: '120px', minHeight: '120px' }}>
            {/* History Header & Clear Button */}
            <div className="flex justify-between items-center mb-1 px-1 flex-shrink-0">
              <div className="text-xs text-white/60">Recent Upscales</div>
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
            
            {/* History Scroll Area */}
            <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              <div className="flex space-x-2 h-full pb-1">
                {history.length > 0 ? (
                  history.map((item) => (
                    <div 
                      key={item.id}
                      className={`relative flex-shrink-0 h-full aspect-square border rounded-lg overflow-hidden cursor-pointer group bg-cover bg-center transition-all
                        ${selectedHistoryItem?.outputUrl === item.outputUrl ? 'border-blue-500 border-2' : 'border-white/10 hover:border-white/30'}`}
                      style={{
                        backgroundImage: `url('${item.outputUrl}')`
                      }}
                      onClick={() => handleSelectHistory({ inputUrl: item.inputUrl, outputUrl: item.outputUrl })}
                      title={`Upscaled ${item.metadata?.scale || '?'}x with ${item.metadata?.model?.split('/').pop() || 'model'}`}
                    >
                      {/* Delete Button */}
                      <button
                        onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                        className="absolute top-1 right-1 p-0.5 bg-red-600/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                        title="Delete Item"
                      >
                        <X size={10} />
                      </button>
                      {/* Metadata */}
                      <span className="absolute bottom-1 left-1 bg-black/70 text-white/80 text-[9px] px-1 py-0.5 rounded">
                        {item.metadata?.model?.split('/').pop()?.substring(0,10) || 'Upscale'}
                        {item.metadata?.scale ? ` ${item.metadata.scale}x` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  /* Placeholder */
                  <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
                    <p>History will appear here</p>
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

// Export the main component
export default ImageEnhanceComponent; // Changed export to the main component directly

// Optional: Add global Window type extension if needed for API keys
declare global {
  interface Window {
    // Define any specific API keys your upscale service might need
    // e.g., YOUR_UPSCALE_SERVICE_API_KEY?: string;
  }
}
