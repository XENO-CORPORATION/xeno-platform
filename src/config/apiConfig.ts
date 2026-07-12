// API Configuration file — NON-SECRET base-URL config only.
//
// SECURITY: provider API keys NEVER live in the browser. There is no client-side
// key store here, and keys are never accepted via URL params or held on `window`.
// All AI inference routes through the authed, metered backend
// (see src/services/aiService.ts → chatComplete), and all media generation routes
// through src/services/xenoProxyRequest.ts, which proxy to api.xenostudio.ai. The
// backend holds the provider keys. Do NOT reintroduce a client key store here.

// Type-only declarations kept for backward compatibility with components that still
// reference these window properties during the migration. They carry NO values —
// nothing in the shipped bundle assigns real keys to them.
declare global {
  interface Window {
    XENO_API_KEY?: string;
    GEMINI_API_TOKEN?: string;
    GEMINI_API_KEY?: string | undefined;
    GoogleGenerativeAI?: any;
  }
}

/**
 * API instructions for obtaining tokens for different services.
 * Display text / links only — contains NO secrets.
 */
export const API_INSTRUCTIONS = {
  xeno: {
    name: 'Xeno API',
    instructions: [
      'Visit Xeno Studio to get your API key',
      'Go to your account settings',
      'Create an API key and copy it here'
    ],
    linkText: 'Get Xeno API Key',
    linkUrl: 'https://xenostudio.ai/account/api-keys',
    placeholder: 'xeno_...'
  },
  gemini: {
    name: 'Google Gemini',
    instructions: [
      'Visit the Google AI Studio at https://aistudio.google.com/',
      'Create or sign in to your Google account',
      'Go to the API keys section and create a new API key'
    ],
    linkText: 'Get Gemini API Token',
    linkUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...'
  }
};

// Get the base URL for the API proxy (non-secret).
const getApiBaseUrl = () => {
  // Xeno API base URL.
  return 'https://api.xenostudio.ai/v1';
};

/**
 * API Endpoints for various services (non-secret base URLs).
 */
export const API_ENDPOINTS = {
  // Xeno API endpoint
  XENO_API: getApiBaseUrl(),

  // Add other API endpoints as needed
  // OPENAI_API: 'https://api.openai.com/v1',
  // STABILITY_API: 'https://api.stability.ai/v1',
};

/**
 * Inert compatibility shims for components not yet fully migrated off the old
 * client key store. These carry NO secrets and NEVER hold a provider key:
 *  - API_TOKENS is an empty object; any `.GEMINI_API_TOKEN` / `.XENO_API_KEY` read
 *    returns undefined, so every "if (API_TOKENS.x)" key-guard is false and those
 *    code paths degrade to the authed backend instead of a browser-held key.
 *  - checkApiTokens() always reports no client tokens.
 * Do NOT reintroduce real key storage here — inference goes through the backend.
 */
export const API_TOKENS: Record<string, string | undefined> = {};

// Record<string,boolean> so any consumer key (xeno/gemini/replicate/…) reads false.
export function checkApiTokens(): Record<string, boolean> {
  return { xeno: false, gemini: false, replicate: false };
}

/**
 * Instructions for obtaining API tokens - LEGACY format for backward compatibility.
 * Display text / links only — contains NO secrets.
 */
export const API_INSTRUCTIONS_LEGACY = {
  xeno: {
    title: 'Xeno API Key',
    description: 'To use AI generation features, you need a Xeno API key.',
    steps: [
      'Visit Xeno Studio at https://xenostudio.ai/',
      'Go to your account settings',
      'Create an API key',
      'Enter it below'
    ],
    url: 'https://xenostudio.ai/account/api-keys'
  },
  gemini: {
    title: 'Google Gemini API Token',
    description: 'To use Gemini AI features, you need a Gemini API token.',
    steps: [
      'Visit the Google AI Studio at https://aistudio.google.com/',
      'Create or sign in to your Google account',
      'Go to the API keys section and create a new API key'
    ],
    url: 'https://aistudio.google.com/app/apikey'
  }
};
