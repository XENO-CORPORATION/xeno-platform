import React, { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { NodeTemplate } from './AgentPanel';

interface SearchContainerProps {
  position: { x: number; y: number };
  onSelect: (template: NodeTemplate) => void;
  onClose: () => void;
  templates: NodeTemplate[];
  connectingType?: string;
}

const SearchContainer: React.FC<SearchContainerProps> = ({
  position,
  onSelect,
  onClose,
  templates,
  connectingType
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter templates based on search and compatibility
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    // If we're connecting, check input compatibility
    if (connectingType) {
      const hasCompatibleInput = template.inputs.some(input => 
        input.type === 'any' || 
        input.type === connectingType ||
        (input.type === 'parameter' && connectingType === 'text')
      );
      return matchesSearch && hasCompatibleInput;
    }
    
    return matchesSearch;
  });

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < filteredTemplates.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredTemplates[selectedIndex]) {
          onSelect(filteredTemplates[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div 
      ref={containerRef}
      className="absolute z-50 w-80 bg-[rgba(30,30,30,0.95)] border border-white/10 rounded-xl shadow-lg transform-gpu"
      style={{ 
        left: position.x, 
        top: position.y,
        transform: 'translate(-50%, -50%)'
      }}
    >
      {/* Search input */}
      <div className="p-2 border-b border-white/10">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-white/40" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:ring-1 focus:ring-white/20"
            placeholder="Search nodes..."
          />
        </div>
      </div>

      {/* Results list */}
      <div className="max-h-64 overflow-y-auto p-1">
        {filteredTemplates.length > 0 ? (
          filteredTemplates.map((template, index) => (
            <div
              key={template.id}
              className={`p-3 rounded-lg cursor-pointer transition-colors ${
                index === selectedIndex 
                  ? 'bg-white/10' 
                  : 'hover:bg-white/5'
              }`}
              onClick={() => onSelect(template)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="flex items-center">
                <div className="mr-3">
                  {template.icon}
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{template.title}</div>
                  <div className="text-xs text-white/50 line-clamp-1">{template.description}</div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="p-4 text-center text-white/50">
            No matching nodes found
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchContainer;