import type { ChatUpdate } from './ChatUpdateCarousel';

// TEMPORARY: Visual review data only. Remove before the final PR.
// Keep every description at or under MAX_UPDATE_DESCRIPTION_CHARS (82).
// Same showcase shell; each body kind must read as a different feature.
export const MOCK_CHAT_UPDATES: ChatUpdate[] = [
  {
    id: 'mock-composer-controls',
    label: 'Preview',
    title: 'Chat controls, together',
    description: 'Choose a model and manage message controls from the composer, in one place.',
    demo: {
      header: 'Composer',
      headerMeta: 'Live preview',
      body: {
        kind: 'composer-controls',
        modes: ['Chat', 'Research', 'Code'],
        activeMode: 'Chat',
        modelLabel: 'GPT-5.6 Terra',
      },
    },
  },
  {
    id: 'mock-document-analysis',
    label: 'New',
    title: 'Start with a document',
    description: 'Attach a document, then give XENO a precise instruction for the analysis you need.',
    demo: {
      header: 'Example prompt',
      copyValue: 'Summarize this document and list the key decisions, risks, and open questions.',
      body: {
        kind: 'document-prompt',
        fileName: 'research-notes.pdf',
        text: 'Summarize this document and list the key decisions, risks, and open questions.',
      },
    },
  },
  {
    id: 'mock-xeno-workspace',
    label: 'Explore',
    title: 'Continue across XENO',
    description: 'Move from chat into the wider XENO workspace when your task needs another tool.',
    demo: {
      header: 'Across XENO',
      body: {
        kind: 'flow-link',
        from: 'Chat',
        to: 'Hub',
        steps: ['Chat', 'Hub'],
        href: 'https://xenostudio.ai',
        linkLabel: 'Explore XENO',
      },
    },
  },
];
