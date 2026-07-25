import type { GroupedModels } from '@/services/modelService';

// TEMPORARY: local visual-review data for the Chat LLM model rail.
// It is intentionally available only while Vite runs in development mode, so
// a signed-out production visitor never sees models that the API did not grant.
export const MOCK_CHAT_MODELS: GroupedModels[] = import.meta.env.DEV
  ? [
      {
        companyName: 'OpenAI',
        models: [
          {
            id: 'gpt-5.6-terra',
            name: 'GPT-5.6 Terra',
            maxTokens: 200_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'gpt-5.5',
            name: 'GPT-5.5',
            maxTokens: 128_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'gpt-5.4-mini',
            name: 'GPT-5.4 Mini',
            maxTokens: 128_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'gpt-5.4-nano',
            name: 'GPT-5.4 Nano',
            maxTokens: 64_000,
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsVision: true,
          },
          {
            id: 'gpt-4.1',
            name: 'GPT-4.1',
            maxTokens: 128_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'gpt-4.1-mini',
            name: 'GPT-4.1 Mini',
            maxTokens: 128_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'o4',
            name: 'o4',
            maxTokens: 200_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'o4-mini',
            name: 'o4 Mini',
            maxTokens: 200_000,
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
          },
        ],
      },
      {
        companyName: 'Anthropic',
        models: [
          {
            id: 'anthropic/claude-sonnet-4',
            name: 'Claude Sonnet 4',
            maxTokens: 200_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
            supportsFileUpload: true,
          },
        ],
      },
      {
        companyName: 'Google',
        models: [
          {
            id: 'google/gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            maxTokens: 1_000_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
            supportsFileUpload: true,
          },
          {
            id: 'google/gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            maxTokens: 1_000_000,
            inputModalities: ['text', 'image', 'file'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
            supportsFileUpload: true,
          },
        ],
      },
      {
        companyName: 'xAI',
        models: [
          {
            id: 'xai/grok-4',
            name: 'Grok 4',
            maxTokens: 128_000,
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsReasoning: 'toggleable',
            supportsVision: true,
          },
        ],
      },
    ]
  : [];
