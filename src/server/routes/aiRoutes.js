import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { generateSignedUrl } from '../middleware/cdnOptimization.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_MODEL_CATALOG_PATH = path.resolve(__dirname, '../data/localModelCatalog.json');

// AI provider configurations
const PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    getKey: () => process.env.OPENAI_API_KEY,
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    getKey: () => process.env.ANTHROPIC_API_KEY,
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    getKey: () => process.env.VITE_GEMINI_API_KEY,
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    getKey: () => process.env.OPENROUTER_API_KEY,
  },
};

// Model to provider mapping
const MODEL_PROVIDERS = {
  // OpenAI models
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'gpt-4-turbo': 'openai',
  'gpt-3.5-turbo': 'openai',

  // Anthropic models
  'claude-3-5-sonnet': 'anthropic',
  'claude-3-5-haiku': 'anthropic',
  'claude-3-opus': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-haiku': 'anthropic',

  // Google models
  'gemini-pro': 'google',
  'gemini-2.0-flash': 'google',
  'gemini-1.5-pro': 'google',
  'gemini-1.5-flash': 'google',

  // OpenRouter models (for Llama, DeepSeek, Mistral, etc.)
  'llama-3.3-70b': 'openrouter',
  'llama-3.1-70b': 'openrouter',
  'llama-3.1-8b': 'openrouter',
  'deepseek-chat': 'openrouter',
  'deepseek-v3': 'openrouter',
  'deepseek-r1': 'openrouter',
  'mistral-large': 'openrouter',
  'qwen-72b': 'openrouter',
};

// OpenRouter model ID mapping
const OPENROUTER_MODEL_IDS = {
  'llama-3.3-70b': 'meta-llama/llama-3.3-70b-instruct',
  'llama-3.1-70b': 'meta-llama/llama-3.1-70b-instruct',
  'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct',
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-v3': 'deepseek/deepseek-chat',
  'deepseek-r1': 'deepseek/deepseek-r1',
  'mistral-large': 'mistralai/mistral-large-latest',
  'qwen-72b': 'qwen/qwen-2.5-72b-instruct',
};

// Anthropic model ID mapping
const ANTHROPIC_MODEL_IDS = {
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',
};

// Google model ID mapping
const GOOGLE_MODEL_IDS = {
  'gemini-2.0-flash': 'gemini-2.0-flash-exp',
  'gemini-1.5-pro': 'gemini-1.5-pro',
  'gemini-1.5-flash': 'gemini-1.5-flash',
  'gemini-pro': 'gemini-pro',
};

function readLocalModelCatalog() {
  const raw = readFileSync(LOCAL_MODEL_CATALOG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function serializeLocalModelCatalogModel(model) {
  const installSpec = model.installSpec
    ? {
        ...model.installSpec,
        downloadUrl: model.installSpec.artifactKey
          ? generateSignedUrl(model.installSpec.artifactKey, 6 * 60 * 60)
          : null,
      }
    : null;

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    category: model.category,
    description: model.description,
    size: model.size,
    sizeBytes: model.sizeBytes ?? null,
    parameters: model.parameters ?? null,
    tags: Array.isArray(model.tags) ? model.tags : [],
    license: model.license ?? null,
    runtime: model.runtime ?? null,
    installable: Boolean(model.installable && installSpec?.downloadUrl),
    installSpec,
    unavailableReason: model.unavailableReason ?? null,
  };
}

/**
 * POST /api/ai/chat
 * Universal AI chat endpoint that routes to appropriate provider
 */
router.post('/chat', async (req, res) => {
  const { model, messages, stream = false, temperature = 0.7, max_tokens = 4096 } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: 'Model and messages are required' });
  }

  console.log(`[AI Chat] Request for model: ${model}, messages: ${messages.length}`);

  // Determine provider
  const provider = MODEL_PROVIDERS[model] || 'openrouter';
  const providerConfig = PROVIDERS[provider];

  if (!providerConfig) {
    return res.status(400).json({ error: `Unknown provider for model: ${model}` });
  }

  const apiKey = providerConfig.getKey();
  if (!apiKey) {
    console.error(`[AI Chat] Missing API key for provider: ${provider}`);
    return res.status(500).json({ error: `API key not configured for ${provider}` });
  }

  try {
    let response;

    switch (provider) {
      case 'openai':
        response = await handleOpenAIChat(apiKey, model, messages, temperature, max_tokens);
        break;
      case 'anthropic':
        response = await handleAnthropicChat(apiKey, model, messages, temperature, max_tokens);
        break;
      case 'google':
        response = await handleGoogleChat(apiKey, model, messages, temperature, max_tokens);
        break;
      case 'openrouter':
        response = await handleOpenRouterChat(apiKey, model, messages, temperature, max_tokens);
        break;
      default:
        return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    res.json(response);
  } catch (error) {
    console.error(`[AI Chat] Error:`, error.message);
    res.status(500).json({
      error: 'AI generation failed',
      provider: provider,
      model: model
    });
  }
});

