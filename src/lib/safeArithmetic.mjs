/**
 * Evaluate a small, arithmetic-only expression without executing JavaScript.
 * Supported grammar: decimal numbers, parentheses, +, -, *, and /.
 * Returns null for incomplete, invalid, non-finite, or excessively long input.
 *
 * @param {string} source
 * @returns {number | null}
 */
export function evaluateArithmeticExpression(source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 128) return null;
  if (!/^[\d\s+\-*/().]+$/.test(source)) return null;

  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(source[index] ?? '')) index += 1;
  };

  let parseExpression;

  const parsePrimary = () => {
    skipWhitespace();
    if (source[index] === '(') {
      index += 1;
      const value = parseExpression();
      skipWhitespace();
      if (source[index] !== ')') throw new Error('Missing closing parenthesis');
      index += 1;
      return value;
    }

    const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error('Expected number');
    index += match[0].length;
    return Number(match[0]);
  };

  const parseUnary = () => {
    skipWhitespace();
    if (source[index] === '+') {
      index += 1;
      return parseUnary();
    }
    if (source[index] === '-') {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parseTerm = () => {
    let value = parseUnary();
    while (true) {
      skipWhitespace();
      const operator = source[index];
      if (operator !== '*' && operator !== '/') return value;
      index += 1;
      const right = parseUnary();
      value = operator === '*' ? value * right : value / right;
    }
  };

  parseExpression = () => {
    let value = parseTerm();
    while (true) {
      skipWhitespace();
      const operator = source[index];
      if (operator !== '+' && operator !== '-') return value;
      index += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
  };

  try {
    const value = parseExpression();
    skipWhitespace();
    return index === source.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
