import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync('src/components/onboarding/useRovingGrid.ts', 'utf8');
const page = readFileSync('src/pages/Onboarding.tsx', 'utf8');

test('onboarding text input owns Space and Enter instead of the step navigator', () => {
  // The handler is mounted on the step wrapper, so keyboard events from the
  // "How did you hear about XENO?" input bubble into it. The guard must happen
  // before the roving item lookup and before either key can activate navigation.
  const start = hook.indexOf('const onKeyDown = useCallback');
  const switchCase = hook.indexOf("case ' ':", start);
  assert.ok(start >= 0 && switchCase > start, 'onboarding key handler changed shape');
  const guard = hook.slice(start, switchCase);
  assert.match(guard, /tag === 'INPUT'/, 'text inputs are not excluded from the step handler');
  assert.match(guard, /tag === 'TEXTAREA'/, 'textareas are not excluded from the step handler');
  assert.match(guard, /target\?\.isContentEditable/, 'contenteditable input is not excluded');
  assert.ok(guard.indexOf("tag === 'INPUT'") < guard.indexOf('const els = items()'),
    'the editable guard must run before navigation item discovery');
  assert.match(page, /label="How did you hear about XENO\?"[\s\S]*?value=\{answers\.heardFrom\}/,
    'the referral field is no longer the controlled text input this guard protects');
});

test('Space still activates onboarding choices outside editable fields', () => {
  const start = hook.indexOf("case ' ':");
  const end = hook.indexOf("case 'Enter':", start);
  const space = hook.slice(start, end);
  assert.match(space, /e\.preventDefault\(\)/);
  assert.match(space, /els\[i\]\?\.click\(\)/);
});
