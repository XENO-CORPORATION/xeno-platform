// Model Service - Fetches available AI models from the backend API
// Models are cached in localStorage with a 30-minute expiry

export interface Model {
  id: string;
  name: string;
  maxTokens: number;
  created?: number;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  inputModalities?: string[];
  outputModalities?: string[];
  // Dynamic capability flags
  supportsReasoning?: 'alwaysOn' | 'toggleable' | 'disabled';
  supportsVision?: boolean;
  supportsFileUpload?: boolean;
}

export interface ModelsResponse {
  success: boolean;
  timestamp: string;
  totalCompanies: number;
  companies: Record<string, Model[]>;
}

export interface GroupedModels {
  companyName: string;
  models: Model[];
}

const CACHE_KEY = 'xeno_models_cache_v2'; // v2: LLMs only, no image models
const FREE_MODELS_CACHE_KEY = 'xeno_free_models_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Get backend URL based on environment
const getBackendUrl = (): string => {
  // Check for environment variable first
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return envUrl;

  // In production, use relative URL (same origin)
  if (import.meta.env.PROD) {
    return '/api';
  }

  // In development, use localhost
  return 'http://localhost:8080/api';
};

interface CachedData {
  timestamp: number;
  data: ModelsResponse;
}

// Check if cached data is still valid
const getCachedModels = (): ModelsResponse | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const { timestamp, data }: CachedData = JSON.parse(cached);
    const now = Date.now();

    if (now - timestamp < CACHE_DURATION) {
      console.log('📦 Using cached models data');
      return data;
    }

    // Cache expired
    console.log('⏰ Models cache expired');
    return null;
  } catch (error) {
    console.warn('Failed to read models cache:', error);
    return null;
  }
};

// Save models to cache
const setCachedModels = (data: ModelsResponse): void => {
  try {
    const cacheData: CachedData = {
      timestamp: Date.now(),
      data
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    console.log('💾 Models cached to localStorage');
  } catch (error) {
    console.warn('Failed to cache models:', error);
  }
};

// Fetch models from API
export const fetchModels = async (): Promise<ModelsResponse> => {
  // Check cache first
  const cached = getCachedModels();
  if (cached) {
    return cached;
  }

  console.log('🔄 Fetching models from API...');

  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/models`);

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const data: ModelsResponse = await response.json();

  if (!data.success) {
    throw new Error('API returned unsuccessful response');
  }

  // Cache the response
  setCachedModels(data);

  return data;
};

// OpenRouter model interface
interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  description?: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

// Fetch free models from OpenRouter API
export const fetchFreeModels = async (): Promise<Model[]> => {
  // Check cache first
  try {
    const cached = localStorage.getItem(FREE_MODELS_CACHE_KEY);
    if (cached) {
      const { timestamp, data } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        console.log('📦 Using cached free models');
        return data;
      }
    }
  } catch (error) {
    console.warn('Failed to read free models cache:', error);
  }

  console.log('🔄 Fetching free models from OpenRouter...');

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const result = await response.json();
    const models: OpenRouterModel[] = result.data || [];

    // Filter for free models (pricing.prompt === "0" and pricing.completion === "0")
    // and sort by created date (newest first)
    const freeModels = models
      .filter(m => {
        const promptPrice = parseFloat(m.pricing?.prompt || '1');
        const completionPrice = parseFloat(m.pricing?.completion || '1');
        return promptPrice === 0 && completionPrice === 0;
      })
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .slice(0, 10) // Get latest 10 free models
      .map(m => ({
        id: m.id,
        name: m.name,
        maxTokens: m.context_length || 4096,
        created: m.created,
        description: m.description,
        pricing: m.pricing,
        inputModalities: m.architecture?.input_modalities,
        outputModalities: m.architecture?.output_modalities,
        supportsVision: m.architecture?.input_modalities?.includes('image'),
        supportsReasoning: 'disabled' as const,
      }));

    // Cache the result
    try {
      localStorage.setItem(FREE_MODELS_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: freeModels
      }));
      console.log('💾 Free models cached');
    } catch (error) {
      console.warn('Failed to cache free models:', error);
    }

    return freeModels;
  } catch (error) {
    console.error('Failed to fetch free models:', error);
    return [];
  }
};

// Convert API response to grouped models array (for dropdown display)
export const getGroupedModels = async (): Promise<GroupedModels[]> => {
  // Fetch both regular models and free models in parallel
  const [response, freeModels] = await Promise.all([
    fetchModels(),
    fetchFreeModels()
  ]);

  const grouped: GroupedModels[] = Object.entries(response.companies).map(
    ([companyName, models]) => ({
      companyName,
      models
    })
  );

  // Sort companies alphabetically
  grouped.sort((a, b) => a.companyName.localeCompare(b.companyName));

  // Sort models within each company by created date (newest first)
  grouped.forEach(group => {
    group.models.sort((a, b) => (b.created || 0) - (a.created || 0));
  });

  // Add "Free" category at the beginning if we have free models
  if (freeModels.length > 0) {
    grouped.unshift({
      companyName: '✨ Free',
      models: freeModels
    });
  }

  return grouped;
};

// Get a flat list of all models
export const getAllModels = async (): Promise<Model[]> => {
  const grouped = await getGroupedModels();
  return grouped.flatMap(group => group.models);
};

// Find a model by ID
export const findModelById = async (modelId: string): Promise<Model | null> => {
  const models = await getAllModels();
  return models.find(m => m.id === modelId) || null;
};

// Clear the cache (useful for forcing a refresh)
export const clearModelsCache = (): void => {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(FREE_MODELS_CACHE_KEY);
  console.log('🗑️ Models cache cleared');
};

// Default/fallback models (used when API fails)
export const FALLBACK_MODELS: GroupedModels[] = [
  {
    companyName: '✨ Free',
    models: [
      { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B (Free)', maxTokens: 96000 },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', maxTokens: 131072 },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', maxTokens: 163840 },
      { id: 'qwen/qwen3-32b:free', name: 'Qwen3 32B (Free)', maxTokens: 40000 },
      { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 (Free)', maxTokens: 96000 },
    ]
  },
  {
    companyName: 'OpenAI',
    models: [
      { id: 'openai/gpt-4o', name: 'GPT-4o', maxTokens: 128000 },
      { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', maxTokens: 128000 },
    ]
  },
  {
    companyName: 'Anthropic',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', maxTokens: 200000 },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', maxTokens: 200000 },
    ]
  },
  {
    companyName: 'Google',
    models: [
      { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro', maxTokens: 1048576 },
      { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', maxTokens: 1048576 },
    ]
  },
  {
    companyName: 'Meta',
    models: [
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', maxTokens: 128000 },
    ]
  },
  {
    companyName: 'Mistral',
    models: [
      { id: 'mistralai/mistral-medium-3', name: 'Mistral Medium 3', maxTokens: 32768 },
    ]
  },
  {
    companyName: 'DeepSeek',
    models: [
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', maxTokens: 128000 },
    ]
  },
  {
    companyName: 'Alibaba',
    models: [
      { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B', maxTokens: 40960 },
    ]
  },
  {
    companyName: 'xAI',
    models: [
      { id: 'x-ai/grok-3-beta', name: 'Grok 3 Beta', maxTokens: 32768 },
    ]
  },
];
