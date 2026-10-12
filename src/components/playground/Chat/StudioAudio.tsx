import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';

/** Studio audio. One player for the whole page, so a track keeps playing while the person scrolls, changes
    view or writes the next prompt. Every track is drawn as its own waveform, read from the audio itself;
    the waveform is also the scrub control. */
type Track = { id: string; url: string; title: string };
const deck = { id: '', url: '', title: '', playing: false, at: 0, length: 0 };
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
let element: HTMLAudioElement | null = null;
function audio() {
  if (element) return element;
  const el = element = new Audio(); el.preload = 'metadata';
  el.addEventListener('timeupdate', () => { deck.at = el.currentTime; emit(); });
  for (const name of ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange']) el.addEventListener(name, () => { deck.playing = !el.paused && !el.ended; deck.length = Number.isFinite(el.duration) ? el.duration : deck.length; emit(); });
  return el;
}
export function playTrack(track: Track, from?: number) {
  const el = audio();
  if (deck.id !== track.id) { Object.assign(deck, track, { at: 0, length: 0 }); el.src = track.url; }
  if (from !== undefined) { const go = () => { if (Number.isFinite(el.duration)) el.currentTime = from * el.duration; }; if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true }); }
  void el.play().catch(() => {}); emit();
}
export const toggleDeck = () => { const el = audio(); if (!deck.id) return; if (el.paused) void el.play().catch(() => {}); else el.pause(); };
export const seekDeck = (fraction: number) => { const el = audio(); if (Number.isFinite(el.duration)) { el.currentTime = Math.min(1, Math.max(0, fraction)) * el.duration; deck.at = el.currentTime; emit(); } };
export function stopDeck() { element?.pause(); Object.assign(deck, { id: '', url: '', title: '', playing: false, at: 0, length: 0 }); emit(); }
export function useDeck() { const [, bump] = useReducer((n: number) => n + 1, 0); useEffect(() => { listeners.add(bump); return () => { listeners.delete(bump); }; }, []); return deck; }
const clock = (seconds: number) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The shape of a track: its loudest moment in each of 600 slices, read once and kept. */
type Shape = { peaks: Float32Array; length: number };
const shapes = new Map<string, Promise<Shape>>();
function shapeOf(url: string) {
  let known = shapes.get(url);
  if (!known) {
    known = (async () => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const Context = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Context();
      try {
        const sound = await context.decodeAudioData(bytes), data = sound.getChannelData(0), peaks = new Float32Array(600), step = Math.max(1, Math.floor(data.length / peaks.length));
        let top = 0;
        for (let i = 0; i < peaks.length; i++) { let peak = 0; for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 8) { const v = Math.abs(data[j]); if (v > peak) peak = v; } peaks[i] = peak; if (peak > top) top = peak; }
        if (top > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= top;
        return { peaks, length: sound.duration };
      } finally { void context.close(); }
    })();
    known.catch(() => shapes.delete(url)); shapes.set(url, known);
  }
  return known;
}
function useShape(url: string | undefined) {
  const [shape, setShape] = useState<Shape | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (!url) return; let on = true; setShape(null); setFailed(false); shapeOf(url).then(s => { if (on) setShape(s); }, () => { if (on) setFailed(true); }); return () => { on = false; }; }, [url]);
  return { shape, failed };
}

