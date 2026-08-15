import React from 'react';
import { X, ExternalLink } from '@/lib/icons';

// Define XenoSource interface here to avoid circular dependencies
interface XenoSource {
  url: string;
  title?: string;
  snippet?: string;
  raw_text?: string;
}

interface XenoSourcePreviewProps {
  source: XenoSource;
  index: number;
  isExpanded: boolean;
}

const XenoSourcePreview: React.FC<XenoSourcePreviewProps> = ({
  source,
  index,
  isExpanded
}) => {
  // Determine the URL to display and link to
  const displayUrl = source.url;
                     
  // Get hostname for display
  const hostname = (() => {
    try {
      return new URL(displayUrl).hostname;
    } catch (e) {
      return displayUrl;
    }
  })();
  
  // Get hostname for the footer without 'www.'
  const footerHostname = (() => {
    try {
      const url = new URL(displayUrl);
      return url.hostname.replace(/^www\./, '');
    } catch (e) {
      return ''; 
    }
  })();
  
    return (      <div         className="xeno-source-preview p-3 my-2 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-sm hover:shadow transition-all"      >        <div className="flex items-center justify-between mb-2">          <a             href={displayUrl}             target="_blank"             rel="noopener noreferrer"             title={displayUrl}            className="flex items-center gap-2 overflow-hidden group"          >            <span className="text-sm font-medium text-[var(--chat-accent)] truncate underline decoration-[var(--chat-border)] underline-offset-2 transition-colors group-hover:decoration-[var(--chat-accent)]">              {source.title || hostname}            </span>            <ExternalLink size={12} className="flex-shrink-0 text-[var(--chat-muted)] transition-colors group-hover:text-[var(--chat-text)]" />          </a>        </div>        <div className="source-preview-content text-gray-300">          <div className="space-y-1">            {source.snippet ? (              <p className={`text-xs text-gray-400 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>                {source.snippet}              </p>            ) : (              <p className="text-xs text-gray-500 italic">No preview available.</p>            )}          </div>        </div>        <div className="mt-2 flex items-center justify-between">          <div className="flex items-center">            <span className="text-[var(--chat-muted)] mr-2 font-medium">[XS:{index + 1}]</span>             {footerHostname && (              <span className="text-xs text-gray-400 truncate" title={displayUrl}>{footerHostname}</span>            )}            {!footerHostname && (              <span className="text-xs text-gray-400 truncate">Source {index + 1}</span>            )}          </div>        </div>      </div>
  );
};

export default XenoSourcePreview; 