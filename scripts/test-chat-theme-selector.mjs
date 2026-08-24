import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/*
 * Two files, because the subject moved and the assertions did not.
 *
 * The twenty-one palettes and the brightness maths used to live inside ChatWithLLM's JSX. They are
 * in `chatTheme.ts` now, and that was the point of moving them: every chat surface is its own route,
 * so while the palettes existed only while THAT component was mounted, the sibling routes — Voice,
 * Search — had no tokens to use. Nothing about what these checks assert changed; only where the
 * answer is written. Reading both keeps every one of them meaningful.
 */
const sources = [
  'src/components/playground/Chat/ChatWithLLM.tsx',
  'src/components/playground/Chat/chatTheme.ts',
].map((p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8'));
const source = sources.join('\n');
const sharedComposerActionSizeReferences = source.match(/composerActionButtonSizeClass/g) ?? [];

const assertions = [
  {
    description: 'Dark uses the ElevenLabs neutral surface hierarchy',
    passes:
      source.includes("createChatThemePalette('#0a0a0a', '#171717', '#262626', '#262626', '#404040'"),
  },
  {
    description: 'Light uses the ElevenLabs neutral surface hierarchy',
    passes:
      source.includes("createChatThemePalette('#ffffff', '#fafafa', '#ffffff', '#f5f5f5', '#e5e5e5'"),
  },
  {
    description: 'Every selector bar receives the real color of its theme position',
    passes: source.includes('backgroundColor: getThemePreviewTokens(position).canvas'),
  },
  {
    description: 'Only the selected bar is marked as selected',
    passes:
      source.includes('const isSelected = position === displayedThemeSliderPosition;') &&
      source.includes('data-selected={isSelected}'),
  },
  {
    description: 'Selection no longer replaces bar colors through an active brightness state',
    passes:
      !source.includes('data-active={isActive}') &&
      !source.includes('.chat-theme-waveform-bar[data-active="true"]'),
  },
  {
    description: 'Intermediate themes use explicit semantic palettes instead of one brightness interpolation',
    passes:
      source.includes('const CHAT_THEME_SURFACE_PALETTES: readonly ChatThemePreviewTokens[] = [') &&
      source.includes("createChatThemePalette('#282b31', '#383c44', '#464b55'") &&
      !source.includes('CHAT_THEME_LIGHT_PROGRESS_EXPONENTS'),
  },
  {
    description: 'Microphone and Send share exactly the same composer action size',
    passes:
      source.includes('const composerActionButtonSizeClass =') &&
      sharedComposerActionSizeReferences.length >= 3,
  },
];

const failures = assertions.filter(({ passes }) => !passes);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.description}`);
  }
  process.exit(1);
}

console.log('Chat theme selector behavior: PASS');