/** The waveform: square bars, the played part bright. With `onSeek` it is also the scrub control. */
export function Wave({ url, progress, onSeek, label }: { url: string; progress: number; onSeek?: (fraction: number) => void; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { shape, failed } = useShape(url);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => { const el = canvas.current; if (!el) return; const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); watch.observe(el); return () => watch.disconnect(); }, []);
  useEffect(() => {
    const el = canvas.current; if (!el || !size.w || !size.h) return;
    const scale = Math.min(2, window.devicePixelRatio || 1); el.width = Math.round(size.w * scale); el.height = Math.round(size.h * scale);
    const draw = el.getContext('2d'); if (!draw) return;
    draw.setTransform(scale, 0, 0, scale, 0, 0); draw.clearRect(0, 0, size.w, size.h);
    const ink = getComputedStyle(el).color, bar = 2, gap = 2, count = Math.max(1, Math.floor((size.w + gap) / (bar + gap))), mid = size.h / 2;
    for (let i = 0; i < count; i++) {
      // Before the shape is known the bars are a flat line, so the control has its size from the first frame.
      let level = 0.06;
      if (shape) { const from = Math.floor((i / count) * shape.peaks.length), to = Math.max(from + 1, Math.floor(((i + 1) / count) * shape.peaks.length)); let peak = 0; for (let j = from; j < to; j++) if (shape.peaks[j] > peak) peak = shape.peaks[j]; level = Math.max(0.06, peak); }
      const tall = Math.max(2, level * (size.h - 2));
      draw.globalAlpha = (i + 0.5) / count <= progress ? 1 : 0.28; draw.fillStyle = ink; draw.fillRect(i * (bar + gap), mid - tall / 2, bar, tall);
    }
    draw.globalAlpha = 1;
  }, [shape, size, progress]);
  const seek = (e: React.PointerEvent<HTMLCanvasElement>) => { const box = e.currentTarget.getBoundingClientRect(); onSeek?.(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))); };
  return <canvas ref={canvas} className="sga-wave" data-seek={onSeek ? '' : undefined} role={onSeek ? 'slider' : 'img'} aria-label={failed ? 'The sound could not be read' : label || 'Waveform'} aria-valuemin={onSeek ? 0 : undefined} aria-valuemax={onSeek ? 100 : undefined} aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
    onPointerDown={onSeek ? e => { e.currentTarget.setPointerCapture(e.pointerId); seek(e); } : undefined} onPointerMove={onSeek ? e => { if (e.buttons) seek(e); } : undefined} />;
}

/** A track in a card: play, the waveform, the time. */
export function AudioStage({ id, url, title }: { id: string; url: string; title: string }) {
  const now = useDeck(); const mine = now.id === id;
  const { shape } = useShape(url);
  const length = mine && now.length ? now.length : shape?.length || 0;
  return <div className="sga" data-current={mine || undefined} data-playing={(mine && now.playing) || undefined}>
    <button type="button" className="sga-play" aria-label={mine && now.playing ? 'Pause' : 'Play'} onClick={() => mine ? toggleDeck() : playTrack({ id, url, title })}>{mine && now.playing ? <Pause size={16} /> : <Play size={16} />}</button>
    <Wave url={url} label={title} progress={mine && length ? now.at / length : 0} onSeek={fraction => mine ? seekDeck(fraction) : playTrack({ id, url, title }, fraction)} />
    <span className="sga-time">{mine ? clock(now.at) : '0:00'} <i>/</i> {clock(length)}</span>
  </div>;
}

/** Now playing, joined to the top of the prompt box. `step` moves to the track before or after. */
export function AudioDeck({ onStep, onShow }: { onStep: (direction: number) => void; onShow: (id: string) => void }) {
  const now = useDeck();
  if (!now.id) return null;
  return <div className="sms-bar sga-deck" role="group" aria-label="Now playing">
    <div className="sms-tools sga-deck-keys">
      <button type="button" aria-label="Track before" onClick={() => onStep(-1)}><SkipBack size={14} /></button>
      <button type="button" aria-label={now.playing ? 'Pause' : 'Play'} onClick={toggleDeck}>{now.playing ? <Pause size={15} /> : <Play size={15} />}</button>
      <button type="button" aria-label="Track after" onClick={() => onStep(1)}><SkipForward size={14} /></button>
    </div>
    <button type="button" className="sga-deck-title" title="Show this track" onClick={() => onShow(now.id)}>{now.title}</button>
    <Wave url={now.url} label={now.title} progress={now.length ? now.at / now.length : 0} onSeek={seekDeck} />
    <span className="sga-time">{clock(now.at)} <i>/</i> {clock(now.length)}</span>
    <div className="sms-tools"><button type="button" aria-label="Stop and close" title="Stop" onClick={stopDeck}><X size={14} /></button></div>
  </div>;
}
