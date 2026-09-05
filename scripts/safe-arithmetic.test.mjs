import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { evaluateArithmeticExpression } from '../src/lib/safeArithmetic.mjs';

test('calculator evaluates arithmetic with precedence and parentheses', () => {
  assert.equal(evaluateArithmeticExpression('2 + 3 * 4'), 14);
  assert.equal(evaluateArithmeticExpression('(2 + 3) * 4'), 20);
  assert.equal(evaluateArithmeticExpression('-3.5 + .5'), -3);
});

test('calculator refuses JavaScript and malformed expressions', () => {
  assert.equal(evaluateArithmeticExpression('globalThis.alert(1)'), null);
  assert.equal(evaluateArithmeticExpression('2 +'), null);
  assert.equal(evaluateArithmeticExpression('1 / 0'), null);
  assert.equal(evaluateArithmeticExpression('1 2'), null);
  assert.equal(evaluateArithmeticExpression('('.repeat(129)), null);
});

test('planning calculator does not execute typed input', async () => {
  const source = await readFile(new URL('../src/components/office/CanvasPlanningVisual.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.match(source, /evaluateArithmeticExpression/);
});
