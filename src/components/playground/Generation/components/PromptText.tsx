import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface StaircaseConfig {
  /** Number of visible lines (the last one gets a "…" if the prompt overflows). */
  lines: number;
  /** Width of the SHORTEST (top) line as a fraction of the available width, e.g. 0.5. */
  minFraction: number;
  /** Width of the LONGEST (bottom) line as a fraction of the available width, e.g. 0.78.
      `(1 − maxFraction)` is the right-side gap the longest line keeps from the edge. */
  maxFraction: number;
}

interface PromptTextProps {
  prompt: string;
  /** Styling for the paragraph (layout + clamp + colour). */
  className?: string;
  /**
   * When set, the prompt is laid out as a "staircase": `lines` rows whose widths ramp
   * from (containerWidth − topReserve) up to the full container width, so the first line
   * is shortest and the last is longest. Computed in JS (canvas word-measuring) rather
   * than CSS `shape-outside`, which proved unreliable here. The full prompt is still used
   * for copy + the hover popup; only the visible rows are shortened (with a trailing "…").
   */
  staircase?: StaircaseConfig;
}

/** Copy to clipboard, with a fallback for non-secure contexts (http on a LAN IP, etc.). */
const writeClipboard = (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    } catch (e) {
      reject(e);
    }
  });
};

/**
 * Split `prompt` into `cfg.lines` rows of ascending width. Returns the rendered rows;
 * the final row ends in "…" when the prompt doesn't fully fit.
 */
const buildStaircase = (
  prompt: string,
  totalWidth: number,
  cfg: StaircaseConfig,
  measure: (s: string) => number,
): string[] => {
  const { lines: n, minFraction, maxFraction } = cfg;
  const maxWidth = Math.max(40, totalWidth * maxFraction);
  const minWidth = Math.max(40, totalWidth * minFraction);
  // Ramp from minWidth (row 0, shortest) up to maxWidth (last row, longest). The longest
  // line stops at maxFraction, leaving (1 − maxFraction) of empty space on the right.
  const widthFor = (i: number) => (n <= 1 ? maxWidth : minWidth + (maxWidth - minWidth) * (i / (n - 1)));

  const words = prompt.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let idx = 0;

  for (let i = 0; i < n && idx < words.length; i++) {
    const maxW = widthFor(i);
    const isLast = i === n - 1;
    let row = '';

    while (idx < words.length) {
      const candidate = row ? `${row} ${words[idx]}` : words[idx];
      if (measure(candidate) <= maxW) {
        row = candidate;
        idx++;
      } else {
        break;
      }
    }

    // A single word longer than the row: hard-break it so we never stall.
    if (!row && idx < words.length) {
      let word = words[idx];
      let cut = word;
      while (cut.length > 1 && measure(cut) > maxW) cut = cut.slice(0, -1);
      row = cut;
      const rest = word.slice(cut.length);
      if (rest) words[idx] = rest;
      else idx++;
    }

    // Last visible row but text remains → trim to fit a trailing ellipsis.
    if (isLast && idx < words.length) {
      let base = row;
      while (base && measure(`${base}…`) > maxW) base = base.slice(0, -1);
      row = `${base.replace(/\s+$/, '')}…`;
    }

    rows.push(row);
  }

  return rows;
};

/**
 * Prompt text: click to copy (with a "Copied!" toast), and on hover — after a short
 * delay so it doesn't block the click — a popup with the FULL prompt.
 *
 * Both the toast and the popup are portaled to <body> so they aren't clipped by the
 * card's overflow-hidden.
 */
const PromptText: React.FC<PromptTextProps> = ({ prompt, className, staircase }) => {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasRenderingContext2D | null>(null);
  const tipTimer = useRef<number | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number; width: number } | null>(null);
  const [copiedAt, setCopiedAt] = useState<{ top: number; left: number } | null>(null);
  const [rows, setRows] = useState<string[] | null>(null);
  const [width, setWidth] = useState(0);

  // Track the available width so the staircase recomputes on resize / theater open.
  useEffect(() => {
    const el = ref.current;
    if (!el || !staircase) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [staircase]);

  // Recompute the staircase rows before paint. The prompt sits inside the theater's
  // animated grid collapse, so on the first frame it can measure 0px wide — retry on the
  // next frame (capped) and fall back to an ancestor's width so we always get a real one.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !staircase) {
      setRows(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    const measureWidth = (): number => {
      let node: HTMLElement | null = el;
      while (node) {
        const w = node.clientWidth || node.getBoundingClientRect().width;
        if (w > 1) return w;
        node = node.parentElement;
      }
      return 0;
    };
    const compute = () => {
      const w = measureWidth();
      if (!w) {
        if (tries++ < 30) raf = requestAnimationFrame(compute);
        return;
      }
      const cs = window.getComputedStyle(el);
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas').getContext('2d');
      const ctx = canvasRef.current;
      if (!ctx) return;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      setRows(buildStaircase(prompt, w, staircase, (s) => ctx.measureText(s).width));
    };
    compute();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [prompt, staircase, width]);

  const copy = () => {
    writeClipboard(prompt).then(
      () => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setCopiedAt({ top: r.bottom, left: r.left });
        window.setTimeout(() => setCopiedAt(null), 1500);
      },
      () => {},
    );
  };

  // Show the full-prompt popup only after a short hover delay, so the viewer has time
  // to click-to-copy before the popup appears over the prompt.
  const showTip = () => {
    const el = ref.current;
    if (!el) return;
    tipTimer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      setTip({ top: r.top, left: r.left, width: r.width });
    }, 2500);
  };

  const hideTip = () => {
    if (tipTimer.current) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
    setTip(null);
  };

  useEffect(
    () => () => {
      if (tipTimer.current) window.clearTimeout(tipTimer.current);
    },
    [],
  );

  return (
    <>
      <div
        ref={ref}
        onClick={copy}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        title="Click to copy prompt"
        className={className}
      >
        {staircase && rows
          ? rows.map((row, i) => (
              <span key={i} className="block">
                {row}
              </span>
            ))
          : prompt}
      </div>

      {copiedAt &&
        createPortal(
          <div
            className="fixed z-[100] px-2.5 py-1 rounded-md bg-[#1a1a1c] border border-white/10 text-white/90 text-xs font-medium shadow-xl shadow-black/50 pointer-events-none"
            style={{ top: copiedAt.top + 8, left: copiedAt.left }}
          >
            Copied!
          </div>,
          document.body,
        )}

      {tip &&
        createPortal(
          <div
            className="fixed z-[100] px-3 py-2 rounded-lg bg-[#1a1a1c] border border-white/10 text-[#c9ccce] text-sm leading-relaxed shadow-xl shadow-black/50 pointer-events-none"
            style={{ top: tip.top - 8, left: tip.left, width: tip.width, transform: 'translateY(-100%)' }}
          >
            {prompt}
          </div>,
          document.body,
        )}
    </>
  );
};

export default PromptText;
