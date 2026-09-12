import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import { DndContext, pointerWithin, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, DragOverlay, type DragStartEvent } from '@dnd-kit/core';
import imageGenerationService from '../../../services/imageGenerationService';
import { ImageModelSettings } from '../../nodes/image-models/ImageModelInterface';
import * as xenoImageService from '../../../services/xenoImageService';
import { useGenerationHistory } from './hooks/useGenerationHistory';
import GenerationHistory from './components/GenerationHistory';
import { generationHistoryService, type GenerationRecord } from '../../../services/generationHistoryService';

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

interface ViewerImageItem {
  genId: string;
  imageIndex: number;
  url: string;
}

// Copy page only: keep this enabled to preview generated-result layouts without calling real model APIs.
const DEMO_MOCK_GENERATION_ENABLED = true;
const DEMO_MOCK_HISTORY_MOBILE_ENABLED = false;
const DEFAULT_DEMO_MODEL = 'Flux 2 Max';
const allowedAspectRatioValues = new Set(['16:9', '4:3', '1:1', '3:4', '9:16']);

function buildMockImageUrls(prompt: string, count: number, width: number, height: number): string[] {
  const safeWidth = Math.max(256, width);
  const safeHeight = Math.max(256, height);
  const seedBase = `${prompt}-${Date.now()}`;

  return Array.from({ length: count }, (_, index) => (
    `https://picsum.photos/seed/${encodeURIComponent(`${seedBase}-${index}`)}/${safeWidth}/${safeHeight}`
  ));
}

function buildMockGenerationHistory(): GenerationRecord[] {
  const now = Date.now();
  const demoPrompts = [
    'cinematic portrait, soft rim light, 85mm lens',
    'futuristic city at blue hour, rainy streets, neon reflections',
    'minimal product shot on dark neutral background',
    'high-detail fantasy landscape with volumetric fog',
    'fashion editorial, studio lighting, monochrome palette',
    'architectural visualization, brutalist interior, natural light',
  ];
  const sizes = [
    { aspect: '1:1', width: 1024, height: 1024, count: 4 },
    { aspect: '16:9', width: 1280, height: 720, count: 3 },
    { aspect: '9:16', width: 720, height: 1280, count: 2 },
    { aspect: '3:4', width: 960, height: 1280, count: 4 },
  ];

  return demoPrompts.map((prompt, index) => {
    const size = sizes[index % sizes.length];
    return {
      id: `local-seed-${now}-${index}`,
      user_id: '',
      prompt,
      image_urls: buildMockImageUrls(prompt, size.count, size.width, size.height),
      model: DEFAULT_DEMO_MODEL,
      aspect_ratio: size.aspect,
      resolution: '2k',
      count: size.count,
      provider: 'demo',
      is_favorite: false,
      created_at: new Date(now - index * 1000 * 60 * 18).toISOString(),
      reference_images: [],
    };
  });
}

function parseAspectRatioValue(aspectRatio?: string | null): number {
  if (!aspectRatio) return 1;
  const match = aspectRatio.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return 1;
  return width / height;
}

function formatGallerySectionDate(createdAt?: string | null): string {
  if (!createdAt) return 'Unknown date';
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) return 'Unknown date';
  return parsedDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
      <svg viewBox="0 0 320 320" className="w-5 h-5" fill="currentColor">
        {/* Seedream logo */}
        <path d="M254 33C260.798 33.6798 266.739 34.4866 273.219 36.25C274.043 36.4682 274.868 36.6863 275.717 36.9111C277.439 37.3682 279.16 37.8288 280.88 38.293C283.519 39.0052 286.162 39.7067 288.805 40.4062C290.485 40.8535 292.164 41.3014 293.844 41.75C294.633 41.9604 295.423 42.1709 296.236 42.3877C301.764 43.8822 301.764 43.8822 304 45C304 120.57 304 196.14 304 274C298.222 275.926 292.553 277.74 286.676 279.262C285.926 279.457 285.176 279.653 284.403 279.854C282.835 280.262 281.266 280.667 279.697 281.072C277.306 281.689 274.918 282.318 272.529 282.947C270.995 283.344 269.46 283.741 267.926 284.137C267.219 284.324 266.513 284.512 265.785 284.705C261.591 285.77 258.445 286 254 286C254 202.51 254 119.02 254 33Z" />
        <path d="M16 46C33.0076 48.1259 49.4193 53.6574 66 58C66 124.99 66 191.98 66 261C20 273 20 273 16 273C16 198.09 16 123.18 16 46Z" />
        <path d="M226 113C226 157.55 226 202.1 226 248C215.108 245.58 204.294 243.146 193.507 240.335C191.445 239.798 189.381 239.267 187.316 238.736C177.275 236.137 177.275 236.137 175 235C175 199.03 175 163.06 175 126C199.585 118.976 199.585 118.976 210.625 116.125C211.793 115.818 212.961 115.511 214.164 115.195C215.278 114.907 216.392 114.618 217.539 114.32C218.521 114.065 219.503 113.81 220.514 113.547C223 113 223 113 226 113Z" />
        <path d="M94 146C103.002 147.125 103.002 147.125 106.748 148.107C108.003 148.433 108.003 148.433 109.284 148.765C110.159 148.997 111.033 149.229 111.934 149.469C113.311 149.829 113.311 149.829 114.717 150.197C116.643 150.702 118.568 151.21 120.493 151.72C123.451 152.504 126.412 153.278 129.373 154.051C131.248 154.544 133.122 155.037 134.996 155.531C135.885 155.764 136.773 155.996 137.688 156.235C143.884 157.884 143.884 157.884 145 159C145.095 160.404 145.122 161.813 145.12 163.22C145.122 164.13 145.123 165.041 145.124 165.978C145.119 167.488 145.119 167.488 145.114 169.028C145.114 170.081 145.114 171.135 145.114 172.22C145.113 175.721 145.105 179.222 145.098 182.723C145.096 185.143 145.094 187.563 145.093 189.983C145.09 196.366 145.08 202.75 145.069 209.133C145.058 215.642 145.054 222.15 145.049 228.658C145.038 241.439 145.021 254.219 145 267C136.487 270.25 136.487 270.25 132.575 271.259C131.808 271.459 131.041 271.659 130.25 271.865C129.451 272.068 128.652 272.271 127.828 272.48C126.561 272.807 126.561 272.807 125.268 273.14C123.497 273.595 121.726 274.048 119.954 274.499C117.242 275.19 114.533 275.89 111.824 276.592C110.097 277.034 108.369 277.477 106.641 277.918C105.833 278.127 105.026 278.337 104.194 278.552C103.439 278.743 102.685 278.933 101.907 279.13C101.247 279.298 100.588 279.467 99.9078 279.641C98 280 98 280 94 280C94 235.78 94 191.56 94 146Z" />
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
      <img src="/flux-logo.svg" alt="Flux" className="w-5 h-5" />
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
      <svg viewBox="0 0 110 66" className="w-5 h-5" fill="currentColor">
        <path fillRule="evenodd" clipRule="evenodd" d="M110.001 43.7425C97.1676 51.9955 84.2426 59.5498 69.8555 62.9776C66.6472 63.7363 63.0905 63.7363 59.8318 63.2123C56.7243 62.7484 55.1705 59.4898 56.2751 56.0619C57.3293 52.8688 58.7318 49.6156 60.5376 46.941C64.4426 41.1279 68.8518 35.8388 72.8118 30.0857C75.2301 26.56 77.4095 22.8111 79.3293 18.8743C80.7318 16.0851 80.081 12.7118 77.6243 11.32C73.513 8.93467 69.1039 7.2535 64.7451 5.45225C64.241 5.21754 63.4893 5.85617 62.4901 6.26554C63.7414 7.59737 64.6443 8.58533 65.8955 9.92262C52.9659 12.5426 40.733 16.2543 28.8622 21.3742C28.8072 21.6635 28.711 21.8928 28.7568 22.0128C30.5122 25.206 29.7101 27.6458 27.1526 29.6218C26.1597 30.3954 25.2803 31.358 24.5493 32.471C32.3685 35.2002 39.3351 33.6336 45.9993 28.4591C45.6005 27.7659 45.1972 27.1273 44.7985 26.4286C47.301 26.9526 48.8043 28.5792 49.006 31.1337C49.0564 31.7178 48.7584 32.2963 48.6072 32.8804C48.2543 32.411 47.8051 31.9525 47.5072 31.423C47.3009 31.0737 47.2505 30.6698 47.1039 30.0857C39.1839 36.3628 30.6635 37.9348 21.2905 34.6816C21.2905 36.8868 21.1897 38.7481 21.341 40.5493C21.4418 42.1159 20.8918 42.8145 19.691 43.6278C16.9822 45.6038 14.1726 47.6397 11.9176 50.2543C9.21345 53.4474 10.2172 57.3446 13.8747 58.9712C18.0318 60.827 22.3951 60.8816 26.7539 60.2485C31.9147 59.4898 36.9747 58.5018 42.5939 57.5739C36.026 61.231 29.5589 63.7964 22.748 64.8335C17.9814 65.5976 13.2239 66.0015 8.5122 64.375C1.7472 62.1098 -1.26405 56.182 0.491366 48.2183C2.14595 40.7786 6.15637 34.8508 10.4647 29.387C24.8518 11.1999 43.043 1.96438 64.0897 0.103084C69.003 -0.300833 73.9668 0.452418 78.573 2.89229C85.0401 6.38017 87.7489 13.7544 84.591 21.1995C82.5376 26.1393 79.6776 30.6698 76.8222 35.1456C74.0172 39.5614 70.8593 43.6278 67.903 47.869C67.0505 49.1462 66.2485 50.489 65.5976 51.9354C64.3418 54.6646 65.1943 56.4658 67.8526 56.182C73.4122 55.5379 79.0818 55.0194 84.4443 53.3928C92.3093 51.0075 99.9772 47.6397 107.746 44.6758C108.548 44.4411 109.3 44.0918 110.001 43.7479V43.7425Z" />
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
      <svg viewBox="0 0 12 12" className="w-5 h-5" fill="currentColor">
        <path fillRule="evenodd" clipRule="evenodd" d="M3.6115 10.5C5.7375 10.5 7.1205 9.39 7.1205 7.72C7.1205 6.425 6.2795 5.602 4.7755 5.261L3.8105 4.9755C2.9635 4.788 2.469 4.563 2.5855 3.988C2.6825 3.5095 2.972 3.2395 3.6465 3.2395C5.789 3.2395 6.583 3.988 6.583 3.988V2.188C6.583 2.188 5.81 1.5 3.6465 1.5C1.6065 1.5 0.5 2.535 0.5 4.1365C0.5 5.4315 1.267 6.185 2.8225 6.5425L2.9895 6.584C3.226 6.656 3.5455 6.7515 3.9475 6.87C4.7425 7.0575 4.947 7.2565 4.947 7.853C4.947 8.398 4.372 8.708 3.612 8.708C1.4205 8.708 0.5 7.6155 0.5 7.6155V9.61C0.5 9.61 1.076 10.5 3.6115 10.5Z" />
        <path fillRule="evenodd" clipRule="evenodd" d="M10.1876 10.3619C10.9401 10.3619 11.5006 9.82544 11.5006 9.09894C11.5006 8.35694 10.9561 7.83594 10.1876 7.83594C9.43512 7.83594 8.89062 8.35694 8.89062 9.09894C8.89062 9.84094 9.43512 10.3619 10.1876 10.3619Z" />
      </svg>
    )
  },
];

function renderCompanyLogo(
  company: (typeof aiCompanies)[number] | null | undefined,
  isActive: boolean,
) {
  if (!company) return null;

  if (company.name === 'Black Forest') {
    return (
      <img
        src="/flux-logo.svg"
        alt="Flux"
        className="w-5 h-5"
        draggable={false}
        style={{
          opacity: isActive ? 1 : 0.52,
          filter: isActive ? 'none' : 'grayscale(1) brightness(0.9)',
        }}
      />
    );
  }

  return company.logo;
}

// Model capabilities interface
interface ModelCapabilities {
  maxCount: number; // Max images per generation
  supportedAspectRatios: string[]; // Empty array = supports all
  supportedResolutions: string[]; // Empty array = supports all
  maxResolution?: string; // Maximum supported resolution
}

// Map UI model names to provider and model ID
interface ModelMapping {
  provider: 'fal' | 'xeno' | 'xeno-flow';
  modelId: string;
  xenoConfig?: typeof xenoImageService.XenoModels[keyof typeof xenoImageService.XenoModels];
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
  // OpenAI GPT Image models
  'GPT 1.5': {
    provider: 'xeno',
    modelId: 'gpt-high',
    xenoConfig: xenoImageService.XenoModels.DALLE_3,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k'],
      maxResolution: '1k'
    }
  },
  'GPT 1.5 - High': {
    provider: 'xeno',
    modelId: 'gpt-high',
    xenoConfig: xenoImageService.XenoModels.DALLE_3,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k'],
      maxResolution: '1k'
    }
  },
  'GPT 1 - HQ': {
    provider: 'xeno',
    modelId: 'gpt-high',
    xenoConfig: xenoImageService.XenoModels.DALLE_3,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k'],
      maxResolution: '1k'
    }
  },
  'GPT': {
    provider: 'xeno',
    modelId: 'gpt-high',
    xenoConfig: xenoImageService.XenoModels.DALLE_3,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k'],
      maxResolution: '1k'
    }
  },

  // Black Forest (Flux models) - Replicate
  'Flux 2 Max': {
    provider: 'xeno',
    modelId: 'black-forest-labs/flux-1.1-pro',
    xenoConfig: xenoImageService.XenoModels.FLUX_PRO,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },
  'Flux 2 Pro': {
    provider: 'xeno',
    modelId: 'black-forest-labs/flux-1.1-pro',
    xenoConfig: xenoImageService.XenoModels.FLUX_PRO,
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: [], // Supports all
      supportedResolutions: ['1k', '2k', '4k'],
      maxResolution: '4k'
    }
  },
  'Flux 2 Flex': {
    provider: 'xeno',
    modelId: 'black-forest-labs/flux-dev',
    xenoConfig: xenoImageService.XenoModels.FLUX_DEV,
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
  'Nano Banana Pro': {
    provider: 'xeno-flow',
    modelId: 'nano-banana-pro',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k', '2k', '4k'], // FIFE URL: =w1280 (1k), =w2560 (2k), =w3840 (4k)
      maxResolution: '4k'
    }
  },
  'Nano Banana': {
    provider: 'xeno-flow',
    modelId: 'nano-banana',
    capabilities: {
      maxCount: 4,
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportedResolutions: ['1k', '2k', '4k'], // FIFE URL: =w1280 (1k), =w2560 (2k), =w3840 (4k)
      maxResolution: '4k'
    }
  },

  // Stability AI - Fal.ai (primary) and Replicate (backup)
  'SDXL 1.0': {
    provider: 'xeno',
    modelId: 'stability-ai/sdxl',
    xenoConfig: xenoImageService.XenoModels.STABLE_DIFFUSION_XL,
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

};

// --- Error Boundary ---
class GalleryErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('GalleryErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, margin: 16, border: '2px solid #ef4444', borderRadius: 12, background: 'rgba(239,68,68,0.08)', color: '#fca5a5' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#ef4444' }}>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, opacity: 0.8 }}>{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- DraggableTile ---
function DraggableTile({ id, children }: { id: string; children: (props: { dragAttributes: Record<string, any>; dragListeners: Record<string, any> | undefined; dragNodeRef: (node: HTMLElement | null) => void; isDragging: boolean }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return <>{children({ dragAttributes: attributes, dragListeners: listeners, dragNodeRef: setNodeRef, isDragging })}</>;
}

// --- DroppableTile ---
function DroppableTile({ id, children }: { id: string; children: (props: { dropNodeRef: (node: HTMLElement | null) => void; isOver: boolean }) => React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <>{children({ dropNodeRef: setNodeRef, isOver })}</>;
}

// --- GalleryImageTile ---
interface GalleryImageTileProps {
  tileId: string;
  tileIndex: number;
  imageUrl: string;
  imageIndex: number;
  prompt: string;
  model: string;
  createdAt: string;
  isFavorite: boolean;
  cardRadius: number;
  cardStyle: React.CSSProperties;
  animatingStars: Set<string>;
  loadedImageUrlsRef: React.MutableRefObject<Set<string>>;
  onView: () => void;
  onToggleFavorite: () => void;
  onUsePrompt: () => void;
  onRerun: () => void;
  onDownload: () => void;
  // Mobile selection mode
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onEnterSelectionMode?: () => void;
}

const GalleryImageTile = React.memo(function GalleryImageTile({
  tileId,
  tileIndex,
  imageUrl,
  imageIndex,
  prompt,
  model,
  createdAt,
  isFavorite,
  cardRadius,
  cardStyle,
  animatingStars,
  loadedImageUrlsRef,
  onView,
  onToggleFavorite,
  onUsePrompt,
  onRerun,
  onDownload,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onEnterSelectionMode,
}: GalleryImageTileProps) {
  const alreadyCached = loadedImageUrlsRef.current.has(imageUrl);
  const [imageLoaded, setImageLoaded] = useState(() => alreadyCached);
  const [imageRevealed, setImageRevealed] = useState(() => alreadyCached);
  const [outerHoverState, setOuterHoverState] = useState(false);
  const [innerHoverState, setInnerHoverState] = useState(false);
  const [longPressActive, setLongPressActive] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imageLoaded && !imageRevealed) {
      revealTimerRef.current = setTimeout(() => setImageRevealed(true), 1500);
    }
    return () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); };
  }, [imageLoaded, imageRevealed]);
  const supportsHover = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    []
  );

  // Long press detection for mobile
  const handleTouchStart = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      if (selectionMode) return; // Already in selection mode, no need for long press overlay
      if (onEnterSelectionMode) {
        // Enter selection mode and select this tile
        onEnterSelectionMode();
        onToggleSelect?.();
      }
    }, 500);
  }, [selectionMode, onEnterSelectionMode, onToggleSelect]);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Combined overlay visibility: hover on desktop OR long press on mobile — never in selection mode
  const showOverlay = supportsHover && outerHoverState && !selectionMode;

  useEffect(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setOuterHoverState(false);
    setInnerHoverState(false);
    setLongPressActive(false);
  }, [selectionMode]);

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      if (!imageLoaded) {
        loadedImageUrlsRef.current.add(imageUrl);
        setImageLoaded(true);
      }
    }
  }, [imageUrl, imageLoaded, loadedImageUrlsRef]);

  const createdAtLabel = createdAt
    ? new Date(createdAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Unknown date';

  return (
    <div
      className="transition-shadow duration-200 hover:shadow-[0_0_15px_rgba(255,255,255,0.12)]"
      style={{ ...cardStyle }}
      onMouseEnter={() => setOuterHoverState(true)}
      onMouseLeave={() => { setOuterHoverState(false); setInnerHoverState(false); }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      data-tile-id={tileId}
    >
      <span data-state={showOverlay ? 'hover' : 'idle'} style={{ display: 'block', width: '100%', height: '100%', position: 'relative' }}>
        <div
          className="relative cursor-pointer overflow-hidden"
          style={{ width: '100%', height: '100%', borderRadius: cardRadius, WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', outline: 'none' }}
          onClick={(e) => {
            if (longPressActive) { e.stopPropagation(); setLongPressActive(false); return; }
            if (selectionMode) { e.stopPropagation(); onToggleSelect?.(); return; }
            onView();
          }}
          onMouseEnter={() => setInnerHoverState(true)}
          onMouseLeave={() => setInnerHoverState(false)}
        >
          <span data-state={innerHoverState ? 'hover' : 'idle'} style={{ display: 'block', width: '100%', height: '100%' }}>
            <div data-tile-id={tileId} style={{ width: '100%', height: '100%', position: 'relative' }}>
              {/* Skeleton placeholder — always visible until image covers it */}
              {!imageLoaded && (
                <div className="absolute inset-0 tile-skeleton-bg" style={{ borderRadius: cardRadius }} />
              )}
              <img
                ref={imgRef}
                src={imageUrl}
                alt={`Generated ${imageIndex + 1}`}
                draggable={false}
                className="w-full h-full object-cover block relative z-[1]"
                style={{
                  borderRadius: cardRadius,
                  opacity: imageLoaded ? 1 : 0,
                  transition: 'opacity 0.3s ease, filter 0.8s ease-out',
                  filter: imageRevealed
                    ? (supportsHover && innerHoverState) ? 'brightness(1.1)' : 'brightness(1)'
                    : 'blur(20px) brightness(0.7)',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                }}
                onLoad={() => {
                  loadedImageUrlsRef.current.add(imageUrl);
                  setImageLoaded(true);
                }}
              />
              {/* Xenomorphing text overlay — fades out together with the blur */}
              <div
                className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
                style={{
                  opacity: imageRevealed ? 0 : 1,
                  transition: 'opacity 0.8s ease-out',
                }}
              >
                <span className="text-white/60 text-[11px] font-medium tracking-[0.25em] uppercase">
                  {'xenomorphing'.split('').map((letter, i) => (
                    <span key={i} className="inline-block" style={{ animation: 'letterWave 2.4s ease-in-out infinite', animationDelay: `${i * 0.12}s` }}>{letter}</span>
                  ))}
                </span>
              </div>
              {/* Selection mode checkbox — only on selected images */}
              {selectionMode && isSelected && (
                <>
                  <div className="absolute inset-0 z-[15] transition-colors duration-200" style={{ background: 'rgba(255,255,255,0.08)', borderRadius: cardRadius }} />
                  <div className="absolute top-2 left-2 z-20 flex items-center justify-center" style={{ width: 22, height: 22 }}>
                    <div className="w-[22px] h-[22px] rounded-md border-2 bg-white border-white flex items-center justify-center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                </>
              )}
              {/* Hover overlay (desktop) / Long press overlay (mobile) */}
              {showOverlay && (
                <>
                  {/* Mobile dismiss backdrop — tapping outside the buttons dismisses the overlay */}
                  {longPressActive && (
                    <div className="md:hidden fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setLongPressActive(false); }} />
                  )}
                  <div className="absolute top-2 right-2 flex items-center gap-1 z-20" style={{ animation: 'virtuosoTileFadeIn 0.15s ease' }}>
                    {/* Favorite */}
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                        className={`image-action-button p-2 rounded-lg backdrop-blur-md transition-all ${
                          isFavorite
                            ? 'bg-[#27272a] text-white'
                            : 'bg-[#1a1a1c]/95 text-white/80 hover:bg-[#3a3a3d] hover:text-white'
                        }`}
                      >
                        <svg className="w-4 h-4 text-white" viewBox="0 0 50 50">
                          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transformOrigin: 'center' }}>
                            {[
                              ['25','8','25','2'], ['25','42','25','48'], ['8','25','2','25'], ['42','25','48','25'],
                              ['13','13','7','7'], ['37','37','43','43'], ['37','13','43','7'], ['13','37','7','43'],
                            ].map(([x1,y1,x2,y2], i) => (
                              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                                className={animatingStars.has(tileId) ? 'animate-star-line' : ''}
                                style={{ strokeDasharray: '1 23', strokeDashoffset: 1 }}
                              />
                            ))}
                          </g>
                          <circle cx="25" cy="25" r="8" fill="none" stroke="currentColor" strokeWidth="16"
                            className={animatingStars.has(tileId) ? 'animate-star-ring' : 'opacity-0'}
                            style={{ transformOrigin: 'center' }}
                          />
                          <path
                            className={animatingStars.has(tileId) ? 'animate-star-stroke' : ''}
                            style={{ transformOrigin: 'center' }}
                            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                          />
                          <path
                            className={animatingStars.has(tileId) ? 'animate-star-fill' : ''}
                            style={{ transformOrigin: 'center', transform: isFavorite && !animatingStars.has(tileId) ? 'scale(1)' : 'scale(0)' }}
                            fill="currentColor"
                            d="M25 5l5.09 10.31L42 17.27l-8.5 8.28 2 11.66L25 32l-10.5 5.21 2-11.66-8.5-8.28 11.91-1.96L25 5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {/* Reuse Prompt */}
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); onUsePrompt(); }}
                        className="image-action-button p-2 rounded-lg backdrop-blur-md bg-[#1a1a1c]/95 text-white/80 hover:bg-[#3a3a3d] hover:text-white transition-all">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.4a2 2 0 112.8 2.8L11.8 15H9v-2.8l8.6-8.6z" />
                        </svg>
                      </button>
                    </div>
                    {/* Rerun */}
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); onRerun(); }}
                        className="image-action-button p-2 rounded-lg backdrop-blur-md bg-[#1a1a1c]/95 text-white/80 hover:bg-[#3a3a3d] hover:text-white transition-all">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.6m15.4 2A8 8 0 004.6 9m0 0H9m11 11v-5h-.6a8 8 0 01-15.4-2m15.4 2H15" />
                        </svg>
                      </button>
                    </div>
                    {/* Download */}
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); onDownload(); }}
                        className="image-action-button p-2 rounded-lg backdrop-blur-md bg-[#1a1a1c]/95 text-white/80 hover:bg-[#3a3a3d] hover:text-white transition-all">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Bottom gradient with prompt text */}
                  <div className="absolute inset-x-0 bottom-0 px-2 pb-2 pt-9 bg-gradient-to-t from-black/95 via-black/75 to-transparent z-10 pointer-events-none">
                    <p className="text-[11px] leading-[1.35] text-white/95 line-clamp-3 break-words" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.75)' }}>
                      {prompt}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-white/80" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.75)' }}>
                      <span className="truncate">Model: {model || 'Unknown'}</span>
                      <span className="shrink-0">{createdAtLabel}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </span>
        </div>
      </span>
    </div>
  );
}, (prev, next) =>
  prev.imageUrl === next.imageUrl &&
  prev.isFavorite === next.isFavorite &&
  prev.cardStyle.width === next.cardStyle.width &&
  prev.cardStyle.height === next.cardStyle.height &&
  prev.animatingStars === next.animatingStars &&
  prev.selectionMode === next.selectionMode &&
  prev.isSelected === next.isSelected
);

// --- Collage type ---
type Collage = { id: string; name: string; imageKeys: string[]; isFavorite?: boolean };

