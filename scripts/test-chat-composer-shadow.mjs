import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const chatSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/playground/Chat/ChatWithLLM.tsx'),
  'utf8',
);
const emptyStateSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/playground/Chat/ChatEmptyState.tsx'),
  'utf8',
);
const indexCss = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

const assertions = [
  {
    description: 'Light theme keeps a visible outer composer drop shadow',
    passes:
      chatSource.includes('0 10px 24px -8px rgba(0, 0, 0, 0.12)') &&
      chatSource.includes('--chat-composer-shadow'),
  },
  {
    description: 'Shell inner composer keeps border/radius and drops only shadow in markup',
    passes:
      chatSource.includes('data-empty-composer-input="true"') &&
      chatSource.includes('rounded-2xl border border-white/[0.10] bg-transparent shadow-none') &&
      chatSource.includes("messages.length === 0 ? 'p-3' : 'p-2'") &&
      !chatSource.includes("'border-0 bg-transparent p-3 shadow-none rounded-none'"),
  },
  {
    description: 'Nested empty-state input CSS clears shadow only, not border',
    passes:
      chatSource.includes('--tw-shadow: 0 0 #0000 !important;') &&
      chatSource.includes('box-shadow: none !important;') &&
      chatSource.includes('Empty nested input: keep its border/radius; drop only the inner shadow.') &&
      !chatSource.includes('border: 0 !important;\n            border-width: 0 !important;'),
  },
  {
    description: 'Each theme defines a distinct readable tool-rail stroke',
    passes:
      chatSource.includes('--chat-tool-rail-stroke: rgba(24, 24, 27, 0.72)') &&
      chatSource.includes('--chat-tool-rail-stroke: rgba(232, 232, 226, 0.72)') &&
      chatSource.includes('--chat-tool-rail-stroke: rgba(245, 245, 245, 0.78)') &&
      indexCss.includes('opacity: 0.88') &&
      !emptyStateSource.includes('bg-white/50'),
  },
  {
    description: 'Conversation composer reuses the shell with mode tabs and the hover tool rail',
    passes:
      emptyStateSource.includes("data-composer-context={isActive ? 'empty' : 'conversation'}") &&
      emptyStateSource.includes('const showToolRail = !isCompact;') &&
      emptyStateSource.includes('data-conversation-composer-frame') &&
      emptyStateSource.includes('self-end ${outerWidthClass}') &&
      !emptyStateSource.includes('if (!isActive) {\n    return <>{children}</>;'),
  },
  {
    description: 'Conversation column matches composer width and stays centered',
    passes:
      chatSource.includes("isWideChatEnabled ? 'max-w-[72rem]' : 'max-w-[52rem]'") &&
      chatSource.includes('Chat Messages Area — same max width + centering as the conversation composer.') &&
      chatSource.includes('[data-composer-context="conversation"]') &&
      chatSource.includes('min-h-[3rem] max-h-[7.5rem]'),
  },
];

const failures = assertions.filter(({ passes }) => !passes);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.description}`);
  }
  process.exit(1);
}

console.log('Chat composer shadow behavior: PASS');
