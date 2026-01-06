import React, { useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
export type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Extension } from '@tiptap/core';
import TurndownService from 'turndown';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Undo2, Redo2, ChevronDown, Type, Palette, Highlighter,
  Plus, Trash2, RowsIcon, ColumnsIcon
} from 'lucide-react';

// Custom FontSize extension
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return {
      types: ['textStyle'],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize?.replace(/['"]+/g, ''),
            renderHTML: attributes => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
      },
    };
  },
});

// Custom FontFamily extension
const FontFamily = Extension.create({
  name: 'fontFamily',
  addOptions() {
    return {
      types: ['textStyle'],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: element => element.style.fontFamily?.replace(/['"]+/g, ''),
            renderHTML: attributes => {
              if (!attributes.fontFamily) return {};
              return { style: `font-family: ${attributes.fontFamily}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontFamily: (fontFamily: string) => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontFamily }).run();
      },
      unsetFontFamily: () => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run();
      },
    };
  },
});

// Font options
const FONT_FAMILIES = [
  { name: 'Default', value: '' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Times New Roman', value: 'Times New Roman, serif' },
  { name: 'Courier New', value: 'Courier New, monospace' },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Trebuchet MS', value: 'Trebuchet MS, sans-serif' },
  { name: 'Palatino', value: 'Palatino Linotype, serif' },
  { name: 'Garamond', value: 'Garamond, serif' },
  { name: 'Comic Sans', value: 'Comic Sans MS, cursive' },
  { name: 'Impact', value: 'Impact, sans-serif' },
];

const FONT_SIZES = [
  { name: '10', value: '10px' },
  { name: '12', value: '12px' },
  { name: '14', value: '14px' },
  { name: '16', value: '16px' },
  { name: '18', value: '18px' },
  { name: '20', value: '20px' },
  { name: '24', value: '24px' },
  { name: '28', value: '28px' },
  { name: '32', value: '32px' },
  { name: '36', value: '36px' },
  { name: '48', value: '48px' },
  { name: '72', value: '72px' },
];

const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
];

const HIGHLIGHT_COLORS = [
  '#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ff0000', '#0000ff',
  '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#ead1dc',
];

interface TipTapEditorProps {
  content?: string;
  onChange?: (html: string, markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  hideToolbar?: boolean;
}

export interface TipTapEditorRef {
  getHTML: () => string;
  getMarkdown: () => string;
  setContent: (content: string) => void;
  getEditor: () => Editor | null;
  executeCommand: (command: any) => void;
}

// Toolbar button component
const ToolbarButton: React.FC<{
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, isActive, disabled, title, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded transition-colors ${
      isActive
        ? 'bg-blue-500/30 text-blue-400'
        : 'text-white/70 hover:bg-white/10 hover:text-white'
    } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
  >
    {children}
  </button>
);

// Dropdown component
const ToolbarDropdown: React.FC<{
  label: string;
  value: string;
  options: { name: string; value: string }[];
  onChange: (value: string) => void;
  width?: string;
}> = ({ label, value, options, onChange, width = 'w-24' }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 px-2 py-1 rounded text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors ${width}`}
      >
        <span className="truncate">{selectedOption?.name || label}</span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto min-w-full">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors ${
                value === option.value ? 'text-blue-400' : 'text-white/70'
              }`}
              style={option.value ? { fontFamily: option.value } : undefined}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Color picker component
const ColorPicker: React.FC<{
  colors: string[];
  selectedColor: string;
  onChange: (color: string) => void;
  icon: React.ReactNode;
  title: string;
}> = ({ colors, selectedColor, onChange, icon, title }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const pickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={title}
        className="p-1.5 rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-0.5"
      >
        {icon}
        <div
          className="w-3 h-1 rounded-sm"
          style={{ backgroundColor: selectedColor || '#ffffff' }}
        />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-2 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl z-50">
          <div className="grid grid-cols-10 gap-1" style={{ width: '200px' }}>
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onChange(color);
                  setIsOpen(false);
                }}
                className={`w-4 h-4 rounded-sm border ${
                  selectedColor === color ? 'border-blue-400 ring-1 ring-blue-400' : 'border-white/20'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-[#3a3a3d]">
            <button
              onClick={() => {
                onChange('');
                setIsOpen(false);
              }}
              className="text-xs text-white/50 hover:text-white/80"
            >
              Remove color
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Create turndown service instance for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Add custom rules for better markdown output
turndownService.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: function (content: string) {
    return '~~' + content + '~~';
  }
});

// Convert HTML to Markdown
const htmlToMarkdown = (html: string): string => {
  if (!html || html.trim() === '' || html === '<p></p>') {
    return '';
  }
  try {
    return turndownService.turndown(html);
  } catch (e) {
    console.error('Error converting HTML to Markdown:', e);
    // Fallback: simple regex-based conversion
    let md = html;
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
    md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<[^>]+>/g, '');
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    return md.trim();
  }
};

const TipTapEditor = forwardRef<TipTapEditorRef, TipTapEditorProps>(
  ({ content = '', onChange, placeholder = 'Start writing...', editable = true, hideToolbar = false }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3, 4, 5, 6],
          },
        }),
        Underline,
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
        TextStyle,
        Color,
        FontSize,
        FontFamily,
        Highlight.configure({
          multicolor: true,
        }),
        Link.configure({
          openOnClick: false,
        }),
        Image,
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        Placeholder.configure({
          placeholder,
        }),
        Typography,
      ],
      content,
      editable,
      onUpdate: ({ editor }) => {
        const html = editor.getHTML();
        const markdown = htmlToMarkdown(html);
        onChange?.(html, markdown);
      },
    });

    useImperativeHandle(ref, () => ({
      getHTML: () => editor?.getHTML() || '',
      getMarkdown: () => htmlToMarkdown(editor?.getHTML() || ''),
      setContent: (newContent: string) => {
        editor?.commands.setContent(newContent);
      },
      getEditor: () => editor,
      executeCommand: (command: any) => {
        if (!editor) return;
        // Execute AI commands
        if (command.action === 'setFontFamily') {
          editor.chain().focus().setMark('textStyle', { fontFamily: command.value }).run();
        } else if (command.action === 'setColor') {
          editor.chain().focus().setColor(command.value).run();
        } else if (command.action === 'setFontSize') {
          editor.chain().focus().setMark('textStyle', { fontSize: command.value }).run();
        } else if (command.action === 'toggleBold') {
          editor.chain().focus().toggleBold().run();
        } else if (command.action === 'toggleItalic') {
          editor.chain().focus().toggleItalic().run();
        } else if (command.action === 'setContent') {
          editor.commands.setContent(command.value);
        }
      },
    }));

    const setLink = useCallback(() => {
      if (!editor) return;
      const previousUrl = editor.getAttributes('link').href;
      const url = window.prompt('URL', previousUrl);
      if (url === null) return;
      if (url === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }, [editor]);

    const addImage = useCallback(() => {
      if (!editor) return;
      const url = window.prompt('Image URL');
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    }, [editor]);

    const insertTable = useCallback(() => {
      if (!editor) return;
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }, [editor]);

    if (!editor) return null;

    const currentFontFamily = editor.getAttributes('textStyle').fontFamily || '';
    const currentFontSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentColor = editor.getAttributes('textStyle').color || '#000000';
    const currentHighlight = editor.getAttributes('highlight').color || '';

    return (
      <div className="flex flex-col h-full bg-white rounded-lg overflow-hidden">
        {/* Toolbar - can be hidden when using external toolbar */}
        {!hideToolbar && (
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-[#19191a] border-b border-[#3a3a3d]">
          {/* Undo/Redo */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
            <ToolbarButton
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              title="Undo"
            >
              <Undo2 size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              title="Redo"
            >
              <Redo2 size={16} />
            </ToolbarButton>
          </div>

          {/* Font Family */}
          <div className="pr-2 border-r border-[#3a3a3d]">
            <ToolbarDropdown
              label="Font"
              value={currentFontFamily}
              options={FONT_FAMILIES}
              onChange={(value) => {
                if (value) {
                  editor.chain().focus().setMark('textStyle', { fontFamily: value }).run();
                } else {
                  editor.chain().focus().unsetMark('textStyle').run();
                }
              }}
              width="w-32"
            />
          </div>

          {/* Font Size */}
          <div className="pr-2 border-r border-[#3a3a3d]">
            <ToolbarDropdown
              label="Size"
              value={currentFontSize}
              options={FONT_SIZES}
              onChange={(value) => {
                editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
              }}
              width="w-16"
            />
          </div>

          {/* Text Formatting */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              title="Bold (Ctrl+B)"
            >
              <Bold size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              title="Italic (Ctrl+I)"
            >
              <Italic size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
              title="Underline (Ctrl+U)"
            >
              <UnderlineIcon size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive('strike')}
              title="Strikethrough"
            >
              <Strikethrough size={16} />
            </ToolbarButton>
          </div>

          {/* Colors */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
            <ColorPicker
              colors={TEXT_COLORS}
              selectedColor={currentColor}
              onChange={(color) => {
                if (color) {
                  editor.chain().focus().setColor(color).run();
                } else {
                  editor.chain().focus().unsetColor().run();
                }
              }}
              icon={<Palette size={16} />}
              title="Text Color"
            />
            <ColorPicker
              colors={HIGHLIGHT_COLORS}
              selectedColor={currentHighlight}
              onChange={(color) => {
                if (color) {
                  editor.chain().focus().toggleHighlight({ color }).run();
                } else {
                  editor.chain().focus().unsetHighlight().run();
                }
              }}
              icon={<Highlighter size={16} />}
              title="Highlight Color"
            />
          </div>

          {/* Alignment */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
            <ToolbarButton
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
              isActive={editor.isActive({ textAlign: 'left' })}
              title="Align Left"
            >
              <AlignLeft size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
              isActive={editor.isActive({ textAlign: 'center' })}
              title="Align Center"
            >
              <AlignCenter size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
              isActive={editor.isActive({ textAlign: 'right' })}
              title="Align Right"
            >
              <AlignRight size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().setTextAlign('justify').run()}
              isActive={editor.isActive({ textAlign: 'justify' })}
              title="Justify"
            >
              <AlignJustify size={16} />
            </ToolbarButton>
          </div>

          {/* Lists */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              isActive={editor.isActive('bulletList')}
              title="Bullet List"
            >
              <List size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              isActive={editor.isActive('orderedList')}
              title="Numbered List"
            >
              <ListOrdered size={16} />
            </ToolbarButton>
          </div>

          {/* Block Elements */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              isActive={editor.isActive('blockquote')}
              title="Quote"
            >
              <Quote size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              isActive={editor.isActive('codeBlock')}
              title="Code Block"
            >
              <Code size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              title="Horizontal Rule"
            >
              <Minus size={16} />
            </ToolbarButton>
          </div>

          {/* Insert */}
          <div className="flex items-center gap-0.5">
            <ToolbarButton onClick={setLink} isActive={editor.isActive('link')} title="Insert Link">
              <LinkIcon size={16} />
            </ToolbarButton>
            <ToolbarButton onClick={addImage} title="Insert Image">
              <ImageIcon size={16} />
            </ToolbarButton>
            <ToolbarButton onClick={insertTable} title="Insert Table">
              <TableIcon size={16} />
            </ToolbarButton>
          </div>

          {/* Table controls (only show when in table) */}
          {editor.isActive('table') && (
            <div className="flex items-center gap-0.5 pl-2 border-l border-[#3a3a3d]">
              <ToolbarButton
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                title="Add Column"
              >
                <Plus size={14} />
                <ColumnsIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().addRowAfter().run()}
                title="Add Row"
              >
                <Plus size={14} />
                <RowsIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().deleteTable().run()}
                title="Delete Table"
              >
                <Trash2 size={16} />
              </ToolbarButton>
            </div>
          )}
        </div>
        )}

        {/* Editor Content */}
        <div className="flex-1 overflow-auto" style={{ cursor: 'text' }}>
          <EditorContent
            editor={editor}
            className="prose prose-sm max-w-none h-full focus:outline-none"
          />
        </div>

        {/* Editor Styles */}
        <style>{`
          .ProseMirror {
            min-height: 100%;
            padding: 2rem;
            outline: none;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: #1f2937;
            cursor: text;
          }
          .ProseMirror[contenteditable="true"] {
            cursor: text;
          }
          .ProseMirror:focus {
            outline: none;
          }
          .ProseMirror p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: #9ca3af;
            pointer-events: none;
            height: 0;
          }
          .ProseMirror h1 { font-size: 2em; font-weight: bold; margin-bottom: 0.5em; }
          .ProseMirror h2 { font-size: 1.5em; font-weight: bold; margin-bottom: 0.5em; }
          .ProseMirror h3 { font-size: 1.25em; font-weight: bold; margin-bottom: 0.5em; }
          .ProseMirror p { margin-bottom: 1em; }
          .ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; margin-bottom: 1em; }
          .ProseMirror li { margin-bottom: 0.25em; }
          .ProseMirror blockquote {
            border-left: 4px solid #3b82f6;
            padding-left: 1em;
            margin: 1em 0;
            color: #4b5563;
          }
          .ProseMirror code {
            background: #f3f4f6;
            padding: 0.2em 0.4em;
            border-radius: 4px;
            font-family: monospace;
          }
          .ProseMirror pre {
            background: #1f2937;
            color: #e5e7eb;
            padding: 1em;
            border-radius: 8px;
            overflow-x: auto;
          }
          .ProseMirror pre code {
            background: none;
            padding: 0;
            color: inherit;
          }
          .ProseMirror hr {
            border: none;
            border-top: 1px solid #e5e7eb;
            margin: 2em 0;
          }
          .ProseMirror a {
            color: #3b82f6;
            text-decoration: underline;
          }
          .ProseMirror img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
          }
          .ProseMirror table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
          }
          .ProseMirror th, .ProseMirror td {
            border: 1px solid #d1d5db;
            padding: 0.5em 1em;
            text-align: left;
          }
          .ProseMirror th {
            background: #f3f4f6;
            font-weight: 600;
          }
          .ProseMirror .tableWrapper {
            overflow-x: auto;
          }
          .ProseMirror .selectedCell {
            background: #dbeafe;
          }
        `}</style>
      </div>
    );
  }
);

TipTapEditor.displayName = 'TipTapEditor';

// Exported EditorToolbar component for external use
export const EditorToolbar: React.FC<{ editor: Editor | null }> = ({ editor }) => {
  const [linkUrl, setLinkUrl] = React.useState('');

  const setLink = React.useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const addImage = React.useCallback(() => {
    if (!editor) return;
    const url = window.prompt('Image URL');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  const insertTable = React.useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) return null;

  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || '';
  const currentFontSize = editor.getAttributes('textStyle').fontSize || '16px';
  const currentColor = editor.getAttributes('textStyle').color || '#000000';
  const currentHighlight = editor.getAttributes('highlight').color || '';

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-[#19191a] border-b border-[#2a2a2d]">
      {/* Font Family */}
      <div className="pr-2 border-r border-[#3a3a3d]">
        <ToolbarDropdown
          label="Font"
          value={currentFontFamily}
          options={FONT_FAMILIES}
          onChange={(value) => {
            if (value) {
              editor.chain().focus().setMark('textStyle', { fontFamily: value }).run();
            } else {
              editor.chain().focus().unsetMark('textStyle').run();
            }
          }}
          width="w-32"
        />
      </div>

      {/* Font Size */}
      <div className="pr-2 border-r border-[#3a3a3d]">
        <ToolbarDropdown
          label="Size"
          value={currentFontSize}
          options={FONT_SIZES}
          onChange={(value) => {
            editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
          }}
          width="w-16"
        />
      </div>

      {/* Text Formatting */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough size={16} />
        </ToolbarButton>
      </div>

      {/* Colors */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
        <ColorPicker
          colors={TEXT_COLORS}
          selectedColor={currentColor}
          onChange={(color) => {
            if (color) {
              editor.chain().focus().setColor(color).run();
            } else {
              editor.chain().focus().unsetColor().run();
            }
          }}
          icon={<Palette size={16} />}
          title="Text Color"
        />
        <ColorPicker
          colors={HIGHLIGHT_COLORS}
          selectedColor={currentHighlight}
          onChange={(color) => {
            if (color) {
              editor.chain().focus().toggleHighlight({ color }).run();
            } else {
              editor.chain().focus().unsetHighlight().run();
            }
          }}
          icon={<Highlighter size={16} />}
          title="Highlight Color"
        />
      </div>

      {/* Alignment */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          title="Align Left"
        >
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          title="Align Center"
        >
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          title="Align Right"
        >
          <AlignRight size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          isActive={editor.isActive({ textAlign: 'justify' })}
          title="Justify"
        >
          <AlignJustify size={16} />
        </ToolbarButton>
      </div>

      {/* Lists */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered List"
        >
          <ListOrdered size={16} />
        </ToolbarButton>
      </div>

      {/* Block Elements */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[#3a3a3d]">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Quote"
        >
          <Quote size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive('codeBlock')}
          title="Code Block"
        >
          <Code size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus size={16} />
        </ToolbarButton>
      </div>

      {/* Insert */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton onClick={setLink} isActive={editor.isActive('link')} title="Insert Link">
          <LinkIcon size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={addImage} title="Insert Image">
          <ImageIcon size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={insertTable} title="Insert Table">
          <TableIcon size={16} />
        </ToolbarButton>
      </div>

      {/* Table controls (only show when in table) */}
      {editor.isActive('table') && (
        <div className="flex items-center gap-0.5 pl-2 border-l border-[#3a3a3d]">
          <ToolbarButton
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            title="Add Column"
          >
            <Plus size={14} />
            <ColumnsIcon size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().addRowAfter().run()}
            title="Add Row"
          >
            <Plus size={14} />
            <RowsIcon size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().deleteTable().run()}
            title="Delete Table"
          >
            <Trash2 size={16} />
          </ToolbarButton>
        </div>
      )}
    </div>
  );
};

export default TipTapEditor;
