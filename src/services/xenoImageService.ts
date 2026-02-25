import { ImageGenerationResponse } from '../components/nodes/image-models/ImageModelInterface';
import { postXenoRequest } from './xenoProxyRequest';

export const XenoModels = {
  STABLE_DIFFUSION_XL: {
    model: "classic",
    version: "classic",
    description: "Stable Diffusion XL 1.0 by Stability AI"
  },
  FLUX_DEV: {
    model: "flux-dev",
    version: "flux-dev",
    description: "Flux Dev - 12B parameter rectified flow transformer for high-quality image generation"
  },
  FLUX_PRO: {
    model: "flux-pro-plus",
    version: "flux-pro-plus",
    description: "Flux 1.1 Pro - Faster generation with excellent image quality, prompt adherence, and output diversity"
  },
  LUMA_PHOTON: {
    model: "fast",
    version: "fast",
    description: "Photon - advanced image generation with reference capabilities"
  },
  RECRAFT_V3: {
    model: "auto",
    version: "auto",
    description: "Recraft V3 - versatile image generation with multiple styles"
  },
  SEEDREAM_4_5: {
    model: "seedream-4-5",
    version: "seedream-4-5",
    description: "Seedream 4.5 - ByteDance's latest image generation model with enhanced spatial understanding"
  },
  SEEDREAM_4: {
    model: "seedream-4-5",
    version: "seedream-4-5",
    description: "Seedream 4.0 - Unified generation and editing model with 4K output support"
  },
  Z_IMAGE_TURBO: {
    model: "auto",
    version: "auto",
    description: "Z-Image Turbo - 6B parameter ultra-fast text-to-image with Chinese/English support"
  },
  DALLE_3: {
    model: "gpt-high",
    version: "gpt-high",
    description: "DALL-E 3 - OpenAI's latest image generation model (requires OpenAI API key)"
  },
  RECRAFT_V3_SVG: {
    model: "auto",
    version: "auto",
    description: "Recraft V3 SVG - vector graphics generation in SVG format (SVG output not supported)"
  },
  CLARITY_UPSCALER: {
    model: "auto",
    version: "auto",
    description: "Clarity Upscaler - high-quality image upscaling with fine detail preservation"
  },
  ULTIMATE_SD_UPSCALE: {
    model: "auto",
    version: "auto",
    description: "Ultimate SD Upscale - detail-enhancing upscaler based on Stable Diffusion"
  },
  RECRAFT_CRISP_UPSCALE: {
    model: "auto",
    version: "auto",
    description: "Recraft Crisp Upscale - sharp and crisp detail preservation for image upscaling"
  },
  RECRAFT_CREATIVE_UPSCALE: {
    model: "auto",
    version: "auto",
    description: "Recraft Creative Upscale - creative enhancement upscaler that adds details while maintaining style"
  },
  REAL_ESRGAN: {
    model: "auto",
    version: "auto",
    description: "Real-ESRGAN - general-purpose image restoration AI for upscaling images with natural textures"
  },
  REAL_ESRGAN_VIDEO: {
    model: "unsupported",
    version: "unsupported",
    description: "Real-ESRGAN Video - video upscaling not supported"
  },
  KLING_V1_6_STANDARD: {
    model: "kling-30",
    version: "kling-30",
    description: "Kling - AI video generation with image-to-video capabilities"
  },
  LUMA_RAY_2_720P: {
    model: "runway-gen45",
    version: "runway-gen45",
    description: "Ray 2 - Luma's high-fidelity 720p video generation model"
  },
  HUNYUAN_VIDEO: {
    model: "wan-2-6",
    version: "wan-2-6",
    description: "Hunyuan Video - Tencent's video generation model"
  },
  WAN_2_1_1_3B: {
    model: "wan-2-6",
    version: "wan-2-6",
    description: "Wan 2.1 - High-quality video generation model"
  },
  GOOGLE_VEO_2: {
    model: "google-veo3",
    version: "google-veo3",
    description: "Veo 2 - Google's advanced video generation model"
  },
  MINIMAX_VIDEO_01: {
    model: "minimax-video-02",
    version: "minimax-video-02",
    description: "Video-01 - Minimax's text-to-video generation model"
  }
};

