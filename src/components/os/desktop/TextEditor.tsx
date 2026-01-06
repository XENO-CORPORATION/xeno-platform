import React, { useState, useEffect } from 'react';
import { Save, FolderOpen, FilePlus, AlertCircle, Check } from 'lucide-react';
import { containerFileSystemService } from '../../../services/containerFileSystemService';

interface TextEditorProps {
  initialPath?: string;
}

const TextEditor: React.FC<TextEditorProps> = ({ initialPath }) => {
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState(initialPath || '');
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialPath) {
      loadFile(initialPath);
    }
  }, [initialPath]);

  const loadFile = async (path: string) => {
    setIsLoading(true);
    setStatus('Loading...');
    try {
      const result = await containerFileSystemService.readFile(path);
      if (result.success) {
        setContent(result.content || '');
        setFilePath(path);
        setIsDirty(false);
        setStatus('File loaded');
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } catch (error) {
      setStatus(`Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!filePath) {
      // TODO: Implement Save As dialog
      const newPath = prompt('Enter file path to save (e.g., /home/user/newfile.txt):');
      if (!newPath) return;
      setFilePath(newPath);
      await saveFile(newPath, content);
    } else {
      await saveFile(filePath, content);
    }
  };

  const saveFile = async (path: string, fileContent: string) => {
    setIsLoading(true);
    setStatus('Saving...');
    try {
      const result = await containerFileSystemService.writeFile(path, fileContent);
      if (result.success) {
        setIsDirty(false);
        setStatus('Saved successfully');
        setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus(`Error: ${result.message || 'Failed to save'}`);
      }
    } catch (error) {
      setStatus(`Error saving file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 bg-[#2d2d2d] border-b border-[#3e3e3e]">
        <button 
          className="p-1.5 hover:bg-[#3e3e3e] rounded transition-colors text-gray-300"
          onClick={() => {
            setContent('');
            setFilePath('');
            setIsDirty(false);
          }}
          title="New File"
        >
          <FilePlus size={16} />
        </button>
        <button 
          className="p-1.5 hover:bg-[#3e3e3e] rounded transition-colors text-gray-300"
          onClick={() => {
            const path = prompt('Enter file path to open:');
            if (path) loadFile(path);
          }}
          title="Open File"
        >
          <FolderOpen size={16} />
        </button>
        <button 
          className="p-1.5 hover:bg-[#3e3e3e] rounded transition-colors text-gray-300"
          onClick={handleSave}
          title="Save (Ctrl+S)"
        >
          <Save size={16} />
        </button>
        
        <div className="h-4 w-px bg-[#3e3e3e] mx-2" />
        
        <span className="text-xs text-gray-400 truncate flex-1 font-mono">
          {filePath || 'Untitled'} {isDirty ? '•' : ''}
        </span>
        
        {status && (
          <span className="text-xs text-gray-400 animate-fade-in flex items-center gap-1">
            {status.includes('Error') ? <AlertCircle size={12} className="text-red-400" /> : <Check size={12} className="text-green-400" />}
            {status}
          </span>
        )}
      </div>

      {/* Editor Area */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-[#1e1e1e]/50 flex items-center justify-center z-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setIsDirty(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] p-4 font-mono text-sm outline-none resize-none leading-relaxed"
          spellCheck={false}
          placeholder="Start typing..."
        />
      </div>
      
      {/* Status Bar */}
      <div className="bg-[#007acc] text-white px-3 py-1 text-xs flex justify-between items-center">
        <div className="flex gap-4">
          <span>UTF-8</span>
          <span>{content.split('\n').length} lines</span>
        </div>
        <span>Text Editor</span>
      </div>
    </div>
  );
};

export default TextEditor;
