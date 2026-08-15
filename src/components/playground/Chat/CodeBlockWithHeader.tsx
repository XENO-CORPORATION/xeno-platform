import React, { useState, useMemo, memo } from 'react';
import { Copy, Check, Rows, Minimize2, Maximize2, Play, Loader2, X, Pencil } from '@/lib/icons';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Interface for Piston API Runtime (can remain here or be moved to a types file)
interface PistonRuntime {
  language: string;
  version: string;
  aliases: string[];
  runtime?: string;
}

interface CodeBlockExecutionState {
  isRunning: boolean;
  output: string | null;
  error: string | null;
}

interface CodeBlockWithHeaderProps {
  language?: string;
  code: string;
  runtimes: PistonRuntime[];
  runtimesLoading: boolean;
  codeBlockId: string; // Unique ID for this block
  executionState?: CodeBlockExecutionState; // Current execution state from parent
  onRunCode: (codeBlockId: string, language: string, code: string, availableRuntimes: PistonRuntime[]) => Promise<void>; // Parent handles execution
  onCloseOutput: (codeBlockId: string) => void; // Parent handles closing output
  onEditCode?: (codeBlockId: string, currentCode: string, language: string) => void; // Parent handles code editing
  isEditing?: boolean; // Whether this code block is currently being edited
  editingCode?: string; // The current edited code value
  onEditCodeChange?: (newCode: string) => void; // Callback when editing code changes
  onSaveCodeEdit?: () => void; // Callback to save code edit
  onCancelCodeEdit?: () => void; // Callback to cancel code edit
  theme?: 'dark' | 'light'; // Chat theme — drives the syntax palette + surfaces
}

// List of languages considered runnable (adjust as needed based on Piston support)
const runnableLanguages = ['python', 'javascript', 'typescript', 'bash', 'sh', 'zsh', 'shell', 'cpp', 'c', 'java', 'go', 'ruby', 'rust'];

