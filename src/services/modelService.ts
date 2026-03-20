// Model Service - Fetches available AI models from the Xeno API
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

const CACHE_KEY = 'xeno_models_cache_v3';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

interface CachedData {
  timestamp: number;
  data: ModelsResponse;
}

const getCachedModels = (): ModelsResponse | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const { timestamp, data }: CachedData = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_DURATION) return data;
    return null;
  } catch {
    return null;
  }
};

const setCachedModels = (data: ModelsResponse): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {}
};

export const fetchModels = async (): Promise<ModelsResponse> => {
  const cached = getCachedModels();
  if (cached) return cached;

  const response = await fetch('/api/models');
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const data: ModelsResponse = await response.json();
  if (!data.success) {
    throw new Error('API returned unsuccessful response');
  }

  setCachedModels(data);
  return data;
};

// Convert API response to grouped models array
export const getGroupedModels = async (): Promise<GroupedModels[]> => {
  const response = await fetchModels();

  const grouped: GroupedModels[] = Object.entries(response.companies).map(
    ([companyName, models]) => ({
      companyName,
      models: models.filter(m => !m.id.includes(':free'))
    })
  ).filter(group => group.models.length > 0);

  // Sort companies alphabetically
  grouped.sort((a, b) => a.companyName.localeCompare(b.companyName));

  // Sort models within each company by created date (newest first)
  grouped.forEach(group => {
    group.models.sort((a, b) => (b.created || 0) - (a.created || 0));
  });

  return grouped;
};

export const getAllModels = async (): Promise<Model[]> => {
  const grouped = await getGroupedModels();
  return grouped.flatMap(group => group.models);
};

export const findModelById = async (modelId: string): Promise<Model | null> => {
  const models = await getAllModels();
  return models.find(m => m.id === modelId) || null;
};

export const clearModelsCache = (): void => {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem('xeno_free_models_cache');
};

// Fallback models when API is unavailable — mirrors api.xenostudio.ai/api/models
export const FALLBACK_MODELS: GroupedModels[] = [
  {
    companyName: 'Anthropic',
    models: [
      { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', maxTokens: 200000 },
      { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', maxTokens: 200000 },
      { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5', maxTokens: 200000 },
      { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', maxTokens: 200000 },
    ]
  },
  {
    companyName: 'OpenAI',
    models: [
      { id: 'openai/gpt-5.4-pro', name: 'GPT-5.4 Pro', maxTokens: 1050000 },
      { id: 'openai/gpt-5.4', name: 'GPT-5.4', maxTokens: 1050000 },
      { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', maxTokens: 400000 },
      { id: 'openai/gpt-5.4-nano', name: 'GPT-5.4 Nano', maxTokens: 400000 },
    ]
  },
  {
    companyName: 'Google',
    models: [
      { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', maxTokens: 1048576 },
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', maxTokens: 1048576 },
      { id: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview', maxTokens: 1048576 },
    ]
  },
  {
    companyName: 'DeepSeek',
    models: [
      { id: 'deepseek/deepseek-v3.2-speciale', name: 'DeepSeek V3.2 Speciale', maxTokens: 128000 },
      { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', maxTokens: 128000 },
      { id: 'deepseek/deepseek-v3.1-terminus', name: 'DeepSeek V3.1 Terminus', maxTokens: 128000 },
    ]
  },
  {
    companyName: 'Meta',
    models: [
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', maxTokens: 128000 },
      { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout', maxTokens: 512000 },
    ]
  },
  {
    companyName: 'xAI',
    models: [
      { id: 'x-ai/grok-4.20-multi-agent-beta', name: 'Grok 4.20 Multi-Agent Beta', maxTokens: 131072 },
      { id: 'x-ai/grok-4.20-beta', name: 'Grok 4.20 Beta', maxTokens: 131072 },
      { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', maxTokens: 131072 },
    ]
  },
  {
    companyName: 'Mistral',
    models: [
      { id: 'mistralai/mistral-small-4', name: 'Mistral Small 4', maxTokens: 131072 },
      { id: 'mistralai/devstral-2-2512', name: 'Devstral 2', maxTokens: 131072 },
    ]
  },
  {
    companyName: 'Alibaba',
    models: [
      { id: 'qwen/qwen3.5-122b-a10b', name: 'Qwen3.5 122B', maxTokens: 40960 },
      { id: 'qwen/qwen3.5-27b', name: 'Qwen3.5 27B', maxTokens: 40960 },
    ]
  },
];
