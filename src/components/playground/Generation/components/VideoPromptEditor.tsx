import React, { forwardRef, useImperativeHandle, useEffect } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { X } from 'lucide-react';

/**
 * VideoPromptEditor
 *
 * A TipTap-based prompt field for the video generation composer. It mirrors the
 * Dreamina "rich prompt" interaction: free text that can hold inline image
 * "reference chips" (atomic nodes) alongside the words.
 *
 * Design intent:
 *  - The authoritative list of references lives in the parent (uploadedImages).
 *  - Chips here are a visual affordance — inserting one drops a small thumbnail
 *    token at the caret. Chips render as empty text in getText() so the prompt
 *    string sent to the model stays clean; references are passed separately as
 *    image URLs by the parent.
 *
 * The editor is intentionally minimal (no headings/lists/marks toolbar) so it
 * reads as a prompt box, not a document editor.
 */

export interface PromptReference {
  id: string;
  url: string;
  /** 1-based label shown inside the chip, e.g. "Image 2". */
  index: number;
}

export interface VideoPromptEditorHandle {
  /** Insert a reference chip at the current caret position. */
  insertReference: (ref: PromptReference) => void;
  /** Clear all content. */
  clear: () => void;
  /** Focus the editor. */
  focus: () => void;
}

interface VideoPromptEditorProps {
  /** Plain-text value (controlled-ish: only pushed in when it diverges). */
  value: string;
  onChange: (text: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// ── Inline reference chip node ──────────────────────────────────────────────
const ReferenceChipView: React.FC<any> = ({ node, deleteNode }) => {
  const { url, index } = node.attrs as { url: string; index: number };
  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex items-center align-middle gap-1 mx-0.5 pl-0.5 pr-1.5 py-0.5 rounded-md bg-white/10 border border-white/20 text-white/85 text-xs select-none"
      contentEditable={false}
      data-reference-chip=""
    >
      {url ? (
        <img src={url} alt="" className="w-4 h-4 rounded-sm object-cover" draggable={false} />
      ) : null}
      <span className="leading-none">Image {index}</span>
      <button
        type="button"
        onClick={() => deleteNode()}
        className="ml-0.5 text-white/60 hover:text-white transition-colors"
        title="Remove reference"
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </NodeViewWrapper>
  );
};

const ReferenceChip = Node.create({
  name: 'referenceChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      refId: { default: null },
      index: { default: 0 },
      url: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-reference-chip]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-reference-chip': '' })];
  },

  // Keep the serialized prompt text clean — references travel separately.
  renderText() {
    return '';
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferenceChipView);
  },
});

const VideoPromptEditor = forwardRef<VideoPromptEditorHandle, VideoPromptEditorProps>(
  ({ value, onChange, onSubmit, placeholder, disabled, className }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Strip document-editor affordances — this is a prompt box.
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
        }),
        Placeholder.configure({ placeholder: placeholder || 'Describe the video you want to generate…' }),
        ReferenceChip,
      ],
      editable: !disabled,
      content: value || '',
      editorProps: {
        attributes: {
          class:
            'tiptap-prompt outline-none min-h-[72px] max-h-[160px] overflow-y-auto text-sm leading-relaxed text-[#E0E0E0] px-1 py-0.5',
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit?.();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        onChange(editor.getText());
      },
    });

    // Keep editable state in sync with the disabled prop.
    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [disabled, editor]);

    // Push external value changes (e.g. image analysis, reuse-prompt) into the
    // editor without clobbering the caret while the user types.
    useEffect(() => {
      if (!editor) return;
      if (value !== editor.getText()) {
        editor.commands.setContent(value || '', false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, editor]);

    useImperativeHandle(ref, () => ({
      insertReference: (refItem: PromptReference) => {
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'referenceChip',
            attrs: { refId: refItem.id, index: refItem.index, url: refItem.url },
          })
          .run();
      },
      clear: () => editor?.commands.clearContent(true),
      focus: () => editor?.commands.focus(),
    }), [editor]);

    return (
      <>
        <style>{`
          .tiptap-prompt { caret-color: #ffffff; }
          .tiptap-prompt:focus { outline: none; }
          .tiptap-prompt p { margin: 0; }
          .tiptap-prompt p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: #4b5563;
            pointer-events: none;
            height: 0;
          }
          .tiptap-prompt::-webkit-scrollbar { width: 6px; }
          .tiptap-prompt::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
          .tiptap-prompt::-webkit-scrollbar-track { background: transparent; }
        `}</style>
        <EditorContent editor={editor} className={className} />
      </>
    );
  }
);

VideoPromptEditor.displayName = 'VideoPromptEditor';

export default VideoPromptEditor;
