// API Configuration file
// In a production environment, these would be set via environment variables

// Define a global interface to add our custom properties to Window
declare global {
  interface Window {
    XENO_API_KEY?: string;
    GEMINI_API_TOKEN?: string;
    GEMINI_API_KEY?: string | undefined;
    GoogleGenerativeAI?: any; // For direct SDK usage in components
  }
}

/**
 * API Tokens for various services
 * Get token from environment variables or window object
 */
export const API_TOKENS = {
  // Xeno API key for AI generation models
  // Try to use the token from window or use an empty string if not found
  XENO_API_KEY: window.XENO_API_KEY || '',
  // Gemini API token for AI features
  GEMINI_API_TOKEN: window.GEMINI_API_TOKEN || window.GEMINI_API_KEY || '',
};

/**
 * API instructions for obtaining tokens for different services
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

// Check for token in URL params (for development convenience)
const urlParams = new URLSearchParams(window.location.search);
const tokenParam = urlParams.get('xeno_token');
if (tokenParam) {
  API_TOKENS.XENO_API_KEY = tokenParam;
  // Store in window for page refreshes
  window.XENO_API_KEY = tokenParam;
}

// Check for Gemini token in URL params
const geminiTokenParam = urlParams.get('gemini_token');
if (geminiTokenParam) {
  API_TOKENS.GEMINI_API_TOKEN = geminiTokenParam;
  // Store in window for page refreshes
  window.GEMINI_API_TOKEN = geminiTokenParam;
  window.GEMINI_API_KEY = geminiTokenParam; // For compatibility
}

// Get the base URL for the API proxy - use backend proxy to avoid CORS issues
const getApiBaseUrl = () => {
  // Use Xeno API directly
  return 'https://api.xenostudio.ai/v1';
};

/**
 * API Endpoints for various services
 */
export const API_ENDPOINTS = {
  // Xeno API endpoint
  XENO_API: getApiBaseUrl(),

  // Add other API endpoints as needed
  // OPENAI_API: 'https://api.openai.com/v1',
  // STABILITY_API: 'https://api.stability.ai/v1',
};

/**
 * Instructions for obtaining API tokens - LEGACY format for backward compatibility
 */
export const API_INSTRUCTIONS_LEGACY = {
  xeno: {
    title: 'Xeno API Key',
    description: 'To use AI generation features, you need a Xeno API key.',
    steps: [
      'Visit Xeno Studio at https://xenostudio.ai/',
      'Go to your account settings',
      'Create an API key',
      'Enter it below or add ?xeno_token=YOUR_TOKEN to the URL'
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

/**
 * Function to check if required API tokens are available
 */
export function checkApiTokens(): Record<string, boolean> {
  return {
    xeno: Boolean(API_TOKENS.XENO_API_KEY),
    gemini: Boolean(API_TOKENS.GEMINI_API_TOKEN || window.GEMINI_API_KEY),
    // Add other API checks as needed
  };
}