const ImageGenerationInterface2: React.FC = () => {
  const desktopAspectRatioTriggerRef = useRef<HTMLDivElement | null>(null);
  const mobileAspectRatioTriggerRef = useRef<HTMLDivElement | null>(null);
  const [desktopSettingsClosing, setDesktopSettingsClosing] = useState(false);
  const [desktopSettingsClosingView, setDesktopSettingsClosingView] = useState<'default' | 'resolutions' | 'aspects'>('default');
  const [desktopSettingsView, setDesktopSettingsView] = useState<'default' | 'resolutions' | 'aspects'>('default');
  const [desktopAspectOptionsVisible, setDesktopAspectOptionsVisible] = useState(false);
  const [desktopResolutionOptionsVisible, setDesktopResolutionOptionsVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [count, setCount] = useState(1);
  const [aspectRatio, setAspectRatio] = useState('3:4');
  const [resolution, setResolution] = useState('4k');
  const [showAspectRatios, setShowAspectRatios] = useState(false);
  const [showResolutions, setShowResolutions] = useState(false);
  const [showMobileCountControls, setShowMobileCountControls] = useState(false);
  const [closingMobileCountControls, setClosingMobileCountControls] = useState(false);
  const [closingMobileResolutions, setClosingMobileResolutions] = useState(false);
  const [closingMobileAspectRatios, setClosingMobileAspectRatios] = useState(false);
  const [mobileSettingsClosing, setMobileSettingsClosing] = useState(false);
  const [showAiCompanies, setShowAiCompanies] = useState(false);
  const [desktopAiCompaniesClosing, setDesktopAiCompaniesClosing] = useState(false);
  const [desktopAiCompaniesMode, setDesktopAiCompaniesMode] = useState<'all' | 'selected'>('all');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [closingCompanyModels, setClosingCompanyModels] = useState<string | null>(null);
  const [showDesktopModelControls, setShowDesktopModelControls] = useState(false);
  const [desktopModelControlsClosing, setDesktopModelControlsClosing] = useState(false);
  const [desktopModelControlsView, setDesktopModelControlsView] = useState<'companies' | 'models'>('companies');
  const [desktopModelControlsClosingView, setDesktopModelControlsClosingView] = useState<'companies' | 'models'>('companies');
  const [desktopModelActiveCompany, setDesktopModelActiveCompany] = useState<string | null>(null);
  const [desktopModelCompaniesVisible, setDesktopModelCompaniesVisible] = useState(false);
  const [desktopModelOptionsVisible, setDesktopModelOptionsVisible] = useState(false);
  const [desktopModelCompanyMorph, setDesktopModelCompanyMorph] = useState<string | null>(null);
  const [desktopModelSelectMorph, setDesktopModelSelectMorph] = useState<string | null>(null);
  const desktopModelLabelRef = useRef<HTMLButtonElement | null>(null);
  const [desktopModelTransitionInFlight, setDesktopModelTransitionInFlight] = useState(false);
  const [hoveredModel, setHoveredModel] = useState<ModelDetails | null>(null);
  const modelHoverTimeoutRef = useRef<number | null>(null);
  const modelHoverLockUntilRef = useRef<number>(0);
const mobileSettingsCloseTimeoutRef = useRef<number | null>(null);
const mobileCountControlsCloseTimeoutRef = useRef<number | null>(null);
const mobileResolutionsCloseTimeoutRef = useRef<number | null>(null);
const mobileAspectRatiosCloseTimeoutRef = useRef<number | null>(null);
const mobileSearchCloseTimeoutRef = useRef<number | null>(null);
const desktopSearchCloseTimeoutRef = useRef<number | null>(null);
const desktopSettingsCloseTimeoutRef = useRef<number | null>(null);
const desktopModelControlsCloseTimeoutRef = useRef<number | null>(null);
const desktopAspectOptionsRevealTimeoutRef = useRef<number | null>(null);
const desktopResolutionOptionsRevealTimeoutRef = useRef<number | null>(null);
const desktopModelCompaniesRevealTimeoutRef = useRef<number | null>(null);
const desktopModelOptionsRevealTimeoutRef = useRef<number | null>(null);
const desktopModelCompanyMorphTimeoutRef = useRef<number | null>(null);
const desktopModelCompanyMorphFrameRef = useRef<number | null>(null);
const DESKTOP_MODEL_COMPANY_SHIFT_MS = 280;
const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
const mobilePromptContainerRef = useRef<HTMLDivElement | null>(null);
const mobilePromptInputRef = useRef<HTMLTextAreaElement | null>(null);
const mobilePromptClosingLockRef = useRef<number | null>(null);
  const clearModelHoverState = useCallback(() => {
    if (modelHoverTimeoutRef.current) { window.clearTimeout(modelHoverTimeoutRef.current); modelHoverTimeoutRef.current = null; }
    setHoveredModel(null);
  }, []);
  const lockModelHover = useCallback((ms = 180) => {
    modelHoverLockUntilRef.current = Date.now() + ms;
    clearModelHoverState();
  }, [clearModelHoverState]);
  const clearDesktopModelSharedTransition = useCallback(() => {
    if (desktopModelCompanyMorphTimeoutRef.current) {
      window.clearTimeout(desktopModelCompanyMorphTimeoutRef.current);
      desktopModelCompanyMorphTimeoutRef.current = null;
    }
    if (desktopModelCompanyMorphFrameRef.current) {
      window.cancelAnimationFrame(desktopModelCompanyMorphFrameRef.current);
      desktopModelCompanyMorphFrameRef.current = null;
    }
    setDesktopModelCompanyMorph(null);
    setDesktopModelTransitionInFlight(false);
  }, []);
  const clearDesktopModelControlTimers = useCallback(() => {
    if (desktopModelControlsCloseTimeoutRef.current) {
      window.clearTimeout(desktopModelControlsCloseTimeoutRef.current);
      desktopModelControlsCloseTimeoutRef.current = null;
    }
    if (desktopModelCompaniesRevealTimeoutRef.current) {
      window.clearTimeout(desktopModelCompaniesRevealTimeoutRef.current);
      desktopModelCompaniesRevealTimeoutRef.current = null;
    }
    if (desktopModelOptionsRevealTimeoutRef.current) {
      window.clearTimeout(desktopModelOptionsRevealTimeoutRef.current);
      desktopModelOptionsRevealTimeoutRef.current = null;
    }
  }, []);
  const hideDesktopModelControlsImmediate = useCallback(() => {
    clearDesktopModelControlTimers();
    clearDesktopModelSharedTransition();
    clearModelHoverState();
    setShowDesktopModelControls(false);
    setDesktopModelControlsClosing(false);
    setDesktopModelControlsView('companies');
    setDesktopModelControlsClosingView('companies');
    setDesktopModelActiveCompany(null);
    setDesktopModelCompaniesVisible(false);
    setDesktopModelOptionsVisible(false);
  }, [clearDesktopModelControlTimers, clearDesktopModelSharedTransition, clearModelHoverState]);
  const openDesktopModelCompanies = useCallback(() => {
    clearDesktopModelControlTimers();
    clearDesktopModelSharedTransition();
    clearModelHoverState();
    setDesktopModelControlsClosing(false);
    setDesktopModelControlsClosingView('companies');
    setDesktopModelActiveCompany(null);
    setDesktopModelOptionsVisible(false);
    setShowDesktopModelControls(true);
    setDesktopModelControlsView('companies');
  }, [clearDesktopModelControlTimers, clearDesktopModelSharedTransition, clearModelHoverState]);
  const setDesktopModelOptionsState = useCallback((companyName: string) => {
    clearDesktopModelControlTimers();
    clearDesktopModelSharedTransition();
    clearModelHoverState();
    setDesktopModelControlsClosing(false);
    setDesktopModelControlsClosingView('models');
    setDesktopModelCompaniesVisible(false);
    setDesktopModelActiveCompany(companyName);
    setShowDesktopModelControls(true);
    setDesktopModelControlsView('models');
  }, [clearDesktopModelControlTimers, clearDesktopModelSharedTransition, clearModelHoverState]);
  const openDesktopModelOptions = useCallback((companyName: string) => {
    setDesktopModelOptionsState(companyName);
  }, [setDesktopModelOptionsState]);
  const morphDesktopCompanyIntoRoot = useCallback((companyName: string, sourceButton: HTMLButtonElement) => {
    if (desktopModelTransitionInFlight) return;

    const rootEl = desktopModelRootButtonRef.current;
    if (!rootEl) return;

    const rootRect = rootEl.getBoundingClientRect();
    const sourceRect = sourceButton.getBoundingClientRect();
    const deltaX = sourceRect.left - rootRect.left;

    clearDesktopModelControlTimers();
    clearDesktopModelSharedTransition();
    clearModelHoverState();
    setDesktopModelControlsClosing(false);
    setDesktopModelControlsClosingView('models');
    setDesktopModelActiveCompany(null);
    setShowDesktopModelControls(true);
    setDesktopModelControlsView('companies');
    setDesktopModelCompaniesVisible(true);
    setDesktopModelOptionsVisible(false);
    setDesktopModelTransitionInFlight(true);
    setDesktopModelCompanyMorph(companyName);

    // Animate the clicked chip directly via Web Animations API
    const chipWrapper = sourceButton.parentElement;
    const finishMorph = () => {
      setDesktopModelControlsClosing(false);
      setDesktopModelControlsClosingView('models');
      setDesktopModelActiveCompany(companyName);
      setShowDesktopModelControls(true);
      setDesktopModelControlsView('models');
      setDesktopModelCompaniesVisible(false);
      setDesktopModelOptionsVisible(false);
      setDesktopModelCompanyMorph(null);
      setDesktopModelTransitionInFlight(false);
      desktopModelCompanyMorphTimeoutRef.current = null;
    };

    if (chipWrapper) {
      chipWrapper.style.zIndex = '10';
      const anim = chipWrapper.animate(
        [
          { transform: 'translateX(0px)' },
          { transform: `translateX(-${deltaX}px)` },
        ],
        {
          duration: DESKTOP_MODEL_COMPANY_SHIFT_MS,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards',
        },
      );
      anim.finished.then(finishMorph).catch(finishMorph);
    } else {
      desktopModelCompanyMorphTimeoutRef.current = window.setTimeout(finishMorph, DESKTOP_MODEL_COMPANY_SHIFT_MS);
    }
  }, [
    DESKTOP_MODEL_COMPANY_SHIFT_MS,
    clearDesktopModelControlTimers,
    clearDesktopModelSharedTransition,
    clearModelHoverState,
    desktopModelTransitionInFlight,
  ]);
  const handleModelHoverEnter = useCallback((model: ModelDetails) => {
    if (Date.now() < modelHoverLockUntilRef.current) return;
    if (modelHoverTimeoutRef.current) window.clearTimeout(modelHoverTimeoutRef.current);
    modelHoverTimeoutRef.current = window.setTimeout(() => { setHoveredModel(model); modelHoverTimeoutRef.current = null; }, 700);
  }, []);
  const handleModelHoverLeave = useCallback(() => { clearModelHoverState(); }, [clearModelHoverState]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const selectedModelCompany = useMemo(
    () => aiCompanies.find((company) => company.models.some((model) => model.name === selectedModel)) ?? null,
    [selectedModel]
  );
  const showDesktopModelPanel = showDesktopModelControls || desktopModelControlsClosing;
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const activeUploadedImage = useMemo(
    () => uploadedImages.find((img) => img.id === activeImageId) ?? null,
    [uploadedImages, activeImageId]
  );
  const [mobilePromptExpanded, setMobilePromptExpanded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animatingStars, setAnimatingStars] = useState<Set<string>>(new Set());
  const [animatingFavButton, setAnimatingFavButton] = useState(false);
  const [animatingHistoryButton, setAnimatingHistoryButton] = useState(false);
  const [animatingSettingsButton, setAnimatingSettingsButton] = useState(false);
  // Tools state
  const [showTools, setShowTools] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [selectedTool, setSelectedTool] = useState<'variations' | null>(null);
  const [selectedVariationMode, setSelectedVariationMode] = useState<'reframe' | 'storyboard' | 'custom' | null>(null);
  // Mobile selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImageKeys, setSelectedImageKeys] = useState<Set<string>>(new Set());
  const [selectionActionFeedback, setSelectionActionFeedback] = useState<string | null>(null);
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);

  // Image viewer modal state
const [viewingImage, setViewingImage] = useState<{
  generationId: string;
  imageIndex: number;
} | null>(null);
const [showDetailsOverlay, setShowDetailsOverlay] = useState(false);
const [showMobileViewerMenu, setShowMobileViewerMenu] = useState(false);
const [mobileViewerMenuView, setMobileViewerMenuView] = useState<'root' | 'collage'>('root');
const [mobileViewerPromptExpanded, setMobileViewerPromptExpanded] = useState(false);
  const [desktopAspectRatioDropdownStyle, setDesktopAspectRatioDropdownStyle] = useState<React.CSSProperties>({});
  const [mobileAspectRatioDropdownStyle, setMobileAspectRatioDropdownStyle] = useState<React.CSSProperties>({});
  // Store the settings used for the current generation (frozen at generation start)
  const [generatingSettings, setGeneratingSettings] = useState<{
    prompt: string;
    count: number;
    aspectRatio: string;
    resolution: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAnimatedRef = useRef(false);
  const loadedImageUrlsRef = useRef<Set<string>>(new Set());
  const [collages, setCollages] = useState<Collage[]>([]);
  const [expandedCollageId, setExpandedCollageId] = useState<string | null>(null);
  const [isEditingCollageName, setIsEditingCollageName] = useState(false);
  const collageNameInputRef = useRef<HTMLInputElement>(null);
  const [inlineRenamingCollageId, setInlineRenamingCollageId] = useState<string | null>(null);
  const inlineRenameInputRef = useRef<HTMLInputElement>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [promptDropHover, setPromptDropHover] = useState(false);
  const desktopPromptContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopModelControlsRef = useRef<HTMLDivElement | null>(null);
  const desktopModelRootButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopSettingsButtonRef = useRef<HTMLDivElement | null>(null);
  const desktopSelectedResolutionButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopLeadingResolutionButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopSearchSlotRef = useRef<HTMLDivElement | null>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopLibrarySearchWidth, setDesktopLibrarySearchWidth] = useState(48);
  const [desktopSelectedResolutionButtonWidth, setDesktopSelectedResolutionButtonWidth] = useState(48);
  const [desktopLeadingResolutionButtonWidth, setDesktopLeadingResolutionButtonWidth] = useState(0);
  const [desktopPromptCollisionLimit, setDesktopPromptCollisionLimit] = useState<number | null>(null);
  const [ingredientImages, setIngredientImages] = useState<{ id: string; url: string }[]>([]);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [gallerySearchQuery, setGallerySearchQuery] = useState('');
  const [showGallerySearch, setShowGallerySearch] = useState(false);
  const [hoveredRefImage, setHoveredRefImage] = useState<{ url: string; rect: DOMRect } | null>(null);
  const mobileViewerTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Prompt drop zone for @dnd-kit (gallery image drag-to-prompt)
  const { setNodeRef: promptDropRef, isOver: isDndOverPrompt } = useDroppable({ id: 'prompt-drop-zone' });
  const [pointerOverPrompt, setPointerOverPrompt] = useState(false);
  const [isExternalDragActive, setIsExternalDragActive] = useState(false);
  // Combined drop state: dnd-kit hover OR native HTML drag hover OR pointer-based hover
  const isAnyDropHover = promptDropHover || isDndOverPrompt || pointerOverPrompt;
  // Hint state: a drag is active anywhere (gallery or external file from PC)
  const isDragActive = !!activeDragId || isExternalDragActive;

  // Track pointer over prompt during @dnd-kit drags (fallback for collision detection)
  useEffect(() => {
    if (!activeDragId) { setPointerOverPrompt(false); return; }
    const onPointerMove = (e: PointerEvent) => {
      const el = desktopPromptContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      setPointerOverPrompt(over);
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => { window.removeEventListener('pointermove', onPointerMove); setPointerOverPrompt(false); };
  }, [activeDragId]);

  // Detect external file drags into the browser window (PC/laptop files)
  useEffect(() => {
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        dragCounter++;
        setIsExternalDragActive(true);
      }
    };
    const onDragLeave = () => {
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; setIsExternalDragActive(false); }
    };
    const onDrop = () => { dragCounter = 0; setIsExternalDragActive(false); };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // History state - SINGLE SOURCE OF TRUTH (no local copy needed)
  // Initialize from URL params to persist view on refresh
  const [showHistory, setShowHistory] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'history' || params.get('view') === 'favorites';
  });
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [viewportHeight, setViewportHeight] = useState(() => typeof window !== 'undefined' ? window.innerHeight : 800);
  const MOBILE_INLINE_STAGGER_MS = 45;
  const MOBILE_INLINE_DURATION_MS = 220;
  const MOBILE_INLINE_OPEN_DURATION_MS = 280;
  const COMPANY_MODEL_CLOSE_DURATION_MS = 180;
  const DESKTOP_SETTINGS_STAGGER_MS = 70;
  const DESKTOP_SETTINGS_DURATION_MS = 220;
  const DESKTOP_ASPECT_OPTIONS_REVEAL_DELAY_MS = 280;
  const DESKTOP_RESOLUTION_OPTIONS_REVEAL_DELAY_MS = 180;
  const DESKTOP_SETTINGS_BASE_GAP_PX = 6;
  const DESKTOP_MODEL_COMPANIES_REVEAL_DELAY_MS = 40;
  const DESKTOP_MODEL_OPTIONS_REVEAL_DELAY_MS = 180;
  const getCompanyModelCloseMs = (itemCount: number) =>
    COMPANY_MODEL_CLOSE_DURATION_MS + MOBILE_INLINE_STAGGER_MS * Math.max(itemCount - 1, 0);
  const getDesktopSettingsCloseMs = (itemCount: number) =>
    DESKTOP_SETTINGS_DURATION_MS + DESKTOP_SETTINGS_STAGGER_MS * Math.max(itemCount - 1, 0);
  const getDesktopModelCloseMs = (itemCount: number) =>
    DESKTOP_SETTINGS_DURATION_MS + DESKTOP_SETTINGS_STAGGER_MS * Math.max(itemCount - 1, 0);
  const getSettingsInlineAnimation = (isClosing: boolean, index: number, total: number) =>
    `${isClosing ? 'mobileInlineItemFadeOut' : 'mobileInlineItemFadeIn'} ${isClosing ? MOBILE_INLINE_DURATION_MS : MOBILE_INLINE_OPEN_DURATION_MS}ms ${isClosing ? 'ease-in' : 'ease-out'} ${(total - 1 - index) * MOBILE_INLINE_STAGGER_MS}ms both`;
  const isMobilePromptCloseLocked = () =>
    mobilePromptClosingLockRef.current !== null && mobilePromptClosingLockRef.current > Date.now();
  const isMobileLandscape = isMobile && viewportWidth > viewportHeight;
  const mobilePromptCollapsedHeight = uploadedImages.length > 0 ? 88 : 40;
  const mobilePromptExpandedHeight = uploadedImages.length > 0
    ? (isMobileLandscape ? 120 : 136)
    : (isMobileLandscape ? 88 : 104);
  const mobilePromptInnerHeight = uploadedImages.length > 0
    ? (mobilePromptExpanded ? (isMobileLandscape ? 56 : 72) : 40)
    : (mobilePromptExpanded ? (isMobileLandscape ? 56 : 72) : 40);
  const shouldFadeMobileReferenceTray =
    selectedCompany !== null ||
    closingCompanyModels !== null ||
    showMobileCountControls ||
    closingMobileCountControls ||
    showResolutions ||
    closingMobileResolutions ||
    showAspectRatios ||
    closingMobileAspectRatios;
  useEffect(() => {
    if (!mobilePromptExpanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (mobilePromptContainerRef.current?.contains(target)) return;
      mobilePromptClosingLockRef.current = Date.now() + 260;
      setMobilePromptExpanded(false);
      mobilePromptInputRef.current?.blur();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [mobilePromptExpanded]);
  const closeMobileSettings = useCallback(() => {
    if (mobileSettingsCloseTimeoutRef.current) {
      window.clearTimeout(mobileSettingsCloseTimeoutRef.current);
      mobileSettingsCloseTimeoutRef.current = null;
    }
    if (isMobile && showSettings) {
      setMobileSettingsClosing(true);
      setShowSettings(false);
      mobileSettingsCloseTimeoutRef.current = window.setTimeout(() => {
        setMobileSettingsClosing(false);
        mobileSettingsCloseTimeoutRef.current = null;
      }, 260);
      return;
    }
    setShowSettings(false);
    setMobileSettingsClosing(false);
  }, [isMobile, showSettings]);
  const closeMobileGallerySearch = useCallback(() => {
    if (mobileSearchCloseTimeoutRef.current) {
      window.clearTimeout(mobileSearchCloseTimeoutRef.current);
      mobileSearchCloseTimeoutRef.current = null;
    }
    setShowGallerySearch(false);
    mobileSearchCloseTimeoutRef.current = window.setTimeout(() => {
      setGallerySearchQuery('');
      mobileSearchCloseTimeoutRef.current = null;
    }, 240);
  }, []);
  const closeDesktopGallerySearch = useCallback(() => {
    if (desktopSearchCloseTimeoutRef.current) {
      window.clearTimeout(desktopSearchCloseTimeoutRef.current);
      desktopSearchCloseTimeoutRef.current = null;
    }
    setShowGallerySearch(false);
    desktopSearchCloseTimeoutRef.current = window.setTimeout(() => {
      setGallerySearchQuery('');
      desktopSearchCloseTimeoutRef.current = null;
    }, 220);
  }, []);
  const closeMobileCountControlsAnimated = useCallback(() => {
    if (mobileCountControlsCloseTimeoutRef.current) {
      window.clearTimeout(mobileCountControlsCloseTimeoutRef.current);
      mobileCountControlsCloseTimeoutRef.current = null;
    }
    if (showMobileCountControls) {
      setClosingMobileCountControls(true);
      setShowMobileCountControls(false);
      mobileCountControlsCloseTimeoutRef.current = window.setTimeout(() => {
        setClosingMobileCountControls(false);
        mobileCountControlsCloseTimeoutRef.current = null;
      }, MOBILE_INLINE_DURATION_MS + MOBILE_INLINE_STAGGER_MS * 2);
      return;
    }
    setClosingMobileCountControls(false);
  }, [showMobileCountControls]);
  const closeMobileResolutionsAnimated = useCallback(() => {
    if (mobileResolutionsCloseTimeoutRef.current) {
      window.clearTimeout(mobileResolutionsCloseTimeoutRef.current);
      mobileResolutionsCloseTimeoutRef.current = null;
    }
    if (showResolutions) {
      setClosingMobileResolutions(true);
      setShowResolutions(false);
      mobileResolutionsCloseTimeoutRef.current = window.setTimeout(() => {
        setClosingMobileResolutions(false);
        mobileResolutionsCloseTimeoutRef.current = null;
      }, MOBILE_INLINE_DURATION_MS + MOBILE_INLINE_STAGGER_MS * 2);
      return;
    }
    setClosingMobileResolutions(false);
  }, [showResolutions]);
  const closeMobileAspectRatiosAnimated = useCallback(() => {
    if (mobileAspectRatiosCloseTimeoutRef.current) {
      window.clearTimeout(mobileAspectRatiosCloseTimeoutRef.current);
      mobileAspectRatiosCloseTimeoutRef.current = null;
    }
    if (showAspectRatios) {
      setClosingMobileAspectRatios(true);
      setShowAspectRatios(false);
      mobileAspectRatiosCloseTimeoutRef.current = window.setTimeout(() => {
        setClosingMobileAspectRatios(false);
        mobileAspectRatiosCloseTimeoutRef.current = null;
      }, MOBILE_INLINE_DURATION_MS + MOBILE_INLINE_STAGGER_MS * 10);
      return;
    }
    setClosingMobileAspectRatios(false);
  }, [showAspectRatios]);
  const closeDesktopModelControls = useCallback(() => {
    if (desktopModelTransitionInFlight) return;
    clearDesktopModelControlTimers();
    clearDesktopModelSharedTransition();
    clearModelHoverState();
    if (!showDesktopModelControls && !desktopModelControlsClosing) return;
    const closingView = desktopModelControlsClosing ? desktopModelControlsClosingView : desktopModelControlsView;
    const activeCompany = desktopModelActiveCompany
      ? aiCompanies.find((company) => company.name === desktopModelActiveCompany) ?? null
      : null;
    const visibleCount = closingView === 'models'
      ? 1 + (activeCompany?.models.length ?? 0)
      : aiCompanies.length;
    setDesktopModelControlsClosingView(closingView);
    setDesktopModelControlsClosing(true);
    setShowDesktopModelControls(false);
    desktopModelControlsCloseTimeoutRef.current = window.setTimeout(() => {
      setDesktopModelControlsView('companies');
      setDesktopModelControlsClosingView('companies');
      setDesktopModelControlsClosing(false);
      setDesktopModelActiveCompany(null);
      setDesktopModelCompaniesVisible(false);
      setDesktopModelOptionsVisible(false);
      desktopModelControlsCloseTimeoutRef.current = null;
    }, getDesktopModelCloseMs(visibleCount));
  }, [
    clearDesktopModelControlTimers,
    clearDesktopModelSharedTransition,
    clearModelHoverState,
    desktopModelTransitionInFlight,
    desktopModelActiveCompany,
    desktopModelControlsClosing,
    desktopModelControlsClosingView,
    desktopModelControlsView,
    showDesktopModelControls,
  ]);
  function closeDesktopSettings() {
      if (desktopSettingsCloseTimeoutRef.current) {
        window.clearTimeout(desktopSettingsCloseTimeoutRef.current);
        desktopSettingsCloseTimeoutRef.current = null;
      }
      if (desktopAspectOptionsRevealTimeoutRef.current) {
        window.clearTimeout(desktopAspectOptionsRevealTimeoutRef.current);
        desktopAspectOptionsRevealTimeoutRef.current = null;
      }
      if (desktopResolutionOptionsRevealTimeoutRef.current) {
        window.clearTimeout(desktopResolutionOptionsRevealTimeoutRef.current);
        desktopResolutionOptionsRevealTimeoutRef.current = null;
      }
    if (!showSettings && !desktopSettingsClosing) return;
    const closingView: 'default' | 'resolutions' | 'aspects' = desktopSettingsClosing
      ? desktopSettingsClosingView
      : desktopSettingsView;
    const supportedResolutionCount = desktopResolutionOptionsVisible ? resolutions.filter((res) => {
      if (res.value === resolution) return false;
      if (!currentModelCapabilities) return true;
      if (currentModelCapabilities.supportedResolutions.length === 0) return true;
      return currentModelCapabilities.supportedResolutions.includes(res.value);
    }).length : 0;
    const supportedAspectRatioCount = desktopAspectOptionsVisible ? aspectRatios.filter((ratioOption) => {
      if (!allowedAspectRatioValues.has(ratioOption.value)) return false;
      if (ratioOption.value === aspectRatio) return false;
      if (!currentModelCapabilities) return true;
      if (currentModelCapabilities.supportedAspectRatios.length === 0) return true;
      return currentModelCapabilities.supportedAspectRatios.includes(ratioOption.value);
    }).length : 0;
    const visibleCount = closingView === 'resolutions'
      ? 1 + supportedResolutionCount
      : closingView === 'aspects'
        ? 1 + supportedAspectRatioCount
      : 3;
      setDesktopSettingsClosingView(closingView);
      setDesktopSettingsClosing(true);
      setShowSettings(false);
      desktopSettingsCloseTimeoutRef.current = window.setTimeout(() => {
        setDesktopSettingsView('default');
        setDesktopAspectOptionsVisible(false);
        setDesktopResolutionOptionsVisible(false);
        setDesktopSettingsClosing(false);
        desktopSettingsCloseTimeoutRef.current = null;
      }, getDesktopSettingsCloseMs(visibleCount));
    }
  const isViewportConstrained = !isMobile && viewportWidth < 1280;
  const desktopPromptMaxWidth = useMemo(() => {
    const fluidWidth = Math.round(viewportWidth * (isViewportConstrained ? 0.46 : 0.52));
    let maxWidth = Math.max(360, Math.min(835, fluidWidth));
    // Single shrink — prompt shrinks once when either models or search opens.
    // Opening the second one does NOT cause additional shrink.
    const shrinkScale = isViewportConstrained ? Math.max(0.6, (1280 - viewportWidth) / 500) : 0;
    const needsShrink = (showDesktopModelPanel || showGallerySearch) && isViewportConstrained;
    const shrink = needsShrink ? Math.round(72 + 80 * shrinkScale) : 0;
    maxWidth -= shrink;
    const collisionCapped = Math.min(maxWidth, desktopPromptCollisionLimit ?? maxWidth);
    return Math.max(200, collisionCapped);
  }, [viewportWidth, isViewportConstrained, showDesktopModelPanel, showGallerySearch, desktopPromptCollisionLimit]);

  // Track viewport state for responsive header behavior
  useEffect(() => {
    const updateSize = () => {
      setIsMobile(window.innerWidth < 768);
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    const onResize = () => {
      updateSize();
      // Auto-close model flyout and search only on actual resize, not on state change
      const width = window.innerWidth;
      if (width >= 768 && width < 960) {
        hideDesktopModelControlsImmediate();
        setShowGallerySearch(false);
        setGallerySearchQuery('');
      }
    };
    updateSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hideDesktopModelControlsImmediate]);

  // Click outside to close desktop model controls
  useEffect(() => {
    if (isMobile) return;
    if (!showDesktopModelControls) return;
    const handleClickOutside = (e: MouseEvent) => {
      const modelControls = desktopModelControlsRef.current;
      const target = e.target as Node;
      if (modelControls && !modelControls.contains(target)) {
        // Also check if click is inside the popout panel (company/model chips)
        const popout = (target as Element).closest?.('[data-desktop-header-popout]');
        if (popout) return;
        closeDesktopModelControls();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeDesktopModelControls, isMobile, showDesktopModelControls]);
  // Measure available width for search bar + prompt collision limit
  useEffect(() => {
    if (isMobile) return;
    // Reset collision limit so it can grow when viewport expands
    setDesktopPromptCollisionLimit(null);
    const flexGapPx = viewportWidth >= 1024 ? 12 : 8;
    const safetyGap = 16;

    // Collision measurement — updates prompt collision limit.
    const measureCollision = () => {
      const modelNode = desktopModelControlsRef.current;
      const promptRect = desktopPromptContainerRef.current?.getBoundingClientRect();
      if (!promptRect) return;
      let limit = Infinity;
      if (modelNode) {
        let leftOccupiedRight = modelNode.getBoundingClientRect().right;
        const openPopouts = modelNode.querySelectorAll<HTMLElement>('[data-desktop-header-popout="true"]');
        openPopouts.forEach((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) leftOccupiedRight = Math.max(leftOccupiedRight, rect.right);
        });
        const promptCenter = (promptRect.left + promptRect.right) / 2;
        const leftLimit = Math.floor(2 * (promptCenter - leftOccupiedRight - safetyGap));
        limit = Math.min(limit, leftLimit);
      }
      // Right-side collision (search bar) is not needed — computeSearchWidth
      // already predictively sizes the search bar to fit the available space.
      if (limit < Infinity) {
        setDesktopPromptCollisionLimit(Math.max(180, limit));
      }
    };

    // Predictive search width — computes the search bar target from the prompt's
    // FINAL width (desktopPromptMaxWidth) instead of its current DOM position.
    const computeSearchWidth = () => {
      const parentRow = desktopPromptContainerRef.current?.parentElement;
      const settingsRect = desktopSettingsButtonRef.current?.getBoundingClientRect();
      if (!parentRow || !settingsRect) return;
      const parentRect = parentRow.getBoundingClientRect();
      const parentCenter = parentRect.left + parentRect.width / 2;
      // Prompt's predicted right edge after its transition completes
      const predictedPromptRight = parentCenter + desktopPromptMaxWidth / 2;
      // Available = total space minus two equal gaps (prompt-to-search and search-to-settings)
      const available = settingsRect.left - predictedPromptRight - flexGapPx * 2;
      setDesktopLibrarySearchWidth(Math.max(40, available));
    };

    // Full measurement — both collision + search width. Used for resize events.
    const measureAll = () => { measureCollision(); computeSearchWidth(); };

    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const debouncedMeasure = () => { if (debounceId) clearTimeout(debounceId); debounceId = setTimeout(measureAll, 60); };

    // Search width computed immediately from predicted prompt position — no waiting
    computeSearchWidth();
    // Collision limits measured at multiple points to catch animations settling
    measureCollision();
    const t1 = setTimeout(measureCollision, 50);
    const t2 = setTimeout(measureCollision, 150);
    const t3 = setTimeout(measureCollision, 350);
    const t4 = showDesktopModelPanel ? setTimeout(measureAll, 600) : null;
    window.addEventListener('resize', debouncedMeasure);
    return () => { window.removeEventListener('resize', debouncedMeasure); if (debounceId) clearTimeout(debounceId); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); if (t4) clearTimeout(t4); };
  }, [desktopModelActiveCompany, desktopModelControlsClosing, desktopModelControlsView, isMobile, viewportWidth, showDesktopModelPanel, showGallerySearch, selectedModel, desktopPromptMaxWidth]);

  // Track scroll position for header background
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close settings when clicking outside
  useEffect(() => {
    if (isMobile) return;
    if (!showSettings) return;
    const handleClickOutside = (e: MouseEvent) => {
      const settingsBtn = desktopSettingsButtonRef.current;
      const settingsPanel = document.querySelector('[data-settings-panel]');
      const target = e.target as Node;
      if (settingsBtn && !settingsBtn.contains(target) && (!settingsPanel || !settingsPanel.contains(target))) {
        closeDesktopSettings();
      }
    };
    // Delay to avoid closing immediately from the same click that opened it
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 10);
    return () => { clearTimeout(timer); window.removeEventListener('click', handleClickOutside); };
  }, [closeDesktopSettings, isMobile, showSettings]);

  useEffect(() => {
    if (!showGallerySearch) return;
    if (isMobile) {
      if (mobileSearchCloseTimeoutRef.current) {
        window.clearTimeout(mobileSearchCloseTimeoutRef.current);
        mobileSearchCloseTimeoutRef.current = null;
      }
    } else if (desktopSearchCloseTimeoutRef.current) {
      window.clearTimeout(desktopSearchCloseTimeoutRef.current);
      desktopSearchCloseTimeoutRef.current = null;
    }
    const focusId = window.requestAnimationFrame(() => {
      if (isMobile) {
        mobileSearchInputRef.current?.focus();
      } else {
        desktopSearchInputRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(focusId);
  }, [isMobile, showGallerySearch]);

  // Click outside to close desktop gallery search
  useEffect(() => {
    if (isMobile) return;
    if (!showGallerySearch) return;
    const handleClickOutside = (e: MouseEvent) => {
      const searchSlot = desktopSearchSlotRef.current;
      const target = e.target as Node;
      if (searchSlot && !searchSlot.contains(target)) {
        closeDesktopGallerySearch();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeDesktopGallerySearch, isMobile, showGallerySearch]);

  useEffect(() => {
    if (isMobile) return;
    const measureSelectedResolutionButton = () => {
      const selectedWidth = desktopSelectedResolutionButtonRef.current?.getBoundingClientRect().width;
      if (selectedWidth) {
        setDesktopSelectedResolutionButtonWidth(Math.ceil(selectedWidth));
      }
      const leadingWidth = desktopLeadingResolutionButtonRef.current?.getBoundingClientRect().width;
      if (leadingWidth) {
        setDesktopLeadingResolutionButtonWidth(Math.ceil(leadingWidth));
      } else {
        setDesktopLeadingResolutionButtonWidth(0);
      }
    };
    const frameId = window.requestAnimationFrame(measureSelectedResolutionButton);
    window.addEventListener('resize', measureSelectedResolutionButton);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', measureSelectedResolutionButton);
    };
  }, [desktopSettingsClosing, desktopSettingsView, isMobile, resolution, showSettings]);

  useEffect(() => {
    if (showSettings || desktopSettingsClosing) return;
    setShowResolutions(false);
    setShowAspectRatios(false);
    setDesktopSettingsView('default');
    setDesktopAspectOptionsVisible(false);
    setDesktopResolutionOptionsVisible(false);
    setShowMobileCountControls(false);
    setClosingMobileResolutions(false);
    setClosingMobileAspectRatios(false);
    setClosingMobileCountControls(false);
  }, [desktopSettingsClosing, showSettings]);

  useEffect(() => {
    if (desktopAspectOptionsRevealTimeoutRef.current) {
      window.clearTimeout(desktopAspectOptionsRevealTimeoutRef.current);
      desktopAspectOptionsRevealTimeoutRef.current = null;
    }

    if (desktopSettingsView !== 'aspects') {
      setDesktopAspectOptionsVisible(false);
      return;
    }

    setDesktopAspectOptionsVisible(false);
    desktopAspectOptionsRevealTimeoutRef.current = window.setTimeout(() => {
      setDesktopAspectOptionsVisible(true);
      desktopAspectOptionsRevealTimeoutRef.current = null;
    }, DESKTOP_ASPECT_OPTIONS_REVEAL_DELAY_MS);
  }, [DESKTOP_ASPECT_OPTIONS_REVEAL_DELAY_MS, desktopSettingsView]);

  useEffect(() => {
    if (desktopModelCompaniesRevealTimeoutRef.current) {
      window.clearTimeout(desktopModelCompaniesRevealTimeoutRef.current);
      desktopModelCompaniesRevealTimeoutRef.current = null;
    }
    if (desktopModelTransitionInFlight) {
      // Don't hide companies during morph — the animation needs them in the DOM
      return;
    }
    if (desktopModelControlsClosing) return;
    if (!showDesktopModelControls || desktopModelControlsView !== 'companies') {
      setDesktopModelCompaniesVisible(false);
      return;
    }
    setDesktopModelCompaniesVisible(false);
    desktopModelCompaniesRevealTimeoutRef.current = window.setTimeout(() => {
      setDesktopModelCompaniesVisible(true);
      desktopModelCompaniesRevealTimeoutRef.current = null;
    }, DESKTOP_MODEL_COMPANIES_REVEAL_DELAY_MS);
  }, [DESKTOP_MODEL_COMPANIES_REVEAL_DELAY_MS, desktopModelControlsClosing, desktopModelControlsView, desktopModelTransitionInFlight, showDesktopModelControls]);

  useEffect(() => {
    if (desktopModelOptionsRevealTimeoutRef.current) {
      window.clearTimeout(desktopModelOptionsRevealTimeoutRef.current);
      desktopModelOptionsRevealTimeoutRef.current = null;
    }
    if (desktopModelTransitionInFlight) {
      setDesktopModelOptionsVisible(false);
      return;
    }
    if (desktopModelControlsClosing) return;
    if (!showDesktopModelControls || desktopModelControlsView !== 'models') {
      setDesktopModelOptionsVisible(false);
      return;
    }
    setDesktopModelOptionsVisible(false);
    desktopModelOptionsRevealTimeoutRef.current = window.setTimeout(() => {
      setDesktopModelOptionsVisible(true);
      desktopModelOptionsRevealTimeoutRef.current = null;
    }, DESKTOP_MODEL_OPTIONS_REVEAL_DELAY_MS);
  }, [DESKTOP_MODEL_OPTIONS_REVEAL_DELAY_MS, desktopModelControlsClosing, desktopModelControlsView, desktopModelTransitionInFlight, showDesktopModelControls, desktopModelActiveCompany]);

  useEffect(() => {
    if (desktopResolutionOptionsRevealTimeoutRef.current) {
      window.clearTimeout(desktopResolutionOptionsRevealTimeoutRef.current);
      desktopResolutionOptionsRevealTimeoutRef.current = null;
    }

    if (desktopSettingsView !== 'resolutions') {
      setDesktopResolutionOptionsVisible(false);
      return;
    }

    setDesktopResolutionOptionsVisible(false);
    desktopResolutionOptionsRevealTimeoutRef.current = window.setTimeout(() => {
      setDesktopResolutionOptionsVisible(true);
      desktopResolutionOptionsRevealTimeoutRef.current = null;
    }, DESKTOP_RESOLUTION_OPTIONS_REVEAL_DELAY_MS);
  }, [DESKTOP_RESOLUTION_OPTIONS_REVEAL_DELAY_MS, desktopSettingsView]);

  useEffect(() => {
    return () => {
      if (mobileSettingsCloseTimeoutRef.current) {
        window.clearTimeout(mobileSettingsCloseTimeoutRef.current);
      }
      if (mobileCountControlsCloseTimeoutRef.current) {
        window.clearTimeout(mobileCountControlsCloseTimeoutRef.current);
      }
      if (mobileResolutionsCloseTimeoutRef.current) {
        window.clearTimeout(mobileResolutionsCloseTimeoutRef.current);
      }
      if (mobileAspectRatiosCloseTimeoutRef.current) {
        window.clearTimeout(mobileAspectRatiosCloseTimeoutRef.current);
      }
      if (mobileSearchCloseTimeoutRef.current) {
        window.clearTimeout(mobileSearchCloseTimeoutRef.current);
      }
      if (desktopSearchCloseTimeoutRef.current) {
        window.clearTimeout(desktopSearchCloseTimeoutRef.current);
      }
      if (desktopSettingsCloseTimeoutRef.current) {
        window.clearTimeout(desktopSettingsCloseTimeoutRef.current);
      }
      if (desktopModelControlsCloseTimeoutRef.current) {
        window.clearTimeout(desktopModelControlsCloseTimeoutRef.current);
      }
      if (desktopAspectOptionsRevealTimeoutRef.current) {
        window.clearTimeout(desktopAspectOptionsRevealTimeoutRef.current);
      }
      if (desktopResolutionOptionsRevealTimeoutRef.current) {
        window.clearTimeout(desktopResolutionOptionsRevealTimeoutRef.current);
      }
      if (desktopModelCompaniesRevealTimeoutRef.current) {
        window.clearTimeout(desktopModelCompaniesRevealTimeoutRef.current);
      }
      if (desktopModelOptionsRevealTimeoutRef.current) {
        window.clearTimeout(desktopModelOptionsRevealTimeoutRef.current);
      }
      if (desktopModelCompanyMorphTimeoutRef.current) {
        window.clearTimeout(desktopModelCompanyMorphTimeoutRef.current);
      }
      if (desktopModelCompanyMorphFrameRef.current) {
        window.cancelAnimationFrame(desktopModelCompanyMorphFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showAspectRatios) return;

    const viewportPadding = 12;
    const dropdownWidth = 192;
    const maxHeight = Math.max(220, window.innerHeight - viewportPadding * 2);

    const buildDropdownStyle = (node: HTMLElement | null): React.CSSProperties => {
      const baseStyle: React.CSSProperties = {
        width: `${Math.min(dropdownWidth, Math.max(0, window.innerWidth - viewportPadding * 2))}px`,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
        maxHeight: `${maxHeight}px`,
      };

      if (!node) {
        return baseStyle;
      }

      const rect = node.getBoundingClientRect();
      const resolvedWidth = Math.min(dropdownWidth, Math.max(0, window.innerWidth - viewportPadding * 2));
      const minShift = viewportPadding - rect.left;
      const maxShift = window.innerWidth - viewportPadding - (rect.left + resolvedWidth);
      const horizontalShift = maxShift < 0 ? maxShift : minShift > 0 ? minShift : 0;

      return {
        ...baseStyle,
        left: `${horizontalShift}px`,
      };
    };

    const updateDropdownPositions = () => {
      setDesktopAspectRatioDropdownStyle(buildDropdownStyle(desktopAspectRatioTriggerRef.current));
      setMobileAspectRatioDropdownStyle(buildDropdownStyle(mobileAspectRatioTriggerRef.current));
    };

    updateDropdownPositions();
    window.addEventListener('resize', updateDropdownPositions);
    window.addEventListener('scroll', updateDropdownPositions, true);

    return () => {
      window.removeEventListener('resize', updateDropdownPositions);
      window.removeEventListener('scroll', updateDropdownPositions, true);
    };
  }, [showAspectRatios]);

  // Track gallery width so row-justified layout can fill narrow viewports without right-side gaps.
  const {
    generations: dbGenerations,  // Generations from database (authenticated users)
    isLoading: isHistoryLoading,
    hasMore,
    favoritesOnly,
    saveGeneration,
    deleteGeneration,
    toggleFavorite,
    loadMore,
    setFavoritesOnly,
  } = useGenerationHistory();

  // Local generations state for non-authenticated users or immediate display
  const [localGenerations, setLocalGenerations] = useState<typeof dbGenerations>([]);
  const [hasSeededMockHistory, setHasSeededMockHistory] = useState(false);

  // Combine local and database generations (local first, then db)
  const generations = useMemo(() => [...localGenerations, ...dbGenerations], [localGenerations, dbGenerations]);

  const filteredGenerations = useMemo(() => {
    let filtered = generations;
    // When viewing favorites, filter to only favorited generations
    if (favoritesOnly) {
      filtered = filtered.filter(g => g.is_favorite);
    }
    if (gallerySearchQuery.trim()) {
      const q = gallerySearchQuery.toLowerCase();
      filtered = filtered.filter(g => g.prompt.toLowerCase().includes(q) || (g.model || '').toLowerCase().includes(q));
    }
    return filtered;
  }, [generations, gallerySearchQuery, favoritesOnly]);

  const libraryImages = useMemo(() => filteredGenerations.flatMap((gen) =>
    gen.image_urls.map((imageUrl, imageIndex) => ({
      key: `${gen.id}-${imageIndex}`,
      generation: gen,
      imageUrl,
      imageIndex,
    }))
  ), [filteredGenerations]);

  const collageImageKeys = useMemo(() => {
    const s = new Set<string>();
    collages.forEach(c => c.imageKeys.forEach(k => s.add(k)));
    return s;
  }, [collages]);
  const cardRadius = 8;
  const galleryGapPx = 12;
  const galleryMinItemWidthPx = 200;
  const galleryRowHeightPx = 240;
  const galleryMaxRowHeightPx = 300;
  const galleryContainerRef = useRef<HTMLDivElement | null>(null);
  const [galleryViewportWidth, setGalleryViewportWidth] = useState(0);
  type GalleryGridItem =
    | { key: string; kind: 'loading' }
    | { key: string; kind: 'image'; asset: (typeof libraryImages)[number] }
    | { key: string; kind: 'collage'; collage: Collage; assets: (typeof libraryImages)[number][] };
  const gridItems: GalleryGridItem[] = useMemo(() => {
    const loadingItems: GalleryGridItem[] = isGenerating && generatingSettings
      ? Array.from({ length: generatingSettings.count }, (_, index) => ({
          key: `loading-${index}`,
          kind: 'loading' as const,
        }))
      : [];

    // When viewing favorites, only show collages that are favorited
    const visibleCollages = favoritesOnly
      ? collages.filter(c => c.isFavorite)
      : collages;

    // Build the set of image keys that belong to visible collages
    const visibleCollageImageKeys = new Set<string>();
    visibleCollages.forEach(c => c.imageKeys.forEach(k => visibleCollageImageKeys.add(k)));

    // Build image items excluding those in visible collages
    const imageItems: GalleryGridItem[] = libraryImages
      .filter(a => !visibleCollageImageKeys.has(a.key))
      .map((asset) => ({
        key: asset.key,
        kind: 'image' as const,
        asset,
      }));

    // Build a full lookup of ALL library images (including those in collages) for resolving collage assets
    const allImagesByKey = new Map(libraryImages.map(a => [a.key, a]));

    // Insert collage tiles at natural position of their first image
    const result: GalleryGridItem[] = [...loadingItems];
    const collagesToInsert = visibleCollages.map(c => {
      const firstKey = c.imageKeys[0];
      const idx = libraryImages.findIndex(a => a.key === firstKey);
      const assets = c.imageKeys.map(k => allImagesByKey.get(k)).filter(Boolean) as (typeof libraryImages)[number][];
      return { collage: c, assets, firstIdx: idx >= 0 ? idx : Infinity };
    }).sort((a, b) => a.firstIdx - b.firstIdx);

    let imageIdx = 0;
    let collageIdx = 0;
    let globalImageIdx = 0;
    const imageItemKeys = new Set(imageItems.map(i => i.key));
    for (const asset of libraryImages) {
      while (collageIdx < collagesToInsert.length && collagesToInsert[collageIdx].firstIdx <= globalImageIdx) {
        const ci = collagesToInsert[collageIdx];
        result.push({ key: `collage-${ci.collage.id}`, kind: 'collage', collage: ci.collage, assets: ci.assets });
        collageIdx++;
      }
      if (imageItemKeys.has(asset.key)) {
        result.push(imageItems[imageIdx++]);
      }
      globalImageIdx++;
    }
    while (collageIdx < collagesToInsert.length) {
      const ci = collagesToInsert[collageIdx];
      result.push({ key: `collage-${ci.collage.id}`, kind: 'collage', collage: ci.collage, assets: ci.assets });
      collageIdx++;
    }

    return result;
  }, [isGenerating, generatingSettings, libraryImages, collages, collageImageKeys, favoritesOnly]);

  useEffect(() => {
    const node = galleryContainerRef.current;
    if (!node) return;

    let frameId = 0;
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const applyWidth = (width: number) => {
      const nextWidth = Math.max(0, Math.round(width / 4) * 4);
      setGalleryViewportWidth((previousWidth) => (
        previousWidth === nextWidth ? previousWidth : nextWidth
      ));
    };

    const updateWidth = () => { applyWidth(node.clientWidth); };
    updateWidth();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (debounceId !== null) clearTimeout(debounceId);
      cancelAnimationFrame(frameId);
      debounceId = setTimeout(() => {
        frameId = requestAnimationFrame(() => { applyWidth(entry.contentRect.width); });
      }, 80);
    });
    observer.observe(node);

    return () => {
      cancelAnimationFrame(frameId);
      if (debounceId !== null) clearTimeout(debounceId);
      observer.disconnect();
    };
  }, [showHistory, gridItems.length]);

  const galleryLayoutData = useMemo(() => {
    const itemLayout = new Map<string, { width: number; height: number }>();
    const renderedRows: Array<{ items: GalleryGridItem[]; rowHeight: number; knownSize: number }> = [];
    if (gridItems.length === 0) {
      return { itemLayout, renderedRows };
    }

    const effectiveWidth = galleryViewportWidth > 0 ? galleryViewportWidth : 1200;
    const targetRowHeight = Math.min(galleryRowHeightPx, galleryMaxRowHeightPx);
    const minJustifiedRowHeight = Math.max(150, targetRowHeight * 0.72);
    const minSparseRowHeight = 140;
    const rowEdgeTolerancePx = Math.max(18, Math.min(32, effectiveWidth * 0.03));
    const minFilledRowWidth = Math.max(0, effectiveWidth - rowEdgeTolerancePx);
    const targetColumns = Math.max(1, Math.floor((effectiveWidth + galleryGapPx) / (galleryMinItemWidthPx + galleryGapPx)));
    const defaultSlotWidth = Math.max(
      120,
      (effectiveWidth - galleryGapPx * Math.max(0, targetColumns - 1)) / targetColumns
    );

    const resolveAspect = (item: GalleryGridItem) => {
      if (item.kind === 'loading') {
        return Math.max(0.2, parseAspectRatioValue(generatingSettings?.aspectRatio || aspectRatio));
      }
      if (item.kind === 'collage') {
        return 1;
      }
      return Math.max(0.2, parseAspectRatioValue(item.asset.generation.aspect_ratio));
    };

    const getRowHeight = (row: Array<{ key: string; aspect: number }>) => {
      if (row.length === 0) return targetRowHeight;
      const aspectSum = row.reduce((sum, entry) => sum + entry.aspect, 0);
      const gapsWidth = galleryGapPx * Math.max(0, row.length - 1);
      return (effectiveWidth - gapsWidth) / aspectSum;
    };

    const getRowWidthAtHeight = (row: Array<{ key: string; aspect: number }>, height: number) => {
      const aspectSum = row.reduce((sum, entry) => sum + entry.aspect, 0);
      const gapsWidth = galleryGapPx * Math.max(0, row.length - 1);
      return aspectSum * height + gapsWidth;
    };

    const rows: Array<Array<{ item: GalleryGridItem; key: string; aspect: number }>> = [];
    let currentRow: Array<{ item: GalleryGridItem; key: string; aspect: number }> = [];

    gridItems.forEach((item) => {
      const aspect = Math.max(0.35, Math.min(2.8, resolveAspect(item)));
      currentRow.push({ item, key: item.key, aspect });

      if (currentRow.length < 2) {
        return;
      }

      const currentHeight = getRowHeight(currentRow);
      const currentWidthAtTargetHeight = getRowWidthAtHeight(currentRow, targetRowHeight);

      const rowNeedsMoreImages =
        currentHeight > galleryMaxRowHeightPx ||
        (currentWidthAtTargetHeight < minFilledRowWidth && currentHeight > minJustifiedRowHeight);

      if (rowNeedsMoreImages) {
        return;
      }

      const previousRow = currentRow.slice(0, -1);
      const previousHeight = previousRow.length > 0 ? getRowHeight(previousRow) : Number.POSITIVE_INFINITY;
      const previousWidthAtTargetHeight = previousRow.length > 0 ? getRowWidthAtHeight(previousRow, targetRowHeight) : 0;
      const previousRowIsUsable =
        previousRow.length >= 2 &&
        previousHeight >= minJustifiedRowHeight &&
        previousWidthAtTargetHeight >= minFilledRowWidth;

      const breakBeforeLast =
        previousRowIsUsable &&
        (currentHeight < minJustifiedRowHeight ||
          Math.abs(previousHeight - targetRowHeight) < Math.abs(currentHeight - targetRowHeight));

      if (breakBeforeLast) {
        rows.push(previousRow);
        currentRow = currentRow.slice(-1);
        return;
      }

      rows.push(currentRow);
      currentRow = [];
    });

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    rows.forEach((row, rowIndex) => {
      const justifiedRowHeight = Math.max(1, getRowHeight(row));
      const isLastRow = rowIndex === rows.length - 1;
      const shouldBoundLastRow = isLastRow && (row.length === 1 || justifiedRowHeight > galleryMaxRowHeightPx);

      if (shouldBoundLastRow) {
        // Only keep the active/incomplete last row bounded when full justification would make it oversized.
        const boundedRowHeight = Math.max(
          minSparseRowHeight,
          Math.min(
            galleryMaxRowHeightPx,
            Math.max(
              targetRowHeight,
              ...row.map((entry) => defaultSlotWidth / entry.aspect)
            )
          )
        );

        row.forEach((entry) => {
          const width = Math.max(90, boundedRowHeight * entry.aspect);
          itemLayout.set(entry.key, { width, height: boundedRowHeight });
        });
        renderedRows.push({
          items: row.map((entry) => entry.item),
          rowHeight: boundedRowHeight,
          knownSize: boundedRowHeight + galleryGapPx,
        });
        return;
      }

      // Fully justified rows preserve every image ratio and fill the viewport width exactly.
      row.forEach((entry) => {
        const width = Math.max(90, justifiedRowHeight * entry.aspect);
        itemLayout.set(entry.key, { width, height: justifiedRowHeight });
      });
      renderedRows.push({
        items: row.map((entry) => entry.item),
        rowHeight: justifiedRowHeight,
        knownSize: justifiedRowHeight + galleryGapPx,
      });
    });

    return { itemLayout, renderedRows };
  }, [
    gridItems,
    galleryViewportWidth,
    generatingSettings?.aspectRatio,
    aspectRatio,
    galleryGapPx,
    galleryRowHeightPx,
    galleryMaxRowHeightPx,
    galleryMinItemWidthPx,
  ]);

  const galleryItemLayout = galleryLayoutData.itemLayout;

  // Build virtualized row data for Virtuoso
  const virtualizedRows = useMemo(() => {
    if (galleryViewportWidth === 0) return [];
    return galleryLayoutData.renderedRows;
  }, [galleryLayoutData, galleryViewportWidth]);

  const mobileGallerySections = useMemo(() => {
    const visibleItems = gridItems.filter((item): item is Extract<GalleryGridItem, { kind: 'image' | 'collage' }> => item.kind === 'image' || item.kind === 'collage');
    const sections: Array<{ label: string; items: typeof visibleItems }> = [];

    visibleItems.forEach((item) => {
      const createdAt = item.kind === 'image'
        ? item.asset.generation.created_at
        : item.assets[0]?.generation.created_at;
      const label = createdAt ? formatGallerySectionDate(createdAt) : 'Collections';
      const currentSection = sections[sections.length - 1];
      if (!currentSection || currentSection.label !== label) {
        sections.push({ label, items: [item] });
        return;
      }
      currentSection.items.push(item);
    });

    return sections;
  }, [gridItems]);

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const draggedKey = String(event.active.id);
    const droppedOnKey = event.over ? String(event.over.id) : null;
    setActiveDragId(null);

    // Check if dropped on prompt — either via dnd-kit collision or pointer position fallback
    const isPromptDrop = droppedOnKey === 'prompt-drop-zone' || (() => {
      const promptEl = desktopPromptContainerRef.current;
      if (!promptEl || !event.activatorEvent) return false;
      const rect = promptEl.getBoundingClientRect();
      // Use the final pointer position from the drag event
      const pointerX = (event.activatorEvent as PointerEvent).clientX + (event.delta?.x ?? 0);
      const pointerY = (event.activatorEvent as PointerEvent).clientY + (event.delta?.y ?? 0);
      return pointerX >= rect.left && pointerX <= rect.right && pointerY >= rect.top && pointerY <= rect.bottom;
    })();

    if (isPromptDrop) {
      const draggedAsset = libraryImages.find(li => li.key === draggedKey);
      if (draggedAsset && uploadedImages.length < 10) {
        const alreadyAdded = uploadedImages.some(img => img.url === draggedAsset.imageUrl);
        if (!alreadyAdded) {
          setUploadedImages(prev => [...prev, { id: `drop-${Date.now()}`, url: draggedAsset.imageUrl, refTypes: ['image'] }]);
        }
      }
      return;
    }

    if (!droppedOnKey || draggedKey === droppedOnKey) return;

    // Dropped on prompt drop zone — handled above, keep legacy check for safety
    if (droppedOnKey === 'prompt-drop-zone') return;

    // Dropped on existing collage → add to it
    const targetCollageMatch = droppedOnKey.startsWith('collage-') ? droppedOnKey.replace('collage-', '') : null;
    if (targetCollageMatch) {
      setCollages(prev => prev.map(c => c.id === targetCollageMatch && !c.imageKeys.includes(draggedKey) ? { ...c, imageKeys: [...c.imageKeys, draggedKey] } : c));
      return;
    }

    // Check if dragged from a collage
    const draggedFromCollage = collages.find(c => c.imageKeys.includes(draggedKey));
    if (draggedFromCollage) {
      setCollages(prev => prev.map(c => c.id === draggedFromCollage.id ? { ...c, imageKeys: c.imageKeys.filter(k => k !== draggedKey) } : c).filter(c => c.imageKeys.length > 0));
    }

    // Check if target is in a collage
    const targetInCollage = collages.find(c => c.imageKeys.includes(droppedOnKey));
    if (targetInCollage) {
      setCollages(prev => prev.map(c => c.id === targetInCollage.id && !c.imageKeys.includes(draggedKey) ? { ...c, imageKeys: [...c.imageKeys, draggedKey] } : c));
      return;
    }

    // Both solo → create new collage
    setCollages(prev => [...prev, { id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: `Collage ${prev.length + 1}`, imageKeys: [droppedOnKey, draggedKey] }]);
  }, [collages, libraryImages, uploadedImages]);

  const handleDragCancel = useCallback(() => { setActiveDragId(null); }, []);

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

  // Mobile-only mock content seed for design/testing
  useEffect(() => {
    if (!DEMO_MOCK_HISTORY_MOBILE_ENABLED || hasSeededMockHistory) return;

    const params = new URLSearchParams(window.location.search);
    const shouldSeedMockContent = isMobile || params.has('token');
    if (!shouldSeedMockContent) return;

    if (localGenerations.length > 0) {
      setHasSeededMockHistory(true);
      return;
    }

    setLocalGenerations(buildMockGenerationHistory());
    setHasSeededMockHistory(true);
  }, [hasSeededMockHistory, isMobile, localGenerations.length]);

  const getViewerImageSet = useCallback(() => {
    const visibleGenerations = favoritesOnly ? generations.filter(g => g.is_favorite) : generations;
    const allImages: ViewerImageItem[] = [];
    visibleGenerations.forEach((gen) => {
      gen.image_urls.forEach((url, idx) => {
        allImages.push({
          genId: gen.id,
          imageIndex: idx,
          url,
        });
      });
    });
    const currentIndex = viewingImage
      ? allImages.findIndex(
          (img) => img.genId === viewingImage.generationId && img.imageIndex === viewingImage.imageIndex
        )
      : -1;
    return { allImages, currentIndex };
  }, [favoritesOnly, generations, viewingImage]);

  const navigateViewingImage = useCallback((delta: number) => {
    if (!viewingImage) return;
    const { allImages, currentIndex } = getViewerImageSet();
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= allImages.length) return;
    const nextImage = allImages[nextIndex];
    setViewingImage({ generationId: nextImage.genId, imageIndex: nextImage.imageIndex });
  }, [getViewerImageSet, viewingImage]);

  useEffect(() => {
    setShowMobileViewerMenu(false);
    setMobileViewerMenuView('root');
    setMobileViewerPromptExpanded(false);
    if (!viewingImage) {
      setShowDetailsOverlay(false);
      return;
    }
    setShowDetailsOverlay(isMobile);
  }, [isMobile, viewingImage]);

  // Keyboard and scroll navigation for image viewer modal
  useEffect(() => {
    if (!viewingImage) return;

    // Helper to get all images and current index — filtered by favorites when in favorites mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewingImage(null);
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateViewingImage(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateViewingImage(1);
      }
    };

    // Scroll wheel navigation
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.deltaY > 0) {
        navigateViewingImage(1);
      } else if (e.deltaY < 0) {
        navigateViewingImage(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [navigateViewingImage, viewingImage]);

  // Check if user is authenticated
  const isAuthenticated = generationHistoryService.isAuthenticated();
  const canViewHistory = isAuthenticated || localGenerations.length > 0;

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

  const parseRatioValue = (ratio: string): number | null => {
    const [w, h] = ratio.split(':').map(Number);
    if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) return null;
    return w / h;
  };

  const pickClosestAspectRatio = (desired: string, supported: string[]): string => {
    if (supported.length === 0 || supported.includes(desired)) return desired;

    const desiredValue = parseRatioValue(desired);
    if (desiredValue === null) return supported[0];

    return supported.reduce((best, candidate) => {
      const bestValue = parseRatioValue(best);
      const candidateValue = parseRatioValue(candidate);
      if (bestValue === null) return candidate;
      if (candidateValue === null) return best;
      const bestDiff = Math.abs(bestValue - desiredValue);
      const candidateDiff = Math.abs(candidateValue - desiredValue);
      return candidateDiff < bestDiff ? candidate : best;
    });
  };

  const resolutionRank: Record<string, number> = {
    '1k': 1,
    '2k': 2,
    '4k': 4,
  };

  const pickClosestResolution = (desired: string, supported: string[]): string => {
    if (supported.length === 0 || supported.includes(desired)) return desired;

    const desiredRank = resolutionRank[desired];
    if (!desiredRank) return supported[0];

    return supported.reduce((best, candidate) => {
      const bestRank = resolutionRank[best] ?? Number.MAX_SAFE_INTEGER;
      const candidateRank = resolutionRank[candidate] ?? Number.MAX_SAFE_INTEGER;
      const bestDiff = Math.abs(bestRank - desiredRank);
      const candidateDiff = Math.abs(candidateRank - desiredRank);
      return candidateDiff < bestDiff ? candidate : best;
    });
  };

  const normalizeGenerationSettings = (
    mapping: ModelMapping,
    desiredAspectRatio: string,
    desiredResolution: string,
    desiredCount: number
  ) => {
    const capabilities = mapping.capabilities;
    const normalizedAspectRatio = pickClosestAspectRatio(
      desiredAspectRatio,
      capabilities.supportedAspectRatios
    );
    const normalizedResolution = pickClosestResolution(
      desiredResolution,
      capabilities.supportedResolutions
    );
    const normalizedCount = Math.max(1, Math.min(desiredCount, capabilities.maxCount || 10));

    return {
      aspectRatio: normalizedAspectRatio,
      resolution: normalizedResolution,
      count: normalizedCount,
    };
  };

  useEffect(() => {
    if (!selectedModel) return;
    const mapping = modelNameToProvider[selectedModel];
    if (!mapping) return;

    const normalized = normalizeGenerationSettings(mapping, aspectRatio, resolution, count);

    if (normalized.aspectRatio !== aspectRatio) {
      setAspectRatio(normalized.aspectRatio);
    }

    if (normalized.resolution !== resolution) {
      setResolution(normalized.resolution);
    }

    if (normalized.count !== count) {
      setCount(normalized.count);
    }
  }, [selectedModel, aspectRatio, resolution, count]);

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

    // Restore reference images if the original generation had any
    if (gen.reference_images && gen.reference_images.length > 0) {
      const restoredImages: UploadedImage[] = gen.reference_images.map((refImg, idx) => ({
        id: `rerun-${Date.now()}-${idx}`,
        url: refImg.url,
        refTypes: [refImg.refType as 'style' | 'character' | 'image'],
      }));
      setUploadedImages(restoredImages);
    }

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
      setIsGenerating(true);
      setError(null);

      try {
        const currentAspectRatio = gen.aspect_ratio || '3:4';
        const currentResolution = gen.resolution || '4k';
        const currentCount = gen.count || 1;

        const [w, h] = currentAspectRatio.split(':').map(Number);
        const baseSize = currentResolution === '1k' ? 512 : currentResolution === '2k' ? 1024 : 2048;
        const totalRatio = w + h;
        // Ensure dimensions are divisible by 8 (required by SD models)
        const width = Math.round((w / totalRatio) * baseSize * 2 / 8) * 8;
        const height = Math.round((h / totalRatio) * baseSize * 2 / 8) * 8;

        let imageUrls: string[] = [];

        if (DEMO_MOCK_GENERATION_ENABLED) {
          console.log('Demo mock rerun: using placeholder images');
          await new Promise(resolve => setTimeout(resolve, 350));
          imageUrls = buildMockImageUrls(gen.prompt, currentCount, width, height);
        } else if (modelMapping.provider === 'fal') {
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
        } else if (modelMapping.provider === 'xeno' && modelMapping.xenoConfig) {
          const xenoSettings = xenoImageService.getXenoSettings({
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
            const response = await xenoImageService.generateImage(modelMapping.xenoConfig, gen.prompt, xenoSettings);
            if (response.imageUrl) imageUrls.push(response.imageUrl);
          }
        }

        if (imageUrls.length > 0) {
          const refImages = uploadedImages
            .filter(img => img.refTypes.length > 0)
            .flatMap(img => img.refTypes.map(type => ({ url: img.url, refType: type })));

          const localGen = {
            id: `local-${Date.now()}`,
            user_id: '',
            prompt: gen.prompt,
            image_urls: imageUrls,
            model: gen.model,
            aspect_ratio: currentAspectRatio,
            resolution: currentResolution,
            count: currentCount,
            provider: modelMapping.provider,
            is_favorite: false,
            created_at: new Date().toISOString(),
            reference_images: refImages.length > 0 ? refImages : [],
          };

          if (isAuthenticated && !DEMO_MOCK_GENERATION_ENABLED) {
            const saved = await saveGeneration({
              prompt: gen.prompt,
              image_urls: imageUrls,
              model: gen.model,
              aspect_ratio: currentAspectRatio,
              resolution: currentResolution,
              count: currentCount,
              provider: modelMapping.provider,
              reference_images: refImages.length > 0 ? refImages : undefined,
            });
            if (!saved) {
              setLocalGenerations(prev => [localGen, ...prev]);
            }
          } else {
            setLocalGenerations(prev => [localGen, ...prev]);
          }
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

  const handleToggleFavoriteGeneration = async (genId: string) => {
    if (genId.startsWith('local-')) {
      setLocalGenerations(prev =>
        prev.map(gen =>
          gen.id === genId ? { ...gen, is_favorite: !gen.is_favorite } : gen
        )
      );
      return;
    }

    await toggleFavorite(genId);
  };

  // Delete a generation
  const handleDeleteGeneration = async (genId: string) => {
    if (!confirm('Are you sure you want to delete this generation?')) {
      return false;
    }

    if (genId.startsWith('local-')) {
      setLocalGenerations(prev => prev.filter(gen => gen.id !== genId));
    } else {
      await deleteGeneration(genId);
    }

    return true;
  };

  const handleDownloadSingleImage = async (imageUrl: string, generationId: string, imageIndex: number) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `generation-${generationId.slice(0, 8)}-${imageIndex + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      console.error('Download failed:', downloadError);
    }
  };

  const handleShareSingleImage = useCallback(async (imageUrl: string, generationId: string, imageIndex: number, promptText: string) => {
    try {
      const fallbackText = `${promptText}\n\n${imageUrl}`;
      if (!navigator.share) {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(fallbackText);
        }
        return;
      }

      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const extension = blob.type.includes('jpeg') ? 'jpg' : 'png';
        const file = new File([blob], `generation-${generationId.slice(0, 8)}-${imageIndex + 1}.${extension}`, {
          type: blob.type || 'image/png',
        });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Generated image',
            text: promptText,
          });
          return;
        }
      } catch (shareFetchError) {
        console.error('Share file preparation failed:', shareFetchError);
      }

      await navigator.share({
        title: 'Generated image',
        text: promptText,
        url: imageUrl,
      });
    } catch (shareError) {
      if ((shareError as Error)?.name !== 'AbortError') {
        console.error('Share failed:', shareError);
      }
    }
  }, []);

  const handleUseImageAsReference = useCallback((imageUrl: string) => {
    const existingImage = uploadedImages.find((img) => img.url === imageUrl);
    if (existingImage) {
      setActiveImageId(existingImage.id);
      setViewingImage(null);
      return;
    }

    const newImage: UploadedImage = {
      id: `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url: imageUrl,
      refTypes: ['image'],
    };
    setUploadedImages((prev) => [...prev, newImage]);
    setActiveImageId(newImage.id);
    setViewingImage(null);
  }, [uploadedImages]);

  const handleMobileViewerTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    mobileViewerTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleMobileViewerTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const start = mobileViewerTouchStartRef.current;
    mobileViewerTouchStartRef.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      navigateViewingImage(deltaX < 0 ? 1 : -1);
      return;
    }

    if (deltaY > 104 && Math.abs(deltaY) > Math.abs(deltaX) * 1.4) {
      setViewingImage(null);
    }
  }, [navigateViewingImage]);

  // --- Selection mode handlers (mobile) ---
  const toggleImageSelection = useCallback((key: string) => {
    setSelectedImageKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      // Exit selection mode if nothing selected
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedImageKeys(new Set());
    setShowCollectionMenu(false);
  }, []);

  const handleBulkFavorite = useCallback(() => {
    // Deduplicate by generation ID — only favorite each generation once
    const genIds = new Set<string>();
    selectedImageKeys.forEach(key => {
      const asset = libraryImages.find(li => li.key === key);
      if (asset) genIds.add(asset.generation.id);
    });
    // Only set to favorite (not toggle) — if already favorited, skip
    genIds.forEach(genId => {
      const gen = generations.find(g => g.id === genId);
      if (gen && !gen.is_favorite) {
        handleToggleFavoriteGeneration(genId);
      }
    });
    setSelectedImageKeys(new Set()); // Clear selections immediately (removes checkboxes)
    setSelectionActionFeedback('favorite');
    setTimeout(() => { setSelectionActionFeedback(null); setSelectionMode(false); }, 400);
  }, [selectedImageKeys, libraryImages, generations, handleToggleFavoriteGeneration]);

  const handleBulkDelete = useCallback(() => {
    selectedImageKeys.forEach(key => {
      const asset = libraryImages.find(li => li.key === key);
      if (asset) {
        if (asset.generation.id.startsWith('local-')) {
          setLocalGenerations(prev => prev.filter(g => g.id !== asset.generation.id));
        } else {
          deleteGeneration(asset.generation.id);
        }
      }
    });
    exitSelectionMode();
  }, [selectedImageKeys, libraryImages, deleteGeneration, exitSelectionMode]);

  const handleBulkDownload = useCallback(async () => {
    for (const key of selectedImageKeys) {
      const asset = libraryImages.find(li => li.key === key);
      if (asset) await handleDownloadSingleImage(asset.imageUrl, asset.generation.id, asset.imageIndex);
    }
    exitSelectionMode();
  }, [selectedImageKeys, libraryImages, handleDownloadSingleImage, exitSelectionMode]);

  const handleBulkCreateCollection = useCallback(() => {
    if (selectedImageKeys.size < 1) return;
    const keys = Array.from(selectedImageKeys);
    setCollages(prev => [...prev, {
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: `Collection ${prev.length + 1}`,
      imageKeys: keys,
    }]);
    setShowCollectionMenu(false);
    exitSelectionMode();
  }, [selectedImageKeys, exitSelectionMode]);

  const handleAddToExistingCollection = useCallback((collageId: string) => {
    const keys = Array.from(selectedImageKeys);
    setCollages(prev => prev.map(c => {
      if (c.id !== collageId) return c;
      const newKeys = keys.filter(k => !c.imageKeys.includes(k));
      return { ...c, imageKeys: [...c.imageKeys, ...newKeys] };
    }));
    setShowCollectionMenu(false);
    exitSelectionMode();
  }, [selectedImageKeys, exitSelectionMode]);

  const handleGenerate = async () => {
    const demoMode = DEMO_MOCK_GENERATION_ENABLED;
    const promptInput = prompt.trim();
    const promptForGeneration = promptInput || (demoMode ? 'Demo image preview' : '');
    const modelForGeneration = selectedModel || (demoMode ? DEFAULT_DEMO_MODEL : null);

    if (!promptForGeneration) {
      setError('Please enter a prompt');
      return;
    }

    if (!modelForGeneration) {
      setError('Please select a model');
      return;
    }

    if (demoMode && !selectedModel) {
      setSelectedModel(modelForGeneration);
    }

    // Get the model mapping
    const modelMapping = modelNameToProvider[modelForGeneration];
    if (!modelMapping) {
      setError(`Model "${modelForGeneration}" is not yet supported. Please select a different model.`);
      return;
    }

    const normalized = normalizeGenerationSettings(modelMapping, aspectRatio, resolution, count);
    const effectiveAspectRatio = normalized.aspectRatio;
    const effectiveResolution = normalized.resolution;
    const effectiveCount = normalized.count;

    if (effectiveAspectRatio !== aspectRatio) {
      setAspectRatio(effectiveAspectRatio);
    }

    if (effectiveResolution !== resolution) {
      setResolution(effectiveResolution);
    }

    if (effectiveCount !== count) {
      setCount(effectiveCount);
    }

    // Store the current prompt for this generation
    const currentPrompt = promptForGeneration;

    // Store the current settings for this generation (freeze them including prompt)
    setGeneratingSettings({
      prompt: currentPrompt,
      count: effectiveCount,
      aspectRatio: effectiveAspectRatio,
      resolution: effectiveResolution
    });

    // Clear the input box immediately after generation starts
    setPrompt('');

    // Switch to main view to show the generating skeleton
    setShowHistory(false);

    setIsGenerating(true);
    setError(null);
    // Don't clear previous images - we want to keep history

    try {
      // Parse aspect ratio to get width and height based on resolution
      const [w, h] = effectiveAspectRatio.split(':').map(Number);
      const baseSize = effectiveResolution === '1k' ? 512 : effectiveResolution === '2k' ? 1024 : 2048;
      const totalRatio = w + h;
      // Ensure dimensions are divisible by 8 (required by SD models)
      const width = Math.round((w / totalRatio) * baseSize * 2 / 8) * 8;
      const height = Math.round((h / totalRatio) * baseSize * 2 / 8) * 8;

      console.log('Generating with settings:', {
        provider: modelMapping.provider,
        model: modelForGeneration,
        aspectRatio: effectiveAspectRatio,
        resolution: effectiveResolution,
        dimensions: `${width}x${height}`,
        count: effectiveCount
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

      if (DEMO_MOCK_GENERATION_ENABLED) {
        console.log('Demo mock generation enabled: using placeholder images');
        await new Promise(resolve => setTimeout(resolve, 350));
        imageUrls = buildMockImageUrls(currentPrompt, effectiveCount, width, height);
      } else if (modelMapping.provider === 'fal') {
        // Use fal.ai - supports batch generation

        // Map aspect ratio to fal.ai image_size parameter
        let image_size = 'square_hd'; // default
        if (effectiveAspectRatio === '1:1') {
          image_size = effectiveResolution === '1k' ? 'square' : 'square_hd';
        } else if (effectiveAspectRatio === '16:9') {
          image_size = 'landscape_16_9';
        } else if (effectiveAspectRatio === '9:16') {
          image_size = 'portrait_16_9';
        } else if (effectiveAspectRatio === '4:3') {
          image_size = 'landscape_4_3';
        } else if (effectiveAspectRatio === '3:4') {
          image_size = 'portrait_4_3';
        } else if (effectiveAspectRatio === '21:9') {
          image_size = 'landscape_16_9'; // Use 16:9 as fallback for ultra-wide
        }

        const settings: ImageModelSettings = {
          prompt: currentPrompt,
          width,
          height,
          num_outputs: effectiveCount,
          aspect_ratio: effectiveAspectRatio,
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
      } else if (modelMapping.provider === 'xeno') {
        // Use Xeno proxy models - generate multiple images sequentially
        if (!modelMapping.xenoConfig) {
          throw new Error('Xeno model configuration missing');
        }

        // Build settings object for Xeno model generation (reuse styleRefImage/charRefImage from above)
        const xenoSettings = xenoImageService.getXenoSettings({
          prompt: currentPrompt,
          resolution: `${width}x${height}`,
          width,
          height,
          aspect_ratio: effectiveAspectRatio,
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

        console.log('Xeno settings:', xenoSettings);

        // Generate images one by one
        for (let i = 0; i < effectiveCount; i++) {
          console.log(`Generating image ${i + 1}/${effectiveCount}...`);

          const response = await xenoImageService.generateImage(
            modelMapping.xenoConfig,
            currentPrompt,
            xenoSettings
          );

          if (response.imageUrl) {
            imageUrls.push(response.imageUrl);
            console.log(`Image ${i + 1} generated:`, response.imageUrl);
          }
        }
      } else if (modelMapping.provider === 'xeno-flow') {
        // Use Xeno Flow Service for Nano Banana models
        console.log('Using Xeno Flow Service for', modelForGeneration);

        // Map aspect ratio to xeno-flow format
        let xenoAspectRatio: 'landscape' | 'portrait' | 'square' = 'landscape';
        if (effectiveAspectRatio === '1:1') {
          xenoAspectRatio = 'square';
        } else if (effectiveAspectRatio === '9:16' || effectiveAspectRatio === '3:4' || effectiveAspectRatio === '2:3') {
          xenoAspectRatio = 'portrait';
        } else {
          xenoAspectRatio = 'landscape';
        }

        // Map resolution to FIFE URL width parameter
        const resolutionToWidth: Record<string, number> = {
          '1k': 1280,  // 1280×720 (720p/HD)
          '2k': 2560,  // 2560×1440 (QHD)
          '4k': 3840,  // 3840×2160 (UHD)
        };
        const fifeWidth = resolutionToWidth[effectiveResolution] || 2560;

        // Generate images one by one (API returns one image per call)
        for (let i = 0; i < effectiveCount; i++) {
          console.log(`Generating image ${i + 1}/${effectiveCount} with Xeno Flow at ${effectiveResolution}...`);

          const response = await fetch('/api/image/xeno-flow/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: currentPrompt,
              aspect_ratio: xenoAspectRatio,
              num_images: 1,
              resolution: fifeWidth, // FIFE URL width parameter
            }),
          });

          const data = await response.json();

          if (data.success && data.images?.[0]?.base64) {
            imageUrls.push(data.images[0].base64);
            console.log(`Image ${i + 1} generated successfully`);
          } else {
            console.error('Xeno Flow generation failed:', data.detail || data.error);
            if (i === 0) {
              throw new Error(data.detail || 'Generation failed');
            }
          }
        }
      }

      if (imageUrls.length > 0) {
        console.log(`Successfully generated ${imageUrls.length} images`);

        // Create a local generation record for immediate display
        const localGen = {
          id: `local-${Date.now()}`,
          user_id: '',
          prompt: currentPrompt,
          image_urls: imageUrls,
          model: modelForGeneration,
          aspect_ratio: effectiveAspectRatio,
          resolution: effectiveResolution,
          count: effectiveCount,
          provider: modelMapping.provider,
          is_favorite: false,
          created_at: new Date().toISOString(),
          reference_images: uploadedImages.flatMap(img => img.refTypes.map(type => ({ url: img.url, refType: type }))),
        };

        // Save to history - this updates the generations array (single source of truth)
        // The hook's saveGeneration automatically prepends to the generations array
        if (isAuthenticated && !demoMode) {
          // Collect reference images used for this generation (flatten multiple types per image)
          const refImages = uploadedImages
            .filter(img => img.refTypes.length > 0)
            .flatMap(img => img.refTypes.map(type => ({ url: img.url, refType: type })));

          const saved = await saveGeneration({
            prompt: currentPrompt,
            image_urls: imageUrls,
            model: modelForGeneration,
            aspect_ratio: effectiveAspectRatio,
            resolution: effectiveResolution,
            count: effectiveCount,
            provider: modelMapping.provider,
            reference_images: refImages.length > 0 ? refImages : undefined,
          });

          // If save failed, add to local generations as fallback
          if (!saved) {
            console.warn('Failed to save to database, using local generation');
            setLocalGenerations(prev => [localGen, ...prev]);
          }
        } else {
          // Not authenticated - add to local generations
          setLocalGenerations(prev => [localGen, ...prev]);
        }
        // If generating inside a collage, add new images to it
        if (expandedCollageId) {
          const newKeys = imageUrls.map((_, idx) => `${localGen.id}-${idx}`);
          setCollages(prev => prev.map(c => c.id === expandedCollageId ? { ...c, imageKeys: [...c.imageKeys, ...newKeys] } : c));
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

  const availableAspectRatios = aspectRatios.filter((ar) => allowedAspectRatioValues.has(ar.value));
  const supportedAspectRatios = availableAspectRatios.filter((ar) => isAspectRatioSupported(ar.value));
  const selectedAspectRatio = availableAspectRatios.find(ar => ar.value === aspectRatio);
  const selectedResolution = resolutions.find(res => res.value === resolution);
  const desktopModelControlsMode: 'companies' | 'models' =
    desktopModelControlsClosing ? desktopModelControlsClosingView : desktopModelControlsView;
  const desktopActiveModelCompany = desktopModelActiveCompany
    ? aiCompanies.find((company) => company.name === desktopModelActiveCompany) ?? null
    : null;
  const desktopModelTriggerCompany =
    desktopModelControlsMode === 'models' && desktopActiveModelCompany
      ? desktopActiveModelCompany
      : selectedModelCompany;
  const showDesktopModelLabel = Boolean(selectedModel) && (
    !showDesktopModelPanel ||
    (desktopModelControlsMode === 'models' && desktopModelActiveCompany === selectedModelCompany?.name)
  );
  const desktopCompanyOptions = aiCompanies.filter((company) => company.name !== desktopModelTriggerCompany?.name);
  const desktopModelOptions = (desktopActiveModelCompany?.models ?? []).filter((model) => {
    if (!selectedModel || desktopActiveModelCompany?.name !== selectedModelCompany?.name) {
      return true;
    }
    return model.name !== selectedModel;
  });
  const desktopModelAnimationItems = desktopModelControlsMode === 'models'
    ? desktopModelOptions
    : desktopCompanyOptions;
  const desktopModelAnimationMaxIndex = Math.max(desktopModelAnimationItems.length - 1, 0);
  const desktopModelCompanyButtonWidthPx = viewportWidth >= 1024 ? 40 : 32;
  const desktopResolutionOptions = resolutions.filter((res) => isResolutionSupported(res.value) && res.value !== resolution);
  const desktopAspectRatioOptions = supportedAspectRatios.filter((ar) => ar.value !== aspectRatio);
  const desktopSettingsMode: 'default' | 'resolutions' | 'aspects' =
    desktopSettingsClosing ? desktopSettingsClosingView : desktopSettingsView;
  const showDesktopSettingsPanel = showSettings || desktopSettingsClosing;
  const hideDesktopSearchSlot = showSettings || desktopSettingsClosing;
  const desktopResolutionWidthDelta = desktopSelectedResolutionButtonWidth - desktopLeadingResolutionButtonWidth;
  const desktopQualityExpandedEdgeGapPx = desktopLeadingResolutionButtonWidth > 0
    ? Math.max(
        DESKTOP_SETTINGS_BASE_GAP_PX,
        Math.min(
          DESKTOP_SETTINGS_BASE_GAP_PX + 2,
          DESKTOP_SETTINGS_BASE_GAP_PX + 1 + Math.round(desktopResolutionWidthDelta / 8),
        ),
      )
    : DESKTOP_SETTINGS_BASE_GAP_PX + 1;
  const desktopSettingsAnimationMaxIndex =
    desktopSettingsMode === 'resolutions'
      ? desktopResolutionOptions.length
      : desktopSettingsMode === 'aspects'
        ? desktopAspectRatioOptions.length
        : 2;
  const getDesktopSettingsAnimation = (visualIndex: number, maxVisualIndex: number) => {
    const delay = desktopSettingsClosing
      ? (maxVisualIndex - visualIndex) * DESKTOP_SETTINGS_STAGGER_MS
      : visualIndex * DESKTOP_SETTINGS_STAGGER_MS;
    return `${desktopSettingsClosing ? 'desktopSettingsHide' : 'desktopSettingsReveal'} ${DESKTOP_SETTINGS_DURATION_MS}ms ease-in-out ${delay}ms both`;
  };
  const getDesktopModelAnimation = (visualIndex: number, maxVisualIndex: number) => {
    const delay = desktopModelControlsClosing
      ? (maxVisualIndex - visualIndex) * DESKTOP_SETTINGS_STAGGER_MS
      : visualIndex * DESKTOP_SETTINGS_STAGGER_MS;
    return `${desktopModelControlsClosing ? 'desktopModelHide' : 'desktopModelReveal'} ${DESKTOP_SETTINGS_DURATION_MS}ms ease-in-out ${delay}ms both`;
  };

  return (
    <div className="generation-interface-surface h-full w-full flex flex-col py-3 pb-52 md:pb-3 overflow-y-auto relative bg-black">
      <style>{`
        .generation-interface-surface button,
        .generation-interface-surface [role="button"] {
          -webkit-tap-highlight-color: transparent;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
        @keyframes mobileControlFadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mobileControlFadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
        @keyframes mobileInlineItemFadeIn { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes mobileInlineItemFadeOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(12px); } }
        @keyframes mobileInlineItemFadeOutReverse { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-12px); } }
        @keyframes companyModelBackdropEnter { from { opacity: 0; transform: translateX(-8px) scale(0.985); } to { opacity: 0.95; transform: translateX(0) scale(1); } }
        @keyframes companyModelBackdropExit { from { opacity: 0.95; transform: translateX(0) scale(1); } to { opacity: 0; transform: translateX(-8px) scale(0.985); } }
        @keyframes mobileCompanyFadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes desktopCompanyExit { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } }
        @keyframes modelExit { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-10px); } }
        @keyframes promptDropPulse { 0%, 100% { box-shadow: 0 0 10px rgba(255, 255, 255, 0.04); } 50% { box-shadow: 0 0 18px rgba(255, 255, 255, 0.08); } }
        @keyframes desktopSettingsReveal { from { opacity: 0; transform: translateX(10px) scale(0.985); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes desktopSettingsHide { from { opacity: 1; transform: translateX(0) scale(1); } to { opacity: 0; transform: translateX(10px) scale(0.985); } }
        @keyframes desktopModelReveal { from { opacity: 0; transform: translateX(-10px) scale(0.985); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes desktopModelHide { from { opacity: 1; transform: translateX(0) scale(1); } to { opacity: 0; transform: translateX(-10px) scale(0.985); } }
        @keyframes star-ring {
          0%, 20% { opacity: 1; transform: scale(0); stroke-width: 16; }
          35% { opacity: 0.5; transform: scale(1); stroke-width: 16; }
          50%, 100% { opacity: 0; transform: scale(1); stroke-width: 0; }
        }
        @keyframes star-fill {
          0%, 40% { transform: scale(0); }
          60% { transform: scale(1.2); }
          80% { transform: scale(0.9); }
          100% { transform: scale(1); }
        }
        @keyframes star-stroke {
          0% { transform: scale(1); }
          20%, 100% { transform: scale(0); }
        }
        @keyframes star-line {
          0%, 40% { stroke-dasharray: 1 23; stroke-dashoffset: 1; }
          60%, 100% { stroke-dasharray: 12 13; stroke-dashoffset: -13; }
        }
        .animate-star-ring { animation: star-ring 0.7s ease-out forwards; }
        .animate-star-fill { animation: star-fill 0.7s ease-out forwards; }
        .animate-star-stroke { animation: star-stroke 0.7s ease-out forwards; }
        .animate-star-line { animation: star-line 0.7s ease-out forwards; }
        @keyframes gear-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .animate-gear-spin { animation: gear-spin 0.5s ease-out forwards; }
      `}</style>
      {/* Parent Container - Wraps both Generation Header and Image History - Responsive width, centered */}
      <div className="w-full mx-auto relative flex flex-col flex-1">

        {/* Generation Header Container - Sticky */}
        <DndContext sensors={dndSensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <div className={`generation-header flex flex-col items-center gap-3 sticky top-0 z-50 transition-colors duration-200 ${isScrolled ? 'bg-[#0a0a0b]' : 'bg-transparent'}`} style={{ width: '100%' }}>
        <div className="w-full hidden md:flex flex-col gap-3 relative">
          {/* Desktop Row: All controls in one row (hidden on mobile) */}
          <div className={`w-full hidden md:flex flex-row items-start justify-between gap-3 relative px-3 ${uploadedImages.length > 0 ? 'pb-16' : ''}`}>
            {/* Model Selector Container - Desktop: icon-only when no model, expands with text after selection */}
            <div ref={desktopModelControlsRef} className="relative flex items-center gap-0 min-w-0">
            {/* Company icon button — always square */}
            <button
              ref={desktopModelRootButtonRef}
              onClick={() => {
                if (showDesktopModelControls && desktopModelControlsMode === 'companies' && !desktopModelControlsClosing) {
                  closeDesktopModelControls();
                } else {
                  openDesktopModelCompanies();
                }
                setShowSettings(false);
                closeDesktopGallerySearch();
                setActiveImageId(null);
                setShowTools(false);
                setSelectedTool(null);
              }}
              className={`h-8 w-8 lg:h-10 lg:w-10 border rounded-md flex items-center justify-center text-white/80 hover:text-white transition-[background-color,border-color] duration-300 ease-out ${
                selectedModel && !showDesktopModelPanel
                  ? 'border-transparent bg-transparent delay-200'
                  : 'border-[#27272a] bg-[#1a1a1c] hover:bg-[#252525] delay-0'
              }`}
              style={{
                ...(desktopModelCompanyMorph ? { opacity: 0, visibility: 'hidden' as const } : {}),
                pointerEvents: desktopModelTransitionInFlight ? 'none' : 'auto',
              }}
            >
              <span className="w-5 h-5 flex items-center justify-center">
                {desktopModelTriggerCompany ? (
                  renderCompanyLogo(desktopModelTriggerCompany, true)
                ) : (
                  <svg className="w-5 h-5 text-[#6b7280]" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="2" y="12.8" width="10" height="2.4" rx="1.2" transform="rotate(-45 7 14)" />
                    <rect x="11.5" y="12.8" width="3.5" height="2.4" rx="1.2" transform="rotate(-45 7 14)" fill="white" stroke="currentColor" strokeWidth="0.5" />
                    <path d="M17.5 5.5 Q18.2 7.7 20.5 8.5 Q18.2 9.3 17.5 11.5 Q16.8 9.3 14.5 8.5 Q16.8 7.7 17.5 5.5 Z" />
                    <path d="M20.5 12.5 Q21 14 22.5 14.5 Q21 15 20.5 16.5 Q20 15 18.5 14.5 Q20 14 20.5 12.5 Z" />
                    <path d="M15 12 Q15.4 13 16.5 13.4 Q15.4 13.8 15 14.8 Q14.6 13.8 13.5 13.4 Q14.6 13 15 12 Z" />
                  </svg>
                )}
              </span>
            </button>
            {/* Divider between company icon and model name — visible only in idle state */}
            {showDesktopModelLabel && (
              <div
                className={`w-px h-4 transition-opacity duration-300 ease-out ${
                  selectedModel && !showDesktopModelPanel ? 'opacity-100 delay-200' : 'opacity-0'
                }`}
                style={{ marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX}px`, backgroundColor: 'rgba(255,255,255,0.1)' }}
              />
            )}
            {/* Model name button — separate, to the right of company icon */}
            {showDesktopModelLabel && (
              <button
                ref={desktopModelLabelRef}
                onClick={() => {
                  if (!selectedModelCompany) return;
                  if (
                    showDesktopModelControls &&
                    desktopModelControlsMode === 'models' &&
                    desktopModelActiveCompany === selectedModelCompany.name &&
                    !desktopModelControlsClosing
                  ) {
                    closeDesktopModelControls();
                  } else {
                    openDesktopModelOptions(selectedModelCompany.name);
                  }
                  setShowSettings(false);
                  closeDesktopGallerySearch();
                }}
                className={`h-6 px-2 border rounded flex items-center text-[11px] font-medium transition-[background-color,border-color,color,box-shadow] duration-300 ease-out cursor-pointer ${
                  showDesktopModelPanel && desktopModelControlsMode === 'models'
                    ? 'border-white/10 bg-[#1a1a1c] text-white/85 hover:bg-[#252525] hover:text-white shadow-[0_8px_20px_rgba(0,0,0,0.22)]'
                    : 'border-transparent bg-transparent text-white/50 hover:text-white/80 shadow-none'
                }`}
                style={{
                  marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX - 1}px`,
                  ...(desktopModelSelectMorph ? { opacity: 0, visibility: 'hidden' as const } : {}),
                }}
              >
                <span className="font-medium">{selectedModel}</span>
              </button>
            )}
            {/* AI Company icons — inline horizontal, right of model button */}
            {showDesktopModelPanel && (
              <div
                data-desktop-header-popout="true"
                className="relative flex items-center gap-0 min-w-0"
                style={{
                  pointerEvents: desktopModelControlsClosing || desktopModelTransitionInFlight ? 'none' : 'auto',
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {desktopModelControlsMode === 'companies' && (desktopModelCompaniesVisible || desktopModelControlsClosing) && (
                  desktopCompanyOptions.map((company, index) => (
                    <div
                      key={company.name}
                      className="min-w-0"
                      style={{
                        marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                        ...(desktopModelCompanyMorph && desktopModelCompanyMorph !== company.name
                          ? { visibility: 'hidden' as const, opacity: 0 }
                          : {}),
                      }}
                    >
                      <button
                        onClick={(e) => {
                          setShowSettings(false);
                          closeDesktopGallerySearch();
                          setShowTools(false);
                          setSelectedTool(null);
                          morphDesktopCompanyIntoRoot(company.name, e.currentTarget);
                        }}
                        className="h-8 w-8 lg:h-10 lg:w-10 border border-[#27272a] rounded-md flex items-center justify-center text-white/80 hover:bg-[#252525] hover:text-white transition-all duration-200 ease-in-out bg-[#1a1a1c] shadow-[0_8px_20px_rgba(0,0,0,0.22)]"
                        style={{
                          animation: desktopModelCompanyMorph ? undefined : getDesktopModelAnimation(index, desktopModelAnimationMaxIndex),
                          pointerEvents: desktopModelTransitionInFlight ? 'none' : 'auto',
                        }}
                      >
                        <span className="w-5 h-5 flex items-center justify-center">{renderCompanyLogo(company, false)}</span>
                      </button>
                    </div>
                  ))
                )}

                {desktopModelControlsMode === 'models' && (desktopModelOptionsVisible || desktopModelControlsClosing) && (
                  desktopModelOptions.map((model, index) => (
                    <div
                      key={model.name}
                      className="relative opacity-0"
                      style={{
                        animation: desktopModelSelectMorph ? undefined : getDesktopModelAnimation(index, desktopModelAnimationMaxIndex),
                        marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                        ...(desktopModelSelectMorph && desktopModelSelectMorph !== model.name
                          ? { visibility: 'hidden' as const, opacity: 0 }
                          : desktopModelSelectMorph === model.name
                            ? { opacity: 1 }
                            : {}),
                      }}
                      onMouseEnter={() => handleModelHoverEnter(model)}
                      onMouseLeave={handleModelHoverLeave}
                    >
                      {hoveredModel?.name === model.name && (
                        <div className="absolute left-0 top-full mt-2 w-56 bg-[#222224] border border-[#27272a] rounded-md p-3 z-[120]">
                          <h3 className="text-white font-semibold text-xs">{hoveredModel.name}</h3>
                          <p className="text-white/60 text-[11px] mb-2 leading-tight">{hoveredModel.description}</p>
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          const sourceBtn = e.currentTarget;
                          const labelEl = desktopModelLabelRef.current;
                          const rootEl = desktopModelRootButtonRef.current;
                          const sourceRect = sourceBtn.getBoundingClientRect();
                          // Slide to label position if it exists, otherwise to right of company button + divider gap
                          const targetLeft = labelEl
                            ? labelEl.getBoundingClientRect().left
                            : rootEl
                              ? rootEl.getBoundingClientRect().right + DESKTOP_SETTINGS_BASE_GAP_PX + 1 + (DESKTOP_SETTINGS_BASE_GAP_PX - 1)
                              : sourceRect.left;
                          const deltaX = sourceRect.left - targetLeft;
                          const chipWrapper = sourceBtn.parentElement;

                          if (chipWrapper && deltaX > 0) {
                            setDesktopModelSelectMorph(model.name);
                            chipWrapper.style.zIndex = '10';
                            const anim = chipWrapper.animate(
                              [
                                { transform: 'translateX(0px)' },
                                { transform: `translateX(-${deltaX}px)` },
                              ],
                              {
                                duration: DESKTOP_MODEL_COMPANY_SHIFT_MS,
                                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                                fill: 'forwards',
                              },
                            );
                            const finish = () => {
                              setSelectedModel(model.name);
                              setDesktopModelSelectMorph(null);
                              hideDesktopModelControlsImmediate();
                            };
                            anim.finished.then(finish).catch(finish);
                          } else {
                            setSelectedModel(model.name);
                            hideDesktopModelControlsImmediate();
                          }
                        }}
                        className="h-6 px-2 border border-white/10 rounded flex items-center gap-2 text-white/75 text-[11px] font-medium bg-[#131416] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-transparent hover:bg-[#1a1b1e] hover:text-white transition-all duration-200 ease-in-out whitespace-nowrap"
                      >
                        <span>{model.name}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
            </div>

            {/* Tools Container - Desktop - HIDDEN: Will be implemented in Image Studio later
            <div className="w-[118px] h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center pl-1 pr-2 shadow-lg shadow-black/40 relative bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
              <button
                onClick={() => {
                  setShowTools(!showTools);
                  setSelectedTool(null);
                  setShowAiCompanies(false);
                  setSelectedCompany(null);
                  setShowSettings(false);
                  setActiveImageId(null);
                }}
                className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg className={`w-6 h-6 ${showTools ? 'text-white' : 'text-white/40'}`} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 20L4 4L20 20H4Z" fillOpacity="0.3" />
                  <path d="M4 20L4 4L20 20H4Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="5.5" y="14" width="1.2" height="4" rx="0.4" />
                  <rect x="8.5" y="16" width="1.2" height="2.5" rx="0.4" />
                  <rect x="11.5" y="17" width="1.2" height="1.8" rx="0.4" />
                </svg>
              </button>
              <div className="w-px h-6 bg-white/10 ml-1"></div>
              <div className="flex-1 flex items-center justify-center">
                {selectedVariationMode ? (
                  <span className="text-white/60 text-xs font-medium truncate capitalize">{selectedVariationMode}</span>
                ) : (
                  <span className="text-white/40 text-xs font-medium">Tools</span>
                )}
              </div>
            </div>
            */}

            {/* Input Container - Desktop — positioned + responsive width */}
            <div
              ref={(node) => { desktopPromptContainerRef.current = node; promptDropRef(node); }}
              className="absolute left-1/2 top-0 -translate-x-1/2 w-full min-w-[180px] transition-[max-width] duration-100 ease-out"
              style={{ maxWidth: `${desktopPromptMaxWidth}px`, zIndex: 55 }}
              onDragOver={(e) => { e.preventDefault(); setPromptDropHover(true); }}
              onDragLeave={() => setPromptDropHover(false)}
              onDrop={(e) => {
                e.preventDefault();
                setPromptDropHover(false);
                const files = e.dataTransfer?.files;
                if (files && files.length > 0 && uploadedImages.length < 10) {
                  Array.from(files).forEach((file) => {
                    if (!file.type.startsWith('image/')) return;
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setUploadedImages(prev => [...prev, {
                        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        url: reader.result as string,
                        refTypes: ['image'],
                      }]);
                    };
                    reader.readAsDataURL(file);
                  });
                }
              }}
            >
            {/* "Add Ingredient" badge — shows below prompt on any drop hover (native or dnd-kit) */}
            {isAnyDropHover && (
              <div style={{
                position: 'absolute', bottom: -36, left: '50%', transform: 'translateX(-50%)',
                background: '#222224', color: 'rgba(255,255,255,0.8)', fontWeight: 600, fontSize: 12,
                padding: '4px 14px', borderRadius: 6, whiteSpace: 'nowrap', border: '1px solid #27272a',
                zIndex: 50,
                animation: 'badgeScaleIn 180ms ease-out both', pointerEvents: 'none',
              }}>
                Add Ingredient
              </div>
            )}
            <div
              className={`min-h-[32px] lg:min-h-[40px] border rounded-md flex flex-col relative transition-all duration-300 overflow-visible ${
                isAnyDropHover
                  ? 'border-[#3a3a3d] bg-[#222224]'
                  : isDragActive
                    ? 'border-[#333336] bg-[#1a1a1c]'
                    : 'border-[#27272a] bg-[#1a1a1c]'
              }`}
              style={{
                ...(isDragActive && !isAnyDropHover ? { animation: 'promptDropPulse 2s ease-in-out infinite' } : {}),
              }}
            >
              {/* Text input row */}
              <div className="flex items-center flex-none h-8 lg:h-10">
                <button
                  onClick={handleImageClick}
                  className="p-2 ml-1 rounded-md flex items-center justify-center transition-all hover:bg-white/[0.08]"
                >
                  <svg className="w-5 h-5 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <div className="w-px h-6 bg-white/[0.08] ml-1 mr-3"></div>

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
                          if (e.key === 'Enter' && !isGenerating && (DEMO_MOCK_GENERATION_ENABLED || (prompt.trim() && selectedModel))) {
                            handleGenerate();
                          }
                        }}
                        maxLength={charLimit}
                        placeholder="Describe what you want to generate..."
                        className="flex-1 bg-transparent text-[#E0E0E0] text-sm placeholder:text-[#4b5563] outline-none focus:outline-none focus:ring-0 border-0 px-1"
                      />
                      {/* Character Counter */}
                      <span className={`text-xs mr-2 ${prompt.length >= warningThreshold ? 'text-red-400' : 'text-[#4b5563]'}`}>
                        {prompt.length}/{charLimit}
                      </span>
                    </>
                  );
                })()}
              </div>
              {/* Ingredient thumbnails — inside the prompt bar */}
              {uploadedImages.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 pb-2 pt-1 flex-wrap relative" style={{ overflow: 'visible', zIndex: 60 }}>
                  {uploadedImages.map((img) => (
                    <div key={img.id} className="relative group/thumb w-12 h-12"
                      onMouseEnter={(e) => { setHoveredRefImage({ url: img.url, rect: e.currentTarget.getBoundingClientRect() }); }}
                      onMouseLeave={() => setHoveredRefImage(null)}
                    >
                      <div className="w-full h-full rounded-md overflow-hidden border border-white/[0.08]">
                        <img src={img.url} alt="" className="w-full h-full object-cover" draggable={false} />
                        <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-all pointer-events-none rounded-md"></div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadedImages(prev => prev.filter(i => i.id !== img.id));
                          setHoveredRefImage(null);
                        }}
                        className="absolute inset-0 m-auto w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-all bg-black/60 hover:bg-black/80 z-10"
                      >
                        <svg className="w-2.5 h-2.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {/* Clear all — collapses the ingredients area */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadedImages([]);
                      setActiveImageId(null);
                      setHoveredRefImage(null);
                    }}
                    className="ml-auto flex items-center justify-center bg-[#1a1a1c] hover:bg-[#252525] border border-[#27272a] rounded-md text-[#6b7280] hover:text-white transition-colors duration-300 self-end"
                    style={{ width: 24, height: 24, minWidth: 24, minHeight: 24, padding: 0 }}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            </div>

            {/* Right-side controls group — flex-1 so search can expand into available space */}
            <div className="ml-auto flex-1 flex items-center justify-end gap-2 lg:gap-3 min-w-0">

            {/* Search — collapsed matches settings button exactly, expanded reveals from right */}
            <div
              ref={desktopSearchSlotRef}
              className="relative overflow-hidden"
              style={{
                width: hideDesktopSearchSlot ? '0rem' : showGallerySearch ? `${desktopLibrarySearchWidth}px` : '2.5rem',
                opacity: hideDesktopSearchSlot ? 0 : 1,
                transition: 'width 220ms ease-in-out, opacity 180ms ease-in-out',
                height: '2.5rem',
                pointerEvents: hideDesktopSearchSlot ? 'none' : 'auto',
              }}
            >
              <div
                className="absolute inset-0 h-10 w-full rounded-md bg-[#1a1a1c] pr-10 flex items-center"
                style={{
                  opacity: showGallerySearch ? 1 : 0,
                  transition: 'opacity 220ms ease-in-out',
                  pointerEvents: showGallerySearch ? 'auto' : 'none',
                }}
              >
                <div
                  className="min-w-0 flex-1 overflow-hidden pl-3 pr-1"
                  style={{
                    opacity: showGallerySearch ? 1 : 0,
                    transform: showGallerySearch ? 'translateX(0)' : 'translateX(10px)',
                    transition: 'opacity 220ms ease-in-out, transform 220ms ease-in-out',
                    pointerEvents: showGallerySearch ? 'auto' : 'none',
                  }}
                >
                  <input
                    ref={desktopSearchInputRef}
                    type="text"
                    value={gallerySearchQuery}
                    onChange={(e) => setGallerySearchQuery(e.target.value.slice(0, 500))}
                    onKeyDown={(e) => { if (e.key === 'Escape') closeDesktopGallerySearch(); }}
                    maxLength={500}
                    placeholder="Search..."
                    className="w-full min-w-0 bg-transparent text-[#E0E0E0] text-sm placeholder:text-[#4b5563] border-0 outline-none focus:outline-none focus:ring-0 shadow-none"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  if (showGallerySearch) {
                    closeDesktopGallerySearch();
                  } else {
                    if (desktopSearchCloseTimeoutRef.current) {
                      window.clearTimeout(desktopSearchCloseTimeoutRef.current);
                      desktopSearchCloseTimeoutRef.current = null;
                    }
                    hideDesktopModelControlsImmediate();
                    setShowGallerySearch(true);
                  }
                }}
                className="absolute right-0 top-0 z-10 h-10 w-10 flex items-center justify-center"
                aria-label="Toggle search"
              >
                <svg className={`w-5 h-5 transition-colors ${showGallerySearch || gallerySearchQuery ? 'text-white' : 'text-[#6b7280]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" strokeWidth="2" />
                  <path strokeLinecap="round" strokeWidth="2" d="M20 20L16.65 16.65" />
                </svg>
              </button>
            </div>

            {/* Settings Button Container — dropdown opens below */}
            <div ref={desktopSettingsButtonRef} className="relative">
              <div className="h-10 w-10 rounded-md flex items-center justify-center relative bg-transparent transition-colors duration-300 cursor-pointer"
                onClick={() => {
                    setAnimatingSettingsButton(true);
                    setTimeout(() => setAnimatingSettingsButton(false), 500);
                    if (showSettings) {
                      closeDesktopSettings();
                    } else {
                      if (desktopSettingsCloseTimeoutRef.current) {
                        window.clearTimeout(desktopSettingsCloseTimeoutRef.current);
                        desktopSettingsCloseTimeoutRef.current = null;
                      }
                      if (desktopAspectOptionsRevealTimeoutRef.current) {
                        window.clearTimeout(desktopAspectOptionsRevealTimeoutRef.current);
                        desktopAspectOptionsRevealTimeoutRef.current = null;
                      }
                      if (desktopResolutionOptionsRevealTimeoutRef.current) {
                        window.clearTimeout(desktopResolutionOptionsRevealTimeoutRef.current);
                        desktopResolutionOptionsRevealTimeoutRef.current = null;
                      }
                      setDesktopSettingsClosing(false);
                      setDesktopSettingsClosingView('default');
                      setShowResolutions(false);
                      setShowAspectRatios(false);
                      setDesktopSettingsView('default');
                      setDesktopAspectOptionsVisible(false);
                      setDesktopResolutionOptionsVisible(false);
                      setShowSettings(true);
                    }
                    setShowGallerySearch(false);
                    hideDesktopModelControlsImmediate();
                    setShowTools(false);
                    setSelectedTool(null);
                  }}
              >
                <button
                  className="h-full w-full flex items-center justify-center"
                >
                  <svg
                    className={`w-5 h-5 ${(showSettings || desktopSettingsClosing) ? 'text-white' : 'text-[#6b7280]'} ${animatingSettingsButton ? 'animate-gear-spin' : ''}`}
                    style={{ transformOrigin: 'center' }}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
              {showDesktopSettingsPanel && (
                <div
                  data-settings-panel
                  className="absolute right-full top-1/2 z-50 mr-2 hidden -translate-y-1/2 md:flex flex-row-reverse items-center gap-2"
                  style={{ pointerEvents: desktopSettingsClosing ? 'none' : 'auto' }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative flex flex-row-reverse items-center gap-0">
                    <div
                      className="relative h-8 overflow-hidden min-w-0 transition-[width,opacity,margin] duration-300 ease-in-out"
                        style={{
                          width: desktopSettingsMode === 'aspects' ? '0px' : `${desktopSelectedResolutionButtonWidth}px`,
                          opacity: desktopSettingsMode === 'aspects' ? 0 : 1,
                          marginLeft: `${desktopSettingsMode === 'resolutions' ? desktopQualityExpandedEdgeGapPx : DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                        }}
                      >
                      <div className="absolute right-0 top-0 opacity-0" style={{ animation: getDesktopSettingsAnimation(0, desktopSettingsAnimationMaxIndex) }}>
                        <button
                          ref={desktopSelectedResolutionButtonRef}
                          onClick={() => {
                            if (desktopAspectOptionsRevealTimeoutRef.current) {
                              window.clearTimeout(desktopAspectOptionsRevealTimeoutRef.current);
                              desktopAspectOptionsRevealTimeoutRef.current = null;
                            }
                            setDesktopAspectOptionsVisible(false);
                            setDesktopSettingsView((current) => current === 'resolutions' ? 'default' : 'resolutions');
                          }}
                          className="h-8 px-3 border border-white/10 rounded-md flex items-center gap-2 text-white/85 text-sm bg-[#1a1a1c] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-transparent hover:bg-[#252525] hover:text-white transition-all duration-200 ease-in-out"
                          style={{ pointerEvents: desktopSettingsMode === 'aspects' ? 'none' : 'auto' }}
                        >
                          <span className="font-medium">{selectedResolution?.label}</span>
                        </button>
                      </div>
                    </div>

                    {desktopSettingsMode === 'resolutions' && (desktopResolutionOptionsVisible || desktopSettingsClosing) && (
                      desktopResolutionOptions.map((res, index) => (
                        <button
                          key={res.value}
                          ref={index === 0 ? desktopLeadingResolutionButtonRef : null}
                          onClick={() => {
                            setResolution(res.value);
                            setDesktopSettingsView('default');
                          }}
                          className="h-8 px-3 border border-white/10 rounded-md flex items-center gap-2 text-white/75 text-sm bg-[#131416] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-transparent hover:bg-[#1a1b1e] hover:text-white transition-all duration-200 ease-in-out opacity-0"
                            style={{
                              animation: getDesktopSettingsAnimation(index + 1, desktopSettingsAnimationMaxIndex),
                              marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                              transform: 'translateX(6px)',
                            }}
                          >
                          <span className="font-medium">{res.label}</span>
                        </button>
                      ))
                    )}

                    <div
                      ref={desktopAspectRatioTriggerRef}
                      className="relative overflow-hidden min-w-0 transition-[max-width,opacity,margin,transform] duration-300 ease-in-out"
                      style={{
                        maxWidth: desktopSettingsMode === 'resolutions' ? '0px' : '96px',
                        opacity: desktopSettingsMode === 'resolutions' ? 0 : 1,
                        marginLeft: desktopSettingsMode === 'aspects' ? '0px' : `${DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                        transform: desktopSettingsMode === 'aspects' ? 'translateX(6px)' : 'translateX(0)',
                      }}
                    >
                      <div className="relative opacity-0" style={{ animation: getDesktopSettingsAnimation(desktopSettingsMode === 'aspects' ? 0 : 1, desktopSettingsAnimationMaxIndex) }}>
                        <button
                          onClick={() => {
                            if (desktopResolutionOptionsRevealTimeoutRef.current) {
                              window.clearTimeout(desktopResolutionOptionsRevealTimeoutRef.current);
                              desktopResolutionOptionsRevealTimeoutRef.current = null;
                            }
                            setDesktopResolutionOptionsVisible(false);
                            setDesktopSettingsView((current) => current === 'aspects' ? 'default' : 'aspects');
                          }}
                          className="h-8 px-3 border border-white/10 rounded-md flex items-center gap-2 text-white/85 text-sm bg-[#1a1a1c] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-transparent hover:bg-[#252525] hover:text-white transition-all duration-200 ease-in-out"
                          style={{ pointerEvents: desktopSettingsMode === 'resolutions' ? 'none' : 'auto' }}
                        >
                          <span className="font-medium">{aspectRatio}</span>
                        </button>
                      </div>
                    </div>

                    {desktopSettingsMode === 'aspects' && (desktopAspectOptionsVisible || desktopSettingsClosing) && (
                      desktopAspectRatioOptions.map((ar, index) => (
                        <button
                          key={ar.value}
                          onClick={() => {
                            setAspectRatio(ar.value);
                            setDesktopSettingsView('default');
                          }}
                          className="h-8 px-3 border border-white/10 rounded-md flex items-center gap-2 text-white/75 text-sm bg-[#131416] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-transparent hover:bg-[#1a1b1e] hover:text-white transition-all duration-200 ease-in-out opacity-0"
                          style={{
                            animation: desktopSettingsClosing
                              ? getDesktopSettingsAnimation(index + 1, desktopSettingsAnimationMaxIndex)
                              : `desktopSettingsReveal ${DESKTOP_SETTINGS_DURATION_MS}ms ease-in-out ${index * DESKTOP_SETTINGS_STAGGER_MS}ms both`,
                            marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                            transform: 'translateX(6px)',
                          }}
                        >
                          <span className="font-medium">{ar.value}</span>
                        </button>
                      ))
                    )}

                    <div
                      className="overflow-hidden min-w-0 transition-[max-width,opacity,margin] duration-300 ease-in-out"
                      style={{
                        maxWidth: desktopSettingsMode === 'default' ? '80px' : '0px',
                        opacity: desktopSettingsMode === 'default' ? 1 : 0,
                        marginLeft: `${DESKTOP_SETTINGS_BASE_GAP_PX}px`,
                      }}
                    >
                      <div className="h-8 border border-white/10 rounded-md flex items-center px-1 gap-0 bg-[#131416] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.22)]" style={{ animation: getDesktopSettingsAnimation(2, desktopSettingsAnimationMaxIndex) }}>
                        <button
                          onClick={handleDecrement}
                          className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent text-white/60 hover:bg-transparent hover:text-white transition-colors duration-200 ease-in-out cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={count <= 1}
                        >
                          <span className="text-lg leading-none translate-x-[2px]">-</span>
                        </button>
                        <div className="w-6 flex items-center justify-center">
                          <span className="text-white/80 text-sm font-medium">{count}</span>
                        </div>
                        <button
                          onClick={handleIncrement}
                          className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent text-white/60 hover:bg-transparent hover:text-white transition-colors duration-200 ease-in-out cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={count >= (currentModelCapabilities?.maxCount || 10)}
                        >
                          <span className="text-lg leading-none">+</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Favorites Button Container */}
            <div className="h-10 w-10 rounded-md flex items-center justify-center relative bg-transparent transition-colors duration-300">
            {/* Favorites Button */}
            <div className="relative group/favorites">
            <button
              onClick={() => {
                // Trigger animation
                setAnimatingFavButton(true);
                setTimeout(() => setAnimatingFavButton(false), 700);
                const newFavoritesOnly = !favoritesOnly;
                setFavoritesOnly(newFavoritesOnly);
                // When enabling favorites, show the favorites gallery. When disabling, go back to main gallery.
                if (newFavoritesOnly) {
                  setShowHistory(true);
                } else {
                  setShowHistory(false);
                }
                setShowSettings(false);
                hideDesktopModelControlsImmediate();
                setShowTools(false);
                setSelectedTool(null);
              }}
              className="h-full w-full flex items-center justify-center transition-colors"
            >
              <svg className={`w-5 h-5 ${favoritesOnly ? 'text-white' : 'text-[#6b7280]'}`} viewBox="0 0 50 50">
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
            <span className="pointer-events-none absolute right-0 top-full mt-2 px-2.5 py-1 bg-[#222224] border border-[#27272a] rounded-md text-[10px] text-white/80 whitespace-nowrap opacity-0 group-hover/favorites:opacity-100 transition-opacity z-30">{canViewHistory ? 'Favorites' : 'Sign in to view favorites'}</span>
            </div>
          </div>
          </div>
          {/* End right-side controls group */}
          </div>


          {/* Tools Floating Buttons - HIDDEN: Will be implemented in Image Studio later
          {showTools && (
            <div className="absolute left-0 md:left-[130px] right-0 md:right-auto top-full mt-2 flex flex-row md:flex-col flex-wrap md:flex-nowrap items-start gap-2 p-2 z-[100]">
              <div className="relative" style={{ animation: `fadeInDown 0.2s ease-out 0ms both` }}>
                <button
                  onClick={() => {
                    setSelectedTool(selectedTool === 'variations' ? null : 'variations');
                  }}
                  className={`h-9 w-9 bg-[#1a1a1c] backdrop-blur-md border rounded-lg flex items-center justify-center text-white/80 hover:bg-[#2a2a2d] transition-all shadow-lg ${
                    selectedTool === 'variations' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                  }`}
                  style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
                  title="Variations"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" />
                    <path d="M12 2L12 22" />
                    <path d="M3 7L21 17" />
                    <path d="M21 7L3 17" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  </svg>
                </button>
                {selectedTool === 'variations' && (
                  <div className="absolute left-0 top-full mt-1.5 flex flex-col gap-1.5 z-[110]">
                    <div className="relative group">
                      <button
                        onClick={() => {
                          setSelectedVariationMode('reframe');
                          setShowTools(false);
                          setSelectedTool(null);
                        }}
                        className={`h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border rounded-lg flex items-center gap-2 hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-xs font-medium ${
                          selectedVariationMode === 'reframe' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                        }`}
                        style={{
                          boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                          animation: `fadeInDown 0.2s ease-out 0ms both`
                        }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="5" width="14" height="14" rx="1" />
                          <path d="M15 3L21 3L21 9" />
                          <path d="M21 3L16 8" />
                          <path d="M9 21L3 21L3 15" />
                          <path d="M3 21L8 16" />
                        </svg>
                        Reframe
                      </button>
                      <div className="absolute left-0 top-full mt-1 px-2 py-1 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded text-[10px] text-white/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                        Create different angles and perspectives
                      </div>
                    </div>
                    <div className="relative group">
                      <button
                        onClick={() => {
                          setSelectedVariationMode('storyboard');
                          setShowTools(false);
                          setSelectedTool(null);
                        }}
                        className={`h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border rounded-lg flex items-center gap-2 hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-xs font-medium ${
                          selectedVariationMode === 'storyboard' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                        }`}
                        style={{
                          boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                          animation: `fadeInDown 0.2s ease-out 50ms both`
                        }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="2" width="8" height="6" rx="1" />
                          <rect x="14" y="2" width="8" height="6" rx="1" />
                          <rect x="2" y="10" width="8" height="6" rx="1" />
                          <rect x="14" y="10" width="8" height="6" rx="1" />
                          <rect x="8" y="18" width="8" height="4" rx="1" />
                        </svg>
                        Storyboard
                      </button>
                      <div className="absolute left-0 top-full mt-1 px-2 py-1 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded text-[10px] text-white/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                        Generate cinematic storyboard sequence
                      </div>
                    </div>
                    <div className="relative group">
                      <button
                        onClick={() => {
                          setSelectedVariationMode('custom');
                          setShowTools(false);
                          setSelectedTool(null);
                        }}
                        className={`h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border rounded-lg flex items-center gap-2 hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-xs font-medium ${
                          selectedVariationMode === 'custom' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                        }`}
                        style={{
                          boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                          animation: `fadeInDown 0.2s ease-out 100ms both`
                        }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                          <path d="M19 3v4" />
                          <path d="M21 5h-4" />
                        </svg>
                        Custom
                      </button>
                      <div className="absolute left-0 top-full mt-1 px-2 py-1 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded text-[10px] text-white/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                        Custom variations based on prompt
                      </div>
                    </div>
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
          End of Tools Floating Buttons */}
        </div>

        {/* Uploaded Images Container - moved inside prompt container */}

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
        <div
          className="image-history-container h-full rounded-md mt-3 flex-1 relative overflow-y-auto bg-black"
          style={{ width: '100%', scrollbarGutter: 'stable' }}
        >
          {/* History View - When showHistory is true (but NOT favorites — favorites uses the gallery grid) */}
          {showHistory && !favoritesOnly ? (
            <div className="pt-4">
              {!canViewHistory ? (
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
                  isLoading={isAuthenticated ? isHistoryLoading : false}
                  hasMore={isAuthenticated ? hasMore : false}
                  onLoadMore={() => {
                    if (isAuthenticated) loadMore();
                  }}
                  onDelete={handleDeleteGeneration}
                  onToggleFavorite={handleToggleFavoriteGeneration}
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
          <div className="flex flex-col-reverse md:flex-col gap-6 pt-0 pb-4">
            {/* Virtualized grid library view — React Virtuoso windowed rendering */}
            {gridItems.length > 0 && (
              <GalleryErrorBoundary>
              <div
                className="image-answer-container ml-3 mt-0 rounded-md py-0 px-0 md:ml-0 md:mt-0 md:py-0 md:px-3 relative bg-black"
                style={{ backgroundColor: 'rgba(255, 0, 0, 0.18)' }}
              >
                <div className="image-preview-container-wrapper relative w-full" style={{ flexGrow: 1 }}>
                  <div id="DndDescribedBy-0" style={{ display: 'none' }}>Press space bar to start a drag.</div>
                  <div ref={galleryContainerRef} className="w-full" style={{ overflowAnchor: 'none' }}>
                    <style>{`
                      @keyframes sweep { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
                      @keyframes letterWave {
                        0%, 100% { opacity: 0.5; transform: translateY(0); text-shadow: none; }
                        30% { opacity: 1; transform: translateY(-2px); text-shadow: 0 0 6px rgba(255,255,255,0.25); }
                        60% { opacity: 0.7; transform: translateY(0); text-shadow: none; }
                      }
                      @keyframes virtuosoTileFadeIn { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: translateY(0); } }
                      @keyframes searchBarExpand { 0% { opacity: 0; transform: scaleX(0.3); } 100% { opacity: 1; transform: scaleX(1); } }
                      @keyframes desktopCompanyEnter { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
                      @keyframes desktopCompanyExit { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } }
                      @keyframes searchInputFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
                      .virtuoso-tile-mount { animation: virtuosoTileFadeIn 320ms ease-out both; }
                      @keyframes skeletonShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
                      .tile-skeleton-bg { background: linear-gradient(90deg, #111113 25%, #1a1a1e 37%, #111113 63%); background-size: 200% 100%; animation: skeletonShimmer 1.6s ease-in-out infinite; }
                      @keyframes badgeScaleIn { 0% { transform: translateX(-50%) scale(0.7); opacity: 0; } 100% { transform: translateX(-50%) scale(1); opacity: 1; } }
                      .image-action-button + .image-action-tooltip { opacity: 0; transform: translateY(4px); }
                      .image-action-button:hover + .image-action-tooltip { opacity: 1; transform: translateY(0); }
                      [data-tile-id] { contain: layout style paint; will-change: transform, opacity; touch-action: none; }
                      [data-testid="virtuoso-row"] { contain: layout style; overflow-anchor: none; }
                    `}</style>
                    {!isMobile ? (
                      <Virtuoso
                        data={virtualizedRows}
                        useWindowScroll
                        overscan={400}
                        computeItemKey={(index, rowData) => `vrow-${index}-${rowData.items.length}-${rowData.items[0]?.key ?? ''}`}
                        defaultItemHeight={galleryRowHeightPx + galleryGapPx}
                        itemContent={(rowIndex, rowData) => (
                          <div data-testid="virtuoso-row" data-index={rowIndex} data-known-size={Math.round(rowData.knownSize)} className="flex items-start" style={{ gap: `${galleryGapPx}px`, height: `${rowData.rowHeight}px`, marginBottom: `${galleryGapPx}px`, width: '100%', overflowAnchor: 'none' }}>
                            {rowData.items.map((item, tileIndex) => {
                              const il = galleryItemLayout.get(item.key);
                              const tw = il?.width ?? galleryMinItemWidthPx;
                              const th = il?.height ?? galleryRowHeightPx;
                              const cardStyle: React.CSSProperties = { borderRadius: `${cardRadius}px`, overflow: 'hidden', width: `${tw}px`, height: `${th}px`, flex: '0 0 auto' };
                              if (item.kind === 'loading') return (<div key={item.key} data-tile-id={item.key} className="relative group border border-[#2a2a2d] virtuoso-tile-mount" style={{ ...cardStyle, backgroundColor: '#0a0a0c', animationDelay: `${tileIndex * 60}ms` }}><div className="w-full h-full relative overflow-hidden bg-[#111113]"><div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)', backgroundSize: '200% 100%', animation: 'sweep 2s ease-in-out infinite' }} /><div className="absolute inset-0 flex items-center justify-center z-10"><span className="text-white/60 text-[11px] font-medium tracking-[0.25em] uppercase">{'xenomorphing'.split('').map((letter, i) => (<span key={i} className="inline-block" style={{ animation: 'letterWave 2.4s ease-in-out infinite', animationDelay: `${i * 0.12}s` }}>{letter}</span>))}</span></div></div></div>);
                              if (item.kind === 'collage') { const { collage, assets: ca } = item; const cover = ca[0]?.imageUrl; return (<DroppableTile key={item.key} id={item.key}>{({ dropNodeRef, isOver: colOver }) => (<div ref={dropNodeRef} data-tile-id={collage.id} role="button" tabIndex={0} className={`relative group cursor-pointer overflow-hidden transition-all duration-200 ${colOver ? 'shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'hover:shadow-[0_0_15px_rgba(255,255,255,0.12)]'}`} style={{ ...cardStyle, background: '#0c0c0e', WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', outline: 'none' }} onClick={() => setExpandedCollageId(expandedCollageId === collage.id ? null : collage.id)}>{cover && <img src={cover} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ filter: 'blur(40px) brightness(0.35) saturate(1.4)', transform: 'scale(1.3)', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }} />}<div className="absolute inset-0 flex items-center justify-center" style={{ perspective: '800px' }}><div style={{ position: 'relative', width: '65%', height: '62%' }}>{ca.slice(0, Math.min(3, ca.length)).reverse().map((img, ci, arr) => { const t=arr.length; const rot=t===1?0:(ci-(t-1)/2)*12; const xs=t===1?0:(ci-(t-1)/2)*8; const sc=t===1?1:0.88+ci*0.06; return <img key={img.key} src={img.imageUrl} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ borderRadius: 6, transform: `rotate(${rot}deg) translateX(${xs}px) scale(${sc})`, boxShadow: `0 ${6+ci*3}px ${14+ci*6}px rgba(0,0,0,${0.35+ci*0.1})`, zIndex: ci, WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }} />; })}</div></div><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" /><div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20"><div className="relative"><button onClick={(e) => { e.stopPropagation(); setInlineRenamingCollageId(collage.id); }} className="image-action-button p-2 rounded-lg backdrop-blur-md bg-[#1a1a1c]/95 text-white/80 hover:bg-[#3a3a3d] hover:text-white transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button><span className="image-action-tooltip pointer-events-none absolute top-full mt-1 right-0 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] text-white transition-all z-30">Rename</span></div><div className="relative"><button onClick={(e) => { e.stopPropagation(); setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, isFavorite: !c.isFavorite } : c)); }} className={`image-action-button p-2 rounded-lg backdrop-blur-sm transition-all ${collage.isFavorite ? 'bg-[#27272a] text-white' : 'bg-[#1a1a1c]/95 text-white/80 hover:bg-[#3a3a3d] hover:text-white'}`}><svg className="w-4 h-4" fill={collage.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg></button><span className="image-action-tooltip pointer-events-none absolute top-full mt-1 right-0 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] text-white transition-all z-30">Favorite</span></div><div className="relative"><button onClick={(e) => { e.stopPropagation(); setCollages(prev => prev.filter(c => c.id !== collage.id)); }} className="image-action-button p-2 rounded-lg backdrop-blur-sm bg-[#1a1a1c]/80 text-white/80 hover:bg-white/20 hover:text-white transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button><span className="image-action-tooltip pointer-events-none absolute top-full mt-1 right-0 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] text-white transition-all z-30">Delete</span></div></div><div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-8 bg-gradient-to-t from-black/90 to-transparent z-10 flex items-end justify-between">{inlineRenamingCollageId === collage.id ? (<div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}><input ref={inlineRenameInputRef} type="text" defaultValue={collage.name} autoFocus className="font-semibold text-white/95 bg-transparent border-none outline-none focus:outline-none focus:ring-0 focus:border-none shadow-none p-0 m-0 min-w-0 flex-1" style={{ fontSize: '30px', boxShadow: 'none' }} onKeyDown={(e) => { if (e.key==='Enter'){const v=e.currentTarget.value.trim();if(v)setCollages(prev=>prev.map(c=>c.id===collage.id?{...c,name:v}:c));setInlineRenamingCollageId(null);}if(e.key==='Escape')setInlineRenamingCollageId(null);}} onBlur={(e)=>{const v=e.currentTarget.value.trim();if(v)setCollages(prev=>prev.map(c=>c.id===collage.id?{...c,name:v}:c));setInlineRenamingCollageId(null);}} /><button onClick={()=>{const v=inlineRenameInputRef.current?.value.trim();if(v)setCollages(prev=>prev.map(c=>c.id===collage.id?{...c,name:v}:c));setInlineRenamingCollageId(null);}} className="p-0.5 text-white/70 hover:text-white transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button><button onClick={()=>setInlineRenamingCollageId(null)} className="p-0.5 text-white/70 hover:text-white transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>) : (<p className="font-semibold text-white/95 truncate" style={{ fontSize: '30px' }}>{collage.name}</p>)}<span className="shrink-0 bg-white/20 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{collage.imageKeys.length}</span></div></div>)}</DroppableTile>); }
                              if (item.kind !== 'image') return null;
                              const { asset } = item;
                              const dragImgUrl = activeDragId ? libraryImages.find(li => li.key === activeDragId)?.imageUrl ?? null : null;
                              if (selectionMode || isMobile) {
                                // Selection mode or mobile: render without drag/drop wrappers
                                return (<div key={item.key} style={{ flex: '0 0 auto' }}><GalleryImageTile tileId={asset.generation.id} tileIndex={tileIndex} imageUrl={asset.imageUrl} imageIndex={asset.imageIndex} prompt={asset.generation.prompt} model={asset.generation.model} createdAt={asset.generation.created_at} isFavorite={asset.generation.is_favorite} cardRadius={cardRadius} cardStyle={cardStyle} animatingStars={animatingStars} loadedImageUrlsRef={loadedImageUrlsRef} onView={() => setViewingImage({ generationId: asset.generation.id, imageIndex: asset.imageIndex })} onToggleFavorite={() => { setAnimatingStars(prev => new Set(prev).add(asset.generation.id)); setTimeout(() => { setAnimatingStars(prev => { const n = new Set(prev); n.delete(asset.generation.id); return n; }); }, 700); handleToggleFavoriteGeneration(asset.generation.id); }} onUsePrompt={() => handleUsePrompt(asset.generation.prompt)} onRerun={() => handleRerun(asset.generation)} onDownload={() => handleDownloadSingleImage(asset.imageUrl, asset.generation.id, asset.imageIndex)} selectionMode={selectionMode} isSelected={selectedImageKeys.has(item.key)} onToggleSelect={() => toggleImageSelection(item.key)} onEnterSelectionMode={() => setSelectionMode(true)} /></div>);
                              }
                              return (<DroppableTile key={`drop-${item.key}`} id={item.key}>{({ dropNodeRef, isOver }) => (<DraggableTile key={item.key} id={item.key}>{({ dragAttributes, dragListeners, dragNodeRef, isDragging }) => (<div ref={(node) => { dragNodeRef(node); dropNodeRef(node); }} role="button" tabIndex={0} aria-roledescription="draggable" aria-describedby="DndDescribedBy-0" style={{ flex: '0 0 auto', opacity: isDragging ? 0.35 : 1, willChange: 'transform, opacity', contain: 'layout style paint' }} {...dragAttributes} {...dragListeners}>{isOver && !isDragging && dragImgUrl ? (<div className="collection-stack-preview" style={{ width: cardStyle.width, height: cardStyle.height, borderRadius: `${cardRadius}px`, overflow: 'visible', outline: '2px solid rgba(255, 255, 255, 0.5)', outlineOffset: '-2px', background: '#0c0c0e', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ position: 'relative', width: '70%', height: '70%' }}><img src={asset.imageUrl} alt="" draggable={false} className="w-full h-full object-cover" style={{ borderRadius: 8, transform: 'rotate(-8deg) scale(0.7)', boxShadow: '0 4px 14px rgba(0,0,0,0.5)' }} /><img src={dragImgUrl} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ borderRadius: 8, transform: 'rotate(8deg) scale(0.7)', boxShadow: '0 6px 18px rgba(0,0,0,0.6)', zIndex: 1 }} /></div><div style={{ position: 'absolute', bottom: 12, left: '50%', zIndex: 10, background: '#fff', color: '#000', fontWeight: 700, fontSize: 11, padding: '5px 16px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(0,0,0,0.35)', animation: 'badgeScaleIn 200ms ease-out both' }}>Create Collection</div></div>) : (<GalleryImageTile tileId={asset.generation.id} tileIndex={tileIndex} imageUrl={asset.imageUrl} imageIndex={asset.imageIndex} prompt={asset.generation.prompt} model={asset.generation.model} createdAt={asset.generation.created_at} isFavorite={asset.generation.is_favorite} cardRadius={cardRadius} cardStyle={cardStyle} animatingStars={animatingStars} loadedImageUrlsRef={loadedImageUrlsRef} onView={() => { if (!isDragging) setViewingImage({ generationId: asset.generation.id, imageIndex: asset.imageIndex }); }} onToggleFavorite={() => { setAnimatingStars(prev => new Set(prev).add(asset.generation.id)); setTimeout(() => { setAnimatingStars(prev => { const n = new Set(prev); n.delete(asset.generation.id); return n; }); }, 700); handleToggleFavoriteGeneration(asset.generation.id); }} onUsePrompt={() => handleUsePrompt(asset.generation.prompt)} onRerun={() => handleRerun(asset.generation)} onDownload={() => handleDownloadSingleImage(asset.imageUrl, asset.generation.id, asset.imageIndex)} selectionMode={selectionMode} isSelected={selectedImageKeys.has(item.key)} onToggleSelect={() => toggleImageSelection(item.key)} onEnterSelectionMode={() => setSelectionMode(true)} />)}</div>)}</DraggableTile>)}</DroppableTile>);
                            })}
                          </div>
                        )}
                      />
                    ) : (
                      <div className="w-full px-0 pb-24 pt-1">
                        <div className="flex flex-col gap-6">
                          {mobileGallerySections.map((section) => (
                            <section key={section.label} className="w-full">
                              <div className="px-1 pb-2 text-[13px] font-medium text-white/80">
                                {section.label}
                              </div>
                              <div className="grid grid-cols-3 gap-[6px] bg-black">
                                {section.items.map((item, tileIndex) => {
                                  if (item.kind === 'collage') {
                                    const { collage, assets: ca } = item;
                                    const cover = ca[0]?.imageUrl;
                                    return (
                                      <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => setExpandedCollageId(expandedCollageId === collage.id ? null : collage.id)}
                                        className="relative block aspect-square w-full overflow-hidden bg-[#0c0c0e] text-left"
                                        style={{ WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', outline: 'none' }}
                                      >
                                        {cover && (
                                          <img
                                            src={cover}
                                            alt=""
                                            draggable={false}
                                            className="absolute inset-0 h-full w-full object-cover"
                                            style={{ filter: 'blur(32px) brightness(0.35) saturate(1.35)', transform: 'scale(1.22)' }}
                                          />
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: '800px' }}>
                                          <div style={{ position: 'relative', width: '64%', height: '60%' }}>
                                            {ca.slice(0, Math.min(3, ca.length)).reverse().map((img, ci, arr) => {
                                              const total = arr.length;
                                              const rotation = total === 1 ? 0 : (ci - (total - 1) / 2) * 12;
                                              const shiftX = total === 1 ? 0 : (ci - (total - 1) / 2) * 8;
                                              const scale = total === 1 ? 1 : 0.88 + ci * 0.06;
                                              return (
                                                <img
                                                  key={img.key}
                                                  src={img.imageUrl}
                                                  alt=""
                                                  draggable={false}
                                                  className="absolute inset-0 h-full w-full object-cover"
                                                  style={{
                                                    borderRadius: 6,
                                                    transform: `rotate(${rotation}deg) translateX(${shiftX}px) scale(${scale})`,
                                                    boxShadow: `0 ${6 + ci * 3}px ${14 + ci * 6}px rgba(0,0,0,${0.35 + ci * 0.1})`,
                                                    zIndex: ci,
                                                  }}
                                                />
                                              );
                                            })}
                                          </div>
                                        </div>
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, isFavorite: !c.isFavorite } : c));
                                          }}
                                          className={`absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                                            collage.isFavorite ? 'bg-[#27272a] text-white' : 'bg-black/45 text-white/75'
                                          }`}
                                        >
                                          <svg className="h-3.5 w-3.5" fill={collage.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                          </svg>
                                        </button>
                                        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-2.5 pb-2.5 pt-8">
                                          <p className="min-w-0 truncate text-[11px] font-semibold text-white/95">
                                            {collage.name}
                                          </p>
                                          <span className="ml-2 shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                                            {collage.imageKeys.length}
                                          </span>
                                        </div>
                                      </button>
                                    );
                                  }

                                  const { asset } = item;
                                  return (
                                    <div key={item.key} className="w-full bg-black">
                                      <GalleryImageTile
                                        tileId={asset.generation.id}
                                        tileIndex={tileIndex}
                                        imageUrl={asset.imageUrl}
                                        imageIndex={asset.imageIndex}
                                        prompt={asset.generation.prompt}
                                        model={asset.generation.model}
                                        createdAt={asset.generation.created_at}
                                        isFavorite={asset.generation.is_favorite}
                                        cardRadius={0}
                                        cardStyle={{ width: '100%', aspectRatio: '1 / 1', display: 'block' }}
                                        animatingStars={animatingStars}
                                        loadedImageUrlsRef={loadedImageUrlsRef}
                                        onView={() => setViewingImage({ generationId: asset.generation.id, imageIndex: asset.imageIndex })}
                                        onToggleFavorite={() => { setAnimatingStars(prev => new Set(prev).add(asset.generation.id)); setTimeout(() => { setAnimatingStars(prev => { const n = new Set(prev); n.delete(asset.generation.id); return n; }); }, 700); handleToggleFavoriteGeneration(asset.generation.id); }}
                                        onUsePrompt={() => handleUsePrompt(asset.generation.prompt)}
                                        onRerun={() => handleRerun(asset.generation)}
                                        onDownload={() => handleDownloadSingleImage(asset.imageUrl, asset.generation.id, asset.imageIndex)}
                                        selectionMode={selectionMode}
                                        isSelected={selectedImageKeys.has(item.key)}
                                        onToggleSelect={() => toggleImageSelection(item.key)}
                                        onEnterSelectionMode={() => setSelectionMode(true)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      </div>
                    )}
                    <DragOverlay>{activeDragId && !isMobile ? (() => { const di = gridItems.find(i => i.key === activeDragId && i.kind === 'image'); if (!di || di.kind !== 'image') return null; const dl = galleryItemLayout.get(di.key); return (<div style={{ width: dl?.width ?? galleryMinItemWidthPx, height: dl?.height ?? galleryRowHeightPx, borderRadius: cardRadius, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', opacity: 0.85 }}><img src={di.asset.imageUrl} alt="Dragging" draggable={false} className="w-full h-full object-cover block" style={{ borderRadius: cardRadius }} /></div>); })() : null}</DragOverlay>
                  </div>
                </div>
              </div>
              </GalleryErrorBoundary>
            )}

            {/* Expanded collection overlay */}
            {expandedCollageId && (() => {
              const collage = collages.find(c => c.id === expandedCollageId);
              if (!collage) return null;
              const imagesByKey = new Map(libraryImages.map(a => [a.key, a]));
              const collageImages = collage.imageKeys.map(k => imagesByKey.get(k)).filter(Boolean) as typeof libraryImages;
              return (
                <div
                  className="fixed inset-0 z-[200] flex flex-col"
                  style={{ background: '#000' }}
                  onClick={(e) => { if (e.target === e.currentTarget) { setExpandedCollageId(null); setIsEditingCollageName(false); } }}
                >
                  {/* Header */}
                  {isMobile ? (
                    <div
                      className="relative shrink-0 px-4 py-4"
                    >
                      <button
                        onClick={() => { setExpandedCollageId(null); setIsEditingCollageName(false); }}
                        className="absolute left-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full text-white/90 flex items-center justify-center"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, isFavorite: !c.isFavorite } : c));
                        }}
                        className="absolute right-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full text-white/90 flex items-center justify-center"
                      >
                        <svg className="w-5 h-5" fill={collage.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </button>
                      <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {isEditingCollageName ? (
                            <>
                              <input
                                ref={collageNameInputRef}
                                type="text"
                                defaultValue={collage.name}
                                autoFocus
                                className="text-white text-2xl font-semibold bg-transparent border-0 outline-none focus:outline-none p-0 m-0 text-center"
                                style={{ minWidth: 80, maxWidth: 300 }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, name: v } : c)); setIsEditingCollageName(false); }
                                  if (e.key === 'Escape') setIsEditingCollageName(false);
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button onClick={(e) => { e.stopPropagation(); const v = collageNameInputRef.current?.value.trim(); if (v) setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, name: v } : c)); setIsEditingCollageName(false); }} className="p-0.5 text-white/70 hover:text-white transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                              <button onClick={(e) => { e.stopPropagation(); setIsEditingCollageName(false); }} className="p-0.5 text-white/70 hover:text-white transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </>
                          ) : (
                            <h2
                              className="text-white text-2xl font-semibold cursor-pointer rounded px-1 py-0.5 transition-colors"
                              onClick={(e) => { e.stopPropagation(); setIsEditingCollageName(true); }}
                            >
                              {collage.name}
                              <svg className="w-5 h-5 inline-block ml-2 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </h2>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-6 py-4 shrink-0">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => { setExpandedCollageId(null); setIsEditingCollageName(false); }}
                          className="p-2 rounded-lg hover:bg-[#252525] transition-colors text-white/70 hover:text-white"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                          </svg>
                        </button>
                        <div>
                          <div className="flex items-center gap-1.5">
                            {isEditingCollageName ? (
                              <>
                                <input
                                  ref={collageNameInputRef}
                                  type="text"
                                  defaultValue={collage.name}
                                  autoFocus
                                  className="text-white text-2xl font-semibold bg-transparent border-0 outline-none focus:outline-none p-0 m-0"
                                  style={{ minWidth: 80, maxWidth: 300 }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, name: v } : c)); setIsEditingCollageName(false); }
                                    if (e.key === 'Escape') setIsEditingCollageName(false);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <button onClick={(e) => { e.stopPropagation(); const v = collageNameInputRef.current?.value.trim(); if (v) setCollages(prev => prev.map(c => c.id === collage.id ? { ...c, name: v } : c)); setIsEditingCollageName(false); }} className="p-0.5 text-white/70 hover:text-white transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                                <button onClick={(e) => { e.stopPropagation(); setIsEditingCollageName(false); }} className="p-0.5 text-white/70 hover:text-white transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                              </>
                            ) : (
                              <h2
                                className="text-white text-2xl font-semibold cursor-pointer hover:bg-white/10 rounded px-1 -ml-1 py-0.5 transition-colors"
                                onClick={(e) => { e.stopPropagation(); setIsEditingCollageName(true); }}
                              >
                                {collage.name}
                                <svg className="w-5 h-5 inline-block ml-2 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </h2>
                            )}
                          </div>
                          <p className="text-white/50 text-xs">{collage.imageKeys.length} items</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setExpandedCollageId(null); setIsEditingCollageName(false); }}
                        className="p-2 rounded-lg hover:bg-[#252525] transition-colors text-white/60 hover:text-white"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {/* Image grid — mobile matches main mobile library, desktop keeps justified collage layout */}
                  <div className={`flex-1 overflow-y-auto ${isMobile ? 'px-4 pb-24 pt-1' : 'px-4 md:px-8 lg:px-12 pb-6'}`} style={{ overflowAnchor: 'none' }}>
                    {isMobile ? (
                      <div className="w-full">
                        <div className="grid grid-cols-3 gap-[6px] bg-black">
                          {collageImages.map((asset, ci) => (
                            <div key={asset.key} className="w-full bg-black">
                              <GalleryImageTile
                                tileId={asset.generation.id}
                                tileIndex={ci}
                                imageUrl={asset.imageUrl}
                                imageIndex={asset.imageIndex}
                                prompt={asset.generation.prompt}
                                model={asset.generation.model}
                                createdAt={asset.generation.created_at}
                                isFavorite={asset.generation.is_favorite}
                                cardRadius={0}
                                cardStyle={{ width: '100%', aspectRatio: '1 / 1', display: 'block' }}
                                animatingStars={animatingStars}
                                loadedImageUrlsRef={loadedImageUrlsRef}
                                onView={() => setViewingImage({ generationId: asset.generation.id, imageIndex: asset.imageIndex })}
                                onToggleFavorite={() => { setAnimatingStars(prev => new Set(prev).add(asset.generation.id)); setTimeout(() => { setAnimatingStars(prev => { const n = new Set(prev); n.delete(asset.generation.id); return n; }); }, 700); handleToggleFavoriteGeneration(asset.generation.id); }}
                                onUsePrompt={() => handleUsePrompt(asset.generation.prompt)}
                                onRerun={() => handleRerun(asset.generation)}
                                onDownload={() => handleDownloadSingleImage(asset.imageUrl, asset.generation.id, asset.imageIndex)}
                                selectionMode={selectionMode}
                                isSelected={selectedImageKeys.has(asset.key)}
                                onToggleSelect={() => toggleImageSelection(asset.key)}
                                onEnterSelectionMode={() => setSelectionMode(true)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div id="DndDescribedBy-1" style={{ display: 'none' }}>Press space bar to start a drag. When dragging, use arrow keys to move. Press space again to drop, or escape to cancel.</div>
                        <DndContext sensors={dndSensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
                        {(() => {
                          const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
                          const padTotal = winW >= 1024 ? 96 : winW >= 768 ? 64 : 32;
                          const containerWidth = Math.max(300, winW - padTotal);
                          const maxH = galleryMaxRowHeightPx;
                          const gap = galleryGapPx;
                          const getAspect = (a: typeof collageImages[number]) => Math.max(0.35, Math.min(2.8, parseAspectRatioValue(a.generation.aspect_ratio)));
                          const rows: typeof collageImages[] = [];
                          let cur: typeof collageImages = [];
                          collageImages.forEach((a) => { cur.push(a); const as2 = cur.reduce((s, i) => s + getAspect(i), 0); const g = gap * Math.max(0, cur.length - 1); const rh = (containerWidth - g) / as2; if (cur.length >= 2 && rh <= maxH) { rows.push(cur); cur = []; } });
                          if (cur.length > 0) rows.push(cur);
                          return rows.map((row, ri) => {
                            const as2 = row.reduce((s, a) => s + getAspect(a), 0);
                            const g = gap * Math.max(0, row.length - 1);
                            const justH = (containerWidth - g) / as2;
                            const rowH = Math.min(maxH, Math.max(1, justH));
                            return (
                              <div key={ri} data-testid="virtuoso-row" data-index={ri} data-known-size={Math.round(rowH + gap)} className="flex items-start" style={{ gap, marginBottom: gap, overflowAnchor: 'none', contain: 'layout style' }}>
                                {row.map((asset, ci) => {
                                  const w = Math.max(90, rowH * getAspect(asset));
                                  const tileCardStyle: React.CSSProperties = { borderRadius: `${cardRadius}px`, overflow: 'hidden', width: `${w}px`, height: `${rowH}px`, flex: '0 0 auto' };
                                  return (
                                    <DroppableTile key={`drop-${asset.key}`} id={asset.key}>
                                      {({ dropNodeRef, isOver: tileIsOver }) => (
                                    <DraggableTile key={asset.key} id={asset.key}>
                                      {({ dragAttributes, dragListeners, dragNodeRef, isDragging }) => (
                                        <div ref={(node) => { dragNodeRef(node); dropNodeRef(node); }} data-tile-id={asset.generation.id} data-item-index={ci} role="button" tabIndex={0} aria-disabled={false} aria-roledescription="draggable" aria-describedby="DndDescribedBy-1" style={{ flex: '0 0 auto', opacity: isDragging ? 0.35 : 1, willChange: 'transform, opacity', contain: 'layout style paint', touchAction: 'none', position: 'relative' }} {...dragAttributes} {...dragListeners}>
                                          <GalleryImageTile tileId={asset.generation.id} tileIndex={ci} imageUrl={asset.imageUrl} imageIndex={asset.imageIndex} prompt={asset.generation.prompt} model={asset.generation.model} createdAt={asset.generation.created_at} isFavorite={asset.generation.is_favorite} cardRadius={cardRadius} cardStyle={tileCardStyle} animatingStars={animatingStars} loadedImageUrlsRef={loadedImageUrlsRef}
                                            onView={() => { if (!isDragging) setViewingImage({ generationId: asset.generation.id, imageIndex: asset.imageIndex }); }}
                                            onToggleFavorite={() => { setAnimatingStars(prev => new Set(prev).add(asset.generation.id)); setTimeout(() => { setAnimatingStars(prev => { const n = new Set(prev); n.delete(asset.generation.id); return n; }); }, 700); handleToggleFavoriteGeneration(asset.generation.id); }}
                                            onUsePrompt={() => handleUsePrompt(asset.generation.prompt)} onRerun={() => handleRerun(asset.generation)} onDownload={() => handleDownloadSingleImage(asset.imageUrl, asset.generation.id, asset.imageIndex)}
                                          />
                                          <button onClick={(e) => { e.stopPropagation(); setCollages(prev => prev.map(c => c.id === expandedCollageId ? { ...c, imageKeys: c.imageKeys.filter(k => k !== asset.key) } : c).filter(c => c.imageKeys.length > 0)); if (collage.imageKeys.length <= 1) { setExpandedCollageId(null); setIsEditingCollageName(false); } }} className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white/60 hover:text-white hover:bg-red-500/80 opacity-0 hover:opacity-100 transition-all z-30" title="Remove from collection">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                                          </button>
                                        </div>
                                      )}
                                    </DraggableTile>
                                      )}
                                    </DroppableTile>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                        <DragOverlay>{activeDragId ? (() => { const da = collageImages.find(a => a.key === activeDragId); if (!da) return null; const asp = Math.max(0.35, parseAspectRatioValue(da.generation.aspect_ratio)); const h = galleryRowHeightPx; const w = h * asp; return (<div style={{ width: w, height: h, borderRadius: cardRadius, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', opacity: 0.85 }}><img src={da.imageUrl} alt="Dragging" draggable={false} className="w-full h-full object-cover block" style={{ borderRadius: cardRadius }} /></div>); })() : null}</DragOverlay>
                        </DndContext>
                      </>
                    )}
                  </div>
                  {/* Generate inside collection — prompt bar at bottom */}
                  {!isMobile && (
                  <div className="shrink-0 px-4 md:px-8 lg:px-12 pb-4 pt-2">
                    <div className="max-w-2xl mx-auto flex items-center gap-2">
                      <div className="flex-1 h-10 border border-[#27272a] rounded-md flex items-center bg-[#1a1a1c] overflow-hidden">
                        <button onClick={handleImageClick} className="p-2 flex items-center justify-center">
                          <svg className="w-4 h-4 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </button>
                        <div className="w-px h-5 bg-white/[0.08]"></div>
                        <input
                          type="text"
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value.slice(0, resolution === '4k' ? 800 : resolution === '2k' ? 650 : 500))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isGenerating && (DEMO_MOCK_GENERATION_ENABLED || (prompt.trim() && selectedModel))) {
                              handleGenerate();
                            }
                          }}
                          placeholder={`Generate into "${collage.name}"...`}
                          className="flex-1 bg-transparent text-[#E0E0E0] text-sm placeholder:text-[#4b5563] border-0 outline-none focus:outline-none focus:ring-0 shadow-none px-2"
                        />
                      </div>
                      {/* Generate button */}
                      <button
                        onClick={() => {
                          if (!isGenerating && (DEMO_MOCK_GENERATION_ENABLED || (prompt.trim() && selectedModel))) {
                            handleGenerate();
                          }
                        }}
                        disabled={isGenerating}
                        className="h-10 px-4 border border-[#27272a] rounded-md flex items-center justify-center bg-[#1a1a1c] hover:bg-[#252525] transition-colors duration-300 text-white/80 text-sm disabled:opacity-40"
                      >
                        {isGenerating ? 'Generating...' : 'Generate'}
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              );
            })()}

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
      </DndContext>
      </div>

      {/* Image Viewer Modal */}
      {viewingImage && (() => {
        const currentGen = generations.find(g => g.id === viewingImage.generationId);
        if (!currentGen) return null;
        const currentImageUrl = currentGen.image_urls[viewingImage.imageIndex];
        const currentImageKey = `${currentGen.id}-${viewingImage.imageIndex}`;

        const { allImages, currentIndex } = getViewerImageSet();

        return (
          <>
            {/* Mobile Full Screen Viewer */}
            {isMobile && (
              <div className="fixed inset-0 bg-black z-[1000] flex flex-col">
                <div
                  className="relative flex-1 overflow-hidden"
                  onTouchStart={handleMobileViewerTouchStart}
                  onTouchEnd={handleMobileViewerTouchEnd}
                >
                  <div className={`absolute top-0 left-0 right-0 flex items-start justify-between z-20 bg-gradient-to-b from-black/55 via-black/10 to-transparent ${isMobileLandscape ? 'px-3 pt-3 pb-2' : 'px-4 pt-6 pb-4'}`}>
                    <button
                      onClick={() => setViewingImage(null)}
                      className="h-11 w-11 rounded-full text-white/90 flex items-center justify-center"
                    >
                      {showDetailsOverlay ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>

                    {showDetailsOverlay && (
                      <div className="relative flex items-center gap-1">
                        <button
                          onClick={() => handleToggleFavoriteGeneration(currentGen.id)}
                          className="h-11 w-11 rounded-full text-white/88 flex items-center justify-center"
                          aria-label={currentGen.is_favorite ? 'Remove favorite' : 'Add favorite'}
                        >
                          <svg className="w-5 h-5" fill={currentGen.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDownloadSingleImage(currentImageUrl, currentGen.id, viewingImage.imageIndex)}
                          className="h-11 w-11 rounded-full text-white/88 flex items-center justify-center"
                          aria-label="Download image"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleShareSingleImage(currentImageUrl, currentGen.id, viewingImage.imageIndex, currentGen.prompt)}
                          className="h-11 w-11 rounded-full text-white/88 flex items-center justify-center"
                          aria-label="Share image"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle cx="18" cy="5" r="2.25" strokeWidth={2} />
                            <circle cx="6" cy="12" r="2.25" strokeWidth={2} />
                            <circle cx="18" cy="19" r="2.25" strokeWidth={2} />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.05 10.98l7.9-4.96" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.05 13.02l7.9 4.96" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setShowMobileViewerMenu((prev) => {
                              const next = !prev;
                              if (next) setMobileViewerMenuView('root');
                              return next;
                            });
                          }}
                          className="h-11 w-11 rounded-full text-white/88 flex items-center justify-center"
                          aria-label="More options"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6h.01M12 12h.01M12 18h.01" />
                          </svg>
                        </button>
                        {showMobileViewerMenu && (
                          <div className="absolute top-full right-0 mt-3 w-52 rounded-2xl border border-white/10 bg-[#111113]/95 p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
                            {mobileViewerMenuView === 'root' ? (
                              <>
                                <button
                                  onClick={() => setMobileViewerMenuView('collage')}
                                  className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
                                >
                                  Add to collage
                                </button>
                                <button
                                  onClick={async () => {
                                    const deleted = await handleDeleteGeneration(currentGen.id);
                                    setShowMobileViewerMenu(false);
                                    setMobileViewerMenuView('root');
                                    if (deleted) {
                                      setViewingImage(null);
                                    }
                                  }}
                                  className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-red-300 hover:bg-white/[0.08] transition-colors"
                                >
                                  Delete image
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setMobileViewerMenuView('root')}
                                  className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/70 hover:bg-white/[0.08] transition-colors"
                                >
                                  Back
                                </button>
                                <button
                                  onClick={() => {
                                    setCollages(prev => [...prev, {
                                      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                      name: `Collection ${prev.length + 1}`,
                                      imageKeys: [currentImageKey],
                                    }]);
                                    setShowMobileViewerMenu(false);
                                    setMobileViewerMenuView('root');
                                  }}
                                  className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
                                >
                                  Create new collage
                                </button>
                                {collages.length > 0 ? (
                                  collages.map((collage) => (
                                    <button
                                      key={collage.id}
                                      onClick={() => {
                                        setCollages(prev => prev.map(c => {
                                          if (c.id !== collage.id) return c;
                                          if (c.imageKeys.includes(currentImageKey)) return c;
                                          return { ...c, imageKeys: [...c.imageKeys, currentImageKey] };
                                        }));
                                        setShowMobileViewerMenu(false);
                                        setMobileViewerMenuView('root');
                                      }}
                                      className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
                                    >
                                      {collage.name}
                                    </button>
                                  ))
                                ) : (
                                  <div className="px-3 py-2 text-xs text-white/45">
                                    No existing collages yet.
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    className={`absolute inset-0 flex items-center justify-center ${isMobileLandscape ? 'px-2 pt-12 pb-14' : 'px-4'}`}
                    onClick={() => setShowDetailsOverlay((prev) => !prev)}
                  >
                    <img
                      src={currentImageUrl}
                      alt="Enlarged view"
                      className={`relative z-10 rounded-xl select-none shadow-[0_20px_50px_rgba(0,0,0,0.35)] ${isMobileLandscape ? 'max-h-full w-auto max-w-full h-full object-contain' : 'w-full h-auto object-contain'}`}
                    />
                  </div>

                  {!showDetailsOverlay && (
                    <div className={`absolute left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/35 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur-xl ${isMobileLandscape ? 'bottom-3' : 'bottom-8'}`}>
                      Tap image for details
                    </div>
                  )}

                  <div className={`absolute inset-x-0 bottom-0 z-20 transition-all duration-300 ${showDetailsOverlay ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
                    <div className={`bg-gradient-to-t from-black via-black/92 to-transparent ${isMobileLandscape ? 'px-3 pb-3 pt-10' : 'px-4 pb-6 pt-20'}`}>
                      <div className="flex items-end gap-3">
                        <div className="min-w-0 flex-1">
                          <p className={`text-white/[0.94] ${isMobileLandscape ? 'text-[13px] leading-5' : 'text-[15px] leading-6'} ${mobileViewerPromptExpanded ? '' : 'line-clamp-3'}`}>
                            {currentGen.prompt}
                          </p>
                          {currentGen.prompt.length > 140 && (
                            <button
                              onClick={() => setMobileViewerPromptExpanded((prev) => !prev)}
                              className="mt-2 text-[11px] font-medium text-white/60"
                            >
                              {mobileViewerPromptExpanded ? 'Show less' : 'Show more'}
                            </button>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                            {currentGen.reference_images && currentGen.reference_images.length > 0 && (
                              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">
                                Reference Images
                              </span>
                            )}
                            <span>{currentGen.model || 'Unknown model'}</span>
                            <span className="text-white/35">|</span>
                            <span>{currentGen.aspect_ratio}</span>
                          </div>
                        </div>

                      </div>

                      <div className={`flex items-center gap-3 ${isMobileLandscape ? 'mt-3' : 'mt-5'}`}>
                        <button
                          onClick={() => {
                            handleRerun(currentGen);
                            setViewingImage(null);
                          }}
                          className={`flex-1 rounded-xl bg-white text-black font-semibold shadow-[0_8px_20px_rgba(255,255,255,0.08)] ${isMobileLandscape ? 'py-2 text-[12px]' : 'py-2.5 text-[13px]'}`}
                        >
                          Recreate
                        </button>
                        <button
                          onClick={() => {
                            handleUseImageAsReference(currentImageUrl);
                          }}
                          className={`flex-1 rounded-xl border border-white/14 bg-white/[0.08] text-white font-semibold backdrop-blur-xl ${isMobileLandscape ? 'py-2 text-[12px]' : 'py-2.5 text-[13px]'}`}
                        >
                          Use as
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Desktop Modal Content */}
          <div
            className={`fixed inset-0 z-[300] flex items-start md:items-center justify-center overflow-y-auto md:overflow-hidden ${isMobile ? 'hidden' : ''}`}
          >
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => {
                setViewingImage(null);
                setShowDetailsOverlay(false);
              }}
            />

            {/* Modal Content */}
            <div className="relative z-10 flex flex-col md:flex-row gap-4 w-full md:h-full p-4 md:p-6 pt-16 md:pt-12 max-w-[95vw] pb-64 md:pb-12">
              {/* Main Image — offset to compensate for right panel (~208px = half of panel+thumbnails+gap) */}
              <div className="flex-1 flex items-center justify-center min-w-0 order-1 md:order-2 relative">
                <div
                  className="relative cursor-pointer md:cursor-default"
                  onClick={() => {
                    if (window.innerWidth < 768) {
                      setShowDetailsOverlay(!showDetailsOverlay);
                    }
                  }}
                >
                  <img
                    src={currentImageUrl}
                    alt="Enlarged view"
                    className="max-w-full max-h-[50vh] md:max-h-[calc(100vh-180px)] object-contain rounded-md"
                  />
                  {/* Details Overlay on Image - Mobile only */}
                  {showDetailsOverlay && (
                    <div className="md:hidden absolute inset-0 bg-black/70 backdrop-blur-sm rounded-md p-4 overflow-y-auto flex flex-col">
                      {/* Prompt */}
                      <p className="text-[#E0E0E0] text-sm leading-relaxed mb-3">{currentGen.prompt}</p>

                      {/* Settings */}
                      <div className="border-t border-[#27272a] pt-3 mt-auto">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-[#6b7280]">Model</div>
                          <div className="text-[#E0E0E0]">{currentGen.model}</div>
                          <div className="text-[#6b7280]">Aspect Ratio</div>
                          <div className="text-[#E0E0E0]">{currentGen.aspect_ratio}</div>
                          <div className="text-[#6b7280]">Resolution</div>
                          <div className="text-[#E0E0E0]">{currentGen.resolution}</div>
                        </div>
                      </div>

                      {/* Tap to hide hint */}
                      <p className="text-white/40 text-xs text-center mt-3">Tap to hide</p>
                    </div>
                  )}
                </div>
                {/* Tap for details hint - Mobile only, when overlay is hidden */}
                {!showDetailsOverlay && (
                  <p className="md:hidden absolute bottom-2 left-1/2 -translate-x-1/2 text-white/40 text-xs bg-black/50 px-2 py-1 rounded">Tap image for details</p>
                )}
              </div>

              {/* Info Panel Wrapper - Hidden on mobile, details shown as overlay on image */}
              <div className="hidden md:flex md:flex-col md:w-80 flex-shrink-0 relative order-3 md:order-3">
                {/* Close Button - positioned to the left of info panel on desktop */}
                <button
                  onClick={() => setViewingImage(null)}
                  className="fixed top-6 right-6 flex items-center justify-center bg-[#1a1a1c] hover:bg-[#252525] border border-[#27272a] rounded-md text-[#6b7280] hover:text-white transition-colors duration-300 z-[301]"
                  style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, padding: 0 }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {/* Info Panel */}
                <div className="w-full bg-[#1a1a1c] border border-[#27272a] rounded-md p-4 flex flex-col justify-between md:overflow-y-auto md:max-h-[calc(100vh-180px)] relative">
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
                    className="p-1.5 rounded-md hover:bg-[#252525] text-[#6b7280] hover:text-white transition-colors duration-300"
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
                      handleToggleFavoriteGeneration(currentGen.id);
                    }}
                    className={`p-1.5 rounded-md hover:bg-[#252525] transition-colors duration-300 ${currentGen.is_favorite ? 'text-white' : 'text-[#6b7280] hover:text-white'}`}
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
                      if (currentGen.id.startsWith('local-')) {
                        setLocalGenerations(prev => prev.filter(gen => gen.id !== currentGen.id));
                      } else {
                        deleteGeneration(currentGen.id);
                      }
                      setViewingImage(null);
                    }}
                    className="p-1.5 rounded-md hover:bg-[#252525] text-[#6b7280] hover:text-white transition-colors duration-300"
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
                    <p className="text-[#E0E0E0] text-sm leading-relaxed">{currentGen.prompt}</p>
                  </div>

                  {/* Reference Images Section */}
                  {currentGen.reference_images && currentGen.reference_images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {currentGen.reference_images.map((refImg, idx) => (
                        <div key={idx} className="relative w-[40px] h-[40px] group/refimg"
                          onMouseEnter={(e) => { setHoveredRefImage({ url: refImg.url, rect: e.currentTarget.getBoundingClientRect() }); }}
                          onMouseLeave={() => setHoveredRefImage(null)}
                        >
                          <div className="w-full h-full rounded-md overflow-hidden border border-[#27272a]">
                          <img src={refImg.url} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover/refimg:bg-black/30 transition-all pointer-events-none rounded-md"></div>
                          </div>
                          {/* Reference Type Badge — only show for non-image types */}
                          {refImg.refType && refImg.refType !== 'image' && (
                            <div className="absolute bottom-0.5 left-0.5 p-1 bg-black/70 backdrop-blur-sm rounded-md">
                              {refImg.refType === 'style' && (
                                <svg className="w-2 h-2 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                </svg>
                              )}
                              {refImg.refType === 'character' && (
                                <svg className="w-2 h-2 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                              )}
                              {refImg.refType === 'pose' && (
                                <svg className="w-2 h-2 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <div className="border-t border-[#27272a] pt-4">
                    <h3 className="text-[#6b7280] text-xs uppercase tracking-wider mb-3">Settings</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-[#6b7280]">Model</div>
                      <div className="text-[#E0E0E0]">{currentGen.model}</div>
                      <div className="text-[#6b7280]">Aspect Ratio</div>
                      <div className="text-[#E0E0E0]">{currentGen.aspect_ratio}</div>
                      <div className="text-[#6b7280]">Resolution</div>
                      <div className="text-[#E0E0E0]">{currentGen.resolution}</div>
                    </div>
                  </div>
                </div>

                {/* Creation Actions Section - Bottom */}
                <div className="border-t border-[#27272a] pt-3 mt-4">
                  <h3 className="text-[#6b7280] text-[10px] uppercase tracking-wider mb-2">Creation Actions</h3>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        handleRerun(currentGen);
                        setViewingImage(null);
                      }}
                      className="flex-1 px-2 py-1.5 bg-[#1a1a1c] border border-[#27272a] rounded-md text-white/80 text-xs hover:bg-[#252525] hover:text-white transition-colors duration-300"
                    >
                      Rerun
                    </button>
                    <button
                      onClick={() => {
                        handleUsePrompt(currentGen.prompt);
                        setViewingImage(null);
                      }}
                      className="flex-1 px-2 py-1.5 bg-[#1a1a1c] border border-[#27272a] rounded-md text-white/80 text-xs hover:bg-[#252525] hover:text-white transition-colors duration-300"
                    >
                      Reuse Prompt
                    </button>
                  </div>
                </div>
                </div>
              </div>

              {/* Thumbnail Strip - horizontal on mobile, vertical on desktop */}
              <div className="order-2 md:order-1 w-full md:w-24 flex-shrink-0 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden max-w-full md:max-h-[calc(100vh-160px)] py-2 md:py-0 md:pr-1 items-center">
                {allImages.map((img, idx) => (
                  <div
                    key={`${img.genId}-${img.imageIndex}`}
                    onClick={() => setViewingImage({ generationId: img.genId, imageIndex: img.imageIndex })}
                    className={`relative cursor-pointer rounded-md overflow-hidden border-2 transition-all duration-300 ease-in-out flex-shrink-0 w-14 h-14 md:w-16 md:h-16 ${
                      idx === currentIndex
                        ? 'border-white scale-110'
                        : 'border-[#27272a] hover:border-white/50 scale-100'
                    }`}
                    style={{ transformOrigin: 'center' }}
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
          </>
        );
      })()}

      {/* Mobile Bottom Bar - legacy (hidden) */}
      <div className="hidden fixed bottom-0 left-0 right-0 md:hidden z-50 px-3 py-3 flex flex-col gap-2">
        {/* Mobile AI Companies Dropdown - Opens upward */}
        {showAiCompanies && (
          <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-row flex-wrap items-end gap-2 p-2 z-[100]">
            {aiCompanies.map((company, index) => (
              <div key={company.name} className="relative" style={{ animation: `fadeInUp 0.2s ease-out ${index * 50}ms both` }}>
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
                  <span className="w-5 h-5 flex items-center justify-center">{renderCompanyLogo(company, selectedCompany === company.name)}</span>
                </button>
                {selectedCompany === company.name && (
                  <div className="absolute bottom-full mb-2 left-0 flex flex-col gap-1.5 z-[110]">
                    {company.models.map((model, modelIndex) => (
                      <button
                        key={model.name}
                        onClick={() => {
                          setSelectedModel(model.name);
                          setShowAiCompanies(false);
                          setSelectedCompany(null);
                        }}
                        className="h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-xs font-medium"
                        style={{
                          boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                          animation: `fadeInUp 0.2s ease-out ${modelIndex * 50}ms both`
                        }}
                      >
                        {model.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <style>{`
              @keyframes fadeInUp {
                from {
                  opacity: 0;
                  transform: translateY(8px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}</style>
          </div>
        )}

        {/* Mobile Settings Panel - Opens horizontally to the left, centered with Settings button */}
        {showSettings && (
          <div
            className="absolute right-[68px] flex flex-row flex-wrap items-center gap-2 p-2 z-[100]"
            style={{ bottom: '79px' }}
          >
            {/* Counter Control */}
            <div
              className="h-8 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center px-1 gap-0.5 shadow-lg"
              style={{ animation: `slideInLeft 0.2s ease-out 0ms both`, boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
            >
              <button
                onClick={handleDecrement}
                className="w-6 h-6 flex items-center justify-center text-white/60 hover:text-white/90 hover:bg-white/10 rounded transition-all"
                disabled={count <= 1}
              >
                <span className="text-sm leading-none">−</span>
              </button>
              <div className="w-5 flex items-center justify-center">
                <span className="text-white/90 text-sm font-medium">{count}</span>
              </div>
              <button
                onClick={handleIncrement}
                className="w-6 h-6 flex items-center justify-center text-white/60 hover:text-white/90 hover:bg-white/10 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={count >= (currentModelCapabilities?.maxCount || 10)}
              >
                <span className="text-sm leading-none">+</span>
              </button>
            </div>

            {/* Aspect Ratio Selector */}
            <div ref={mobileAspectRatioTriggerRef} className="relative" style={{ animation: `slideInLeft 0.2s ease-out 50ms both` }}>
              <button
                onClick={() => {
                  setShowAspectRatios(!showAspectRatios);
                  setShowResolutions(false);
                }}
                className="h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center text-white/90 text-sm hover:bg-[#2a2a2d] hover:border-white/30 transition-all shadow-lg"
                style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
              >
                <span className="font-medium">{aspectRatio}</span>
              </button>
              {showAspectRatios && (
                <div
                  className="absolute bottom-full mb-2 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg overflow-y-auto overflow-x-hidden shadow-xl shadow-black/30 z-50 p-1"
                  style={{
                    ...mobileAspectRatioDropdownStyle,
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 0 25px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  {aspectRatios.filter((ar) => isAspectRatioSupported(ar.value)).map((ar) => (
                      <button
                        key={ar.value}
                        onClick={() => {
                          setAspectRatio(ar.value);
                          setShowAspectRatios(false);
                        }}
                        className={`w-full h-8 px-3 flex items-center gap-3 rounded-lg transition-colors hover:bg-white/10 cursor-pointer ${ar.value === aspectRatio ? 'bg-white/10' : ''}`}
                      >
                        <span className="text-base text-white/60">{ar.icon}</span>
                        <span className="text-sm font-medium text-white/80">{ar.value}</span>
                        <span className="text-sm ml-auto text-white/50">{ar.label}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Resolution Selector */}
            <div className="relative" style={{ animation: `slideInLeft 0.2s ease-out 100ms both` }}>
              <button
                onClick={() => {
                  setShowResolutions(!showResolutions);
                  setShowAspectRatios(false);
                }}
                className="h-8 px-3 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center text-white/90 text-sm hover:bg-[#2a2a2d] hover:border-white/30 transition-all shadow-lg"
                style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
              >
                <span className="font-medium">{selectedResolution?.label}</span>
              </button>
              {showResolutions && (
                <div className="absolute bottom-full right-0 mb-2 w-40 bg-[#1a1a1c] backdrop-blur-md border border-[#3a3a3d] rounded-lg overflow-hidden shadow-xl shadow-black/30 z-50 p-1" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 0 25px rgba(0, 0, 0, 0.5)' }}>
                  {resolutions.filter((res) => isResolutionSupported(res.value)).map((res) => (
                    <button
                      key={res.value}
                      onClick={() => {
                        setResolution(res.value);
                        setShowResolutions(false);
                      }}
                      className={`w-full h-8 px-3 flex items-center justify-between rounded-lg transition-colors hover:bg-white/10 cursor-pointer ${res.value === resolution ? 'bg-white/10' : ''}`}
                    >
                      <span className="text-sm font-medium text-white/80">{res.label}</span>
                      <span className="text-xs text-white/50">{res.time}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <style>{`
              @keyframes slideInLeft {
                from {
                  opacity: 0;
                  transform: translateX(30px);
                }
                to {
                  opacity: 1;
                  transform: translateX(0);
                }
              }
            `}</style>
          </div>
        )}

        {/* Mobile Tools Dropdown - HIDDEN: Will be implemented in Image Studio later
        {showTools && (
          <div
            className="absolute right-[68px] flex flex-row flex-wrap items-center gap-2 p-2 z-[100]"
            style={{ bottom: '134.5px' }}
          >
            <div className="relative" style={{ animation: `slideInLeft 0.2s ease-out 0ms both` }}>
              <button
                onClick={() => {
                  setSelectedTool(selectedTool === 'variations' ? null : 'variations');
                }}
                className={`h-9 w-9 bg-[#1a1a1c] backdrop-blur-md border rounded-lg flex items-center justify-center text-white/80 hover:bg-[#2a2a2d] transition-all shadow-lg ${
                  selectedTool === 'variations' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                }`}
                style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)' }}
                title="Variations"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" />
                  <path d="M12 2L12 22" />
                  <path d="M3 7L21 17" />
                  <path d="M21 7L3 17" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>
              {selectedTool === 'variations' && (
                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 flex flex-row gap-1 z-[110]">
                  <button
                    onClick={() => {
                      setSelectedVariationMode('reframe');
                      setShowTools(false);
                      setSelectedTool(null);
                    }}
                    className={`h-7 px-2 bg-[#1a1a1c] backdrop-blur-md border rounded-md flex items-center gap-1.5 hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-[10px] font-medium ${
                      selectedVariationMode === 'reframe' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                    }`}
                    style={{
                      boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                      animation: `slideInLeft 0.2s ease-out 0ms both`
                    }}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="5" width="14" height="14" rx="1" />
                      <path d="M15 3L21 3L21 9" />
                      <path d="M21 3L16 8" />
                      <path d="M9 21L3 21L3 15" />
                      <path d="M3 21L8 16" />
                    </svg>
                    Reframe
                  </button>
                  <button
                    onClick={() => {
                      setSelectedVariationMode('storyboard');
                      setShowTools(false);
                      setSelectedTool(null);
                    }}
                    className={`h-7 px-2 bg-[#1a1a1c] backdrop-blur-md border rounded-md flex items-center gap-1.5 hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-[10px] font-medium ${
                      selectedVariationMode === 'storyboard' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                    }`}
                    style={{
                      boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                      animation: `slideInLeft 0.2s ease-out 50ms both`
                    }}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="8" height="6" rx="1" />
                      <rect x="14" y="2" width="8" height="6" rx="1" />
                      <rect x="2" y="10" width="8" height="6" rx="1" />
                      <rect x="14" y="10" width="8" height="6" rx="1" />
                      <rect x="8" y="18" width="8" height="4" rx="1" />
                    </svg>
                    Storyboard
                  </button>
                  <button
                    onClick={() => {
                      setSelectedVariationMode('custom');
                      setShowTools(false);
                      setSelectedTool(null);
                    }}
                    className={`h-7 px-2 bg-[#1a1a1c] backdrop-blur-md border rounded-md flex items-center gap-1.5 hover:bg-[#2a2a2d] hover:border-white/30 transition-all cursor-pointer text-white/90 shadow-lg whitespace-nowrap text-[10px] font-medium ${
                      selectedVariationMode === 'custom' ? 'border-white/40 bg-[#2a2a2d]' : 'border-[#3a3a3d]'
                    }`}
                    style={{
                      boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 0, 0, 0.4)',
                      animation: `slideInLeft 0.2s ease-out 100ms both`
                    }}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                      <path d="M19 3v4" />
                      <path d="M21 5h-4" />
                    </svg>
                    Custom
                  </button>
                </div>
              )}
            </div>
            <style>{`
              @keyframes slideInLeft {
                from {
                  opacity: 0;
                  transform: translateX(30px);
                }
                to {
                  opacity: 1;
                  transform: translateX(0);
                }
              }
            `}</style>
          </div>
        )}
        End of Mobile Tools Dropdown */}

        {/* Mobile Menu Column - Shows Settings, Tools, History, Favorites when menu is open */}
        {showMobileMenu && (
          <div className="absolute bottom-full right-3 mb-2 flex flex-col items-center gap-2 z-[150]">
            {/* Favorites Button - appears first (at top), but animates last */}
            <div
              className="w-12 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg shadow-black/40 relative bg-[#1a1a1c]"
              style={{
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)',
                animation: 'mobileMenuSlideUp 0.2s ease-out 150ms both'
              }}
            >
              <button
                onClick={() => {
                  setAnimatingFavButton(true);
                  setTimeout(() => setAnimatingFavButton(false), 700);
                  const newFavoritesOnly = !favoritesOnly;
                  setFavoritesOnly(newFavoritesOnly);
                  setShowHistory(newFavoritesOnly);
                  setShowSettings(false);
                  setShowTools(false);
                  setSelectedTool(null);
                  setShowAiCompanies(false);
                  setSelectedCompany(null);
                }}
                className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg className={`w-6 h-6 ${favoritesOnly ? 'text-white' : 'text-white/40'}`} fill={favoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            </div>

            {/* History Button */}
            <div
              className="w-12 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg shadow-black/40 relative bg-[#1a1a1c]"
              style={{
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)',
                animation: 'mobileMenuSlideUp 0.2s ease-out 100ms both'
              }}
            >
              <button
                onClick={() => {
                  setAnimatingHistoryButton(true);
                  setTimeout(() => setAnimatingHistoryButton(false), 500);
                  if (favoritesOnly && showHistory) {
                    setFavoritesOnly(false);
                  } else {
                    const newShowHistory = !showHistory;
                    setShowHistory(newShowHistory);
                    if (!newShowHistory) {
                      setFavoritesOnly(false);
                    }
                  }
                  setShowSettings(false);
                  setShowTools(false);
                  setSelectedTool(null);
                  setShowAiCompanies(false);
                  setSelectedCompany(null);
                }}
                className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg
                  className={`w-5 h-5 ${showHistory && !favoritesOnly ? 'text-white' : 'text-[#6b7280]'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="9" strokeWidth={2} fill={showHistory && !favoritesOnly ? 'currentColor' : 'none'} fillOpacity="0.2" />
                  <g className={animatingHistoryButton ? 'animate-clock-tick' : ''} style={{ transformOrigin: '12px 12px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 4" />
                  </g>
                </svg>
              </button>
            </div>

            {/* Tools Button - HIDDEN: Will be implemented in Image Studio later
            <div
              className="w-12 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg shadow-black/40 relative bg-[#1a1a1c]"
              style={{
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)',
                animation: 'mobileMenuSlideUp 0.2s ease-out 50ms both'
              }}
            >
              <button
                onClick={() => {
                  setShowTools(!showTools);
                  setSelectedTool(null);
                  setShowSettings(false);
                  setShowAiCompanies(false);
                  setSelectedCompany(null);
                }}
                className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg className={`w-6 h-6 ${showTools ? 'text-white' : 'text-white/40'}`} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 20L4 4L20 20H4Z" fillOpacity="0.3" />
                  <path d="M4 20L4 4L20 20H4Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="5.5" y="14" width="1.2" height="4" rx="0.4" />
                  <rect x="8.5" y="16" width="1.2" height="2.5" rx="0.4" />
                  <rect x="11.5" y="17" width="1.2" height="1.8" rx="0.4" />
                </svg>
              </button>
            </div>
            */}

            {/* Settings Button - appears last (at bottom), but animates first */}
            <div
              className="w-12 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg shadow-black/40 relative bg-[#1a1a1c]"
              style={{
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)',
                animation: 'mobileMenuSlideUp 0.2s ease-out 0ms both'
              }}
            >
              <button
                onClick={() => {
                  setShowSettings(!showSettings);
                  setShowTools(false);
                  setSelectedTool(null);
                  setShowAiCompanies(false);
                  setSelectedCompany(null);
                }}
                className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg
                  className={`w-6 h-6 ${showSettings ? 'text-white' : 'text-white/40'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>

            <style>{`
              @keyframes mobileMenuSlideUp {
                from {
                  opacity: 0;
                  transform: translateY(16px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}</style>
          </div>
        )}

        {/* Mobile Main Row: Model + Input + Menu Button */}
        <div className="w-full flex flex-row items-center justify-center gap-2">
          {/* Model Selector - Mobile (icon only) */}
          <div className="w-12 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg shadow-black/40 relative bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            <button
              onClick={() => {
                setShowAiCompanies(!showAiCompanies);
                setSelectedCompany(null);
                setShowSettings(false);
                setActiveImageId(null);
                setShowTools(false);
                setSelectedTool(null);
                setShowMobileMenu(false);
              }}
              className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
            >
              <svg className="w-6 h-6 text-white/40" viewBox="0 0 24 24" fill="currentColor">
                <rect x="2" y="12.8" width="10" height="2.4" rx="1.2" transform="rotate(-45 7 14)" />
                <rect x="11.5" y="12.8" width="3.5" height="2.4" rx="1.2" transform="rotate(-45 7 14)" fill="white" stroke="currentColor" strokeWidth="0.5" />
                <path d="M17.5 5.5 Q18.2 7.7 20.5 8.5 Q18.2 9.3 17.5 11.5 Q16.8 9.3 14.5 8.5 Q16.8 7.7 17.5 5.5 Z" />
                <path d="M20.5 12.5 Q21 14 22.5 14.5 Q21 15 20.5 16.5 Q20 15 18.5 14.5 Q20 14 20.5 12.5 Z" />
                <path d="M15 12 Q15.4 13 16.5 13.4 Q15.4 13.8 15 14.8 Q14.6 13.8 13.5 13.4 Q14.6 13 15 12 Z" />
              </svg>
            </button>
          </div>

          {/* Input Container - Mobile (flexible width) */}
          <div className="flex-1 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-between relative shadow-lg shadow-black/40 bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            <div className="flex items-center flex-1">
              <button
                onClick={handleImageClick}
                className="p-2 ml-1 rounded flex items-center justify-center transition-all hover:bg-white/5"
              >
                <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <div className="w-px h-5 bg-white/10 ml-1 mr-2"></div>
              {(() => {
                const charLimit = resolution === '4k' ? 800 : resolution === '2k' ? 650 : 500;
                return (
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, charLimit))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isGenerating && (DEMO_MOCK_GENERATION_ENABLED || (prompt.trim() && selectedModel))) {
                        handleGenerate();
                      }
                    }}
                    maxLength={charLimit}
                    placeholder="Describe..."
                    className="flex-1 bg-transparent text-white/90 text-base placeholder:text-white/30 outline-none focus:outline-none focus:ring-0 border-0 px-1"
                  />
                );
              })()}
            </div>
          </div>

          {/* Menu Button - Mobile */}
          <div className="w-12 h-12 backdrop-blur-md border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg shadow-black/40 relative bg-[#1a1a1c]" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 0 15px rgba(0, 0, 0, 0.3)' }}>
            <button
              onClick={() => {
                setShowMobileMenu(!showMobileMenu);
                if (showMobileMenu) {
                  setShowSettings(false);
                  setShowTools(false);
                  setSelectedTool(null);
                }
              }}
              className="p-2 rounded flex items-center justify-center transition-all hover:bg-white/5"
            >
              <svg
                className={`w-6 h-6 ${showMobileMenu ? 'text-white' : 'text-white/40'}`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        </div>

        <style>{`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
      {/* ═══════════════════════ MOBILE SELECTION ACTION BAR ═══════════════════════ */}
      {selectionMode && (
        <div className="fixed bottom-0 left-0 right-0 md:hidden z-[250] bg-[#1a1a1c] border-t border-[#27272a]">
          <div className="px-3 py-3 flex items-center gap-2">
            {/* Cancel */}
            <button onClick={exitSelectionMode} className="h-10 w-10 shrink-0 border border-[#27272a] rounded-md flex items-center justify-center bg-[#1a1a1c] hover:bg-[#252525] transition-colors duration-300">
              <svg className="w-4 h-4 text-[#E0E0E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* Count */}
            <span className="text-[#E0E0E0] text-sm font-medium">{selectedImageKeys.size} selected</span>
            {/* Spacer */}
            <div className="flex-1" />
            {/* Collection */}
            {selectedImageKeys.size >= 1 && (
              <div className="relative">
                <button onClick={() => setShowCollectionMenu(!showCollectionMenu)} className={`h-10 w-10 shrink-0 border border-[#27272a] rounded-md flex items-center justify-center transition-colors duration-300 ${showCollectionMenu ? 'bg-[#252525] text-white' : 'bg-[#1a1a1c]'}`}>
                  <svg className={`w-4 h-4 ${showCollectionMenu ? 'text-white' : 'text-[#6b7280]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </button>
                {/* Collection Menu — opens upward */}
                {showCollectionMenu && (
                  <div className="absolute bottom-full mb-2 right-0 bg-[#1a1a1c] border border-[#27272a] rounded-md p-1 z-[260] w-48 max-h-[200px] overflow-y-auto animate-fade-in">
                    {/* New Collection */}
                    {selectedImageKeys.size >= 1 && (
                      <button
                        onClick={handleBulkCreateCollection}
                        className="w-full h-8 px-3 flex items-center gap-2 rounded-md text-sm text-white/80 hover:bg-[#252525] hover:text-white transition-colors duration-300"
                      >
                        <svg className="w-3.5 h-3.5 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>New Collection</span>
                      </button>
                    )}
                    {/* Existing Collections */}
                    {collages.length > 0 && (
                      <>
                        {selectedImageKeys.size >= 1 && <div className="h-px bg-[#27272a] my-1" />}
                        {collages.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleAddToExistingCollection(c.id)}
                            className="w-full h-8 px-3 flex items-center justify-between rounded-md text-sm text-white/80 hover:bg-[#252525] hover:text-white transition-colors duration-300"
                          >
                            <span className="truncate">{c.name}</span>
                            <span className="text-[#6b7280] text-xs shrink-0 ml-2">{c.imageKeys.length}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {collages.length === 0 && selectedImageKeys.size < 1 && (
                      <div className="px-3 py-2 text-xs text-[#6b7280]">Select at least 1 image to create a collection</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Favorite */}
            <button onClick={handleBulkFavorite} className={`h-10 w-10 shrink-0 border border-[#27272a] rounded-md flex items-center justify-center transition-colors duration-300 ${selectionActionFeedback === 'favorite' ? 'bg-[#252525]' : 'bg-[#1a1a1c]'}`}>
              <svg className={`w-4 h-4 transition-colors duration-300 ${selectionActionFeedback === 'favorite' ? 'text-white' : 'text-[#6b7280]'}`} fill={selectionActionFeedback === 'favorite' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
            {/* Download */}
            <button onClick={handleBulkDownload} className="h-10 w-10 shrink-0 border border-[#27272a] rounded-md flex items-center justify-center bg-[#1a1a1c] active:bg-[#252525] active:text-white transition-colors duration-300">
              <svg className="w-4 h-4 text-[#6b7280] active:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            {/* Delete */}
            <button onClick={handleBulkDelete} className="h-10 w-10 shrink-0 border border-[#27272a] rounded-md flex items-center justify-center bg-[#1a1a1c] active:bg-[#252525] active:text-white transition-colors duration-300">
              <svg className="w-4 h-4 text-[#6b7280] active:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════ NEW MOBILE BOTTOM BAR ═══════════════════════ */}
      {!selectionMode && !viewingImage && !expandedCollageId && (
      <div className="fixed top-3 left-3 right-3 md:hidden z-[205] pointer-events-none">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => {
              const newFav = !favoritesOnly;
              setFavoritesOnly(newFav);
              setShowHistory(newFav);
              closeMobileSettings();
              setShowAiCompanies(false);
              setShowGallerySearch(false);
            }}
            className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center bg-transparent transition-colors duration-300 pointer-events-auto"
            style={{ WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', outline: 'none' }}
          >
            <svg className={`w-4 h-4 ${favoritesOnly ? 'text-white' : 'text-[#6b7280]'}`} fill={favoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>

          <div
            className="pointer-events-auto relative ml-auto overflow-hidden"
            style={{
              width: showGallerySearch ? 'calc(100vw - 4.5rem)' : '2.5rem',
              transition: 'width 220ms ease-in-out',
              height: '2.5rem',
            }}
          >
            <div
              className="absolute inset-0 h-10 w-full bg-[#090B0F]/96 backdrop-blur-md border border-[#171A20] rounded-md pl-3 pr-11 shadow-[0_10px_30px_rgba(0,0,0,0.35)] flex items-center"
              style={{
                opacity: showGallerySearch ? 1 : 0,
                transition: 'opacity 220ms ease-in-out',
                pointerEvents: showGallerySearch ? 'auto' : 'none',
              }}
            >
              <div
                className="min-w-0 flex-1 overflow-hidden"
                style={{
                  opacity: showGallerySearch ? 1 : 0,
                  transform: showGallerySearch ? 'translateX(0)' : 'translateX(10px)',
                  transition: 'opacity 220ms ease-in-out, transform 220ms ease-in-out',
                  pointerEvents: showGallerySearch ? 'auto' : 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    ref={mobileSearchInputRef}
                    type="text"
                    value={gallerySearchQuery}
                    onChange={(e) => setGallerySearchQuery(e.target.value.slice(0, 500))}
                    placeholder="Search generated prompts..."
                    className="flex-1 min-w-0 bg-transparent text-[#E7EAF0] text-sm placeholder:text-[#727B88]/70 border-0 outline-none focus:outline-none focus:ring-0 shadow-none"
                  />
                  {gallerySearchQuery && (
                    <button
                      onClick={() => setGallerySearchQuery('')}
                      className="shrink-0 text-[#727B88] hover:text-white transition-colors"
                      style={{ WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', outline: 'none' }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                if (showGallerySearch) {
                  closeMobileGallerySearch();
                } else {
                  setShowGallerySearch(true);
                  closeMobileSettings();
                  setShowAiCompanies(false);
                }
              }}
              className="absolute right-0 top-0 z-10 h-10 w-10 rounded-md flex items-center justify-center text-[#727B88] bg-transparent hover:text-white transition-colors duration-300"
              style={{ WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', outline: 'none' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" strokeWidth="2" />
                <path strokeLinecap="round" strokeWidth="2" d="M20 20L16.65 16.65" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      )}
      {!selectionMode && (
      <div className={`fixed bottom-0 left-0 right-0 md:hidden z-[200] flex flex-col ${isMobileLandscape ? 'pb-1' : ''}`} style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>

        {/* Upward panels — model picker, settings */}
        {/* Model Picker — vertical stack above model button, same animation as desktop */}
        {false && (showAiCompanies || desktopAiCompaniesClosing) && (() => {
          const visibleCompanies = desktopAiCompaniesMode === 'selected' && selectedModelCompany
            ? [selectedModelCompany!]
            : aiCompanies;
          const isClosingMobile = desktopAiCompaniesClosing;
          return (
            <div className="absolute bottom-full left-3 mb-2 flex flex-col-reverse items-start gap-2 z-[210]" onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
              {visibleCompanies.map((company, index) => {
                const total = visibleCompanies.length;
                const exitDelay = index * 50;
                return (
                  <div key={company.name}
                    style={isClosingMobile
                      ? { animation: `desktopCompanyExit 300ms ease-out ${exitDelay}ms both` }
                      : { animation: `mobileCompanyFadeIn 280ms ease-out ${index * 60}ms both` }
                    }
                  >
                    <div className="relative flex items-center gap-2 z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectedCompany === company.name) {
                            setClosingCompanyModels(company.name);
                            const modelCount = company.models.length;
                            setTimeout(() => { setSelectedCompany(null); setClosingCompanyModels(null); }, modelCount * 50 + 250);
                          } else if (selectedCompany && selectedCompany !== company.name) {
                            const oldCompany = aiCompanies.find(c => c.name === selectedCompany);
                            const oldCount = oldCompany?.models.length ?? 0;
                            setClosingCompanyModels(selectedCompany);
                            setTimeout(() => { setClosingCompanyModels(null); setSelectedCompany(company.name); }, oldCount * 50 + 250);
                          } else {
                            setSelectedCompany(company.name);
                          }
                        }}
                        className={`h-8 w-8 border border-[#27272a] rounded-md flex items-center justify-center text-white/80 hover:bg-[#252525] hover:text-white transition-colors duration-300 ${
                          selectedCompany === company.name ? 'bg-[#252525] text-white border-[#3a3a3d]' : 'bg-[#1a1a1c]'
                        }`}
                      >
                        <span className="w-5 h-5 flex items-center justify-center">{renderCompanyLogo(company, selectedCompany === company.name)}</span>
                      </button>
                      {/* Models — appear to the right of the company icon */}
                      {(selectedCompany === company.name || closingCompanyModels === company.name) && (
                        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 flex w-max max-w-[calc(100vw-4.5rem)] flex-wrap content-start gap-1">
                          {company.models.map((model, modelIndex) => {
                            const isClosing = closingCompanyModels === company.name;
                            const mTotal = company.models.length;
                            const mEnterDelay = modelIndex * MOBILE_INLINE_STAGGER_MS;
                            const mExitDelay = (mTotal - 1 - modelIndex) * MOBILE_INLINE_STAGGER_MS;
                            return (
                              <button
                                key={model.name}
                                className={`h-6 px-2 border border-[#27272a] rounded-md text-[9px] leading-none whitespace-nowrap text-white/80 hover:bg-[#252525] hover:text-white transition-colors duration-300 ${
                                  selectedModel === model.name ? 'bg-[#252525] text-white border-[#3a3a3d]' : 'bg-[#1a1a1c]'
                                }`}
                                style={isClosing
                                  ? { animation: `mobileInlineItemFadeOutReverse ${COMPANY_MODEL_CLOSE_DURATION_MS}ms ease-in ${mExitDelay}ms both` }
                                  : { animation: `mobileInlineItemFadeIn 280ms ease-out ${mEnterDelay}ms both` }
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedModel(model.name);
                                  setDesktopAiCompaniesClosing(true);
                                  setSelectedCompany(null);
                                  setTimeout(() => { setShowAiCompanies(false); setDesktopAiCompaniesClosing(false); }, 550);
                                }}
                              >
                                <span className="inline-flex h-full items-center justify-center leading-none -translate-y-px">
                                  {model.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}



        {/* Image References — shows when images are attached */}
        {/* Main Bottom Row: Model + Prompt + Actions */}
        <div className={`px-3 pt-1 flex items-end gap-2 ${isMobileLandscape ? 'pb-2' : 'pb-3'}`}>
          {/* Model Button */}
          <div className="relative shrink-0 self-end">
            {(showAiCompanies || desktopAiCompaniesClosing) && (() => {
              const visibleCompanies = desktopAiCompaniesMode === 'selected' && selectedModelCompany
                ? [selectedModelCompany!]
                : aiCompanies;
              const isClosingMobile = desktopAiCompaniesClosing;
              return (
                <div className="absolute bottom-full left-0 mb-2 flex flex-col-reverse items-start gap-2 z-[210]" onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                  {visibleCompanies.map((company, index) => {
                    const exitDelay = index * 50;
                    return (
                      <div
                        key={company.name}
                        style={isClosingMobile
                          ? { animation: `desktopCompanyExit 300ms ease-out ${exitDelay}ms both` }
                          : { animation: `mobileCompanyFadeIn 280ms ease-out ${index * 60}ms both` }
                        }
                      >
                        <div className="relative flex items-center gap-2 z-10">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectedCompany === company.name) {
                                setClosingCompanyModels(company.name);
                                const modelCount = company.models.length;
                                setTimeout(() => { setSelectedCompany(null); setClosingCompanyModels(null); }, getCompanyModelCloseMs(modelCount));
                              } else if (selectedCompany && selectedCompany !== company.name) {
                                const oldCompany = aiCompanies.find(c => c.name === selectedCompany);
                                const oldCount = oldCompany?.models.length ?? 0;
                                setClosingCompanyModels(selectedCompany);
                                setTimeout(() => { setClosingCompanyModels(null); setSelectedCompany(company.name); }, getCompanyModelCloseMs(oldCount));
                              } else {
                                setSelectedCompany(company.name);
                              }
                            }}
                            className={`h-8 w-8 border border-[#171A20] rounded-md flex items-center justify-center text-[#727B88] hover:bg-[#111419] hover:text-white transition-colors duration-300 ${
                              selectedCompany === company.name ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F]'
                            }`}
                          >
                            <span className="w-5 h-5 flex items-center justify-center">{renderCompanyLogo(company, selectedCompany === company.name)}</span>
                          </button>
                          {(selectedCompany === company.name || closingCompanyModels === company.name) && (
                            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-10">
                                <div className="flex w-max max-w-[calc(100vw-4.5rem)] flex-wrap content-start gap-1 px-1.5 py-1.5">
                                {company.models.map((model, modelIndex) => {
                                  const isClosing = closingCompanyModels === company.name;
                                  const mTotal = company.models.length;
                                  const mEnterDelay = modelIndex * MOBILE_INLINE_STAGGER_MS;
                                  const mExitDelay = (mTotal - 1 - modelIndex) * MOBILE_INLINE_STAGGER_MS;
                                  return (
                                    <button
                                      key={model.name}
                                      className={`h-6 px-2 border border-[#171A20] rounded-md text-[9px] leading-none whitespace-nowrap text-[#727B88] hover:bg-[#111419] hover:text-white transition-colors duration-300 ${
                                        selectedModel === model.name ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F]'
                                      }`}
                                      style={isClosing
                                        ? { animation: `mobileInlineItemFadeOutReverse ${COMPANY_MODEL_CLOSE_DURATION_MS}ms ease-in ${mExitDelay}ms both` }
                                        : { animation: `mobileInlineItemFadeIn 280ms ease-out ${mEnterDelay}ms both` }
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedModel(model.name);
                                        setDesktopAiCompaniesClosing(true);
                                        setSelectedCompany(null);
                                        setTimeout(() => { setShowAiCompanies(false); setDesktopAiCompaniesClosing(false); }, 550);
                                      }}
                                    >
                                      <span className="inline-flex h-full items-center justify-center leading-none -translate-y-px">
                                        {model.name}
                                      </span>
                                    </button>
                                  );
                                })}
                                </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <button
              onClick={() => {
                if (showAiCompanies) {
                  setDesktopAiCompaniesClosing(true);
                  setSelectedCompany(null);
                  setTimeout(() => { setShowAiCompanies(false); setDesktopAiCompaniesClosing(false); }, 550);
                } else {
                  setDesktopAiCompaniesMode('all');
                  setShowAiCompanies(true);
                }
                closeMobileSettings();
                setShowResolutions(false);
                setShowAspectRatios(false);
                setShowGallerySearch(false);
              }}
              className="h-10 w-10 border border-[#171A20] rounded-md flex items-center justify-center bg-[#090B0F] hover:bg-[#111419] transition-colors duration-300"
            >
              {selectedModel && selectedModelCompany ? (
                <span className="w-5 h-5 flex items-center justify-center text-white/80">{renderCompanyLogo(selectedModelCompany, true)}</span>
              ) : (
                <svg className="w-5 h-5 text-[#727B88]" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="2" y="12.8" width="10" height="2.4" rx="1.2" transform="rotate(-45 7 14)" />
                  <rect x="11.5" y="12.8" width="3.5" height="2.4" rx="1.2" transform="rotate(-45 7 14)" fill="white" stroke="currentColor" strokeWidth="0.5" />
                  <path d="M17.5 5.5 Q18.2 7.7 20.5 8.5 Q18.2 9.3 17.5 11.5 Q16.8 9.3 14.5 8.5 Q16.8 7.7 17.5 5.5 Z" />
                  <path d="M20.5 12.5 Q21 14 22.5 14.5 Q21 15 20.5 16.5 Q20 15 18.5 14.5 Q20 14 20.5 12.5 Z" />
                  <path d="M15 12 Q15.4 13 16.5 13.4 Q15.4 13.8 15 14.8 Q14.6 13.8 13.5 13.4 Q14.6 13 15 12 Z" />
                </svg>
              )}
            </button>
          </div>

          {/* Prompt Input */}
          <div className="relative flex-1 min-w-0">
            {activeUploadedImage && uploadedImages.length > 0 && !shouldFadeMobileReferenceTray && (
              <div className="pointer-events-none absolute bottom-full left-2 z-[220] mb-2">
                <div className={`pointer-events-auto relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#151517] shadow-[0_12px_28px_rgba(0,0,0,0.42)] ${isMobileLandscape ? 'h-24 w-[72px]' : 'h-32 w-24'}`}>
                  <img src={activeUploadedImage.url} alt="" className="h-full w-full object-cover" />
                </div>
              </div>
            )}
            <div
              ref={mobilePromptContainerRef}
              className={`overflow-hidden rounded-md border border-[#171A20] bg-[#090B0F] transition-[height] duration-[220ms] ease-in-out ${
                mobilePromptExpanded
                  ? ''
                  : ''
              }`}
              style={{ height: `${mobilePromptExpanded ? mobilePromptExpandedHeight : mobilePromptCollapsedHeight}px` }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                if (isMobilePromptCloseLocked()) return;
                if (mobilePromptExpanded) return;
                setMobilePromptExpanded(true);
                window.requestAnimationFrame(() => {
                  mobilePromptInputRef.current?.focus();
                });
              }}
            >
              {uploadedImages.length > 0 && (
                <div
                  style={{
                    opacity: shouldFadeMobileReferenceTray ? 0 : 1,
                    maxHeight: shouldFadeMobileReferenceTray ? 0 : (isMobileLandscape ? 60 : 72),
                    overflow: 'hidden',
                    transition: 'opacity 180ms ease-out, max-height 220ms ease-out',
                    pointerEvents: shouldFadeMobileReferenceTray ? 'none' : 'auto',
                  }}
                >
                  <div className={`flex items-center gap-1.5 border-b border-white/[0.06] px-2 ${isMobileLandscape ? 'py-1' : 'py-1.5'}`}>
                    <div className="min-w-0 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                      <div className="flex w-max items-center gap-2 pr-1">
                        {uploadedImages.map((img) => (
                          <div
                            key={img.id}
                            className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-md border transition-colors duration-300 ${
                              activeImageId === img.id ? 'border-white/60' : 'border-[#171A20]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setActiveImageId(activeImageId === img.id ? null : img.id)}
                              className="h-full w-full"
                            >
                              <img src={img.url} alt="" className="h-full w-full object-cover" />
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-black/70 to-transparent" />
                            </button>
                            {activeImageId === img.id && (
                              <button
                                type="button"
                                onClick={() => handleDeleteImage(img.id)}
                                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"
                              >
                                <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                        {uploadedImages.length < 10 && (
                          <button
                            type="button"
                            onClick={handleImageClick}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-dashed border-[#171A20] bg-[#090B0F] text-[#727B88] transition-colors duration-300 hover:border-[#272B33] hover:bg-[#111419] hover:text-white"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setUploadedImages([]); setActiveImageId(null); }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#727B88] transition-colors duration-300 hover:bg-[#111419] hover:text-white"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              <div className={`flex transition-[height] duration-[220ms] ease-in-out ${mobilePromptExpanded ? 'items-end' : 'items-center'} ${uploadedImages.length > 0 || mobilePromptExpanded ? '' : 'h-full'}`} style={{ height: uploadedImages.length > 0 || mobilePromptExpanded ? `${mobilePromptInnerHeight}px` : undefined }}>
                {uploadedImages.length === 0 && (
                  <>
                    <button onClick={handleImageClick} className="p-2 flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#727B88]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <div className="w-px h-5 bg-white/[0.08]"></div>
                  </>
                )}
                <textarea
                  ref={mobilePromptInputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, resolution === '4k' ? 800 : resolution === '2k' ? 650 : 500))}
                  onFocus={() => {
                    if (isMobilePromptCloseLocked()) return;
                    setMobilePromptExpanded(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isGenerating && (DEMO_MOCK_GENERATION_ENABLED || (prompt.trim() && selectedModel))) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                  placeholder="Describe..."
                  rows={1}
                  className={`flex-1 resize-none overflow-hidden bg-transparent text-[#E7EAF0] text-base placeholder:text-[#727B88]/70 border-0 outline-none focus:outline-none focus:ring-0 shadow-none transition-[height,padding] duration-[220ms] ease-in-out ${uploadedImages.length > 0 ? 'px-3' : 'px-2'}`}
                  style={{
                    height: `${mobilePromptInnerHeight}px`,
                    fontSize: '16px',
                    paddingTop: mobilePromptExpanded ? (isMobileLandscape ? 8 : 12) : 8,
                    paddingBottom: mobilePromptExpanded ? (isMobileLandscape ? 8 : 12) : 8,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Action Buttons: Search + Settings + Favorites */}
          {/* Search Button */}
          <button
            onClick={() => {
              setShowGallerySearch(!showGallerySearch);
              closeMobileSettings();
              setShowAiCompanies(false);
            }}
            className="hidden h-10 w-10 shrink-0 border border-[#27272a] rounded-md items-center justify-center bg-[#1a1a1c] hover:bg-[#252525] transition-colors duration-300"
          >
            <svg className={`w-4 h-4 ${showGallerySearch ? 'text-white' : 'text-[#6b7280]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" strokeWidth="2" />
              <path strokeLinecap="round" strokeWidth="2" d="M20 20L16.65 16.65" />
            </svg>
          </button>

          {/* Settings Button */}
          <div className="relative shrink-0 self-end">
            {(showSettings || mobileSettingsClosing) && (
              <div
                className="absolute bottom-full right-0 mb-2 flex flex-col-reverse items-end gap-2 z-[210]"
                data-settings-panel
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <div className="relative flex items-center gap-2 z-10" style={{ animation: mobileSettingsClosing ? 'mobileControlFadeOut 220ms ease-in 0ms both' : 'mobileControlFadeIn 280ms ease-out 140ms both' }}>
                  {(showMobileCountControls || closingMobileCountControls) && (
                    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2">
                        <div className="flex w-max max-w-[calc(100vw-4.5rem)] flex-wrap content-start justify-end gap-1 px-1.5 py-1.5">
                      <button
                        onClick={handleDecrement}
                        className="h-6 min-w-[26px] px-1.5 border border-[#171A20] rounded-md flex items-center justify-center text-[#727B88] hover:text-white hover:bg-[#111419] bg-[#090B0F] transition-colors duration-300 disabled:opacity-40"
                        disabled={count <= 1}
                        style={{ animation: getSettingsInlineAnimation(closingMobileCountControls, 0, 3) }}
                      >
                        <span className="text-lg leading-none">-</span>
                      </button>
                      <div className="h-6 min-w-[30px] px-1.5 border border-[#272B33] rounded-md flex items-center justify-center bg-[#111419] text-white text-[10px] font-medium" style={{ animation: getSettingsInlineAnimation(closingMobileCountControls, 1, 3) }}>
                        {count}
                      </div>
                      <button
                        onClick={handleIncrement}
                        className="h-6 min-w-[26px] px-1.5 border border-[#171A20] rounded-md flex items-center justify-center text-[#727B88] hover:text-white hover:bg-[#111419] bg-[#090B0F] transition-colors duration-300 disabled:opacity-40"
                        disabled={count >= (currentModelCapabilities?.maxCount || 10)}
                        style={{ animation: getSettingsInlineAnimation(closingMobileCountControls, 2, 3) }}
                      >
                        <span className="inline-flex h-full items-center justify-center leading-none -translate-y-px text-lg">+</span>
                      </button>
                        </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (showMobileCountControls || closingMobileCountControls) {
                        closeMobileCountControlsAnimated();
                      } else {
                        if (mobileCountControlsCloseTimeoutRef.current) {
                          window.clearTimeout(mobileCountControlsCloseTimeoutRef.current);
                          mobileCountControlsCloseTimeoutRef.current = null;
                        }
                        setClosingMobileCountControls(false);
                        setShowMobileCountControls(true);
                        setShowAspectRatios(false);
                        setShowResolutions(false);
                        setClosingMobileAspectRatios(false);
                        setClosingMobileResolutions(false);
                      }
                    }}
                    className={`h-8 w-8 border border-[#171A20] rounded-md flex items-center justify-center text-[11px] font-medium transition-colors duration-300 ${
                      showMobileCountControls ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F] text-[#727B88] hover:bg-[#111419] hover:text-white'
                    }`}
                  >
                    {count}
                  </button>
                </div>

                <div className="relative flex items-center gap-2 z-10" style={{ animation: mobileSettingsClosing ? 'mobileControlFadeOut 220ms ease-in 70ms both' : 'mobileControlFadeIn 280ms ease-out 70ms both' }}>
                  {(showResolutions || closingMobileResolutions) && (
                    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2">
                        <div className="flex w-max max-w-[calc(100vw-4.5rem)] flex-wrap content-start justify-end gap-1 px-1.5 py-1.5">
                      {resolutions.filter((res) => isResolutionSupported(res.value)).map((res, index, filtered) => (
                        <button
                          key={res.value}
                          onClick={() => { setResolution(res.value); closeMobileResolutionsAnimated(); }}
                          className={`h-6 px-1.5 border border-[#171A20] rounded-md flex items-center justify-center text-[9px] leading-none whitespace-nowrap font-medium transition-colors duration-300 ${
                            res.value === resolution ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F] text-[#727B88] hover:bg-[#111419] hover:text-white'
                          }`}
                          style={{ animation: getSettingsInlineAnimation(closingMobileResolutions, index, filtered.length) }}
                        >
                          <span className="inline-flex h-full items-center justify-center leading-none -translate-y-px">{res.label}</span>
                        </button>
                      ))}
                        </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (showResolutions || closingMobileResolutions) {
                        closeMobileResolutionsAnimated();
                      } else {
                        if (mobileResolutionsCloseTimeoutRef.current) {
                          window.clearTimeout(mobileResolutionsCloseTimeoutRef.current);
                          mobileResolutionsCloseTimeoutRef.current = null;
                        }
                        setClosingMobileResolutions(false);
                        setShowResolutions(true);
                        setShowAspectRatios(false);
                        setShowMobileCountControls(false);
                        setClosingMobileAspectRatios(false);
                        setClosingMobileCountControls(false);
                      }
                    }}
                    className={`h-8 w-8 border border-[#171A20] rounded-md flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors duration-300 ${
                      showResolutions ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F] text-[#727B88] hover:bg-[#111419] hover:text-white'
                    }`}
                  >
                    {(selectedResolution?.label || resolution).replace(/\s+/g, '')}
                  </button>
                </div>

                <div className="relative flex items-center gap-2 z-10" style={{ animation: mobileSettingsClosing ? 'mobileControlFadeOut 220ms ease-in 140ms both' : 'mobileControlFadeIn 280ms ease-out 0ms both' }}>
                  {(showAspectRatios || closingMobileAspectRatios) && (
                    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2">
                        <div className="flex w-max max-w-[calc(100vw-4.5rem)] flex-wrap content-start justify-end gap-1 px-1.5 py-1.5">
                      {aspectRatios.filter((ar) => isAspectRatioSupported(ar.value)).map((ar, index, filtered) => (
                        <button
                          key={ar.value}
                          onClick={() => { setAspectRatio(ar.value); closeMobileAspectRatiosAnimated(); }}
                          className={`h-6 px-1.5 border border-[#171A20] rounded-md flex items-center justify-center gap-0.5 text-[9px] leading-none whitespace-nowrap text-center transition-colors duration-300 ${
                            ar.value === aspectRatio ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F] text-[#727B88] hover:bg-[#111419] hover:text-white'
                          }`}
                          style={{ animation: getSettingsInlineAnimation(closingMobileAspectRatios, index, filtered.length) }}
                        >
                          <span className={`inline-flex h-full w-2.5 items-center justify-center leading-none -translate-y-px ${ar.value === aspectRatio ? 'text-white' : 'text-[#727B88]'}`}>{ar.icon}</span>
                          <span className="inline-flex h-full items-center leading-none">{ar.value}</span>
                        </button>
                      ))}
                        </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (showAspectRatios || closingMobileAspectRatios) {
                        closeMobileAspectRatiosAnimated();
                      } else {
                        if (mobileAspectRatiosCloseTimeoutRef.current) {
                          window.clearTimeout(mobileAspectRatiosCloseTimeoutRef.current);
                          mobileAspectRatiosCloseTimeoutRef.current = null;
                        }
                        setClosingMobileAspectRatios(false);
                        setShowAspectRatios(true);
                        setShowResolutions(false);
                        setShowMobileCountControls(false);
                        setClosingMobileResolutions(false);
                        setClosingMobileCountControls(false);
                      }
                    }}
                    className={`h-8 w-8 border border-[#171A20] rounded-md flex items-center justify-center text-sm transition-colors duration-300 ${
                      showAspectRatios ? 'bg-[#111419] text-white border-[#272B33]' : 'bg-[#090B0F] text-[#727B88] hover:bg-[#111419] hover:text-white'
                    }`}
                  >
                    <span className={`inline-flex h-full items-center justify-center leading-none -translate-y-px ${showAspectRatios ? 'text-white' : 'text-[#727B88]'}`}>{selectedAspectRatio?.icon || '□'}</span>
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                const nextShowSettings = !showSettings;
                if (!nextShowSettings) {
                  closeMobileSettings();
                } else {
                  if (mobileSettingsCloseTimeoutRef.current) {
                    window.clearTimeout(mobileSettingsCloseTimeoutRef.current);
                    mobileSettingsCloseTimeoutRef.current = null;
                  }
                  setMobileSettingsClosing(false);
                  setShowSettings(true);
                  setShowMobileCountControls(false);
                  setShowResolutions(false);
                  setShowAspectRatios(false);
                }
                setShowAiCompanies(false);
                setSelectedCompany(null);
                setShowGallerySearch(false);
              }}
              className="h-10 w-10 border border-[#171A20] rounded-md flex items-center justify-center bg-[#090B0F] hover:bg-[#111419] transition-colors duration-300"
            >
              <svg className={`w-4 h-4 ${showSettings ? 'text-white' : 'text-[#727B88]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* Favorites Button */}
          <button
            onClick={() => {
              const newFav = !favoritesOnly;
              setFavoritesOnly(newFav);
              setShowHistory(newFav);
              closeMobileSettings();
              setShowAiCompanies(false);
              setShowGallerySearch(false);
            }}
            className="hidden h-10 w-10 shrink-0 border border-[#27272a] rounded-md items-center justify-center bg-[#1a1a1c] hover:bg-[#252525] transition-colors duration-300"
          >
            <svg className={`w-4 h-4 ${favoritesOnly ? 'text-white' : 'text-[#6b7280]'}`} fill={favoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        </div>
      </div>
      )}
      {/* ═══════════════════════ END MOBILE BOTTOM BAR ═══════════════════════ */}

      {/* Reference image hover preview — rendered via portal to escape stacking contexts */}
      {hoveredRefImage && ReactDOM.createPortal(
        <div
          className="pointer-events-none fixed rounded-md overflow-hidden border border-white/[0.08] p-1 bg-[#18181b] transition-opacity duration-150"
          style={{
            top: hoveredRefImage.rect.bottom + 8,
            left: hoveredRefImage.rect.left + hoveredRefImage.rect.width / 2,
            transform: 'translateX(-50%)',
            zIndex: 99999,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          }}
        >
          <img src={hoveredRefImage.url} alt="" className="rounded-md" style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: '240px', maxHeight: '240px', minWidth: '120px', minHeight: '120px' }} />
        </div>,
        document.body
      )}
    </div>
  );
};

export default ImageGenerationInterface2;
