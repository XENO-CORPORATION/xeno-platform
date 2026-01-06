// API Configuration file
// In a production environment, these would be set via environment variables

// Define a global interface to add our custom properties to Window
declare global {
  interface Window {
    REPLICATE_API_TOKEN?: string;
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
  // Replicate API token for image generation models
  // Try to use the token from window or use an empty string if not found
  REPLICATE_API_TOKEN: window.REPLICATE_API_TOKEN || '',
  // Gemini API token for AI features
  GEMINI_API_TOKEN: window.GEMINI_API_TOKEN || window.GEMINI_API_KEY || '',
};

/**
 * API instructions for obtaining tokens for different services
 */
export const API_INSTRUCTIONS = {
  replicate: {
    name: 'Replicate',
    instructions: [
      'Create a Replicate account at https://replicate.com',
      'Go to your account settings',
      'Create an API token and copy it here'
    ],
    linkText: 'Get Replicate API Token',
    linkUrl: 'https://replicate.com/account/api-tokens',
    placeholder: 'r8_...'
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
const tokenParam = urlParams.get('api_token');
if (tokenParam) {
  API_TOKENS.REPLICATE_API_TOKEN = tokenParam;
  // Store in window for page refreshes
  window.REPLICATE_API_TOKEN = tokenParam;
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
  // Always use the backend proxy to avoid CORS issues
  // The backend server proxies requests to Replicate API
  if (window.location.hostname === 'localhost') {
    // Development: use local backend server
    return 'http://localhost:8080/api/image/replicate';
  }
  // Production: use the same origin backend server
  return `${window.location.origin}/api/image/replicate`;
};

/**
 * API Endpoints for various services
 */
export const API_ENDPOINTS = {
  // Use the backend proxy server to avoid CORS issues
  REPLICATE_API: getApiBaseUrl(),

  // Add other API endpoints as needed
  // OPENAI_API: 'https://api.openai.com/v1',
  // STABILITY_API: 'https://api.stability.ai/v1',
};

/**
 * Instructions for obtaining API tokens - LEGACY format for backward compatibility
 */
export const API_INSTRUCTIONS_LEGACY = {
  replicate: {
    title: 'Replicate API Token',
    description: 'To use image generation features, you need a Replicate API token.',
    steps: [
      'Sign up at https://replicate.com/',
      'Go to https://replicate.com/account',
      'Copy your API token',
      'Enter it below or add ?api_token=YOUR_TOKEN to the URL'
    ],
    url: 'https://replicate.com/account'
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
    replicate: Boolean(API_TOKENS.REPLICATE_API_TOKEN),
    gemini: Boolean(API_TOKENS.GEMINI_API_TOKEN || window.GEMINI_API_KEY),
    // Add other API checks as needed
  };
}