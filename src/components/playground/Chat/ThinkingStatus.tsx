import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMode } from './chatModeConfig';

/**
 * The phases the wait is scripted in. It used to live in `ThinkingCube`, which drew a small 3D cube
 * for each of them; the mark is a flat square now — the chat draws no circles and no perspective —
 * so the type outlived the component that owned it, and this is the only file that reads it.
 */
export type ThinkingPhase = 'thinking' | 'searching' | 'reading' | 'writing';

interface Step {
  /** ms after start when this step becomes active. */
  at: number;
  key: ThinkingPhase;
  label: string;
}

/**
 * Client-side "phase script" per mode. With no real backend telling us what the
 * model is doing, we simulate a believable sequence (thinking → searching →
 * reading → writing). Swaps cleanly for real phase events from the backend
 * later — this component just needs the current phase + step list.
 */
const scriptFor = (mode: ChatMode, searching: boolean): Step[] => {
  if (mode === 'research' || searching) {
    return [
      { at: 0, key: 'thinking', label: 'Reading your question' },
      { at: 900, key: 'searching', label: 'Searching the web' },
      { at: 2200, key: 'reading', label: 'Reading sources' },
      { at: 3600, key: 'writing', label: 'Writing the answer' },
    ];
  }
  if (mode === 'agents') {
    return [
      { at: 0, key: 'thinking', label: 'Planning the steps' },
      { at: 1000, key: 'searching', label: 'Picking tools' },
      { at: 2300, key: 'writing', label: 'Running' },
    ];
  }
  if (mode === 'code') {
    return [
      { at: 0, key: 'thinking', label: 'Reading the request' },
      { at: 1200, key: 'writing', label: 'Writing code' },
    ];
  }
  return [
    { at: 0, key: 'thinking', label: 'Thinking' },
    { at: 1500, key: 'writing', label: 'Writing the answer' },
  ];
};

/** Reassuring copy that adapts to how long the wait has run. */
const microcopyFor = (ms: number): string | null => {
  if (ms > 12000) return 'Taking longer than usual — you can stop anytime.';
  if (ms > 7000) return 'Digging deeper…';
  if (ms > 4000) return 'Almost there…';
  return null;
};

interface ThinkingStatusProps {
  mode: ChatMode;
  searching: boolean;
}

/**
 * The "thinking" placeholder: a phase-reactive cube, a contextual status verb,
 * a live step timeline (for multi-step modes) and duration-adaptive microcopy.
 */
const ThinkingStatus: React.FC<ThinkingStatusProps> = ({ mode, searching }) => {
  const steps = useMemo(() => scriptFor(mode, searching), [mode, searching]);
  const startRef = useRef<number>(performance.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    startRef.current = performance.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 120);
    return () => clearInterval(id);
  }, [mode, searching]);

  let idx = 0;
  for (let i = 0; i < steps.length; i++) if (elapsed >= steps[i].at) idx = i;
  const current = steps[idx];
  const showTimeline = steps.length >= 3;
  const micro = microcopyFor(elapsed);
  const secs = Math.floor(elapsed / 1000);

  return (
    <div className="flex items-start gap-2.5">
      {/* Draws in `currentColor`'s neighbour, `--chat-text`, so the theme reaches it through CSS —
          there is nothing for a theme prop to do here. */}
      <span className="thinking-cube" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1 pt-[3px] font-mono opacity-25">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--chat-text)]">
            {current.label}
            <span className="thinking-status-dots" />
          </span>
          {secs >= 1 && (
            <span className="text-[11px] tabular-nums text-[var(--chat-muted)]">{secs}s</span>
          )}
        </div>

        {showTimeline ? (
          <ul className="mt-0.5 flex flex-col gap-[5px]">
            {steps.map((s, i) => {
              const state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
              return (
                <li key={`${s.key}-${i}`} className="flex items-center gap-2 text-[12px] leading-none">
                  <span className={`thinking-step-mark thinking-step-${state}`} aria-hidden="true" />
                  <span
                    className={
                      state === 'active'
                        ? 'text-[var(--chat-text)]'
                        : state === 'done'
                          ? 'text-[var(--chat-muted)]'
                          : 'text-[var(--chat-muted)] opacity-55'
                    }
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          micro && <span className="text-[12px] text-[var(--chat-muted)]">{micro}</span>
        )}
      </div>

      <style>{`
        .thinking-cube {
          width: 15px;
          height: 15px;
          flex-shrink: 0;
          margin-top: 4px;
          border-radius: 3px;
          border: 1.6px solid var(--chat-text);
          box-sizing: border-box;
          animation: thinking-cube-life 1.6s ease-in-out infinite;
        }
        @keyframes thinking-cube-life {
          0% { transform: rotate(0deg) scale(0.92); }
          50% { transform: rotate(180deg) scale(0.55); }
          100% { transform: rotate(360deg) scale(0.92); }
        }
        @media (prefers-reduced-motion: reduce) {
          .thinking-cube { animation: none; }
        }
        .thinking-status-dots::after {
          content: '';
          animation: ts-dots 1.4s steps(4, end) infinite;
        }
        @keyframes ts-dots {
          0%, 20% { content: ''; }
          40% { content: '.'; }
          60% { content: '..'; }
          80%, 100% { content: '...'; }
        }
        .thinking-step-mark {
          width: 12px;
          height: 12px;
          border-radius: 3px;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1.5px solid var(--chat-border);
          box-sizing: border-box;
        }
        .thinking-step-done {
          background: var(--chat-text);
          border-color: var(--chat-text);
        }
        .thinking-step-done::after {
          content: '';
          width: 4px;
          height: 4px;
          border-radius: 1px;
          background: var(--chat-canvas);
        }
        .thinking-step-active {
          border-color: var(--chat-text);
          animation: ts-pulse 1.15s ease-in-out infinite;
        }
        .thinking-step-active::after {
          content: '';
          width: 5px;
          height: 5px;
          border-radius: 1px;
          background: var(--chat-text);
        }
        @keyframes ts-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--chat-text) 32%, transparent); }
          50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--chat-text) 0%, transparent); }
        }
      `}</style>
    </div>
  );
};

export default ThinkingStatus;
