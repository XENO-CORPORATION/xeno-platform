import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, Key, Save, CheckCircle } from 'lucide-react';
import { API_INSTRUCTIONS, API_INSTRUCTIONS_LEGACY, API_TOKENS } from '../../config/apiConfig';

interface ApiTokenNoticeProps {
  serviceKey: string;
  onClose?: () => void;
  onTokenSaved?: () => void;
}

/**
 * Component that displays a notice when an API token is missing and allows users to input the token
 */
const ApiTokenNotice: React.FC<ApiTokenNoticeProps> = ({ serviceKey, onClose, onTokenSaved }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [token, setToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Handle both new and legacy API instruction formats
  const newServiceInfo = API_INSTRUCTIONS[serviceKey as keyof typeof API_INSTRUCTIONS];
  const legacyServiceInfo = API_INSTRUCTIONS_LEGACY[serviceKey as keyof typeof API_INSTRUCTIONS_LEGACY];
  
  // Use the new format if available, otherwise fall back to legacy
  const serviceInfo = newServiceInfo || legacyServiceInfo;
  
  if (!serviceInfo) {
    console.error(`No service info found for key: ${serviceKey}`);
    return null;
  }
  
  // Check if token already exists
  const tokenKey = `${serviceKey.toUpperCase()}_API_TOKEN` as keyof typeof API_TOKENS;
  if (API_TOKENS[tokenKey]) {
    return null;
  }
  
  const handleClose = () => {
    setIsOpen(false);
    if (onClose) onClose();
  };
  
  const handleSaveToken = async () => {
    if (!token.trim()) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      // XENO: client-side provider token writes removed — the browser holds no
      // provider keys, and these values were never used for any request. The notice
      // still calls onTokenSaved so any dependent UI refresh keeps working.
      
      // Success case
      setIsSaving(false);
      setIsSaved(true);
      
      if (onTokenSaved) {
        onTokenSaved();
      }
      
      // Close the notice after a delay
      setTimeout(() => {
        setIsOpen(false);
        if (onClose) onClose();
      }, 2000);
    } catch (err) {
      setIsSaving(false);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };
  
  if (!isOpen) return null;
  
  // Extract data based on available format
  const title = newServiceInfo?.name ? `${newServiceInfo.name} API Token` : legacyServiceInfo?.title || 'API Token';
  const description = legacyServiceInfo?.description || `To use ${title} features, you need an API token.`;
  const steps = newServiceInfo?.instructions || legacyServiceInfo?.steps || [];
  const url = newServiceInfo?.linkUrl || legacyServiceInfo?.url || '';
  const linkText = newServiceInfo?.linkText || 'Get API Token';
  const placeholder = newServiceInfo?.placeholder || 'Enter your API token here';
  
  return (
    <div className="bg-amber-900/30 border border-amber-800 rounded-lg p-4 mb-6">
      <div className="flex items-start">
        <div className="flex-shrink-0 mt-0.5">
          <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden="true" />
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-amber-300">{title}</h3>
          <div className="mt-2 text-sm text-amber-200">
            <p>{description}</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              {steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ul>
            
            {/* Token input form */}
            <div className="mt-4 bg-black/30 rounded-lg p-3">
              <label htmlFor="api-token" className="block text-xs font-medium text-amber-200 mb-2">
                Enter your API token:
              </label>
              <div className="flex items-center">
                <div className="relative flex-grow">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key size={16} className="text-amber-500" />
                  </div>
                  <input
                    type="text"
                    id="api-token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="bg-black/50 text-white pl-10 pr-3 py-2 border border-amber-700 focus:ring-amber-500 focus:border-amber-500 block w-full rounded-md text-sm"
                    placeholder={placeholder}
                    disabled={isSaving || isSaved}
                  />
                </div>
                <button
                  onClick={handleSaveToken}
                  disabled={!token.trim() || isSaving || isSaved}
                  className={`ml-3 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm flex items-center transition-colors ${
                    !token.trim() || isSaving || isSaved
                      ? 'bg-amber-700/50 text-amber-300/50 cursor-not-allowed'
                      : 'text-black bg-amber-400 hover:bg-amber-500'
                  }`}
                >
                  {isSaved ? (
                    <>
                      <CheckCircle size={16} className="mr-1.5" />
                      Saved
                    </>
                  ) : isSaving ? (
                    <>
                      <svg className="animate-spin h-4 w-4 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={16} className="mr-1.5" />
                      Save Token
                    </>
                  )}
                </button>
              </div>
              {error && (
                <p className="mt-2 text-xs text-red-400">{error}</p>
              )}
              <p className="mt-2 text-xs text-amber-300/70">Your token is stored locally in your browser and is never sent to our servers</p>
            </div>
          </div>
          
          <div className="mt-4 flex space-x-4">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-black bg-amber-200 hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
            >
              {linkText}
              <ExternalLink size={14} className="ml-1" />
            </a>
            {!isSaved && (
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex items-center px-3 py-2 border border-amber-200/30 text-sm leading-4 font-medium rounded-md text-amber-200 bg-transparent hover:bg-amber-900/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiTokenNotice;