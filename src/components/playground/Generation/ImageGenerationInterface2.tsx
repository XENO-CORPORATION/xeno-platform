import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import imageGenerationService from '../../../services/imageGenerationService';
import { ImageModelSettings } from '../../nodes/image-models/ImageModelInterface';
import * as replicateService from '../../../services/replicateService';
import { useGenerationHistory } from './hooks/useGenerationHistory';
import GenerationHistory from './components/GenerationHistory';
import { generationHistoryService } from '../../../services/generationHistoryService';

interface AspectRatio {
  value: string;
  label: string;
  icon: string;
}

interface Resolution {
  value: string;
  label: string;
  time: string;
}

interface UploadedImage {
  id: string;
  url: string;
  refTypes: ('style' | 'character' | 'image')[];
}

const aspectRatios: AspectRatio[] = [
  { value: '1:1', label: 'Square', icon: '□' },
  { value: '16:9', label: 'Widescreen', icon: '▭' },
  { value: '9:16', label: 'Social story', icon: '▯' },
  { value: '2:3', label: 'Portrait', icon: '▯' },
  { value: '3:4', label: 'Traditional', icon: '▯' },
  { value: '1:2', label: 'Vertical', icon: '▯' },
  { value: '2:1', label: 'Horizontal', icon: '▭' },
  { value: '4:5', label: 'Social post', icon: '▯' },
  { value: '3:2', label: 'Standard', icon: '▭' },
  { value: '4:3', label: 'Classic', icon: '▭' },
  { value: '21:9', label: 'Ultrawide', icon: '▬' },
];

const resolutions: Resolution[] = [
  { value: '1k', label: '1K', time: '~27s' },
  { value: '2k', label: '2K', time: '~55s' },
  { value: '4k', label: '4K', time: '~1m 23s' },
];

interface ModelDetails {
  name: string;
  type: 'image' | 'video';
  cost: string;
  speed: string;
  quality: string;
  description: string;
}

