import React from 'react';

export type ScopeStatus = 'active' | 'paused' | 'blocked' | 'settled';

// NFR-08: statuses are never color-only. Every badge renders a distinct
// text word plus a distinct glyph; the color class is decoration on top.
// Removing either the word or the glyph is a regression the proof catches.
const STATUS_META: Record<ScopeStatus, { word: string; glyph: string }> = {
  active: { word: 'Active', glyph: '\u25CF' },
  paused: { word: 'Paused', glyph: '\u275A\u275A' },
  blocked: { word: 'Blocked', glyph: '\u26D4' },
  settled: { word: 'Settled', glyph: '\u2713' },
};

export const ScopeStatusBadge: React.FC<{ status: ScopeStatus }> = ({ status }) => {
  const meta = STATUS_META[status];
  return (
    <span className={`scope-status-badge scope-status-${status}`} data-status={status}>
      <span className="scope-status-glyph" aria-hidden="true">
        {meta.glyph}
      </span>{' '}
      <span className="scope-status-word">{meta.word}</span>
    </span>
  );
};
