const DEFAULT_MAX_CHARS = 3_200;
const DEFAULT_OVERLAP_CHARS = 320;

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

export function chunkExtractedText(text, {
  maxChars = DEFAULT_MAX_CHARS,
  overlapChars = DEFAULT_OVERLAP_CHARS,
  locator = {},
} = {}) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf('\n', end);
      if (boundary > start + Math.floor(maxChars * 0.5)) end = boundary;
    }
    const content = normalized.slice(start, end).trim();
    if (content) {
      const before = normalized.slice(0, start);
      const through = normalized.slice(0, end);
      chunks.push({
        ordinal: chunks.length,
        content,
        tokenCount: estimateTokens(content),
        sourceLocator: {
          ...locator,
          char_start: start,
          char_end: end,
          line_start: before.split('\n').length,
          line_end: through.split('\n').length,
        },
      });
    }
    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}
