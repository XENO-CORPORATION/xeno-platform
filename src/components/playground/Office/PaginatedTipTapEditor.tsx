import React, { forwardRef, useImperativeHandle, useCallback } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
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

// Import pagination extension
// Note: The package may have different exports depending on version
// We'll import what's available and configure accordingly
import PaginationExtension from 'tiptap-extension-pagination';

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
    return '';
  }
};

interface PaginatedTipTapEditorProps {
  content?: string;
  onChange?: (html: string, markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  pageFormat?: 'A4' | 'A3' | 'Letter' | 'Legal';
}

export interface PaginatedTipTapEditorRef {
  getHTML: () => string;
  getMarkdown: () => string;
  setContent: (content: string) => void;
  getEditor: () => Editor | null;
  executeCommand: (command: any) => void;
}

const PaginatedTipTapEditor = forwardRef<PaginatedTipTapEditorRef, PaginatedTipTapEditorProps>(
  ({ content = '', onChange, placeholder = 'Start writing...', editable = true, pageFormat = 'A4' }, ref) => {
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
        // Add pagination extension with A4 configuration
        PaginationExtension.configure({
          defaultPaperSize: pageFormat,
          defaultPaperOrientation: 'portrait',
          defaultPaperColour: '#ffffff',
          defaultMarginConfig: {
            top: 25.4,    // 1 inch in mm
            bottom: 25.4,
            left: 25.4,
            right: 25.4,
          },
          pageAmendmentOptions: {
            enableHeader: false,
            enableFooter: true,
          },
        }),
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

    if (!editor) return null;

    return (
      <div className="paginated-editor-container">
        <style>{`
          .paginated-editor-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            background: #3a3a3d;
            padding: 24px;
            min-height: 100%;
          }

          .paginated-editor-container .ProseMirror {
            outline: none;
            font-family: 'Segoe UI', Arial, sans-serif;
            color: #1f2937;
            line-height: 1.6;
          }

          .paginated-editor-container .ProseMirror h1 {
            font-size: 2em;
            text-align: center;
            margin-top: 0;
          }
          .paginated-editor-container .ProseMirror h2 {
            font-size: 1.5em;
            border-bottom: 2px solid #333;
            padding-bottom: 0.3em;
          }
          .paginated-editor-container .ProseMirror h3 {
            font-size: 1.25em;
          }
          .paginated-editor-container .ProseMirror p {
            margin-bottom: 0.75em;
          }

          /* Page styling from pagination extension */
          .paginated-editor-container .tiptap-page {
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            margin-bottom: 32px;
          }

          .paginated-editor-container .tiptap-page-body {
            min-height: 100%;
          }

          .paginated-editor-container .tiptap-page-footer {
            text-align: center;
            font-size: 11px;
            color: #666;
          }
        `}</style>

        <EditorContent
          editor={editor}
          className="paginated-editor-content"
        />
      </div>
    );
  }
);

PaginatedTipTapEditor.displayName = 'PaginatedTipTapEditor';

export default PaginatedTipTapEditor;
