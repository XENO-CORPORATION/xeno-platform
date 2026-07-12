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

  // /api/models is auth-gated — send the platform bearer token (same key the
  // rest of the app uses). Without it the endpoint 401s and the picker is empty.
  const token = localStorage.getItem('xenoos_auth_token');
  const response = await fetch('/api/models', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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

// No hardcoded fallback: the chat shows ONLY the live models actually available
// on api.xenostudio.ai (/api/models → /v1/models, filtered to type=text). An
// empty fallback means a transient loading/empty picker rather than fabricated
// model ids that don't exist on the endpoint.
export const FALLBACK_MODELS: GroupedModels[] = [];
