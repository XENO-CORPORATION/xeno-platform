import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Type,
  Image,
  CheckSquare,
  List,
  Table,
  Code,
  Calendar,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
  Link,
  Hash,
  MoreHorizontal,
  Trash2,
  Copy,
  Move,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Save,
  Download,
  Upload,
  Settings,
  Users,
  Clock,
  File
} from 'lucide-react';

interface Block {
  id: string;
  type: 'text' | 'heading1' | 'heading2' | 'heading3' | 'todo' | 'bullet' | 'numbered' | 'quote' | 'code' | 'divider' | 'image' | 'table';
  content: string;
  checked?: boolean;
  level?: number;
  children?: Block[];
  collapsed?: boolean;
}

const CanvasPlanning: React.FC = () => {
  const [blocks, setBlocks] = useState<Block[]>([
    {
      id: '1',
      type: 'heading1',
      content: 'Welcome to Canvas Planning'
    },
    {
      id: '2',
      type: 'text',
      content: 'Start planning your ideas here...'
    }
  ]);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [blockMenuPosition, setBlockMenuPosition] = useState({ x: 0, y: 0 });
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);

  const blockTypes = [
    { type: 'text', label: 'Text', icon: <Type size={16} />, description: 'Plain text' },
    { type: 'heading1', label: 'Heading 1', icon: <Heading1 size={16} />, description: 'Large heading' },
    { type: 'heading2', label: 'Heading 2', icon: <Heading2 size={16} />, description: 'Medium heading' },
    { type: 'heading3', label: 'Heading 3', icon: <Heading3 size={16} />, description: 'Small heading' },
    { type: 'todo', label: 'To-do', icon: <CheckSquare size={16} />, description: 'Checkbox list' },
    { type: 'bullet', label: 'Bullet List', icon: <List size={16} />, description: 'Bulleted list' },
    { type: 'numbered', label: 'Numbered List', icon: <Hash size={16} />, description: 'Numbered list' },
    { type: 'quote', label: 'Quote', icon: <Quote size={16} />, description: 'Quote block' },
    { type: 'code', label: 'Code', icon: <Code size={16} />, description: 'Code block' },
    { type: 'divider', label: 'Divider', icon: <Minus size={16} />, description: 'Visual divider' },
  ];

  const addBlock = (type: Block['type'], afterId?: string) => {
    const newBlock: Block = {
      id: Date.now().toString(),
      type,
      content: '',
      checked: type === 'todo' ? false : undefined,
    };

    if (afterId) {
      const index = blocks.findIndex(b => b.id === afterId);
      const newBlocks = [...blocks];
      newBlocks.splice(index + 1, 0, newBlock);
      setBlocks(newBlocks);
    } else {
      setBlocks([...blocks, newBlock]);
    }

    setShowBlockMenu(false);
  };

  const updateBlock = (id: string, updates: Partial<Block>) => {
    setBlocks(blocks.map(block =>
      block.id === id ? { ...block, ...updates } : block
    ));
  };

  const deleteBlock = (id: string) => {
    setBlocks(blocks.filter(block => block.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent, blockId: string, index: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const block = blocks.find(b => b.id === blockId);
      addBlock(block?.type || 'text', blockId);
    } else if (e.key === 'Backspace') {
      const block = blocks.find(b => b.id === blockId);
      if (block?.content === '' && blocks.length > 1) {
        e.preventDefault();
        deleteBlock(blockId);
        // Focus previous block
        if (index > 0) {
          const prevBlock = blocks[index - 1];
          setTimeout(() => {
            const input = document.getElementById(`block-${prevBlock.id}`);
            if (input) input.focus();
          }, 0);
        }
      }
    } else if (e.key === '/') {
      const block = blocks.find(b => b.id === blockId);
      if (block?.content === '') {
        e.preventDefault();
        setCurrentBlockId(blockId);
        setShowBlockMenu(true);
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        setBlockMenuPosition({ x: rect.left, y: rect.bottom });
      }
    }
  };

  const renderBlock = (block: Block, index: number) => {
    const commonClasses = "w-full bg-transparent text-white placeholder-white/40 focus:outline-none resize-none";

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateBlock(block.id, { content: e.target.value });
    };

    const handleCheckToggle = () => {
      updateBlock(block.id, { checked: !block.checked });
    };

    switch (block.type) {
      case 'heading1':
        return (
          <input
            id={`block-${block.id}`}
            type="text"
            value={block.content}
            onChange={handleChange}
            onKeyDown={(e) => handleKeyDown(e, block.id, index)}
            className={`${commonClasses} text-3xl font-bold`}
            placeholder="Heading 1"
            autoFocus={block.content === ''}
          />
        );

      case 'heading2':
        return (
          <input
            id={`block-${block.id}`}
            type="text"
            value={block.content}
            onChange={handleChange}
            onKeyDown={(e) => handleKeyDown(e, block.id, index)}
            className={`${commonClasses} text-2xl font-bold`}
            placeholder="Heading 2"
            autoFocus={block.content === ''}
          />
        );

      case 'heading3':
        return (
          <input
            id={`block-${block.id}`}
            type="text"
            value={block.content}
            onChange={handleChange}
            onKeyDown={(e) => handleKeyDown(e, block.id, index)}
            className={`${commonClasses} text-xl font-bold`}
            placeholder="Heading 3"
            autoFocus={block.content === ''}
          />
        );

      case 'todo':
        return (
          <div className="flex items-start gap-2">
            <button
              onClick={handleCheckToggle}
              className="mt-1 flex-shrink-0"
            >
              <CheckSquare
                size={18}
                className={block.checked ? 'text-blue-500' : 'text-white/40'}
              />
            </button>
            <input
              id={`block-${block.id}`}
              type="text"
              value={block.content}
              onChange={handleChange}
              onKeyDown={(e) => handleKeyDown(e, block.id, index)}
              className={`${commonClasses} ${block.checked ? 'line-through text-white/50' : ''}`}
              placeholder="To-do"
              autoFocus={block.content === ''}
            />
          </div>
        );

      case 'bullet':
        return (
          <div className="flex items-start gap-2">
            <span className="text-white/60 mt-1">•</span>
            <input
              id={`block-${block.id}`}
              type="text"
              value={block.content}
              onChange={handleChange}
              onKeyDown={(e) => handleKeyDown(e, block.id, index)}
              className={commonClasses}
              placeholder="List item"
              autoFocus={block.content === ''}
            />
          </div>
        );

      case 'numbered':
        return (
          <div className="flex items-start gap-2">
            <span className="text-white/60 mt-1">{index + 1}.</span>
            <input
              id={`block-${block.id}`}
              type="text"
              value={block.content}
              onChange={handleChange}
              onKeyDown={(e) => handleKeyDown(e, block.id, index)}
              className={commonClasses}
              placeholder="List item"
              autoFocus={block.content === ''}
            />
          </div>
        );

      case 'quote':
        return (
          <div className="border-l-4 border-white/20 pl-4">
            <input
              id={`block-${block.id}`}
              type="text"
              value={block.content}
              onChange={handleChange}
              onKeyDown={(e) => handleKeyDown(e, block.id, index)}
              className={`${commonClasses} italic text-white/80`}
              placeholder="Quote"
              autoFocus={block.content === ''}
            />
          </div>
        );

      case 'code':
        return (
          <textarea
            id={`block-${block.id}`}
            value={block.content}
            onChange={handleChange}
            onKeyDown={(e) => handleKeyDown(e, block.id, index)}
            className={`${commonClasses} font-mono text-sm bg-white/5 rounded p-3`}
            placeholder="Code"
            rows={3}
            autoFocus={block.content === ''}
          />
        );

      case 'divider':
        return <hr className="border-white/10 my-4" />;

      default:
        return (
          <input
            id={`block-${block.id}`}
            type="text"
            value={block.content}
            onChange={handleChange}
            onKeyDown={(e) => handleKeyDown(e, block.id, index)}
            className={commonClasses}
            placeholder="Type '/' for commands"
            autoFocus={block.content === ''}
          />
        );
    }
  };

  return (
    <div className="w-full h-full flex flex-col relative">
      {/* Header */}
      <div className="w-full border-b border-white/10 bg-black/40 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <File className="text-white/60" size={20} />
            <input
              type="text"
              defaultValue="Untitled"
              className="bg-transparent text-white text-lg font-medium focus:outline-none border-b border-transparent hover:border-white/20 focus:border-white/40 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="Share">
              <Users size={18} />
            </button>
            <button className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="History">
              <Clock size={18} />
            </button>
            <button className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="Settings">
              <Settings size={18} />
            </button>
            <div className="w-px h-6 bg-white/10 mx-2"></div>
            <button className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-white text-sm transition-colors">
              <Download size={16} className="inline mr-1" />
              Export
            </button>
            <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm transition-colors">
              <Save size={16} className="inline mr-1" />
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Main Editor */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Blocks */}
          <div className="space-y-2">
            {blocks.map((block, index) => (
              <div
                key={block.id}
                className="group relative hover:bg-white/5 rounded p-2 -ml-2 transition-colors"
                onMouseEnter={() => setSelectedBlockId(block.id)}
                onMouseLeave={() => setSelectedBlockId(null)}
              >
                {/* Block Actions */}
                {selectedBlockId === block.id && (
                  <div className="absolute left-0 top-2 -ml-12 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white"
                      title="Drag"
                    >
                      <GripVertical size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setCurrentBlockId(block.id);
                        setShowBlockMenu(true);
                        const element = document.getElementById(`block-${block.id}`);
                        if (element) {
                          const rect = element.getBoundingClientRect();
                          setBlockMenuPosition({ x: rect.left, y: rect.bottom });
                        }
                      }}
                      className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white"
                      title="More options"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}

                {renderBlock(block, index)}
              </div>
            ))}
          </div>

          {/* Add Block Button */}
          <button
            onClick={() => addBlock('text')}
            className="mt-4 text-white/40 hover:text-white flex items-center gap-2 text-sm transition-colors"
          >
            <Plus size={16} />
            Add a block
          </button>
        </div>
      </div>

      {/* Block Type Menu */}
      {showBlockMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowBlockMenu(false)}
          />
          <div
            className="fixed z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden"
            style={{
              left: blockMenuPosition.x,
              top: blockMenuPosition.y + 8,
              width: '280px',
              maxHeight: '400px'
            }}
          >
            <div className="p-2">
              <input
                type="text"
                placeholder="Search blocks..."
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/20"
                autoFocus
              />
            </div>

            <div className="overflow-y-auto max-h-80">
              {blockTypes.map((blockType) => (
                <button
                  key={blockType.type}
                  onClick={() => {
                    if (currentBlockId) {
                      updateBlock(currentBlockId, { type: blockType.type as Block['type'], content: '' });
                      setShowBlockMenu(false);
                      setTimeout(() => {
                        const input = document.getElementById(`block-${currentBlockId}`);
                        if (input) input.focus();
                      }, 0);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 transition-colors text-left"
                >
                  <div className="text-white/60">{blockType.icon}</div>
                  <div className="flex-1">
                    <div className="text-white text-sm font-medium">{blockType.label}</div>
                    <div className="text-white/40 text-xs">{blockType.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CanvasPlanning;
