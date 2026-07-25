import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sourcePath = path.resolve(
  process.cwd(),
  'src/components/playground/Chat/ChatWithLLM.tsx',
);
const source = fs.readFileSync(sourcePath, 'utf8');
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
