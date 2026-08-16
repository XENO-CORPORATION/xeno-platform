import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/*
 * `chat-theme.css` joins the chat source here for the same reason it exists at all: the three
 * palettes and the tokens under them used to be a <style> block inside ChatWithLLM's JSX, so they
 * were only mounted while that one component was, and the sibling chat routes had no tokens. Moving
 * them out did not change a single value these checks assert — `--chat-composer-shadow: none` is
 * still declared three times, once per named theme — only which file says so.
 */
const chatSource = [
  'src/components/playground/Chat/ChatWithLLM.tsx',
  'src/components/playground/Chat/chat-theme.css',
]
  .map((p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8'))
  .join('\n');
const emptyStateSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/playground/Chat/ChatEmptyState.tsx'),
  'utf8',
);
const indexCss = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

const assertions = [
  {
    // The gooey reveal grows a liquid neck out of the box; a drop shadow would paint a
    // hard edge straight across it, so every theme now declares `none`.
    description: 'No theme paints a drop shadow on the composer',
    passes:
      chatSource.includes('--chat-composer-shadow') &&
      !/--chat-composer-shadow'?:?\s*'?0 /.test(chatSource) &&
      (chatSource.match(/--chat-composer-shadow: none;/g) ?? []).length >= 3,
  },
  {
    // One stroke: the shell IS the box the skin is moulded onto. A second border inside
    // it reads as two stacked cards and cuts the neck in half.
    description: 'Inner composer field draws no second border',
    passes:
      chatSource.includes('data-empty-composer-input="true"') &&
      chatSource.includes('rounded-2xl border border-transparent bg-transparent shadow-none') &&
      chatSource.includes("messages.length === 0 ? 'p-3' : 'p-2'") &&
      !chatSource.includes('rounded-2xl border border-white/[0.10] bg-transparent shadow-none'),
  },
  {
    description: 'Nested input CSS clears both the shadow and the border',
    passes:
      chatSource.includes('--tw-shadow: 0 0 #0000 !important;') &&
      chatSource.includes('box-shadow: none !important;') &&
      chatSource.includes('gooey skin is moulded onto') &&
      chatSource.includes('border-color: transparent !important;'),
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
    // Same composer in both surfaces — a new chat and an existing one get the same
    // gooey reveal, the same floating mode row and the same single-stroke box.
    description: 'Conversation composer reuses the shell with the gooey reveal',
    passes:
      emptyStateSource.includes("data-composer-context={isActive ? 'empty' : 'conversation'}") &&
      emptyStateSource.includes('data-conversation-composer-frame') &&
      emptyStateSource.includes('data-composer-reveal') &&
      emptyStateSource.includes('chat-gooey-skin') &&
      indexCss.includes('.chat-gooey-body') &&
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