interface XenoPrediction {
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

interface XenoImageSettings {
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  seed?: number;
  [key: string]: any;
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;
const GPT_HIGH_MODEL = 'gpt-high';

function parsePositiveInt(value: any, fallback = 1024): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeModelDimensions(model: string, width: number, height: number) {
  if (model !== GPT_HIGH_MODEL) {
    return { width, height };
  }

  // gpt-high only accepts fixed image sizes. Map any requested aspect ratio to
  // the closest supported preset to avoid upstream 500 errors.
  const ratio = width / height;
  if (ratio > 1.2) {
    return { width: 1536, height: 1024 };
  }
  if (ratio < 0.83) {
    return { width: 1024, height: 1536 };
  }
  return { width: 1024, height: 1024 };
}

function toDataUrl(maybeBase64?: string): string | null {
  if (!maybeBase64 || typeof maybeBase64 !== 'string') return null;
  if (maybeBase64.startsWith('data:image/')) return maybeBase64;
  return `data:image/png;base64,${maybeBase64}`;
}

export async function generateImage(
  modelConfig: { model: string; version: string; description: string },
  prompt: string,
  settings: XenoImageSettings
): Promise<ImageGenerationResponse> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  try {
    const startTime = Date.now();

    const requestedWidth = parsePositiveInt(settings.width, 1024);
    const requestedHeight = parsePositiveInt(settings.height, 1024);
    const { width, height } = normalizeModelDimensions(
      modelConfig.model,
      requestedWidth,
      requestedHeight
    );
    const seed = settings.seed === -1 ? undefined : settings.seed;

    const response = await postXenoRequest('/images/generate', {
      model: modelConfig.model,
      prompt: prompt,
      width: width,
      height: height,
      seed: seed,
    });

    const firstImage = response?.data?.[0];
    const imageUrl =
      firstImage?.url ||
      firstImage?.image_url ||
      firstImage?.image?.url ||
      toDataUrl(firstImage?.b64_json) ||
      toDataUrl(firstImage?.base64);

    if (!imageUrl) {
      throw new Error('No image data returned from Xeno API');
    }

    const generationTime = (Date.now() - startTime) / 1000;

    return {
      imageUrl: imageUrl,
      metadata: {
        id: `xeno-${Date.now()}`,
        generationTime: generationTime,
        modelVersion: `${modelConfig.description} (Xeno AI)`,
        steps: settings.num_inference_steps,
        guidance: settings.guidance_scale,
        seed: seed,
        width,
        height,
        requestedWidth,
        requestedHeight,
        prompt: prompt,
        negativePrompt: settings.negative_prompt
      }
    };
  } catch (error: any) {
    if (error.message?.includes('rate limit')) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return generateImage(modelConfig, prompt, settings);
    }

    throw error;
  }
}

export function getXenoSettings(internalSettings: any, modelId?: string): XenoImageSettings {
  const rawWidth = parsePositiveInt(
    internalSettings.resolution?.split('x')?.[0] || internalSettings.width,
    1024
  );
  const rawHeight = parsePositiveInt(
    internalSettings.resolution?.split('x')?.[1] || internalSettings.height,
    1024
  );
  const { width, height } = normalizeModelDimensions(modelId || 'auto', rawWidth, rawHeight);

  return {
    negative_prompt: internalSettings.negativePrompt || "",
    width,
    height,
    num_inference_steps: internalSettings.steps || 30,
    guidance_scale: internalSettings.guidance || 7.5,
    seed: internalSettings.seed === -1 ? undefined : internalSettings.seed
  };
}