// Wrap component with React.memo
const CodeBlockWithHeader: React.FC<CodeBlockWithHeaderProps> = memo(({
  language = 'plaintext',
  code,
  runtimes,
  runtimesLoading,
  codeBlockId,
  executionState,
  onRunCode,
  onCloseOutput,
  onEditCode,
  isEditing = false,
  editingCode = '',
  onEditCodeChange,
  onSaveCodeEdit,
  onCancelCodeEdit,
  theme = 'dark'
}) => {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Derive display values from props.executionState or defaults
  const currentIsRunning = executionState?.isRunning ?? false;
  const currentRunOutput = executionState?.output ?? null;
  const currentRunError = executionState?.error ?? null;

  const cleanLanguage = useMemo(() => language.split(' ')[0]?.toLowerCase() || 'plaintext', [language]);
  const numberOfLines = useMemo(() => code.split('\n').length, [code]);
  const canCollapse = useMemo(() => numberOfLines > 5, [numberOfLines]); // Collapse threshold
  const isRunnable = useMemo(() => runnableLanguages.includes(cleanLanguage), [cleanLanguage]); // Check if language is runnable

  const handleCloseOutput = () => {
    onCloseOutput(codeBlockId); // Call parent to clear output for this block
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
    setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(err => {
      console.error('Failed to copy code: ', err);
    });
  };

  const toggleCollapse = () => {
      if (canCollapse) {
          setIsCollapsed(!isCollapsed);
      }
  };

  const handleRun = async () => {
    if (!isRunnable || runtimesLoading || runtimes.length === 0) {
      // If runtimes are still loading or not available, or language not runnable,
      // parent will be responsible for setting an appropriate error via onRunCode if desired,
      // or this button should ideally be disabled based on runtimesLoading.
      // For now, let parent's onRunCode handle it or show its own error.
      console.warn("Run called but conditions not met (e.g., runtimes loading/unavailable).");
      // Optionally, call onRunCode which might set an error state in the parent if runtimes aren't ready
      // For simplicity here, we rely on the button being disabled if runtimesLoading is true.
      // If it makes it here and runtimes.length is 0 (after loading), onRunCode should handle this case.
      await onRunCode(codeBlockId, cleanLanguage, code, runtimes); 
      return;
    }
    await onRunCode(codeBlockId, cleanLanguage, code, runtimes);
  };

  // --- Style Definitions ---
  const baseButtonClass = "p-1.5 rounded-md transition-all duration-150 ease-in-out flex items-center gap-1.5 text-[var(--chat-muted)] text-xs font-medium hover:text-[var(--chat-text)] hover:bg-[var(--chat-hover)]";
  const copiedButtonClass = "text-[var(--chat-text)] bg-[var(--chat-hover)]";

  // Customizations for the syntax highlighter style
  // We modify the theme directly here for padding and line height inside the <pre>
  const customSyntaxHighlighterStyle = useMemo(() => {
    const style = { ...(theme === 'light' ? oneLight : vscDarkPlus) }; // Palette follows chat theme

    // Style the main <pre> tag
    style['pre[class*="language-"]'] = {
        ...(style['pre[class*="language-"]'] || {}), // Keep existing pre styles
        margin: '0',                     // Remove outer margin
        padding: '1rem',                 // Add internal padding (adjust as needed)
        backgroundColor: 'transparent',  // Show the token-themed container behind it
        lineHeight: '1.5',               // Standard line height for readability
        borderRadius: '0 0 0.5rem 0.5rem', // RE-ADD bottom rounding
    };
    
    // Style the <code> tag inside <pre>
     style['code[class*="language-"]'] = {
         ...(style['code[class*="language-"]'] || {}), // Keep existing code styles
         fontFamily: 'Consolas, Monaco, \'Andale Mono\', \'Ubuntu Mono\', monospace', // Consistent font
         lineHeight: 'inherit', // Inherit line height from pre
         fontSize: '0.9rem',    // Adjust font size if needed
         whiteSpace: 'pre',     // Crucial: Preserve whitespace and line breaks
     };

    return style;
  }, [theme]);
  
  // Style for line numbers
  const lineNumberStyle = useMemo(() => ({
      minWidth: '2.5em', // Ensure space for line numbers
      paddingRight: '1em',
      marginRight: '0.5em', // Consistent margin for all lines
      textAlign: 'right' as const, // Right-align line numbers for consistent spacing
      color: 'var(--chat-muted)', // Dim color for line numbers
      userSelect: 'none' as const,
      fontSize: '0.9em', // Slightly smaller line numbers
      display: 'inline-block', // Needed for proper alignment
      // borderRight: '1px solid #3a3a3d', // Optional separator line
  }), []);
  // --- End Style Definitions ---

  return (
    // Use a Fragment to return multiple top-level elements
    <>
      {/* The scrollbar is XENO Elements' now, applied document-wide from `scrollbar.css`: nothing at
          rest, a hairline rail with the thumb on it once the pointer is in the region.

          A local one used to be declared here — an 8px webkit bar plus a `scrollbar-width: thin`
          labelled "Optional: Firefox scrollbar styling". That label had it backwards. Since Chrome 121
          an element with `scrollbar-width` set has its `::-webkit-scrollbar` rules IGNORED, so the line
          meant for Firefox was switching the good version off everywhere else, and this panel had been
          showing the browser's default bar rather than the four rules above it. No error, and the rules
          still listed as applied in DevTools. */}

      {/* Code Block Container - Add the unique class.
          `overflow: clip` rather than `hidden`: both round off the corners, but `hidden`
          makes this a scroll container, and a sticky child can then only stick inside a
          box that never scrolls — i.e. not at all. `clip` does not, so the header below
          sticks against the conversation's scrollport, which is the one actually moving. */}
      <div className="code-block-container code-block-syntax-highlighter rounded-lg border border-[var(--chat-border)] bg-[var(--chat-canvas)] [overflow:clip] shadow-none my-4">

        {/* Header — pinned, so Copy / Edit stay reachable anywhere inside a long block. */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-lg border-b border-[var(--chat-border)] bg-[var(--chat-surface)] px-4 py-2">
          {/* Language Name */}
          <span className="text-xs font-medium text-[var(--chat-muted)] select-none uppercase tracking-wider">
            {cleanLanguage}
        </span>
          
          {/* Header Buttons */}
          <div className="flex items-center gap-3">
             {/* Collapse Button */}
             {canCollapse && !isEditing && (
                 <button
                    className={`${baseButtonClass} hover:bg-zinc-700/60`}
                    title={isCollapsed ? "Expand code" : "Collapse code"}
                    onClick={toggleCollapse}
                    disabled={currentIsRunning} // Disable while running
                 >
                    {isCollapsed ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
                    <span className="hidden sm:inline">{isCollapsed ? 'Expand' : 'Collapse'}</span>
                 </button>
             )}
             {/* Run Button (Conditional) */}
             {isRunnable && !isEditing && (
                <button
                   className={`${baseButtonClass} ${currentIsRunning || runtimesLoading ? 'text-gray-500 cursor-not-allowed' : 'hover:bg-zinc-700/60'}`}
                   title={runtimesLoading ? "Loading runtimes..." : currentIsRunning ? "Running..." : "Run code"}
                   onClick={handleRun}
                   disabled={currentIsRunning || runtimesLoading} // Disable if running OR if runtimes are loading
                >
                   {currentIsRunning || runtimesLoading ? <Loader2 size={15} className="animate-spin"/> : <Play size={15} className="fill-current"/>}
                   <span className="hidden sm:inline">{runtimesLoading ? "Loading..." : currentIsRunning ? 'Running' : 'Run'}</span>
                </button>
             )}
             {/* Edit Button */}
             {onEditCode && !isEditing && (
                <button
                   className={`${baseButtonClass} hover:bg-zinc-700/60`}
                   title="Edit code"
                   onClick={() => onEditCode(codeBlockId, code, cleanLanguage)}
                   disabled={currentIsRunning}
                >
                   <Pencil size={15} />
                   <span className="hidden sm:inline">Edit</span>
                </button>
             )}
             {/* Save/Cancel Buttons when editing */}
             {isEditing && (
                <>
                  <button
                     className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 transition-colors"
                     title="Cancel editing"
                     onClick={onCancelCodeEdit}
                  >
                     Cancel
                  </button>
                  <button
                     className="text-xs bg-gray-400 text-zinc-900 px-3 py-1 rounded-md font-semibold hover:bg-gray-300 transition-colors"
                     title="Save changes"
                     onClick={onSaveCodeEdit}
                  >
                     Save
                  </button>
                </>
             )}
             {/* Copy Button */}
          <button
                className={`${baseButtonClass} ${copied ? copiedButtonClass : 'hover:bg-zinc-700/60'}`}
                title={copied ? "Copied!" : "Copy code"}
                data-selection={copied ? 'on' : 'off'}
            onClick={handleCopy}
                disabled={copied || currentIsRunning || isEditing} // Disable while running, copied, or editing
          >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          </div>
        </div>

        {/* Content Area (Code or Placeholder or Edit Textarea) */}
        <div className="code-content-area">
            {isEditing ? (
              <div className="p-2">
                <textarea
                  value={editingCode}
                  onChange={(e) => onEditCodeChange?.(e.target.value)}
                  className="w-full min-h-[200px] max-h-[500px] p-3 bg-[var(--chat-canvas)] border border-[var(--chat-border)] rounded-lg text-[var(--chat-text)] font-mono text-sm resize-y focus:outline-none focus:border-[var(--chat-muted)] focus:ring-1 focus:ring-[var(--chat-muted)] leading-relaxed"
                  placeholder="Edit code..."
                  autoFocus
                  spellCheck={false}
                />
              </div>
            ) : isCollapsed ? (
              <div
                className="px-4 py-3 flex items-center justify-center gap-2 text-sm text-gray-500 cursor-pointer hover:text-gray-400 transition-colors duration-150"
                onClick={toggleCollapse}
              >
                  <Rows size={16} />
                  <span className="text-white">{numberOfLines}</span> <span className="sr-only">hidden lines</span> <span className="hidden md:inline text-gray-400">hidden lines</span>
              </div>
            ) : (
              <SyntaxHighlighter
                language={cleanLanguage}
                style={customSyntaxHighlighterStyle}
                showLineNumbers={true}
                lineNumberStyle={lineNumberStyle}
                wrapLines={false}
                wrapLongLines={false}
                codeTagProps={{ style: { fontFamily: 'inherit', whiteSpace: 'inherit', lineHeight: 'inherit' } }}
              >
                {code}
              </SyntaxHighlighter>
          )}
        </div>

        
      </div> {/* End Code Block Container */} 

      {/* --- Separate Execution Output Container (RESTORED) --- */}
      {(currentIsRunning || currentRunOutput || currentRunError) && (
          // Restore original styling for a separate panel, remove top margin/bottom margin
          <div className="execution-output-container relative rounded-lg bg-[var(--chat-surface)] border border-[var(--chat-border)] px-4 py-2 text-xs shadow-none">
              {/* Close Button for Output - Conditionally Rendered */}
              {!currentIsRunning && (currentRunOutput || currentRunError) && (
                <button 
                  onClick={handleCloseOutput}
                  className="absolute top-1 right-1 p-1 text-gray-500 hover:text-gray-300 hover:bg-zinc-700/50 rounded-md transition-colors"
                  aria-label="Close output"
                >
                  <X size={14} />
                </button>
              )}

              {currentIsRunning && (
                  <div className="flex items-center gap-2 text-gray-400 text-xs">
                      <Loader2 size={14} className="animate-spin"/> 
                      <span>Running...</span>
                  </div>
              )}
              {currentRunOutput && !currentIsRunning && (
                  <div className="whitespace-pre-wrap font-mono text-gray-300 text-xs leading-relaxed">{currentRunOutput}</div> 
              )}
              {currentRunError && !currentIsRunning && (
                  <div className="whitespace-pre-wrap font-mono text-[var(--chat-danger)] text-xs leading-relaxed">{currentRunError}</div>
              )}
            </div>
      )}
      {/* ------------------------------------------ */}
    </>
  );
}); // Close React.memo

export default CodeBlockWithHeader;