/**
 * Handle OpenAI chat completion
 */
async function handleOpenAIChat(apiKey, model, messages, temperature, max_tokens) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature,
      max_tokens: max_tokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    success: true,
    content: data.choices[0]?.message?.content || '',
    model: model,
    provider: 'openai',
    usage: data.usage,
  };
}

/**
 * Handle Anthropic chat completion
 */
async function handleAnthropicChat(apiKey, model, messages, temperature, max_tokens) {
  // Convert OpenAI message format to Anthropic format
  const anthropicMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  // Extract system prompt
  const systemMessage = messages.find(m => m.role === 'system');
  const systemPrompt = systemMessage?.content || '';

  const anthropicModel = ANTHROPIC_MODEL_IDS[model] || model;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: max_tokens,
      system: systemPrompt,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    success: true,
    content: data.content[0]?.text || '',
    model: anthropicModel,
    provider: 'anthropic',
    usage: {
      prompt_tokens: data.usage?.input_tokens,
      completion_tokens: data.usage?.output_tokens,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  };
}

/**
 * Handle Google Gemini chat completion
 */
async function handleGoogleChat(apiKey, model, messages, temperature, max_tokens) {
  // Convert to Gemini format
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  // Get system instruction
  const systemMessage = messages.find(m => m.role === 'system');

  const geminiModel = GOOGLE_MODEL_IDS[model] || model;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: max_tokens,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    success: true,
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    model: geminiModel,
    provider: 'google',
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount,
      completion_tokens: data.usageMetadata?.candidatesTokenCount,
      total_tokens: data.usageMetadata?.totalTokenCount,
    },
  };
}

/**
 * Handle OpenRouter chat completion (for Llama, DeepSeek, Mistral, etc.)
 */
async function handleOpenRouterChat(apiKey, model, messages, temperature, max_tokens) {
  const openRouterModel = OPENROUTER_MODEL_IDS[model] || model;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://xeno-studio.com',
      'X-Title': 'Xeno Search Engine',
    },
    body: JSON.stringify({
      model: openRouterModel,
      messages: messages,
      temperature: temperature,
      max_tokens: max_tokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    success: true,
    content: data.choices[0]?.message?.content || '',
    model: openRouterModel,
    provider: 'openrouter',
    usage: data.usage,
  };
}

/**
 * GET /api/ai/models
 * List available AI models
 */
router.get('/models', (req, res) => {
  const models = [
    // OpenAI
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', description: 'Most capable OpenAI model', icon: '🟢' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', description: 'Fast and affordable', icon: '🟢' },

    // Anthropic
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', description: 'Best for analysis and coding', icon: '🟠' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic', description: 'Most powerful Claude', icon: '🟠' },

    // Google
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', description: 'Long context, multimodal', icon: '🔵' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google', description: 'Fast and efficient', icon: '🔵' },

    // Open Source via OpenRouter
    { id: 'llama-3.1-70b', name: 'Llama 3.1 70B', provider: 'Meta', description: 'Open source, powerful', icon: '🟣' },
    { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', description: 'Advanced reasoning', icon: '🔴' },
    { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'DeepSeek', description: 'Reasoning model', icon: '🔴' },
    { id: 'mistral-large', name: 'Mistral Large', provider: 'Mistral', description: 'European excellence', icon: '⚪' },
  ];

  res.json({
    success: true,
    models: models,
  });
});

/**
 * GET /api/ai/local-model-catalog
 * Returns the production local model catalog that Hub should render.
 */
router.get('/local-model-catalog', (req, res) => {
  const catalog = readLocalModelCatalog();
  const models = Array.isArray(catalog.models)
    ? catalog.models.map(serializeLocalModelCatalogModel)
    : [];

  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
  res.json({
    success: true,
    source: 'platform',
    schemaVersion: catalog.schemaVersion ?? 1,
    catalogVersion: catalog.catalogVersion ?? 'unknown',
    updatedAt: catalog.updatedAt ?? null,
    models,
  });
});

export default router;