const aiCompanies = [
  {
    name: 'OpenAI',
    models: [
      {
        name: 'DALL-E 3',
        type: 'image' as const,
        cost: '$0.040 - $0.120 per image',
        speed: '~10-30 seconds',
        quality: 'High quality, photorealistic',
        description: 'Advanced image generation with improved prompt following and detail'
      },
      {
        name: 'DALL-E 2',
        type: 'image' as const,
        cost: '$0.016 - $0.020 per image',
        speed: '~5-15 seconds',
        quality: 'Good quality',
        description: 'Original DALL-E with fast generation times'
      },
      {
        name: 'GPT 1.5',
        type: 'image' as const,
        cost: '$0.025 - $0.080 per image',
        speed: '~8-20 seconds',
        quality: 'High quality',
        description: 'Next-generation image synthesis with enhanced detail'
      },
      {
        name: 'GPT 1.5 - High',
        type: 'image' as const,
        cost: '$0.050 - $0.150 per image',
        speed: '~15-35 seconds',
        quality: 'Premium quality',
        description: 'High-fidelity variant with superior rendering and composition'
      },
      {
        name: 'GPT 1 - HQ',
        type: 'image' as const,
        cost: '$0.030 - $0.100 per image',
        speed: '~10-25 seconds',
        quality: 'High quality',
        description: 'Original high-quality image generation model'
      },
      {
        name: 'GPT',
        type: 'image' as const,
        cost: '$0.015 - $0.050 per image',
        speed: '~5-12 seconds',
        quality: 'Standard quality',
        description: 'Fast and efficient image generation for rapid prototyping'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
      </svg>
    )
  },
  {
    name: 'ByteDance',
    models: [
      {
        name: 'Seedream 4.5',
        type: 'image' as const,
        cost: '$0.020 - $0.070 per image',
        speed: '~6-18 seconds',
        quality: 'High quality, Asian aesthetics',
        description: 'Latest model with enhanced cultural understanding and detail precision'
      },
      {
        name: 'Seedream 4',
        type: 'image' as const,
        cost: '$0.015 - $0.050 per image',
        speed: '~5-15 seconds',
        quality: 'Good quality',
        description: 'Fast image generation with strong prompt adherence'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    )
  },
  {
    name: 'Black Forest',
    models: [
      {
        name: 'Flux 2 Max',
        type: 'image' as const,
        cost: '$0.060 - $0.180 per image',
        speed: '~20-45 seconds',
        quality: 'Premium quality, ultra-detailed',
        description: 'Maximum quality variant with exceptional detail and composition'
      },
      {
        name: 'Flux 2 Pro',
        type: 'image' as const,
        cost: '$0.040 - $0.130 per image',
        speed: '~12-35 seconds',
        quality: 'Professional quality',
        description: 'Professional-grade image generation with balanced speed and quality'
      },
      {
        name: 'Flux 2 Flex',
        type: 'image' as const,
        cost: '$0.020 - $0.080 per image',
        speed: '~6-20 seconds',
        quality: 'Versatile quality',
        description: 'Flexible model for rapid iteration and experimentation'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4zm0 2.18l6 3v4.82c0 4.52-2.98 8.69-6 9.88-3.02-1.19-6-5.36-6-9.88V7.18l6-3z"/>
      </svg>
    )
  },
  {
    name: 'Google',
    models: [
      {
        name: 'Imagen 4 Ultra',
        type: 'image' as const,
        cost: '$0.080 - $0.200 per image',
        speed: '~25-60 seconds',
        quality: 'Ultra-premium quality',
        description: 'Flagship model with state-of-the-art photorealism and detail'
      },
      {
        name: 'Imagen 4',
        type: 'image' as const,
        cost: '$0.050 - $0.150 per image',
        speed: '~15-40 seconds',
        quality: 'Premium quality',
        description: 'Latest generation with improved realism and prompt understanding'
      },
      {
        name: 'Imagen 4 Fast',
        type: 'image' as const,
        cost: '$0.030 - $0.100 per image',
        speed: '~8-20 seconds',
        quality: 'High quality',
        description: 'Optimized for speed while maintaining excellent quality'
      },
      {
        name: 'Imagen 3',
        type: 'image' as const,
        cost: '$0.025 - $0.080 per image',
        speed: '~10-25 seconds',
        quality: 'High quality',
        description: 'Previous generation with reliable performance'
      },
      {
        name: 'Nano Banana Pro',
        type: 'image' as const,
        cost: '$0.015 - $0.050 per image',
        speed: '~5-12 seconds',
        quality: 'Good quality, efficient',
        description: 'Compact model with optimized performance for rapid generation'
      },
      {
        name: 'Nano Banana',
        type: 'image' as const,
        cost: '$0.008 - $0.030 per image',
        speed: '~3-8 seconds',
        quality: 'Standard quality',
        description: 'Ultra-fast model for quick iterations and prototyping'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
      </svg>
    )
  },
  {
    name: 'Alibaba',
    models: [
      {
        name: 'Z-Image',
        type: 'image' as const,
        cost: '$0.012 - $0.045 per image',
        speed: '~4-10 seconds',
        quality: 'Good quality, efficient',
        description: 'Fast and cost-effective image generation with strong Asian context understanding'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M4 4h16v2H4V4zm0 14h16v2H4v-2zm9.5-8.5l5.196 3-5.196 3v-6zm-2 0v6l-5.196-3 5.196-3z"/>
      </svg>
    )
  },
  {
    name: 'Stability AI',
    models: [
      {
        name: 'SDXL 1.0',
        type: 'image' as const,
        cost: '$0.003 - $0.010 per image',
        speed: '~3-8 seconds',
        quality: 'Very high quality, versatile',
        description: 'Latest Stable Diffusion XL with enhanced realism and composition'
      },
      {
        name: 'SD 3.0',
        type: 'image' as const,
        cost: '$0.002 - $0.008 per image',
        speed: '~2-5 seconds',
        quality: 'High quality',
        description: 'Fast and efficient image generation with great detail'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.82 8 12 11.82 4.18 8 12 4.18zM4 9.47l7 3.5v7.85l-7-3.5V9.47zm16 0v7.85l-7 3.5v-7.85l7-3.5z"/>
      </svg>
    )
  },
  {
    name: 'Midjourney',
    models: [
      {
        name: 'v6.1',
        type: 'image' as const,
        cost: '$0.05 - $0.15 per image',
        speed: '~30-90 seconds',
        quality: 'Exceptional artistic quality',
        description: 'Latest version with improved coherence and prompt understanding'
      },
      {
        name: 'v6.0',
        type: 'image' as const,
        cost: '$0.04 - $0.12 per image',
        speed: '~25-80 seconds',
        quality: 'Artistic, stylized',
        description: 'Previous flagship with great artistic rendering'
      },
      {
        name: 'Niji 6',
        type: 'image' as const,
        cost: '$0.04 - $0.12 per image',
        speed: '~25-80 seconds',
        quality: 'Anime style specialist',
        description: 'Specialized model for anime and manga-style artwork'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    name: 'Runway',
    models: [
      {
        name: 'Gen-3 Alpha',
        type: 'video' as const,
        cost: '$0.50 - $2.00 per 5s video',
        speed: '~60-180 seconds',
        quality: 'High quality video',
        description: 'Latest video generation model with improved temporal consistency'
      },
      {
        name: 'Gen-2',
        type: 'video' as const,
        cost: '$0.30 - $1.50 per 4s video',
        speed: '~45-120 seconds',
        quality: 'Good video quality',
        description: 'Text and image to video generation with smooth motion'
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 18.5L4 16.18V8.82L12 4.5l8 4.32v7.36L12 20.5z"/>
      </svg>
    )
  },
  {
    name: 'Image-to-Image',
    models: [
      {
        name: 'Flux Dev Img2Img',
        type: 'image' as const,
        cost: '$0.030 per megapixel',
        speed: '~8-25 seconds',
        quality: 'High quality transformation',
        description: 'Transform images with text prompts using Flux Dev. Requires an input image.',
        isImageToImage: true
      },
      {
        name: 'SD V3 Medium Img2Img',
        type: 'image' as const,
        cost: '$0.020 - $0.060 per image',
        speed: '~6-18 seconds',
        quality: 'High quality transformation',
        description: 'Stable Diffusion V3 image transformation. Requires an input image.',
        isImageToImage: true
      },
      {
        name: 'Recraft V3 Img2Img',
        type: 'image' as const,
        cost: '$0.025 - $0.080 per image',
        speed: '~8-20 seconds',
        quality: 'Premium transformation',
        description: 'Recraft V3 image editing and transformation. Requires an input image.',
        isImageToImage: true
      },
      {
        name: 'Ideogram V3',
        type: 'image' as const,
        cost: '$0.030 - $0.100 per image',
        speed: '~10-30 seconds',
        quality: 'High quality with style reference',
        description: 'Generate images with style references. Supports multiple reference images.',
        isImageToImage: true
      }
    ],
    logo: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7l-3 3.72L9 13l-3 4h12l-4-5z"/>
      </svg>
    )
  },
];

// Model capabilities interface
interface ModelCapabilities {
  maxCount: number; // Max images per generation
  supportedAspectRatios: string[]; // Empty array = supports all
  supportedResolutions: string[]; // Empty array = supports all
  maxResolution?: string; // Maximum supported resolution
}

// Map UI model names to provider and model ID
interface ModelMapping {
  provider: 'fal' | 'replicate';
  modelId: string;
  replicateConfig?: typeof replicateService.ReplicateModels[keyof typeof replicateService.ReplicateModels];
  capabilities: ModelCapabilities;
}

// Generated image with settings (kept for backwards compatibility)
interface GeneratedImage {
  url: string;
  settings: {
    model: string;
    count: number;
    aspectRatio: string;
    resolution: string;
    prompt: string;
  };
}

const modelNameToProvider: Record<string, ModelMapping> = {
  // Black Forest (Flux models) - Replicate
  'Flux 2 Max': {
    provider: 'replicate',
    modelId: 'black-forest-labs/flux-1.1-pro',
    replicateConfig: replicateService.ReplicateModels.FLUX_PRO,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },
  'Flux 2 Pro': {
    provider: 'replicate',
    modelId: 'black-forest-labs/flux-1.1-pro',
    replicateConfig: replicateService.ReplicateModels.FLUX_PRO,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },
  'Flux 2 Flex': {
    provider: 'replicate',
    modelId: 'black-forest-labs/flux-dev',
    replicateConfig: replicateService.ReplicateModels.FLUX_DEV,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },

  // Google (Imagen models) - Fal.ai
  'Imagen 4 Ultra': {
    provider: 'fal',
    modelId: 'fal-ai/imagen4/preview',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'Imagen 4': {
    provider: 'fal',
    modelId: 'fal-ai/imagen4/preview',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'Imagen 4 Fast': {
    provider: 'fal',
    modelId: 'fal-ai/imagen3',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'Imagen 3': {
    provider: 'fal',
    modelId: 'fal-ai/imagen3',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },

  // Stability AI - Fal.ai (primary) and Replicate (backup)
  'SDXL 1.0': {
    provider: 'replicate',
    modelId: 'stability-ai/sdxl',
    replicateConfig: replicateService.ReplicateModels.STABLE_DIFFUSION_XL,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'SD 3.0': {
    provider: 'fal',
    modelId: 'fal-ai/stable-diffusion-v3-medium',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },

  // ByteDance (Seedream models) - Fal.ai
  'Seedream 4.5': {
    provider: 'fal',
    modelId: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },
  'Seedream 4': {
    provider: 'fal',
    modelId: 'fal-ai/bytedance/seedream/v4/text-to-image',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },

  // Alibaba (Z-Image) - Fal.ai
  'Z-Image': {
    provider: 'fal',
    modelId: 'fal-ai/z-image/turbo',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },

  // ============================================
  // IMAGE-TO-IMAGE MODELS - Fal.ai
  // ============================================
  'Flux Dev Img2Img': {
    provider: 'fal',
    modelId: 'fal-ai/flux/dev/image-to-image',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Inherits from input image
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'SD V3 Medium Img2Img': {
    provider: 'fal',
    modelId: 'fal-ai/stable-diffusion-v3-medium/image-to-image',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Inherits from input image
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'Recraft V3 Img2Img': {
    provider: 'fal',
    modelId: 'fal-ai/recraft/v3/image-to-image',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Inherits from input image
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
  'Ideogram V3': {
    provider: 'fal',
    modelId: 'fal-ai/ideogram/v3',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },

  // OpenAI (DALL-E models) - Replicate (requires OpenAI API key)
  'DALL-E 3': {
    provider: 'replicate',
    modelId: 'openai/dall-e-3',
    replicateConfig: replicateService.ReplicateModels.DALLE_3,
    capabilities: {
      maxCount: 1, // DALL-E 3 generates 1 image at a time
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k', '2k'],
      maxResolution: '2k'
    }
  },
};

const ImageGenerationInterface2: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [count, setCount] = useState(1);
  const [aspectRatio, setAspectRatio] = useState('3:4');
  const [resolution, setResolution] = useState('4k');
  const [showAspectRatios, setShowAspectRatios] = useState(false);
  const [showResolutions, setShowResolutions] = useState(false);
  const [showAiCompanies, setShowAiCompanies] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [hoveredModel, setHoveredModel] = useState<ModelDetails | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [openMoreMenu, setOpenMoreMenu] = useState<string | null>(null);
  const [animatingStars, setAnimatingStars] = useState<Set<string>>(new Set());
  const [animatingFavButton, setAnimatingFavButton] = useState(false);
  const [animatingHistoryButton, setAnimatingHistoryButton] = useState(false);
  const [animatingSettingsButton, setAnimatingSettingsButton] = useState(false);
  // Image viewer modal state
  const [viewingImage, setViewingImage] = useState<{
    generationId: string;
    imageIndex: number;
  } | null>(null);
  // Store the settings used for the current generation (frozen at generation start)
  const [generatingSettings, setGeneratingSettings] = useState<{
    prompt: string;
    count: number;
    aspectRatio: string;
    resolution: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAnimatedRef = useRef(false);

  // History state - SINGLE SOURCE OF TRUTH (no local copy needed)
  // Initialize from URL params to persist view on refresh
  const [showHistory, setShowHistory] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'history' || params.get('view') === 'favorites';
  });
  const [isScrolled, setIsScrolled] = useState(false);

  // Track scroll position for header background
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const {
    generations,  // This IS the source of truth - renders directly from this
    isLoading: isHistoryLoading,
    hasMore,
    favoritesOnly,
    saveGeneration,
    deleteGeneration,
    toggleFavorite,
    loadMore,
    setFavoritesOnly,
  } = useGenerationHistory();

  // Update URL when view changes to persist state on refresh
  useEffect(() => {
    const url = new URL(window.location.href);
    if (showHistory) {
      if (favoritesOnly) {
        url.searchParams.set('view', 'favorites');
      } else {
        url.searchParams.set('view', 'history');
      }
    } else {
      url.searchParams.delete('view');
    }
    window.history.replaceState({}, '', url.toString());
  }, [showHistory, favoritesOnly]);

  // Keyboard and scroll navigation for image viewer modal
  useEffect(() => {
    if (!viewingImage) return;

    // Helper to get all images and current index
    const getNavigationData = () => {
      const allImages: { genId: string; imageIndex: number }[] = [];
      generations.forEach(gen => {
        gen.image_urls.forEach((_, idx) => {
          allImages.push({ genId: gen.id, imageIndex: idx });
        });
      });
      const currentIndex = allImages.findIndex(
        img => img.genId === viewingImage.generationId && img.imageIndex === viewingImage.imageIndex
      );
      return { allImages, currentIndex };
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewingImage(null);
        return;
      }

      const { allImages, currentIndex } = getNavigationData();

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentIndex > 0) {
          const prev = allImages[currentIndex - 1];
          setViewingImage({ generationId: prev.genId, imageIndex: prev.imageIndex });
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentIndex < allImages.length - 1) {
          const next = allImages[currentIndex + 1];
          setViewingImage({ generationId: next.genId, imageIndex: next.imageIndex });
        }
      }
    };

    // Scroll wheel navigation
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { allImages, currentIndex } = getNavigationData();

      if (e.deltaY > 0) {
        // Scroll down - next image
        if (currentIndex < allImages.length - 1) {
          const next = allImages[currentIndex + 1];
          setViewingImage({ generationId: next.genId, imageIndex: next.imageIndex });
        }
      } else if (e.deltaY < 0) {
        // Scroll up - previous image
        if (currentIndex > 0) {
          const prev = allImages[currentIndex - 1];
          setViewingImage({ generationId: prev.genId, imageIndex: prev.imageIndex });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [viewingImage, generations]);

  // Check if user is authenticated
  const isAuthenticated = generationHistoryService.isAuthenticated();

  // Get current model capabilities
  const currentModelCapabilities = selectedModel ? modelNameToProvider[selectedModel]?.capabilities : null;

  // Check if setting is supported
  const isAspectRatioSupported = (ratio: string): boolean => {
    if (!currentModelCapabilities) return true;
    if (currentModelCapabilities.supportedAspectRatios.length === 0) return true; // Supports all
    return currentModelCapabilities.supportedAspectRatios.includes(ratio);
  };

  const isResolutionSupported = (res: string): boolean => {
    if (!currentModelCapabilities) return true;
    if (currentModelCapabilities.supportedResolutions.length === 0) return true; // Supports all
    return currentModelCapabilities.supportedResolutions.includes(res);
  };

  const handleIncrement = () => {
    const maxCount = currentModelCapabilities?.maxCount || 10;
    if (count < maxCount) setCount(count + 1);
  };

  const handleDecrement = () => {
    if (count > 1) setCount(count - 1);
  };

  const handleImageClick = () => {
    if (uploadedImages.length < 10) {
      fileInputRef.current?.click();
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadedImages.length < 10) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const newImage: UploadedImage = {
          id: Date.now().toString(),
          url: e.target?.result as string,
          refTypes: ['image'],
        };
        setUploadedImages([...uploadedImages, newImage]);
      };
      reader.readAsDataURL(file);
    }
    // Reset input
    event.target.value = '';
  };

  const handleDeleteImage = (imageId: string) => {
    setUploadedImages(uploadedImages.filter(img => img.id !== imageId));
    if (activeImageId === imageId) {
      setActiveImageId(null);
    }
  };

  const handleImageRightClick = (e: React.MouseEvent, imageId: string) => {
    e.preventDefault();
    setActiveImageId(activeImageId === imageId ? null : imageId);
  };

  const handleSetRefType = (imageId: string, type: 'style' | 'character' | 'image') => {
    setUploadedImages(uploadedImages.map(img => {
      if (img.id !== imageId) return img;
      // Toggle: if type exists, remove it; if not, add it
      const hasType = img.refTypes.includes(type);
      const newRefTypes = hasType
        ? img.refTypes.filter(t => t !== type)
        : [...img.refTypes, type];
      return { ...img, refTypes: newRefTypes };
    }));
    // Don't close menu so user can select multiple types
  };

  // Rerun generation with same prompt and settings
  const handleRerun = async (gen: typeof generations[0]) => {
    // Set all the settings from the previous generation
    setPrompt(gen.prompt);
    setSelectedModel(gen.model);
    if (gen.aspect_ratio) setAspectRatio(gen.aspect_ratio);
    if (gen.resolution) setResolution(gen.resolution);
    if (gen.count) setCount(gen.count);

    // Use a small delay to allow state to update, then trigger generation
    setTimeout(async () => {
      // Manually trigger generation with the settings
      if (!gen.prompt.trim() || !gen.model) return;

      const modelMapping = modelNameToProvider[gen.model];
      if (!modelMapping) return;

      setGeneratingSettings({
        prompt: gen.prompt,
        count: gen.count || 1,
        aspectRatio: gen.aspect_ratio || '3:4',
        resolution: gen.resolution || '4k'
      });
      setPrompt('');
      setIsGenerating(true);
      setError(null);

      try {
        const currentAspectRatio = gen.aspect_ratio || '3:4';
        const currentResolution = gen.resolution || '4k';
        const currentCount = gen.count || 1;

        const [w, h] = currentAspectRatio.split(':').map(Number);
        const baseSize = currentResolution === '1k' ? 512 : currentResolution === '2k' ? 1024 : 2048;
        const totalRatio = w + h;
        const width = Math.round((w / totalRatio) * baseSize * 2);
        const height = Math.round((h / totalRatio) * baseSize * 2);

        let imageUrls: string[] = [];

        if (modelMapping.provider === 'fal') {
          let image_size = 'square_hd';
          if (currentAspectRatio === '1:1') image_size = currentResolution === '1k' ? 'square' : 'square_hd';
          else if (currentAspectRatio === '16:9') image_size = 'landscape_16_9';
          else if (currentAspectRatio === '9:16') image_size = 'portrait_16_9';
          else if (currentAspectRatio === '4:3') image_size = 'landscape_4_3';
          else if (currentAspectRatio === '3:4') image_size = 'portrait_4_3';

          const response = await imageGenerationService.generateImage(modelMapping.modelId, {
            prompt: gen.prompt,
            width,
            height,
            num_outputs: currentCount,
            aspect_ratio: currentAspectRatio,
            image_size,
          }, () => {});

          if (response.success && response.images) {
            imageUrls = response.images.map(img => img.url);
          }
        } else if (modelMapping.provider === 'replicate' && modelMapping.replicateConfig) {
          const replicateSettings = replicateService.getReplicateSettings({
            prompt: gen.prompt,
            resolution: `${width}x${height}`,
            width,
            height,
            aspect_ratio: currentAspectRatio,
            seed: -1,
            num_inference_steps: 30,
            guidance_scale: 7.5,
          }, modelMapping.modelId);

          for (let i = 0; i < currentCount; i++) {
            const response = await replicateService.generateImage(modelMapping.replicateConfig, gen.prompt, replicateSettings);
            if (response.imageUrl) imageUrls.push(response.imageUrl);
          }
        }

        if (imageUrls.length > 0 && isAuthenticated) {
          // Collect reference images used for this generation (flatten multiple types per image)
          const refImages = uploadedImages
            .filter(img => img.refTypes.length > 0)
            .flatMap(img => img.refTypes.map(type => ({ url: img.url, refType: type })));

          await saveGeneration({
            prompt: gen.prompt,
            image_urls: imageUrls,
            model: gen.model,
            aspect_ratio: currentAspectRatio,
            resolution: currentResolution,
            count: currentCount,
            provider: modelMapping.provider,
            reference_images: refImages.length > 0 ? refImages : undefined,
          });
        }
      } catch (err: any) {
        setError(err.message || 'An error occurred during generation');
      } finally {
        setIsGenerating(false);
        setGeneratingSettings(null);
      }
    }, 50);
  };

  // Copy prompt to input for editing
  const handleUsePrompt = (promptText: string) => {
    setPrompt(promptText);
  };

  // Delete a generation
  const handleDeleteGeneration = async (genId: string) => {
    if (confirm('Are you sure you want to delete this generation?')) {
      await deleteGeneration(genId);
      setOpenMoreMenu(null);
    }
  };

  // Download all images from a generation
  // 1-2 images: individual downloads, 3+ images: ZIP file
  const handleDownloadImages = async (gen: typeof generations[0]) => {
    const imageCount = gen.image_urls?.length || 0;

    if (imageCount === 0) {
      alert('No images to download');
      setOpenMoreMenu(null);
      return;
    }

    try {
      // Fetch all images first
      const blobs: { blob: Blob; index: number }[] = [];

      for (let i = 0; i < imageCount; i++) {
        const imageUrl = gen.image_urls[i];
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        blobs.push({ blob, index: i });
      }

      // For 3+ images, create a ZIP file
      if (imageCount >= 3) {
        const zip = new JSZip();
        const folderName = `generation-${gen.id.slice(0, 8)}`;
        const folder = zip.folder(folderName);

        for (const { blob, index } of blobs) {
          folder?.file(`image-${index + 1}.png`, blob);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const blobUrl = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${folderName}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      } else {
        // For 1-2 images, download individually
        for (let i = 0; i < blobs.length; i++) {
          const { blob, index } = blobs[i];
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `generation-${gen.id.slice(0, 8)}-${index + 1}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);

          // Delay between downloads to prevent browser blocking
          if (i < blobs.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
      }
    } catch (error) {
      console.error('Failed to download images:', error);
      alert('Failed to download images. Please try again.');
    }
    setOpenMoreMenu(null);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    if (!selectedModel) {
      setError('Please select a model');
      return;
    }

    // Get the model mapping
    const modelMapping = modelNameToProvider[selectedModel];
    if (!modelMapping) {
      setError(`Model "${selectedModel}" is not yet supported. Please select a different model.`);
      return;
    }

    // Store the current prompt for this generation
    const currentPrompt = prompt.trim();

    // Store the current settings for this generation (freeze them including prompt)
    setGeneratingSettings({
      prompt: currentPrompt,
      count,
      aspectRatio,
      resolution
    });

    // Clear the input box immediately after generation starts
    setPrompt('');

    setIsGenerating(true);
    setError(null);
    // Don't clear previous images - we want to keep history

    try {
      // Parse aspect ratio to get width and height based on resolution
      const [w, h] = aspectRatio.split(':').map(Number);
      const baseSize = resolution === '1k' ? 512 : resolution === '2k' ? 1024 : 2048;
      const totalRatio = w + h;
      const width = Math.round((w / totalRatio) * baseSize * 2);
      const height = Math.round((h / totalRatio) * baseSize * 2);

      console.log('Generating with settings:', {
        provider: modelMapping.provider,
        model: selectedModel,
        aspectRatio,
        resolution,
        dimensions: `${width}x${height}`,
        count
      });

      let imageUrls: string[] = [];

      /* MOCK DATA - Disabled to use real API
      console.log('Using mock data for testing...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API delay

      // Generate mock images based on count and aspect ratio
      const mockImages = [
        'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba',
        'https://images.unsplash.com/photo-1682687221038-404cb8830901',
        'https://images.unsplash.com/photo-1682687220063-4742bd7fd538',
        'https://images.unsplash.com/photo-1682687220208-22d7a2543e88',
        'https://images.unsplash.com/photo-1682687220199-d0124f48f95b',
        'https://images.unsplash.com/photo-1682687221080-5cb261c645cb',
        'https://images.unsplash.com/photo-1682687220946-b57c3a620f18',
        'https://images.unsplash.com/photo-1682687221175-99e3d37d9249',
        'https://images.unsplash.com/photo-1682687220067-dced9a881b56',
        'https://images.unsplash.com/photo-1682687220198-88e9bdfc730d',
      ];

      for (let i = 0; i < count; i++) {
        imageUrls.push(mockImages[i % mockImages.length]);
      }

      setGeneratedImages(imageUrls);
      setIsGenerating(false);
      return;
      END MOCK DATA */

      // Separate uploaded images by reference type (used by both FAL and Replicate)
      const styleRefImage = uploadedImages.find(img => img.refTypes.includes('style'));
      const charRefImage = uploadedImages.find(img => img.refTypes.includes('character'));
      const imgRefImages = uploadedImages.filter(img => img.refTypes.includes('image') || img.refTypes.length === 0);

      if (modelMapping.provider === 'fal') {
        // Use fal.ai - supports batch generation

        // Map aspect ratio to fal.ai image_size parameter
        let image_size = 'square_hd'; // default
        if (aspectRatio === '1:1') {
          image_size = resolution === '1k' ? 'square' : 'square_hd';
        } else if (aspectRatio === '16:9') {
          image_size = 'landscape_16_9';
        } else if (aspectRatio === '9:16') {
          image_size = 'portrait_16_9';
        } else if (aspectRatio === '4:3') {
          image_size = 'landscape_4_3';
        } else if (aspectRatio === '3:4') {
          image_size = 'portrait_4_3';
        } else if (aspectRatio === '21:9') {
          image_size = 'landscape_16_9'; // Use 16:9 as fallback for ultra-wide
        }

        const settings: ImageModelSettings = {
          prompt: currentPrompt,
          width,
          height,
          num_outputs: count,
          aspect_ratio: aspectRatio,
          image_size: image_size,
          // Style reference (for models that support it or Vision-to-Prompt fallback)
          ...(styleRefImage && {
            style_reference_url: styleRefImage.url,
            style_reference_weight: 0.85,
          }),
          // Character reference (for models that support it or Vision-to-Prompt fallback)
          ...(charRefImage && {
            character_reference_url: charRefImage.url,
            character_reference_weight: 1.0,
          }),
          // Image-to-image reference (for img2img models)
          ...(imgRefImages.length > 0 && {
            image_url: imgRefImages[0].url,
            image_urls: imgRefImages.map(img => img.url),
          }),
        };

        const response = await imageGenerationService.generateImage(
          modelMapping.modelId,
          settings,
          (update) => {
            console.log('Fal.ai queue update:', update);
          }
        );

        if (response.success && response.images) {
          imageUrls = response.images.map(img => img.url);
        } else {
          throw new Error(response.error || 'Failed to generate image');
        }
      } else if (modelMapping.provider === 'replicate') {
        // Use Replicate - generate multiple images sequentially
        if (!modelMapping.replicateConfig) {
          throw new Error('Replicate model configuration missing');
        }

        // Build settings object for Replicate (reuse styleRefImage/charRefImage from above)
        const replicateSettings = replicateService.getReplicateSettings({
          prompt: currentPrompt,
          resolution: `${width}x${height}`,
          width,
          height,
          aspect_ratio: aspectRatio,
          seed: -1, // Random seed
          num_inference_steps: 30, // Default quality steps
          guidance_scale: 7.5, // Default guidance
          // Pass style/character references for Luma Photon
          ...(styleRefImage && {
            styleReferenceUrl: styleRefImage.url,
            styleReferenceWeight: 0.85,
          }),
          ...(charRefImage && {
            characterReferenceUrl: charRefImage.url,
          }),
          // Pass image reference for image-to-image
          ...(imgRefImages.length > 0 && {
            imageReferenceUrl: imgRefImages[0].url,
            imageReferenceWeight: 0.85,
          }),
        }, modelMapping.modelId);

        console.log('Replicate settings:', replicateSettings);

        // Generate images one by one (Replicate API returns one image per call)
        for (let i = 0; i < count; i++) {
          console.log(`Generating image ${i + 1}/${count}...`);

          const response = await replicateService.generateImage(
            modelMapping.replicateConfig,
            currentPrompt,
            replicateSettings
          );

          if (response.imageUrl) {
            imageUrls.push(response.imageUrl);
            console.log(`Image ${i + 1} generated:`, response.imageUrl);
          }
        }
      }

      if (imageUrls.length > 0) {
        console.log(`Successfully generated ${imageUrls.length} images`);

        // Save to history - this updates the generations array (single source of truth)
        // The hook's saveGeneration automatically prepends to the generations array
        if (isAuthenticated) {
          // Collect reference images used for this generation (flatten multiple types per image)
          const refImages = uploadedImages
            .filter(img => img.refTypes.length > 0)
            .flatMap(img => img.refTypes.map(type => ({ url: img.url, refType: type })));

          await saveGeneration({
            prompt: currentPrompt,
            image_urls: imageUrls,
            model: selectedModel,
            aspect_ratio: aspectRatio,
            resolution,
            count,
            provider: modelMapping.provider,
            reference_images: refImages.length > 0 ? refImages : undefined,
          });
        }
      } else {
        throw new Error('No images were generated');
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      setError(err.message || 'An error occurred during generation');
    } finally {
      setIsGenerating(false);
      setGeneratingSettings(null); // Clear the frozen settings
    }
  };

  const selectedAspectRatio = aspectRatios.find(ar => ar.value === aspectRatio);
  const selectedResolution = resolutions.find(res => res.value === resolution);

  return (
    <div className="h-full w-full flex flex-col py-3 overflow-y-auto relative">
      {/* Parent Container - Wraps both Generation Header and Image History - Responsive width, centered */}
      <div className="w-[100%] sm:w-[99%] md:w-[98%] lg:w-[97%] xl:w-[95%] 2xl:w-[90%] mx-auto relative flex flex-col flex-1">

        {/* Generation Header Container - Sticky */}
        <div className={`generation-header flex flex-col items-center gap-3 sticky top-0 z-50 transition-colors duration-200 ${isScrolled ? 'bg-[#0a0a0b]' : 'bg-transparent'}`} style={{ width: '100%' }}>
        <div className="w-full flex items-start justify-center gap-3 relative">
          {/* Tool Container */}
          <div className="w-60 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center pl-1 pr-4 shadow-lg shadow-black/40 relative bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            <button
              onClick={() => {
                setShowAiCompanies(!showAiCompanies);
                setSelectedCompany(null);
                setShowSettings(false);
                setActiveImageId(null);
              }}
              className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
            >
              <svg className="w-6 h-6 text-white/40" viewBox="0 0 24 24" fill="currentColor">
                {/* Wand body - centered with equal padding */}
                <rect x="2" y="12.8" width="10" height="2.4" rx="1.2" transform="rotate(-45 7 14)" />
                {/* Wand tip - white with dark outline */}
                <rect x="11.5" y="12.8" width="3.5" height="2.4" rx="1.2" transform="rotate(-45 7 14)" fill="white" stroke="currentColor" strokeWidth="0.5" />
                {/* Large star - top right */}
                <path d="M17.5 5.5 Q18.2 7.7 20.5 8.5 Q18.2 9.3 17.5 11.5 Q16.8 9.3 14.5 8.5 Q16.8 7.7 17.5 5.5 Z" />
                {/* Medium star - right side */}
                <path d="M20.5 12.5 Q21 14 22.5 14.5 Q21 15 20.5 16.5 Q20 15 18.5 14.5 Q20 14 20.5 12.5 Z" />
                {/* Small star - between them */}
                <path d="M15 12 Q15.4 13 16.5 13.4 Q15.4 13.8 15 14.8 Q14.6 13.8 13.5 13.4 Q14.6 13 15 12 Z" />
              </svg>
            </button>
            <div className="w-px h-6 bg-white/10 ml-1 mr-3"></div>
            {selectedModel ? (
              <span className="text-white/60 text-sm font-medium truncate">{selectedModel}</span>
            ) : prompt.trim().length > 0 ? (
              <span className="text-red-400 text-sm font-medium animate-pulse">Select model</span>
            ) : (
              <span className="text-white/40 text-sm font-medium">No model selected</span>
            )}
          </div>

          {/* Input Container */}
          <div className="flex-1 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-between relative shadow-lg shadow-black/40 bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            <div className="flex items-center flex-1">
              <button
                onClick={handleImageClick}
                className="p-2 ml-1 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg className="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <div className="w-px h-6 bg-white/10 ml-1 mr-3"></div>

              {/* Text Input */}
              {(() => {
                const charLimit = resolution === '4k' ? 800 : resolution === '2k' ? 650 : 500;
                const warningThreshold = charLimit - 50;
                return (
                  <>
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value.slice(0, charLimit))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isGenerating && prompt.trim() && selectedModel) {
                          handleGenerate();
                        }
                      }}
                      maxLength={charLimit}
                      placeholder="Describe what you want to generate..."
                      className="flex-1 bg-transparent text-white/90 text-sm placeholder:text-white/30 outline-none focus:outline-none focus:ring-0 border-0 px-1"
                    />
                    {/* Character Counter */}
                    <span className={`text-xs mr-2 ${prompt.length >= warningThreshold ? 'text-red-400' : 'text-white/30'}`}>
                      {prompt.length}/{charLimit}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Settings Button Container */}
          <div className="h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center px-2 shadow-lg shadow-black/40 relative bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            <button
              onClick={() => {
                // Trigger animation
                setAnimatingSettingsButton(true);
                setTimeout(() => setAnimatingSettingsButton(false), 500);
                setShowSettings(!showSettings);
                setShowAiCompanies(false);
                setSelectedCompany(null);
              }}
              className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
            >
              <svg
                className={`w-6 h-6 ${showSettings ? 'text-white' : 'text-white/40'} ${animatingSettingsButton ? 'animate-gear-spin' : ''}`}
                style={{ transformOrigin: 'center' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* History & Favorites Button Container */}
          <div className="h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center px-2 gap-1 shadow-lg shadow-black/40 relative bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            {/* History Button */}
            <button
              onClick={() => {
                // Trigger animation
                setAnimatingHistoryButton(true);
                setTimeout(() => setAnimatingHistoryButton(false), 500);
                if (favoritesOnly) {
                  // Switching from favorites to history - keep history open
                  setFavoritesOnly(false);
                  setShowHistory(true);
                } else {
                  // Toggle history view
                  setShowHistory(!showHistory);
                }
                setShowSettings(false);
                setShowAiCompanies(false);
                setSelectedCompany(null);
              }}
              className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              title={isAuthenticated ? 'View generation history' : 'Sign in to view history'}
            >
              <svg
                className={`w-6 h-6 ${showHistory && !favoritesOnly ? 'text-white' : 'text-white/40'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {/* Clock face */}
                <circle cx="12" cy="12" r="9" strokeWidth={2} fill={showHistory && !favoritesOnly ? 'currentColor' : 'none'} fillOpacity="0.2" />
                {/* Clock hands - animated */}
                <g
                  className={animatingHistoryButton ? 'animate-clock-tick' : ''}
                  style={{ transformOrigin: '12px 12px' }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 4" />
                </g>
              </svg>
            </button>
            {/* Favorites Button */}
            <button
              onClick={() => {
                // Trigger animation
                setAnimatingFavButton(true);
                setTimeout(() => setAnimatingFavButton(false), 700);
                const newFavoritesOnly = !favoritesOnly;
                setFavoritesOnly(newFavoritesOnly);
                // Only show history when enabling favorites, hide when disabling
                setShowHistory(newFavoritesOnly);
                setShowSettings(false);
                setShowAiCompanies(false);
                setSelectedCompany(null);
              }}
              className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              title={isAuthenticated ? 'View favorites' : 'Sign in to view favorites'}
            >
              <svg className={`w-[27px] h-[27px] mt-0.5 ${favoritesOnly ? 'text-white' : 'text-white/40'}`} viewBox="0 0 50 50">
                  {/* Expanding ring */}
                  <circle
                    cx="25" cy="25" r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="16"
                    className={animatingFavButton ? 'animate-star-ring' : 'opacity-0'}
                    style={{ transformOrigin: 'center' }}
                  />
                  {/* Burst lines */}
                  <g stroke="currentColor" strokeWidth="6" strokeLinecap="round" style={{ transformOrigin: 'center' }}>
                    <line x1="25" y1="8" x2="25" y2="2" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="25" y1="42" x2="25" y2="48" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="8" y1="25" x2="2" y2="25" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="42" y1="25" x2="48" y2="25" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="13" y1="13" x2="7" y2="7" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="37" y1="37" x2="43" y2="43" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="37" y1="13" x2="43" y2="7" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                    <line x1="13" y1="37" x2="7" y2="43" className={animatingFavButton ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                  </g>
                  {/* Star outline (shrinks away) */}
                  <path
                    className={animatingFavButton ? 'animate-star-stroke' : ''}
                    style={{ transformOrigin: 'center' }}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                  />
                  {/* Star fill (bounces in) */}
                  <path
                    className={animatingFavButton ? 'animate-star-fill' : ''}
                    style={{ transformOrigin: 'center', transform: favoritesOnly && !animatingFavButton ? 'scale(1)' : 'scale(0)' }}
                    fill="currentColor"
                    d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                  />
                </svg>
            </button>
          </div>

          {/* AI Companies Floating Buttons - Positioned at left below Tool Container */}
          {showAiCompanies && (
            <div className="absolute left-0 top-full mt-2 flex flex-col items-start gap-2 p-2 z-[100]">
              {aiCompanies.map((company, index) => (
                  <div key={company.name} className="relative" style={{ animation: `fadeInDown 0.2s ease-out ${index * 50}ms both` }}>
                    {/* Company Button - Icon only */}
                    <button
                      onClick={() => {
                        setSelectedCompany(selectedCompany === company.name ? null : company.name);
                        setShowSettings(false);
                      }}
                      className={`h-9 w-9 bg-[#1a1a1c] backdrop-blur-md border rounded-lg flex items-center justify-center text-white/80 hover:bg-[#2a2a2d] transition-all shadow-lg ${
                        selectedCompany === company.name ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                      } ${
                        selectedCompany && selectedCompany !== company.name ? 'opacity-50' : 'opacity-100'
                      }`}
                      style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
                      title={company.name}
                    >
                      <span className="w-5 h-5 flex items-center justify-center">{company.logo}</span>
                    </button>

                    {/* Models Dropdown - appears to the right of the company button */}
                    {selectedCompany === company.name && (
                      <div className="absolute left-full ml-2 top-0 flex flex-col gap-1.5 z-[110]">
                        {company.models.map((model, modelIndex) => (
                          <div
                            key={model.name}
                            className="relative"
                            onMouseEnter={() => setHoveredModel(model)}
                            onMouseLeave={() => setHoveredModel(null)}
                          >
                            {/* Model Details Panel - shows on hover to the right */}
                            {hoveredModel && hoveredModel.name === model.name && (
                              <div className="absolute left-full ml-2 top-0 w-56 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg p-3 shadow-xl z-[120]"
                                style={{
                                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 25px rgba(0, 0, 0, 0.4)'
                                }}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <h3 className="text-white font-semibold text-xs">{hoveredModel.name}</h3>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                                    hoveredModel.type === 'video' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                                  }`}>
                                    {hoveredModel.type}
                                  </span>
                                </div>
                                <p className="text-white/60 text-[11px] mb-2 leading-tight">{hoveredModel.description}</p>
                                <div className="space-y-1.5">
                                  <div className="flex justify-between items-center">
                                    <span className="text-white/50 text-[10px]">Cost</span>
                                    <span className="text-white/80 text-[10px] font-medium">{hoveredModel.cost}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-white/50 text-[10px]">Speed</span>
                                    <span className="text-white/80 text-[10px] font-medium">{hoveredModel.speed}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-white/50 text-[10px]">Quality</span>
                                    <span className="text-white/80 text-[10px] font-medium">{hoveredModel.quality}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            <button
                              onClick={() => {
                                setSelectedModel(model.name);
                                setShowAiCompanies(false);
                                setSelectedCompany(null);
                              }}
                              className="h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-xs font-medium"
                              style={{
                                boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                                animation: `fadeInDown 0.2s ease-out ${modelIndex * 50}ms both`
                              }}
                            >
                              {model.name}
                            </button>
                          </div>
                        ))}
                        <style>{`
                          @keyframes fadeInDown {
                            from {
                              opacity: 0;
                              transform: translateY(-8px);
                            }
                            to {
                              opacity: 1;
                              transform: translateY(0);
                            }
                          }
                        `}</style>
                      </div>
                    )}
                  </div>
                ))}
              <style>{`
                @keyframes fadeInDown {
                  from {
                    opacity: 0;
                    transform: translateY(-8px);
                  }
                  to {
                    opacity: 1;
                    transform: translateY(0);
                  }
                }
              `}</style>
            </div>
          )}
        </div>

        {/* Uploaded Images Container - Overlaps below image icon in Input Container */}
        {uploadedImages.length > 0 && (
          <div className="absolute left-[256px] top-full mt-2 flex flex-wrap items-start gap-2 p-2 z-[60]">
            {uploadedImages.map((image) => (
              <div key={image.id} className="flex flex-col items-start gap-2">
                <div
                  className="h-[66px] w-[66px] bg-[#1a1a1c]/25 backdrop-blur-sm border border-[#3a3a3d]/20 rounded-lg flex items-center justify-center overflow-visible shadow-md shadow-black/20 relative group cursor-pointer transition-all hover:bg-[#0a0a0b]/40"
                  style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3), inset 0 0 0 2px rgba(255, 255, 255, 0.15), inset 0 0 0 3px rgba(0, 0, 0, 0.3)' }}
                  onContextMenu={(e) => handleImageRightClick(e, image.id)}
                >
                  <div className="w-full h-full overflow-hidden rounded-lg relative">
                    <img src={image.url} alt="Uploaded" className="w-full h-full object-cover" />

                    {/* Black Overlay on Hover */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all pointer-events-none"></div>

                    {/* Trash Icon - Top Right */}
                    <button
                      onClick={() => handleDeleteImage(image.id)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-black/60 z-10"
                    >
                      <svg className="w-3.5 h-3.5 text-red-500 hover:text-red-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>

                    {/* Ref Type Badge - Bottom Left */}
                    {image.refTypes.length > 0 && (
                      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[9px] text-white/90 font-medium flex items-center gap-1 z-10">
                        {image.refTypes.includes('style') && (
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                          </svg>
                        )}
                        {image.refTypes.includes('character') && (
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        )}
                        {image.refTypes.includes('image') && (
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ref Options Menu */}
                {activeImageId === image.id && (
                  <div className="flex flex-col gap-1 animate-fade-in z-10">
                    {/* Top row: Character Ref and Image Ref */}
                    <div className="flex gap-2">
                      <div className="relative group">
                        <button
                          onClick={() => handleSetRefType(image.id, 'character')}
                          className={`h-7 w-7 backdrop-blur-md border rounded-lg flex items-center justify-center hover:bg-white/10 transition-all shadow-lg shadow-black/40 ${image.refTypes.includes('character') ? 'bg-[#2a2a2c] border-white/50' : 'bg-[#1a1a1c] border-[#3a3a3d]'}`}
                          style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}
                        >
                          <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </button>
                        {/* Tooltip */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-black/80 backdrop-blur-sm rounded text-[10px] text-white/90 font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          Character Ref
                        </div>
                      </div>

                      <div className="relative group">
                        <button
                          onClick={() => handleSetRefType(image.id, 'image')}
                          className={`h-7 w-7 backdrop-blur-md border rounded-lg flex items-center justify-center hover:bg-white/10 transition-all shadow-lg shadow-black/40 ${image.refTypes.includes('image') ? 'bg-[#2a2a2c] border-white/50' : 'bg-[#1a1a1c] border-[#3a3a3d]'}`}
                          style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}
                        >
                          <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </button>
                        {/* Tooltip */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-black/80 backdrop-blur-sm rounded text-[10px] text-white/90 font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          Image Ref (Img2Img)
                        </div>
                      </div>
                    </div>

                    {/* Bottom row: Style Ref and Pose Ref */}
                    <div className="flex justify-center gap-2">
                      <div className="relative group">
                        <button
                          onClick={() => handleSetRefType(image.id, 'style')}
                          className={`h-7 w-7 backdrop-blur-md border rounded-lg flex items-center justify-center hover:bg-white/10 transition-all shadow-lg shadow-black/40 ${image.refTypes.includes('style') ? 'bg-[#2a2a2c] border-white/50' : 'bg-[#1a1a1c] border-[#3a3a3d]'}`}
                          style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}
                        >
                          <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                          </svg>
                        </button>
                        {/* Tooltip */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-black/80 backdrop-blur-sm rounded text-[10px] text-white/90 font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          Style Ref
                        </div>
                      </div>

                      {/* Pose Ref - Coming Soon */}
                      <div className="relative group">
                        <button
                          className="h-7 w-7 backdrop-blur-md border rounded-lg flex items-center justify-center hover:bg-white/10 transition-all shadow-lg shadow-black/40 opacity-50 cursor-not-allowed bg-[#1a1a1c] border-[#3a3a3d]"
                          style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}
                          disabled
                        >
                          <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        {/* Tooltip */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-black/80 backdrop-blur-sm rounded text-[10px] text-white/90 font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          Pose Ref - Coming Soon
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Settings Controls - Overlaps the uploaded images area when images exist, otherwise below */}
        {showSettings && (
          <div className={`absolute left-0 right-0 flex flex-row-reverse items-start gap-2 justify-start p-2 z-50 ${uploadedImages.length > 0 ? 'top-14 mt-1' : 'top-full'}`}>
            {/* Resolution Selector - Appears first (rightmost) */}
            <div
              className="relative animate-fade-in"
              style={{ animationDelay: '0ms' }}
            >
              <button
                onClick={() => {
                  setShowResolutions(!showResolutions);
                  setShowAspectRatios(false);
                }}
                className="h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center gap-2 text-white/90 text-sm hover:bg-[#2a2a2d] hover:border-white/30 transition-all shadow-lg"
                style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
              >
                <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                <span className="font-medium">{selectedResolution?.label}</span>
              </button>

              {/* Resolution Dropdown */}
              {showResolutions && (
                <div className="absolute top-full right-0 mt-2 w-40 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg overflow-hidden shadow-xl shadow-black/30 z-50 p-1" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 0 25px rgba(0, 0, 0, 0.5)' }}>
                  {resolutions.map((res) => {
                    const isSupported = isResolutionSupported(res.value);
                    return (
                      <button
                        key={res.value}
                        onClick={() => {
                          if (isSupported) {
                            setResolution(res.value);
                            setShowResolutions(false);
                          }
                        }}
                        disabled={!isSupported}
                        className={`w-full h-8 px-3 flex items-center justify-between rounded-lg transition-colors ${
                          isSupported ? 'hover:bg-white/10 cursor-pointer' : 'cursor-not-allowed opacity-40'
                        } ${res.value === resolution ? 'bg-white/10' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${isSupported ? 'text-white/80' : 'text-white/25'}`}>{res.label}</span>
                          {!isSupported && <span className="text-xs text-red-400/60">N/A</span>}
                        </div>
                        <span className={`text-xs ${isSupported ? 'text-white/50' : 'text-white/10'}`}>{res.time}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Aspect Ratio Selector - Appears second */}
            <div
              className="relative animate-fade-in"
              style={{ animationDelay: '100ms' }}
            >
              <button
                onClick={() => {
                  setShowAspectRatios(!showAspectRatios);
                  setShowResolutions(false);
                }}
                className="h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center gap-2 text-white/90 text-sm hover:bg-[#2a2a2d] hover:border-white/30 transition-all shadow-lg"
                style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
              >
                <span className="text-base">{selectedAspectRatio?.icon}</span>
                <span className="font-medium">{aspectRatio}</span>
              </button>

              {/* Aspect Ratio Dropdown */}
              {showAspectRatios && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg overflow-hidden shadow-xl shadow-black/30 z-50 p-1" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 0 25px rgba(0, 0, 0, 0.5)' }}>
                  {aspectRatios.map((ar) => {
                    const isSupported = isAspectRatioSupported(ar.value);
                    return (
                      <button
                        key={ar.value}
                        onClick={() => {
                          if (isSupported) {
                            setAspectRatio(ar.value);
                            setShowAspectRatios(false);
                          }
                        }}
                        disabled={!isSupported}
                        className={`w-full h-8 px-3 flex items-center gap-3 rounded-lg transition-colors ${
                          isSupported ? 'hover:bg-white/10 cursor-pointer' : 'cursor-not-allowed opacity-40'
                        } ${ar.value === aspectRatio ? 'bg-white/10' : ''}`}
                      >
                        <span className={`text-base ${isSupported ? 'text-white/60' : 'text-white/15'}`}>{ar.icon}</span>
                        <span className={`text-sm font-medium ${isSupported ? 'text-white/80' : 'text-white/25'}`}>{ar.value}</span>
                        <span className={`text-sm ml-auto ${isSupported ? 'text-white/50' : 'text-white/10'}`}>{ar.label}</span>
                        {!isSupported && <span className="text-xs text-red-400/60 ml-2">N/A</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Counter Control - Appears third (leftmost) */}
            <div
              className="h-8 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center px-1 gap-1 animate-fade-in shadow-lg"
              style={{ animationDelay: '200ms', boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
            >
              <button
                onClick={handleDecrement}
                className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white/90 hover:bg-white/10 rounded transition-all"
                disabled={count <= 1}
              >
                <span className="text-lg leading-none">−</span>
              </button>
              <div className="w-8 flex items-center justify-center">
                <span className="text-white/90 text-sm font-medium">{count}</span>
              </div>
              <button
                onClick={handleIncrement}
                className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white/90 hover:bg-white/10 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={count >= (currentModelCapabilities?.maxCount || 10)}
              >
                <span className="text-lg leading-none">+</span>
              </button>
            </div>
          </div>
        )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4" style={{ width: '100%' }}>
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3 relative">
              <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-red-400 font-medium text-sm mb-1">Generation Error</h3>
                <p className="text-red-300/80 text-sm">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400/60 hover:text-red-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Image History Container - Scrollable */}
        <div className="image-history-container h-full rounded-md mt-6 flex-1 relative overflow-y-auto" style={{ width: '100%' }}>
          {/* History View - When showHistory is true */}
          {showHistory ? (
            <div className="pt-4">
              {!isAuthenticated ? (
                <div className="flex flex-col items-center justify-center py-16 text-white/40">
                  <svg className="w-16 h-16 mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <p className="text-lg mb-2">Sign in to view history</p>
                  <p className="text-sm text-white/30">Your generations will be saved when you're signed in</p>
                </div>
              ) : (
                <GenerationHistory
                  generations={generations}
                  isLoading={isHistoryLoading}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  onDelete={deleteGeneration}
                  onToggleFavorite={toggleFavorite}
                  onSelectGeneration={(gen) => {
                    // Load the prompt into input and close history
                    // The generation is already in the generations array (single source of truth)
                    // so it will be visible when we switch back to the main view
                    setPrompt(gen.prompt);
                    setShowHistory(false);
                  }}
                />
              )}
            </div>
          ) : (
          /* Vertical stack of image answer containers - Midjourney style */
          <div className="flex flex-col gap-6 py-4">

            {/* Currently Generating Container - shown only during generation */}
            {isGenerating && generatingSettings && (
              <div className="image-answer-container rounded-md py-4 relative">
                <div className="flex gap-4 items-stretch">
                  <div className="image-preview-container-wrapper relative" style={{ flexGrow: 1 }}>
                    <div className={`grid gap-2 ${
                      generatingSettings.count === 1 ? 'grid-cols-1' :
                      generatingSettings.count === 2 ? 'grid-cols-2' :
                      generatingSettings.count === 3 ? 'grid-cols-3' :
                      'grid-cols-2 grid-rows-2'
                    }`}>
                      {Array.from({ length: generatingSettings.count }).map((_, index) => (
                        <div
                          key={index}
                          className="relative group bg-[#0a0a0c] rounded-md overflow-hidden border border-[#2a2a2d]"
                          style={{ aspectRatio: '16/9' }}
                        >
                          <div className="w-full h-full relative overflow-hidden bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-pink-900/20">
                            <div className="absolute inset-0 opacity-50" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)', backgroundSize: '200% 100%', animation: 'sweep 3s ease-in-out infinite' }}></div>
                            <div className="absolute inset-0 opacity-20 mix-blend-soft-light" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' /%3E%3C/svg%3E")`, backgroundSize: '64px 64px', animation: 'grain 0.5s steps(4) infinite' }}></div>
                            <div className="absolute inset-0">
                              <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-purple-500/10 rounded-full blur-xl animate-pulse" style={{ animationDuration: '2s' }}></div>
                              <div className="absolute bottom-1/4 right-1/4 w-40 h-40 bg-blue-500/10 rounded-full blur-xl animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.5s' }}></div>
                            </div>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 gap-2 z-10">
                              <div className="relative">
                                <svg className="w-12 h-12 text-white/40 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <div className="absolute inset-0 border-2 border-white/30 rounded-full animate-ping opacity-75"></div>
                              </div>
                              <span className="text-xs font-medium animate-pulse">Generating...</span>
                            </div>
                            <style>{`
                              @keyframes sweep { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
                              @keyframes grain { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(-2px, 2px); } 50% { transform: translate(2px, -2px); } 75% { transform: translate(-2px, -2px); } }
                            `}</style>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Settings panel for generating */}
                  <div className="image-detail-container relative bg-[#1a1a1c]/50 rounded-md overflow-hidden border border-[#2a2a2d] transition-all" style={{ width: '16%', flexShrink: 0 }}>
                    <div className="w-full h-full flex flex-col items-start justify-start p-4 pt-4 text-white/70 text-sm">
                      <div className="w-full mb-4 pb-3 border-b border-white/10">
                        <p className="text-xs text-white/80 line-clamp-4">{generatingSettings.prompt}</p>
                      </div>
                      <div className="w-full space-y-2">
                        <div className="flex justify-between text-xs"><span className="text-white/40">Model</span><span className="text-white/80">{selectedModel}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-white/40">Aspect</span><span className="text-white/80">{generatingSettings.aspectRatio}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-white/40">Resolution</span><span className="text-white/80">{generatingSettings.resolution.toUpperCase()}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-white/40">Count</span><span className="text-white/80">{generatingSettings.count}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Midjourney-style: Map over generations - one container per generation (SINGLE SOURCE OF TRUTH from hook) */}
            {generations.map((gen) => (
              <div key={gen.id} className="image-answer-container rounded-md py-4 relative">
                <div className="flex gap-4 items-stretch">
                  {/* Image Preview Grid for this generation */}
                  <div className="image-preview-container-wrapper relative" style={{ flexGrow: 1 }}>
                    <div className={`grid gap-2 ${
                      gen.image_urls.length === 1 ? 'grid-cols-1' :
                      gen.image_urls.length === 2 ? 'grid-cols-2' :
                      gen.image_urls.length === 3 ? 'grid-cols-3' :
                      'grid-cols-2 grid-rows-2'
                    }`}>
                      {gen.image_urls.map((imageUrl, imgIndex) => (
                        <div
                          key={imgIndex}
                          className="relative group bg-[#0a0a0c] rounded-md overflow-hidden border border-[#2a2a2d] hover:border-[#3a3a3d] transition-all cursor-pointer"
                          style={{ aspectRatio: '16/9' }}
                          onClick={() => setViewingImage({ generationId: gen.id, imageIndex: imgIndex })}
                        >
                          <img
                            src={imageUrl}
                            alt={`Generated ${imgIndex + 1}`}
                            className="w-full h-full object-contain"
                          />
                          {/* Favorite Button - Top Right Corner, appears on hover */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // Trigger animation
                              setAnimatingStars(prev => new Set(prev).add(gen.id));
                              setTimeout(() => {
                                setAnimatingStars(prev => {
                                  const next = new Set(prev);
                                  next.delete(gen.id);
                                  return next;
                                });
                              }, 700);
                              toggleFavorite(gen.id);
                            }}
                            className={`absolute top-2 right-2 p-2 rounded-lg backdrop-blur-sm transition-all z-10 ${
                              gen.is_favorite
                                ? 'bg-white/20 text-white'
                                : 'opacity-0 group-hover:opacity-100 bg-black/50 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                            title={gen.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                          >
                            <svg className="w-5 h-5 text-white" viewBox="0 0 50 50">
                              {/* Expanding ring */}
                              <circle
                                cx="25" cy="25" r="8"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="16"
                                className={animatingStars.has(gen.id) ? 'animate-star-ring' : 'opacity-0'}
                                style={{ transformOrigin: 'center' }}
                              />
                              {/* Burst lines */}
                              <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transformOrigin: 'center' }}>
                                <line x1="25" y1="8" x2="25" y2="2" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="25" y1="42" x2="25" y2="48" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="8" y1="25" x2="2" y2="25" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="42" y1="25" x2="48" y2="25" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="13" y1="13" x2="7" y2="7" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="37" y1="37" x2="43" y2="43" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="37" y1="13" x2="43" y2="7" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                                <line x1="13" y1="37" x2="7" y2="43" className={animatingStars.has(gen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                              </g>
                              {/* Star outline (shrinks away) */}
                              <path
                                className={animatingStars.has(gen.id) ? 'animate-star-stroke' : ''}
                                style={{ transformOrigin: 'center' }}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                              />
                              {/* Star fill (bounces in) */}
                              <path
                                className={animatingStars.has(gen.id) ? 'animate-star-fill' : ''}
                                style={{ transformOrigin: 'center', transform: gen.is_favorite && !animatingStars.has(gen.id) ? 'scale(1)' : 'scale(0)' }}
                                fill="currentColor"
                                d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                              />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Settings Panel for this generation */}
                  <div className="image-detail-container group relative bg-[#1a1a1c]/50 rounded-md overflow-hidden border border-[#2a2a2d] transition-all flex flex-col justify-between" style={{ width: '16%', flexShrink: 0 }}>
                    <div className="w-full flex-1 flex flex-col items-start justify-start p-4 pt-4 text-white/70 text-sm">
                      {/* Prompt */}
                      <div className="w-full mb-4 pb-3 border-b border-white/10">
                        <div
                          className="px-1 py-1 rounded-md cursor-pointer hover:bg-white/5 active:bg-white/10 transition-colors"
                          onClick={() => {
                            navigator.clipboard.writeText(gen.prompt);
                            setCopiedPrompt(gen.id);
                            setTimeout(() => setCopiedPrompt(null), 2000);
                          }}
                        >
                          <p className="text-xs text-white/80 line-clamp-4">{gen.prompt}</p>
                          {copiedPrompt === gen.id && (
                            <span className="text-xs text-green-400 mt-1 block">✓ Copied</span>
                          )}
                        </div>
                        {/* Reference Images */}
                        {gen.reference_images && gen.reference_images.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3 px-1">
                            {gen.reference_images.map((refImg, idx) => (
                              <div key={idx} className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#3a3a3d]">
                                <img src={refImg.url} alt={`Ref ${idx + 1}`} className="w-full h-full object-cover" />
                                {refImg.refType && (
                                  <div className="absolute bottom-1 left-1 p-1 bg-black/70 backdrop-blur-sm rounded">
                                    {refImg.refType === 'style' && (
                                      <svg className="w-2.5 h-2.5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                      </svg>
                                    )}
                                    {refImg.refType === 'character' && (
                                      <svg className="w-2.5 h-2.5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                      </svg>
                                    )}
                                    {refImg.refType === 'image' && (
                                      <svg className="w-2.5 h-2.5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    )}
                                    {refImg.refType === 'pose' && (
                                      <svg className="w-2.5 h-2.5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                                      </svg>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Settings */}
                      <div className="w-full space-y-2">
                        <div className="flex justify-between text-xs"><span className="text-white/40">Model</span><span className="text-white/80 truncate ml-2">{gen.model}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-white/40">Aspect</span><span className="text-white/80">{gen.aspect_ratio}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-white/40">Resolution</span><span className="text-white/80">{gen.resolution?.toUpperCase() || 'N/A'}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-white/40">Count</span><span className="text-white/80">{gen.count}</span></div>
                      </div>
                    </div>

                    {/* Action Buttons - Appear on hover at the bottom inside the container */}
                    <div className="w-full px-2 pb-2 mt-auto">
                      <div className="flex flex-wrap gap-1.5">
                        {/* Rerun Button - appears first (in), disappears last (out after 1.5s pause) */}
                        <button
                          onClick={() => handleRerun(gen)}
                          className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-xs text-white/70 hover:text-white opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 ease-out [transition-delay:1800ms] group-hover:![transition-delay:0ms]"
                          title="Rerun with same settings"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>Rerun</span>
                        </button>

                        {/* Use Prompt Button - appears second (in), disappears third (out after 1.5s pause) */}
                        <button
                          onClick={() => handleUsePrompt(gen.prompt)}
                          className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-xs text-white/70 hover:text-white opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 ease-out [transition-delay:1700ms] group-hover:![transition-delay:100ms]"
                          title="Use this prompt"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          <span>Use prompt</span>
                        </button>

                        {/* Delete Button - appears third (in), disappears second (out after 1.5s pause) */}
                        <button
                          onClick={() => handleDeleteGeneration(gen.id)}
                          className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 hover:bg-red-500/20 rounded text-xs text-white/70 hover:text-red-400 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 ease-out [transition-delay:1600ms] group-hover:![transition-delay:200ms]"
                          title="Delete generation"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span>Delete</span>
                        </button>

                        {/* More Button - appears fourth (in), disappears first (out after 1.5s pause) */}
                        <div className="relative opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 ease-out [transition-delay:1500ms] group-hover:![transition-delay:300ms]">
                          <button
                            onClick={() => setOpenMoreMenu(openMoreMenu === gen.id ? null : gen.id)}
                            className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-xs text-white/70 hover:text-white transition-colors"
                            title="More options"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                            </svg>
                            <span>More</span>
                          </button>

                          {/* More Menu Dropdown */}
                          {openMoreMenu === gen.id && (
                            <div className="absolute bottom-full left-0 mb-1 w-40 bg-[#0a0a0b]/95 backdrop-blur-md border border-[#2a2a2d]/40 rounded-md shadow-xl overflow-hidden z-30">
                              <button
                                onClick={() => handleDownloadImages(gen)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                <span>Download images</span>
                              </button>
                              <button
                                onClick={() => {
                                  alert('Report submitted. Thank you for your feedback.');
                                  setOpenMoreMenu(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>Report</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Empty state message - only when not generating and no generations */}
            {!isGenerating && generations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-white/40">
                <svg className="w-16 h-16 mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-lg mb-2">No images generated yet</p>
                <p className="text-sm text-white/30">Select a model, enter a prompt, and click Generate to create images</p>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {/* Image Viewer Modal */}
      {viewingImage && (() => {
        const currentGen = generations.find(g => g.id === viewingImage.generationId);
        if (!currentGen) return null;
        const currentImageUrl = currentGen.image_urls[viewingImage.imageIndex];

        // Get all images from all generations for the thumbnail strip
        const allImages: { genId: string; imageIndex: number; url: string; isActive: boolean }[] = [];
        generations.forEach(gen => {
          gen.image_urls.forEach((url, idx) => {
            allImages.push({
              genId: gen.id,
              imageIndex: idx,
              url,
              isActive: gen.id === viewingImage.generationId && idx === viewingImage.imageIndex
            });
          });
        });

        return (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setViewingImage(null)}
            />

            {/* Modal Content */}
            <div className="relative z-10 flex gap-4 w-full h-full p-6 pt-24 max-w-[95vw]">
              {/* Main Image */}
              <div className="flex-1 flex items-center justify-center min-w-0">
                <img
                  src={currentImageUrl}
                  alt="Enlarged view"
                  className="max-w-full max-h-[calc(100vh-180px)] object-contain rounded-lg"
                />
              </div>

              {/* Info Panel Wrapper */}
              <div className="w-80 flex-shrink-0 relative">
                {/* Close Button - positioned to the left of info panel */}
                <button
                  onClick={() => setViewingImage(null)}
                  className="absolute -left-12 top-0 p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white/70 hover:text-white transition-all z-10"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {/* Info Panel */}
                <div className="w-full h-full bg-[#1a1a1c] border border-[#3a3a3d] rounded-lg p-4 flex flex-col justify-between overflow-y-auto max-h-[calc(100vh-180px)] relative">
                {/* Action Icons - Top Right */}
                <div className="absolute top-3 right-3 flex gap-1">
                  {/* Download */}
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(currentImageUrl);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `generation-${currentGen.id}-${viewingImage.imageIndex + 1}.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        window.URL.revokeObjectURL(url);
                      } catch (error) {
                        console.error('Download failed:', error);
                      }
                    }}
                    className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-all"
                    title="Download"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  {/* Favorite */}
                  <button
                    onClick={() => {
                      // Trigger animation
                      setAnimatingStars(prev => new Set(prev).add(currentGen.id));
                      setTimeout(() => {
                        setAnimatingStars(prev => {
                          const next = new Set(prev);
                          next.delete(currentGen.id);
                          return next;
                        });
                      }, 700);
                      toggleFavorite(currentGen.id);
                    }}
                    className={`p-1.5 rounded hover:bg-white/10 transition-all ${currentGen.is_favorite ? 'text-white' : 'text-white/50 hover:text-white'}`}
                    title={currentGen.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <svg className="w-4 h-4 text-white" viewBox="0 0 50 50">
                      {/* Expanding ring */}
                      <circle
                        cx="25" cy="25" r="8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="16"
                        className={animatingStars.has(currentGen.id) ? 'animate-star-ring' : 'opacity-0'}
                        style={{ transformOrigin: 'center' }}
                      />
                      {/* Burst lines */}
                      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transformOrigin: 'center' }}>
                        <line x1="25" y1="8" x2="25" y2="2" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="25" y1="42" x2="25" y2="48" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="8" y1="25" x2="2" y2="25" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="42" y1="25" x2="48" y2="25" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="13" y1="13" x2="7" y2="7" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="37" y1="37" x2="43" y2="43" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="37" y1="13" x2="43" y2="7" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                        <line x1="13" y1="37" x2="7" y2="43" className={animatingStars.has(currentGen.id) ? 'animate-star-line' : ''} style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }} />
                      </g>
                      {/* Star outline (shrinks away) */}
                      <path
                        className={animatingStars.has(currentGen.id) ? 'animate-star-stroke' : ''}
                        style={{ transformOrigin: 'center' }}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                      />
                      {/* Star fill (bounces in) */}
                      <path
                        className={animatingStars.has(currentGen.id) ? 'animate-star-fill' : ''}
                        style={{ transformOrigin: 'center', transform: currentGen.is_favorite && !animatingStars.has(currentGen.id) ? 'scale(1)' : 'scale(0)' }}
                        fill="currentColor"
                        d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                      />
                    </svg>
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => {
                      deleteGeneration(currentGen.id);
                      setViewingImage(null);
                    }}
                    className="p-1.5 rounded hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-all"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                {/* Top Section - Prompt & Settings */}
                <div className="flex flex-col gap-4 mt-6">
                  {/* Prompt Section */}
                  <div>
                    <p className="text-white/90 text-sm leading-relaxed">{currentGen.prompt}</p>
                  </div>

                  {/* Reference Images Section */}
                  {currentGen.reference_images && currentGen.reference_images.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {currentGen.reference_images.map((refImg, idx) => (
                        <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#3a3a3d]">
                          <img src={refImg.url} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover" />
                          {/* Reference Type Badge */}
                          {refImg.refType && (
                            <div className="absolute bottom-1 left-1 p-1.5 bg-black/70 backdrop-blur-sm rounded">
                              {refImg.refType === 'style' && (
                                <svg className="w-3 h-3 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                </svg>
                              )}
                              {refImg.refType === 'character' && (
                                <svg className="w-3 h-3 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                              )}
                              {refImg.refType === 'image' && (
                                <svg className="w-3 h-3 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              )}
                              {refImg.refType === 'pose' && (
                                <svg className="w-3 h-3 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                                </svg>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Settings Section */}
                  <div className="border-t border-[#3a3a3d] pt-4">
                    <h3 className="text-white/60 text-xs uppercase tracking-wider mb-3">Settings</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-white/50">Model</div>
                      <div className="text-white/90">{currentGen.model}</div>
                      <div className="text-white/50">Aspect Ratio</div>
                      <div className="text-white/90">{currentGen.aspect_ratio}</div>
                      <div className="text-white/50">Resolution</div>
                      <div className="text-white/90">{currentGen.resolution}</div>
                    </div>
                  </div>
                </div>

                {/* Creation Actions Section - Bottom */}
                <div className="border-t border-[#3a3a3d] pt-3 mt-4">
                  <h3 className="text-white/60 text-[10px] uppercase tracking-wider mb-2">Creation Actions</h3>

                  {/* Vary */}
                  <div className="mb-2">
                    <span className="text-white/70 text-xs">Vary</span>
                    <div className="flex gap-1.5 mt-1">
                      <button
                        disabled
                        className="flex-1 px-2 py-1 bg-white/5 border border-[#3a3a3d] rounded text-white/30 text-xs cursor-not-allowed"
                        title="Coming Soon"
                      >
                        Subtle
                      </button>
                      <button
                        disabled
                        className="flex-1 px-2 py-1 bg-white/5 border border-[#3a3a3d] rounded text-white/30 text-xs cursor-not-allowed"
                        title="Coming Soon"
                      >
                        Strong
                      </button>
                    </div>
                  </div>

                  {/* Upscale */}
                  <div className="mb-2">
                    <span className="text-white/70 text-xs">Upscale</span>
                    <div className="flex gap-1.5 mt-1">
                      <button
                        disabled
                        className="flex-1 px-2 py-1 bg-white/5 border border-[#3a3a3d] rounded text-white/30 text-xs cursor-not-allowed"
                        title="Coming Soon"
                      >
                        Subtle
                      </button>
                      <button
                        disabled
                        className="flex-1 px-2 py-1 bg-white/5 border border-[#3a3a3d] rounded text-white/30 text-xs cursor-not-allowed"
                        title="Coming Soon"
                      >
                        Creative
                      </button>
                    </div>
                  </div>

                  {/* More */}
                  <div className="mb-2">
                    <span className="text-white/70 text-xs">More</span>
                    <div className="flex gap-1.5 mt-1">
                      <button
                        onClick={() => {
                          handleRerun(currentGen);
                          setViewingImage(null);
                        }}
                        className="flex-1 px-2 py-1 bg-white/10 border border-[#3a3a3d] rounded text-white/90 text-xs hover:bg-white/20 transition-all"
                      >
                        Rerun
                      </button>
                      <button
                        disabled
                        className="flex-1 px-2 py-1 bg-white/5 border border-[#3a3a3d] rounded text-white/30 text-xs cursor-not-allowed"
                        title="Coming Soon"
                      >
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Use */}
                  <div>
                    <span className="text-white/70 text-xs">Use</span>
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      <button
                        onClick={() => {
                          const newImage: UploadedImage = {
                            id: `ref-${Date.now()}`,
                            url: currentImageUrl,
                            refTypes: ['image']
                          };
                          setUploadedImages(prev => [...prev, newImage]);
                          setViewingImage(null);
                        }}
                        className="px-2 py-1 bg-white/10 border border-[#3a3a3d] rounded text-white/90 text-xs hover:bg-white/20 transition-all"
                      >
                        Image
                      </button>
                      <button
                        onClick={() => {
                          const newImage: UploadedImage = {
                            id: `ref-${Date.now()}`,
                            url: currentImageUrl,
                            refTypes: ['style']
                          };
                          setUploadedImages(prev => [...prev, newImage]);
                          setViewingImage(null);
                        }}
                        className="px-2 py-1 bg-white/10 border border-[#3a3a3d] rounded text-white/90 text-xs hover:bg-white/20 transition-all"
                      >
                        Style
                      </button>
                      <button
                        onClick={() => {
                          handleUsePrompt(currentGen.prompt);
                          setViewingImage(null);
                        }}
                        className="px-2 py-1 bg-white/10 border border-[#3a3a3d] rounded text-white/90 text-xs hover:bg-white/20 transition-all"
                      >
                        Prompt
                      </button>
                      <button
                        onClick={() => {
                          const newImage: UploadedImage = {
                            id: `ref-${Date.now()}`,
                            url: currentImageUrl,
                            refTypes: ['character']
                          };
                          setUploadedImages(prev => [...prev, newImage]);
                          setViewingImage(null);
                        }}
                        className="px-2 py-1 bg-white/10 border border-[#3a3a3d] rounded text-white/90 text-xs hover:bg-white/20 transition-all"
                      >
                        Character
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              </div>

              {/* Thumbnail Strip */}
              <div className="w-24 flex-shrink-0 flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-160px)] pr-1 items-center">
                {allImages.map((img, idx) => (
                  <div
                    key={`${img.genId}-${img.imageIndex}`}
                    onClick={() => setViewingImage({ generationId: img.genId, imageIndex: img.imageIndex })}
                    className={`relative cursor-pointer rounded overflow-hidden border-2 transition-all duration-300 ease-in-out ${
                      img.isActive
                        ? 'border-white w-20 h-20'
                        : 'border-transparent hover:border-white/50 w-16 h-16'
                    }`}
                  >
                    <img
                      src={img.url}
                      alt={`Thumbnail ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ImageGenerationInterface2;

