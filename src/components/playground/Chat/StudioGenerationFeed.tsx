import { MarkLoader } from '../../platform/MarkLoader';
import React, { Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Download, Star, Trash2, Expand, Link2, Maximize2, Pause, Play, RotateCw, Volume2, VolumeX, X } from 'lucide-react';
import { generations, generationAuthHeaders, generationPath, isGenerationTerminal, type Generation, type GenerationType } from '@/lib/generations';
import { libraryService } from '@/services/libraryService';
import { GenerationRecord, GENERATION_FAILURE } from './GenerationRecord';
import { AudioDeck, AudioStage, Wave, playTrack, stopDeck, useDeck } from './StudioAudio';
import { confirmAction } from '../../platform/confirmAction';
import './studioFeed.css';

// The 3D stage brings a 3D engine with it, so it is fetched only when someone opens that view.
const StudioModelStage = React.lazy(() => import('./StudioModelStage'));

/** Studio › Generate › <type>: every generation of this type the person owns, oldest at the top and the
    newest just above the composer. Each card reads server state; nothing here is kept only in memory,
    so a refresh, Back or a fresh tab shows the same feed. */
type Media = { url: string; mime: string };
const TYPE_NOUN: Record<GenerationType, string> = { image: 'image', video: 'video', audio: 'audio', '3d': '3D model' };
const STATE_LABEL: Record<string, string> = { queued: 'Waiting to start', running: 'Generating', submitted: 'Generating', importing: 'Saving the result', cancelled: 'Cancelled', denied: 'Declined', expired: 'Expired' };
const titleOf = (prompt: string) => { const words = prompt.trim().split(/\s+/).slice(0, 7).join(' '); return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled'; };
const ago = (iso: string | undefined, now: number) => {
  if (!iso) return '';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  return s < 60 ? 'Just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
const elapsed = (iso: string | undefined, now: number) => { if (!iso) return ''; const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** 3D results use the viewer element. Its code is loaded only when a 3D result is first shown, so the
    image and video pages never pay for it. `live` gives the person the camera; otherwise it only turns. */
let viewerCode: Promise<unknown> | null = null;
export function ModelView({ url, label, live, turning }: { url: string; label: string; live: boolean; turning: boolean }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let on = true; (viewerCode ??= import('@google/model-viewer')).then(() => { if (on) setReady(true); }, () => { viewerCode = null; if (on) setFailed(true); }); return () => { on = false; }; }, []);
  if (failed) return <span className="sgf-stage-label" role="alert">The 3D viewer could not be loaded</span>;
  if (!ready) return <span className="sgf-stage-label" role="status">Opening the model</span>;
  return React.createElement('model-viewer', {
    class: 'sgf-model', src: url, alt: label, 'shadow-intensity': '0.9', exposure: '1.05', 'environment-image': 'neutral', 'interaction-prompt': 'none',
    ...(live ? { 'camera-controls': '', 'touch-action': 'pan-y' } : {}), ...(turning ? { 'auto-rotate': '', 'rotation-per-second': '24deg', 'auto-rotate-delay': '0' } : {}),
  });
}

const ratioOf = (record: Generation) => { const m = /^(\d+):(\d+)$/.exec(record.request.settings.ratio || record.request.settings.aspect_ratio || ''); return m ? `${m[1]} / ${m[2]}` : record.type === 'audio' ? '' : record.type === '3d' ? '4 / 3' : '16 / 9'; };

/** A result is shown only after its library asset passes the scan (423 = still being checked). */
export function useResultMedia(assetId: string | undefined) {
  const [media, setMedia] = useState<Media | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setMedia(null); setError('');
    const load = async () => {
      try {
        const head = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/content`, { method: 'HEAD', credentials: 'same-origin', headers: generationAuthHeaders(), signal: controller.signal });
        if (head.status === 423) { timer = setTimeout(load, 2000); return; }
        if (!head.ok) throw new Error(`The result could not be opened (${head.status}).`);
        const mime = (head.headers.get('content-type') || '').split(';')[0];
        const url = await libraryService.createSignedLink(assetId);
        if (!controller.signal.aborted) setMedia({ url, mime });
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'The result could not be opened.'); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [assetId, attempt]);
  return { media, error, retry: () => setAttempt(n => n + 1) };
}

/** The video player. The browser's own controls are round and look like every other site; this one is a
    thin line along the lower edge and three square buttons, shown while the pointer is over the video or
    while it is paused. Click the picture to play or pause. */
const clock = (seconds: number) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function Player({ url, label }: { url: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null), box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); };
  const seek = (e: React.PointerEvent<HTMLDivElement>) => { const v = video.current; if (!v || !length) return; const line = e.currentTarget.getBoundingClientRect(); v.currentTime = Math.min(1, Math.max(0, (e.clientX - line.left) / line.width)) * length; };
  const full = () => { const el = box.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.().catch(() => {}); };
  return <div className="sgp" ref={box} data-playing={playing || undefined} tabIndex={0} aria-label={label}
    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); } else if (e.key === 'm') setMuted(v => !v); else if (e.key === 'f') full(); }}>
    <video ref={video} src={url} muted={muted} playsInline loop preload="metadata" onClick={toggle}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => setAt(e.currentTarget.currentTime)} onLoadedMetadata={e => setLength(e.currentTarget.duration || 0)} />
    {!playing && <button type="button" className="sgp-start" aria-label="Play" onClick={toggle}><Play size={20} /></button>}
    <div className="sgp-bar">
      <div className="sgp-line" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(at)} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seek(e); }} onPointerMove={e => { if (e.buttons) seek(e); }}><i style={{ width: length ? `${(at / length) * 100}%` : 0 }} /></div>
      <div className="sgp-row">
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
        <span>{clock(at)} <i>/</i> {clock(length)}</span>
        <button type="button" className="sgp-right" aria-label={muted ? 'Sound on' : 'Sound off'} aria-pressed={muted} onClick={() => setMuted(v => !v)}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
        <button type="button" aria-label="Full screen" onClick={full}><Maximize2 size={14} /></button>
      </div>
    </div>
  </div>;
}

/** One image of a set. Images come in sets of one to four, so each loads and fails on its own. */
function Tile({ assetId, alt, onOpen }: { assetId: string; alt: string; onOpen?: () => void }) {
  const { media, error, retry } = useResultMedia(assetId);
  if (error) return <div className="sgf-tile sgf-tile-note"><p role="alert">{error}</p><button type="button" className="sgf-btn" onClick={retry}>Open it again</button></div>;
  if (!media) return <div className="sgf-tile sgf-working"><span className="sgf-stage-label" role="status">Checking the result</span></div>;
  return <button type="button" className="sgf-tile sgf-ready" onClick={onOpen} aria-label={onOpen ? 'Open in theater view' : alt} disabled={!onOpen}><img src={media.url} alt={alt} loading="lazy" /></button>;
}
const pretty = (value: string) => /^(glb|gltf|obj|fbx|usdz|stl|png|jpg|webp|mp4|wav|mp3)$/.test(value) ? value.toUpperCase() : /^[a-z]/.test(value) ? value[0].toUpperCase() + value.slice(1) : value;

/** What a page that reuses this feed may change. Generate uses none of it. Enhance supplies its own records,
    names what each is compared with, and turns off the things that only make sense for a prompt. */
export type FeedOptions = {
  load?: (signal: AbortSignal) => Promise<Generation[]>;
  compareWith?: (record: Generation) => string | undefined;
  pathOf?: (record: Generation) => string;
  plain?: boolean;
  empty?: { title: string; text: string };
};
const Options = React.createContext<FeedOptions>({});

/** Before and after under one divider. Drag anywhere on it. */
function Compare({ before, after, type, label }: { before: string; after: string; type: GenerationType; label: string }) {
  const a = useResultMedia(before), b = useResultMedia(after);
  const [split, setSplit] = useState(0.5);
  const move = (e: React.PointerEvent<HTMLDivElement>) => { const box = e.currentTarget.getBoundingClientRect(); setSplit(Math.min(0.98, Math.max(0.02, (e.clientX - box.left) / box.width))); };
  if (a.error || b.error) return <p className="sgc-note" role="alert">{a.error || b.error}</p>;
  if (!a.media || !b.media) return <span className="sgf-stage-label" role="status">Opening the comparison</span>;
  const show = (url: string, alt: string) => type === 'video' ? <video src={url} muted loop autoPlay playsInline aria-label={alt} /> : <img src={url} alt={alt} draggable={false} />;
  return <div className="sgc" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={e => { if (e.buttons) move(e); }} onDoubleClick={e => e.stopPropagation()}>
    {show(a.media.url, `Before: ${label}`)}
    <div className="sgc-after" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>{show(b.media.url, `After: ${label}`)}</div>
    <span className="sgc-tag">Before</span><span className="sgc-tag sgc-tag-after">After</span>
    <div className="sgc-line" style={{ left: `${split * 100}%` }} role="slider" aria-label="Compare before and after" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)}><i /></div>
  </div>;
}

function Stage({ record, now, onExpand }: { record: Generation; now: number; onExpand?: () => void }) {
  const options = useContext(Options);
  const before = record.state === 'succeeded' ? options.compareWith?.(record) : undefined;
  const compared = !!before && (record.type === 'image' || record.type === 'video') && !!record.resultAssetIds[0];
  const set = record.type === 'image' && record.state === 'succeeded' && !compared;
  const { media, error, retry } = useResultMedia(record.state === 'succeeded' && !set && !compared ? record.resultAssetIds[0] : undefined);
  const ratio = ratioOf(record);
  const style = ratio ? { aspectRatio: ratio } : undefined;
  if (compared) return <div className="sgf-stage sgf-ready" style={style}>{onExpand && <button type="button" className="sgf-expand" aria-label="Open in theater view" title="Theater view" onClick={onExpand}><Expand size={15} /></button>}<Compare before={before!} after={record.resultAssetIds[0]} type={record.type} label={record.request.prompt} /></div>;
  if (set) return <div className="sgf-stage sgf-set" data-count={Math.min(4, record.resultAssetIds.length)}>{record.resultAssetIds.map(assetId => <Tile key={assetId} assetId={assetId} alt={record.request.prompt} onOpen={onExpand} />)}</div>;
  if (record.state === 'succeeded') {
    if (error) return <div className="sgf-stage sgf-stage-note" style={style}><p role="alert">{error}</p><button type="button" className="sgf-btn" onClick={retry}>Open it again</button></div>;
    if (!media) return <div className="sgf-stage sgf-working" style={style}><span className="sgf-stage-label" role="status">Checking the result</span></div>;
    return <div className="sgf-stage sgf-ready" style={style} onDoubleClick={record.type === 'audio' ? undefined : onExpand}>
      {onExpand && record.type !== 'audio' && <button type="button" className="sgf-expand" aria-label="Open in theater view" title="Theater view" onClick={onExpand}><Expand size={15} /></button>}
      {record.type === 'video' && media.mime.startsWith('video/') ? <Player url={media.url} label={record.request.prompt} />
        : record.type === 'image' && media.mime.startsWith('image/') ? <img src={media.url} alt={record.request.prompt} />
        : record.type === 'audio' && media.mime.startsWith('audio/') ? <AudioStage id={record.id} url={media.url} title={record.request.prompt} />
        : record.type === '3d' ? <ModelView url={media.url} label={record.request.prompt} live turning />
        : <a className="sgf-btn" href={media.url} target="_blank" rel="noopener noreferrer">Open the {TYPE_NOUN[record.type]}</a>}
    </div>;
  }
  if (record.state === 'failed') return <div className="sgf-stage sgf-stage-note" style={style}><p role="alert">{GENERATION_FAILURE[record.error?.code || ''] || record.error?.message || record.error?.code || 'This could not be made. Nothing was charged.'}</p></div>;
  if (isGenerationTerminal(record.state)) return <div className="sgf-stage sgf-stage-note" style={style}><p>{STATE_LABEL[record.state] || record.state}. Nothing was charged.</p></div>;
  return <div className="sgf-stage sgf-working" style={style}><span className="sgf-stage-label" role="status">{STATE_LABEL[record.state] || 'Generating'} <i>{elapsed(record.createdAt, now)}</i></span></div>;
}

/** Grid view: one tile per result. A row keeps one height and each tile takes the width its shape needs,
    so a row is always full from edge to edge (the earlier image page's history layout). */
const shapeOf = (record: Generation) => { const m = /^(\d+):(\d+)$/.exec(record.request.settings.ratio || record.request.settings.aspect_ratio || ''); return m ? Number(m[1]) / Number(m[2]) : record.type === 'image' || record.type === '3d' ? 1 : record.type === 'audio' ? 2.3 : 16 / 9; };
function GridTile({ record, assetId, first, active, modelName, now, onPick }: { record: Generation; assetId?: string; first: boolean; active: boolean; modelName: string; now: number; onPick: (id: string) => void }) {
  const { media, error } = useResultMedia(record.state === 'succeeded' ? assetId : undefined);
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const playing = useDeck();
  const waiting = !isGenerationTerminal(record.state) || (record.state === 'succeeded' && !media && !error);
  const quiet = record.state !== 'succeeded' || !!error;
  const grab = useDraggable(record, assetId);
  return <button type="button" {...grab} className={'sgg-tile' + (waiting ? ' sgf-working' : '')} data-quiet={quiet || undefined} data-generation-card={first ? record.id : undefined} data-active={active || undefined} style={{ ['--r' as string]: shapeOf(record) }} onClick={() => onPick(record.id)}
    onMouseEnter={() => { setHover(true); void video.current?.play().catch(() => {}); }} onMouseLeave={() => { setHover(false); const v = video.current; if (v) { v.pause(); v.currentTime = 0; } }}>
    {media && media.mime.startsWith('video/') ? <video ref={video} src={media.url} muted loop playsInline preload="metadata" aria-label={record.request.prompt} />
      : media && media.mime.startsWith('image/') ? <img src={media.url} alt={record.request.prompt} loading="lazy" />
      : media && record.type === '3d' ? <ModelView url={media.url} label={record.request.prompt} live={false} turning={hover} />
      : media && media.mime.startsWith('audio/') ? <Wave url={media.url} label={record.request.prompt} progress={playing.id === record.id && playing.length ? playing.at / playing.length : 0} />
      : <span className="sgf-stage-label sgg-status"><b>{titleOf(record.request.prompt)}</b>{record.state === 'failed' || error ? 'Could not be made' : record.state === 'succeeded' ? 'Checking the result' : isGenerationTerminal(record.state) ? (STATE_LABEL[record.state] || record.state) : <>{STATE_LABEL[record.state] || 'Generating'} <i>{elapsed(record.createdAt, now)}</i></>}</span>}
    <span className="sgg-cap"><b>{titleOf(record.request.prompt)}</b><i>{modelName} · {ago(record.createdAt, now)}</i></span>
  </button>;
}

function Card({ record, modelName, now, active, index, onOpen, onChanged, onExpand, onUsePrompt }: { record: Generation; modelName: string; onUsePrompt: (prompt: string) => void; onExpand?: (id: string) => void; now: number; active: boolean; index: number; onOpen: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const run = async (work: () => Promise<unknown>) => { if (busy) return; setBusy(true); setNote(''); try { await work(); onChanged(); } catch (e) { setNote(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(false); } };
  const tryAgain = () => run(async () => { const quote = await generations.quote(record.request); const next = await generations.retry(record.id, quote.quoteToken, crypto.randomUUID()); onOpen(next.id); });
  const options = useContext(Options);
  const copyLink = () => run(async () => { await navigator.clipboard.writeText(window.location.origin + (options.pathOf?.(record) ?? generationPath(record.type, record.id))); setNote('Link copied'); });
  const download = () => run(async () => { for (const assetId of record.resultAssetIds) { const url = await libraryService.createSignedLink(assetId, { download: true }); const a = document.createElement('a'); a.href = url; a.download = ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); } });
  const grab = useDraggable(record);
  const favorite = () => run(() => generations.favorite(record.id, !record.favorite));
  const remove = () => run(async () => { if (await confirmAction({ title: 'Remove from your history', detail: 'It leaves this page. The result files stay in your Library, and nothing is refunded or charged.', destructive: true })) await generations.remove(record.id); });
  const [open, setOpen] = useState(false); // the prompt is one quiet line until asked for
  const copyPrompt = () => run(async () => { await navigator.clipboard.writeText(record.request.prompt); setNote('Prompt copied'); });
  // Approval keeps its one tested implementation (cost, approve, decline) rather than a second copy here.
  if (record.state === 'awaiting_approval') return <div className="sgf-card-wrap" data-generation-card={record.id} style={{ ['--i' as string]: index }}><GenerationRecord id={record.id} /></div>;
  const reason = record.state === 'failed' ? (GENERATION_FAILURE[record.error?.code || ''] || record.error?.message || record.error?.code || 'This could not be made. Nothing was charged.') : `${STATE_LABEL[record.state] || record.state}. Nothing was charged.`;
  const meta = [modelName, ...Object.entries(record.request.settings).map(([key, value]) => key === 'n' ? `${value} ${TYPE_NOUN[record.type]}s` : pretty(String(value)))].filter(Boolean);
  // Not finished, or not made: one line. It has nothing to show, so it does not hold a result's space.
  if (record.state !== 'succeeded') return <article className="sgf-card sgf-line" data-generation-card={record.id} data-active={active || undefined} data-state={record.state} data-live={!isGenerationTerminal(record.state) || undefined} style={{ ['--i' as string]: index }}>
    <i className="sgf-mark" aria-hidden="true" />
    <button type="button" className="sgf-line-prompt" title="Copy the prompt" onClick={copyPrompt}>{record.request.prompt}</button>
    <span className="sgf-line-state" role="status">{note || (isGenerationTerminal(record.state) ? reason : <>{STATE_LABEL[record.state] || 'Generating'} <i>{elapsed(record.createdAt, now)}</i></>)}</span>
    <div className="sgf-actions">
      {!options.plain && <button type="button" className="sgf-act" disabled={busy} onClick={() => onUsePrompt(record.request.prompt)}><CornerDownLeft size={14} />Use prompt</button>}
      {!options.plain && (record.state === 'failed' || record.state === 'cancelled') && <button type="button" className="sgf-act" disabled={busy} onClick={tryAgain}><RotateCw size={14} />Try again</button>}
      {!options.plain && isGenerationTerminal(record.state) && <button type="button" className="sgf-act" disabled={busy} aria-label="Remove from your history" title="Remove" onClick={remove}><Trash2 size={14} /></button>}
      {!options.plain && !isGenerationTerminal(record.state) && <button type="button" className="sgf-act" disabled={busy} onClick={() => run(() => generations.cancel(record.id))}><X size={14} />Cancel</button>}
    </div>
  </article>;
  // Made: the result has the card's full width; one line under it says what it is and what you can do.
  return <article {...grab} className="sgf-card" data-generation-card={record.id} data-active={active || undefined} data-state={record.state} style={{ ['--i' as string]: index }}>
    <Stage record={record} now={now} onExpand={onExpand ? () => onExpand(record.id) : undefined} />
    {/* Two rows on one grid, so left and right share their lines: the prompt with the actions, the details with the time. */}
    <div className="sgf-foot">
      <button type="button" className="sgf-foot-prompt" data-open={open || undefined} aria-expanded={open} title={open ? 'Show less' : 'Show the whole prompt'} onClick={() => setOpen(v => !v)}>{record.request.prompt}</button>
      <div className="sgf-foot-acts">
        {!options.plain && <button type="button" disabled={busy} aria-pressed={!!record.favorite} aria-label={record.favorite ? 'Remove from favorites' : 'Add to favorites'} title={record.favorite ? 'Favorite' : 'Add to favorites'} onClick={favorite}><Star size={15} fill={record.favorite ? 'currentColor' : 'none'} /></button>}
        {!options.plain && <button type="button" disabled={busy} aria-label="Use this prompt" title="Use prompt" onClick={() => onUsePrompt(record.request.prompt)}><CornerDownLeft size={15} /></button>}
        {record.resultAssetIds[0] && <button type="button" disabled={busy} aria-label="Download" title="Download" onClick={download}><Download size={15} /></button>}
        <button type="button" disabled={busy} aria-label="Copy link" title="Copy link" onClick={copyLink}><Link2 size={15} /></button>
      </div>
      <div className="sgf-foot-meta">{note ? <span role="status">{note}</span> : meta.map((value, i) => <span key={i}>{value}</span>)}</div>
      <time className="sgf-foot-time">{ago(record.createdAt, now)}</time>
    </div>
  </article>;
}

/** Dragging a result. While a result is held, the prompt box opens into one box per thing that result can
    be used for; dropping on one does it. A box is offered only when it would really work: a reference only
    for an image, and only while the chosen model still has room for one. */
/** What lifts off when a result is sent to another page: the WHOLE container (its frame and its line of details),
    with the picture inside it kept as the fallback. `box` is the container; `mark` tags it so the workspace can copy it. */
type Lift = { x: number; y: number; w: number; h: number; src: string; kind: 'img' | 'video'; box?: { x: number; y: number; w: number; h: number }; mark?: () => void };
type Held = { record: Generation; assetId: string; lift?: Lift };
/** Tell the workspace where a result that was sent here has come to rest (it flies the result there). */
/** One generation inside a chat conversation: the SAME card Studio shows (result, player, favorite, download,
    link, use prompt, try again), live while it is being made. A retry continues in the same place. */
export function ChatGenerationCard({ id, onUsePrompt }: { id: string; onUsePrompt: (prompt: string) => void }) {
  const [current, setCurrent] = useState(id);
  const [record, setRecord] = useState<Generation | null>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setCurrent(id); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => { try { const value = await generations.get(current, controller.signal); if (controller.signal.aborted) return; setRecord(value); setNow(Date.now()); if (!isGenerationTerminal(value.state)) timer = setTimeout(load, 2500); } catch { if (!controller.signal.aborted) timer = setTimeout(load, 5000); } };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [current, reload]);
  useEffect(() => { if (!record || isGenerationTerminal(record.state)) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [record]);
  if (!record) return <div className="sgf-chat" role="status"><MarkLoader size={48} label="Loading the generation" /></div>;
  return <div className="sgf-chat" data-chat-generation={record.id}>
    <Card record={record} modelName={record.request.model} now={now} active={false} index={0} onOpen={(next) => setCurrent(next)} onChanged={() => setReload(n => n + 1)} onUsePrompt={onUsePrompt} />
  </div>;
}

export function reportLanding(find: () => Element | null | undefined) {
  if (window.parent === window) return;
  let tries = 0;
  const look = () => { const el = find(); const box = el?.getBoundingClientRect(); if (box && box.width > 4 && (!(el instanceof HTMLImageElement) || el.complete)) { window.parent.postMessage({ source: 'xeno-chat', type: 'generation-landed', rect: { x: box.left, y: box.top, w: box.width, h: box.height, radius: getComputedStyle(el!).borderRadius || getComputedStyle(el!.parentElement!).borderRadius } }, window.location.origin); return; } if (++tries < 90) setTimeout(look, 60); else window.parent.postMessage({ source: 'xeno-chat', type: 'generation-landed', rect: null }, window.location.origin); };
  look();
}
export const RESULT_DRAG = 'application/x-xeno-result';
const Drag = React.createContext<{ hold: (held: Held | null) => void; menu: (held: Held, at: { x: number; y: number }) => void } | null>(null);
function useDraggable(record: Generation, assetId?: string) {
  const drag = useContext(Drag), plain = useContext(Options).plain;
  if (!drag || plain || record.state !== 'succeeded' || !(assetId || record.resultAssetIds[0])) return {};
  const whole = { record, assetId: assetId || record.resultAssetIds[0] };
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      // what will lift off if this is sent to another page: the picture under the pointer, where it sits now
      const media = ((e.target as Element).closest('img, video') ?? e.currentTarget.querySelector('img, video')) as HTMLImageElement | HTMLVideoElement | null;
      const box = media?.getBoundingClientRect();
      const holder = e.currentTarget as HTMLElement, outer = holder.getBoundingClientRect();
      const lift: Lift | undefined = media && box && box.width > 0 ? { x: box.left, y: box.top, w: box.width, h: box.height, src: media.currentSrc || media.src, kind: media instanceof HTMLVideoElement ? 'video' : 'img', box: { x: outer.left, y: outer.top, w: outer.width, h: outer.height }, mark: () => { document.querySelectorAll('[data-lifting]').forEach(el => el.removeAttribute('data-lifting')); holder.setAttribute('data-lifting', ''); } } : undefined;
      drag.menu({ ...whole, lift }, { x: e.clientX, y: e.clientY });
    },
    draggable: true,
    // The scrub line, the waveform and the 3D view are dragged for their own reasons; a drag that starts on them is theirs.
    onDragStart: (e: React.DragEvent) => { if ((e.target as Element).closest?.('.sgp-bar, .sga, .sgf-model, .sgf-actions')) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', record.request.prompt);
      // A dragged picture also travels as a FILE, which the prompt box takes for an upload. This mark tells it the drag is one of the person's own results.
      e.dataTransfer.setData(RESULT_DRAG, record.id);
      const held = { record, assetId: assetId || record.resultAssetIds[0] };
      // After this event: changing the page inside dragstart can make the browser drop the drag.
      requestAnimationFrame(() => drag.hold(held)); },
    onDragEnd: () => requestAnimationFrame(() => drag.hold(null)),
  };
}
export type StudioHandoff = { to: GenerationType | `enhance-${GenerationType}`; generationId: string; assetId: string; prompt: string; role: string };
const HANDOFF = 'xeno_studio_handoff';
export const takeHandoff = (to: string): StudioHandoff | null => { try { const raw = sessionStorage.getItem(HANDOFF); if (!raw) return null; const value = JSON.parse(raw) as StudioHandoff; if (value.to !== to) return null; sessionStorage.removeItem(HANDOFF); return value; } catch { return null; } };
type Target = { id: string; label: string; run?: () => void };
const ROLE_LABEL: Record<string, string> = { reference: 'Reference', start_frame: 'Start frame', first_frame: 'Start frame', end_frame: 'End frame', last_frame: 'End frame', ingredient: 'Ingredient', ingredients: 'Ingredient', style: 'Style', character: 'Character', subject: 'Subject', pose: 'Pose' };
const roleLabel = (role: string) => ROLE_LABEL[role] || (role[0].toUpperCase() + role.slice(1).replace(/_/g, ' '));
function DropDeck({ targets, dock }: { targets: Target[]; dock: HTMLElement }) {
  const [over, setOver] = useState('');
  // The boxes take exactly the prompt box's place and height, so the box reads as parting into them.
  const [place, setPlace] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const shell = dock.querySelector<HTMLElement>('[data-chat-composer-shell]'); if (!shell) return;
    const a = shell.getBoundingClientRect(), b = dock.getBoundingClientRect();
    setPlace({ left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height });
  }, [dock]);
  if (!place) return null;
  return createPortal(<div className="sgd" style={{ ...place, ['--n' as string]: targets.length }}>
    {targets.map(target => target.run
      ? <div key={target.id} className="sgd-box" data-over={over === target.id || undefined}
          onDragEnter={e => { e.preventDefault(); setOver(target.id); }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (over !== target.id) setOver(target.id); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(o => o === target.id ? '' : o); }} onDrop={e => { e.preventDefault(); target.run!(); }}>{target.label}</div>
      : <div key={target.id} className="sgd-box sgd-no">{target.label}</div>)}
  </div>, dock);
}

/** Right-click on a result: what else it can become. Words only, like the rest of the workspace's menus. */
type MenuItem = { label: string; run: () => void };
function ResultMenu({ at, items, root, onClose }: { at: { x: number; y: number }; items: MenuItem[]; root: HTMLElement; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState(at);
  useLayoutEffect(() => { const el = menu.current; if (!el) return; const box = root.getBoundingClientRect(); setSpot({ x: Math.min(at.x - box.left, box.width - el.offsetWidth - 8), y: Math.min(at.y - box.top, box.height - el.offsetHeight - 8) }); el.querySelector('button')?.focus(); }, [at, root]);
  useEffect(() => {
    const away = (e: Event) => { if (!menu.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); document.addEventListener('scroll', onClose, true); window.addEventListener('blur', onClose);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); document.removeEventListener('scroll', onClose, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  return createPortal(<div className="sgm" ref={menu} role="menu" style={{ left: spot.x, top: spot.y }}
    onKeyDown={e => { const all = [...(menu.current?.querySelectorAll('button') || [])]; const i = all.indexOf(document.activeElement as HTMLButtonElement); if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); } }}>
    {items.map(item => <button key={item.label} type="button" role="menuitem" onClick={() => { onClose(); item.run(); }}>{item.label}</button>)}
  </div>, root);
}

/** Scroll one card into place inside the list ONLY. `scrollIntoView` also scrolls every scrollable ancestor,
    which pushed the whole page up and left the prompt box floating above the bottom edge. */
function bring(list: HTMLElement, card: HTMLElement, block: 'center' | 'end', smooth = false) {
  const top = card.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  list.scrollTo({ top: block === 'end' ? top + card.offsetHeight - list.clientHeight : top - (list.clientHeight - card.offsetHeight) / 2, behavior: smooth ? 'smooth' : 'auto' });
}
type View = 'feed' | 'theater' | 'grid' | 'stage';
const asView = (value: unknown, type?: GenerationType): View => value === 'theater' || value === 'grid' || (value === 'stage' && type === '3d') ? value as View : 'feed';
const clampRow = (value: number) => Math.min(440, Math.max(110, Math.round(value) || 220));

const NO_OPTIONS: FeedOptions = {};
export function StudioGenerationFeed({ type, modelNames, activeId, reloadKey, onOpen, onUsePrompt, references, onAddReference, options = NO_OPTIONS }: { type: GenerationType; modelNames: Record<string, string>; activeId: string | null; reloadKey: number; onOpen: (id: string, replace?: boolean) => void; onUsePrompt: (prompt: string) => void; references: { max: number; used: number; modes?: string[] }; onAddReference: (assetId: string, name: string, role: string) => void; options?: FeedOptions }) {
  const [records, setRecords] = useState<Generation[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // SHELF: `library` is everything of this type in the gallery; `favorites` only what was starred. It lives in
  // the address (…/image/library, …/image/favorites), so refresh, Back and a shared link land on it.
  const readShelf = () => { const s = new URLSearchParams(window.location.search).get('shelf'); return s === 'library' || s === 'favorites' ? s : null; };
  const [shelf, setShelf] = useState<'library' | 'favorites' | null>(readShelf);
  useEffect(() => { const on = () => setShelf(readShelf()); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  const onlyFavorites = shelf === 'favorites';
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement | null>(null);
  const seen = useRef('');
  // Two views of one feed. Feed: every card at reading size. Theater: one result large just above the
  // box, the earlier ones waiting above it, and the scroll snaps from one to the next.
  const [view, setView] = useState<View>(() => { try { return asView(localStorage.getItem('xeno_studio_view_' + type) ?? localStorage.getItem('xeno_studio_view'), type); } catch { return 'feed'; } });
  // Grid tile height. Changed from the header's size control, or with Ctrl and the wheel over the grid.
  const [row, setRow] = useState(() => { try { return clampRow(Number(localStorage.getItem('xeno_studio_grid')) || 220); } catch { return 220; } });
  const base = useRef<View>(view === 'theater' || view === 'stage' ? 'feed' : view); // where Theater returns to
  const [focusId, setFocusId] = useState<string | null>(null);
  // The switch itself is in the workspace's top bar; both sides keep each other in step by message.
  const choose = (next: View, tell = true) => { seen.current = ''; if (next !== 'theater' && next !== 'stage') base.current = next; setView(next); try { localStorage.setItem(next === 'stage' ? 'xeno_studio_view_3d' : 'xeno_studio_view', next); if (type === '3d' && next !== 'stage') localStorage.removeItem('xeno_studio_view_3d'); } catch { /* a private window still switches */ } if (tell && window.parent !== window) window.parent.postMessage({ source: 'xeno-chat', type: 'generation-view', view: next }, window.location.origin); };
  const chooseRef = useRef(choose); chooseRef.current = choose;
  useEffect(() => { if (shelf) chooseRef.current('grid'); }, [shelf]); // a shelf is looked through, so it opens as the grid
  useEffect(() => {
    const onMessage = (e: MessageEvent) => { if (e.origin === window.location.origin && e.source === window.parent && e.data?.source === 'xeno-workspace' && e.data.type === 'generation-view') chooseRef.current(asView(e.data.view, type), false); else if (e.origin === window.location.origin && e.source === window.parent && e.data?.source === 'xeno-workspace' && e.data.type === 'area') setReload(n => n + 1); /* another area: its own history */ else if (e.origin === window.location.origin && e.source === window.parent && e.data?.source === 'xeno-workspace' && e.data.type === 'generation-grid-size') setRow(clampRow(Number(e.data.size))); };
    window.addEventListener('message', onMessage); return () => window.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const list = options.load ? await options.load(controller.signal) : await generations.list(onlyFavorites ? { type, favorite: 'true' } : { type }, controller.signal);
        if (controller.signal.aborted) return;
        setRecords(list); setError('');
        // Poll only while something is still moving; a finished feed costs nothing.
        if (list.some(g => !isGenerationTerminal(g.state))) timer = setTimeout(load, 2500);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Your generations could not be loaded.'); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [type, reload, reloadKey, onlyFavorites]);
  const moving = !!records?.some(g => !isGenerationTerminal(g.state));
  useEffect(() => { if (!moving) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [moving]);
  // Land on the addressed generation, otherwise on the newest (bottom), once per address or new record.
  // also when the addressed result finishes: a one-line card becomes a full one, and must be brought back into view
  const key = `${view}|${activeId || ''}|${records?.[0]?.id || ''}|${records?.find(g => g.id === activeId)?.state === 'succeeded' ? 'made' : ''}`;
  useLayoutEffect(() => {
    const el = scroller.current; if (!el || !records || seen.current === key) return; seen.current = key;
    const target = activeId ? el.querySelector<HTMLElement>(`[data-generation-card="${CSS.escape(activeId)}"]`) : null;
    el.style.scrollBehavior = 'auto';
    if (target) bring(el, target, view === 'theater' ? 'end' : 'center'); else el.scrollTop = view === 'grid' ? 0 : el.scrollHeight;
    el.style.scrollBehavior = '';
  }, [key, records, activeId, view]);
  // Theater motion is driven by the scroll position itself, so it tracks the finger or the wheel exactly:
  // each card reads how far its lower edge is from the resting line and scales and dims by that distance.
  useEffect(() => {
    const el = scroller.current; if (!el || view !== 'theater' || !records?.length) return;
    let frame = 0, settle: ReturnType<typeof setTimeout>, last = '';
    const measure = () => {
      frame = 0;
      const line = el.getBoundingClientRect().bottom; let best: HTMLElement | null = null, least = Infinity;
      for (const card of el.querySelectorAll<HTMLElement>('[data-generation-card]')) {
        const box = card.getBoundingClientRect(); const away = Math.abs(box.bottom - line) / Math.max(1, box.height);
        card.style.setProperty('--away', String(Math.min(1, away)));
        if (away < least) { least = away; best = card; }
      }
      const id = best?.dataset.generationCard || '';
      for (const card of el.querySelectorAll<HTMLElement>('[data-generation-card]')) {
        const on = card === best; card.toggleAttribute('data-focus', on);
        const video = card.querySelector('video'); if (video) { if (on) void video.play().catch(() => {}); else video.pause(); }
      }
      if (id && id !== last) { last = id; setFocusId(id); clearTimeout(settle); settle = setTimeout(() => onOpenRef.current(id, true), 350); }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure(); el.addEventListener('scroll', onScroll, { passive: true }); const resize = new ResizeObserver(onScroll); resize.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); resize.disconnect(); cancelAnimationFrame(frame); clearTimeout(settle); for (const card of el.querySelectorAll<HTMLElement>('[data-generation-card]')) { card.style.removeProperty('--away'); card.removeAttribute('data-focus'); card.querySelector('video')?.pause(); } };
  }, [view, records]);
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const listed = !!records?.length;
  // --- dragging a result onto the box ---
  const [held, setHeld] = useState<Held | null>(null);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState<{ held: Held; at: { x: number; y: number } } | null>(null);
  const dragApi = useRef({ hold: (value: Held | null) => setHeld(value), menu: (value: Held, at: { x: number; y: number }) => setMenu({ held: value, at }) }).current;
  useEffect(() => { const dock = scroller.current?.closest<HTMLElement>('.sgf-dock') ?? null; setDockEl(dock); if (!dock) return; if (held) dock.dataset.dropping = ''; else delete dock.dataset.dropping; return () => { delete dock.dataset.dropping; }; }, [held, view, listed]);
  const send = (from: Held, to: StudioHandoff['to'], role: string) => {
    try { sessionStorage.setItem(HANDOFF, JSON.stringify({ to, generationId: from.record.id, assetId: from.assetId, prompt: from.record.request.prompt, role } satisfies StudioHandoff)); } catch { /* the page still opens */ }
    from.lift?.mark?.();
    const carry = from.lift ? { x: from.lift.x, y: from.lift.y, w: from.lift.w, h: from.lift.h, src: from.lift.src, kind: from.lift.kind, box: from.lift.box } : undefined;
    if (window.parent !== window) window.parent.postMessage({ source: 'xeno-chat', type: 'generation-open', generationType: to, carry }, window.location.origin);
  };
  // The boxes are only the attachments the CHOSEN MODEL takes: one per kind it names, or a single Reference.
  // When it takes none, or the held result cannot be one, a single box says so and accepts nothing.
  const roles = references.modes?.length ? references.modes : ['reference'];
  const targets: Target[] = !held ? []
    : held.record.type !== 'image' ? [{ id: 'none', label: 'Only an image can be attached' }]
    : references.max <= 0 ? [{ id: 'none', label: 'This model takes no attachment' }]
    : references.used >= references.max ? [{ id: 'none', label: `This model takes ${references.max} at most` }]
    : roles.map(role => ({ id: role, label: roleLabel(role), run: () => { onAddReference(held.assetId, held.record.request.prompt, roleLabel(role)); setHeld(null); } }));
  // A result sent here from another page arrives as an attachment on the box.
  useEffect(() => { if (options.plain) return; const sent = takeHandoff(type); if (!sent) return; onAddReference(sent.assetId, sent.prompt, roleLabel(sent.role)); reportLanding(() => document.querySelector('[data-chat-composer-shell] img')); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);
  const dropDeck = held && dockEl ? <DropDeck targets={targets} dock={dockEl} /> : null;
  const menuRoot = scroller.current?.closest<HTMLElement>('.chat-themed') ?? null;
  const menuItems: MenuItem[] = !menu ? [] : [
    ...(menu.held.record.type === 'image' && type !== 'video' ? [{ label: 'Animate', run: () => send(menu.held, 'video', 'start_frame') }] : []),
    ...(menu.held.record.type === 'image' && type !== '3d' ? [{ label: 'Make 3D', run: () => send(menu.held, '3d', 'reference') }] : []),
    { label: 'Enhance', run: () => send(menu.held, `enhance-${menu.held.record.type}`, 'source') },
    { label: 'Use prompt', run: () => onUsePrompt(menu.held.record.request.prompt) },
    { label: 'Copy prompt', run: () => void navigator.clipboard.writeText(menu.held.record.request.prompt).catch(() => {}) },
    { label: 'Copy link', run: () => void navigator.clipboard.writeText(window.location.origin + generationPath(menu.held.record.type, menu.held.record.id)).catch(() => {}) },
    { label: menu.held.record.favorite ? 'Remove from favorites' : 'Add to favorites', run: () => void generations.favorite(menu.held.record.id, !menu.held.record.favorite).then(() => setReload(n => n + 1), () => {}) },
    { label: 'Remove', run: () => void (async () => { if (await confirmAction({ title: 'Remove from your history', detail: 'It leaves this page. The result files stay in your Library, and nothing is refunded or charged.', destructive: true })) { await generations.remove(menu.held.record.id).catch(() => {}); setReload(n => n + 1); } })() },
  ];
  const resultMenu = menu && menuRoot ? <ResultMenu at={menu.at} items={menuItems} root={menuRoot} onClose={() => setMenu(null)} /> : null;
  // Audio: one player for the page. It stops when the page is left, and the box learns that it has a strip on top.
  const playing = useDeck();
  useEffect(() => () => { if (type === 'audio') stopDeck(); }, [type]);
  useEffect(() => { const dock = scroller.current?.closest<HTMLElement>('.sgf-dock'); if (!dock) return; if (type === 'audio' && playing.id) dock.dataset.deck = ''; else delete dock.dataset.deck; return () => { delete dock.dataset.deck; }; }, [type, playing.id, view, listed]);
  const stepTrack = async (direction: number) => {
    const tracks = (records || []).filter(g => g.state === 'succeeded' && g.resultAssetIds[0]); const at = tracks.findIndex(g => g.id === playing.id);
    const next = tracks[at + direction]; if (!next) return;
    try { playTrack({ id: next.id, url: await libraryService.createSignedLink(next.resultAssetIds[0]), title: next.request.prompt }); onOpen(next.id, true); } catch { /* the current track keeps playing */ }
  };
  const deckBar = type === 'audio' ? <AudioDeck onStep={direction => void stepTrack(direction)} onShow={id => onOpen(id)} /> : null;
  const [stageRoot, setStageRoot] = useState<HTMLElement | null>(null);
  const [barHost, setBarHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setStageRoot(view === 'stage' ? scroller.current?.closest<HTMLElement>('.chat-themed') ?? document.body : null); }, [view, listed]);
  // The grid uses the whole pane; the box below it keeps its own width. The page element carries the view.
  useEffect(() => { const dock = scroller.current?.closest<HTMLElement>('.sgf-dock'); if (!dock) return; dock.dataset.view = view; return () => { delete dock.dataset.view; }; }, [view, listed]);
  useEffect(() => {
    const el = scroller.current; if (!el || view !== 'grid') return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
      setRow(now => { const next = clampRow(now * (e.deltaY > 0 ? 0.92 : 1.08)); try { localStorage.setItem('xeno_studio_grid', String(next)); } catch { /* still resizes */ } if (window.parent !== window) window.parent.postMessage({ source: 'xeno-chat', type: 'generation-grid-size', size: next }, window.location.origin); return next; });
    };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, [view, listed]);
  // Keys, in both views: Up and Down travel from one result to the next, Enter switches between Feed and
  // Theater on the current one. They work as soon as the page opens, including while the empty prompt box
  // has the caret; once there is text in the box, the keys belong to the text.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const el = scroller.current;
    if (!el || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const sideways = view === 'grid' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== 'Escape' && !sideways) return;
    const target = e.target as HTMLElement | null;
    const emptyPrompt = target instanceof HTMLTextAreaElement && target.value === '' && !!target.closest('[data-chat-composer-shell]');
    if (target && target !== document.body && target !== el && !emptyPrompt) return;
    const cards = [...el.querySelectorAll<HTMLElement>('[data-generation-card]')]; if (!cards.length) return;
    const theater = view === 'theater';
    let at = cards.findIndex(c => theater ? c.hasAttribute('data-focus') : c.dataset.generationCard === activeId);
    if (e.key === 'Escape') { if (theater) { e.preventDefault(); choose(base.current); } return; }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation(); if (at < 0) at = cards.length - 1;
      const id = cards[at].dataset.generationCard!; onOpen(id, true); choose(theater ? base.current : 'theater'); return;
    }
    e.preventDefault(); e.stopPropagation();
    const next = cards[at < 0 ? cards.length - 1 : Math.min(cards.length - 1, Math.max(0, at + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1)))];
    if (theater) { bring(el, next, 'end', true); return; }
    const id = next.dataset.generationCard!;
    seen.current = `${view}|${id}|${records?.[0]?.id || ''}`; // this move scrolls itself, smoothly
    onOpen(id, true); bring(el, next, 'center', true);
  };
  useEffect(() => { const onKey = (e: KeyboardEvent) => keys.current(e); // Capture: the prompt box handles Enter itself and would swallow it before it reached the page.
  document.addEventListener('keydown', onKey, true); return () => document.removeEventListener('keydown', onKey, true); }, []);
  if (error) return <div className="sgf-empty" role="alert"><p>{error}</p><button type="button" className="sgf-btn" onClick={() => setReload(n => n + 1)}>Load again</button></div>;
  if (!records) return <div className="sgf-empty" role="status"><MarkLoader size={72} label={`Loading your ${TYPE_NOUN[type]}s`} /></div>;
  if (!records.length && onlyFavorites) return <div className="sgf-empty"><h2>No favorites yet</h2><p>Mark a result with the star and it is kept here.</p></div>;
  if (!records.length) return <div className="sgf-empty"><h2>{options.empty?.title ?? 'Nothing made yet'}</h2><p>{options.empty?.text ?? `Describe the ${TYPE_NOUN[type]} you want below. It will appear here, and stay here.`}</p></div>;
  const ordered = [...records].reverse();
  const theater = view === 'theater';
  // Stage: the scene is mounted on the themed page root so it fills the pane behind the box. The hidden
  // element keeps this component's place in the column, which is how the page learns the view.
  if (view === 'stage') return <>
    <div className="sgf sms-barhost" ref={node => { scroller.current = node; setBarHost(node); }} data-view="stage" />
    {stageRoot && createPortal(<Suspense fallback={<div className="sms" role="status"><MarkLoader size={88} label="Opening the stage" /></div>}><StudioModelStage records={records} activeId={activeId} modelNames={modelNames} onOpen={onOpen} onExit={() => choose(base.current)} barHost={barHost} /></Suspense>, stageRoot)}
  </>;
  if (view === 'grid') return <Options.Provider value={options}><Drag.Provider value={dragApi}><div className="sgf" ref={scroller} data-view="grid" data-holding={held ? '' : undefined} tabIndex={0} style={{ ['--row' as string]: row + 'px' }} aria-label="Results as a grid. Arrow keys move between them, Enter opens one in Theater.">
    <div className="sgg">
      {records.map(record => (record.state === 'succeeded' && record.resultAssetIds.length ? record.resultAssetIds : [undefined]).map((assetId, i) => <GridTile key={record.id + ':' + i} record={record} assetId={assetId} first={i === 0} active={record.id === activeId} modelName={modelNames[record.request.model] || record.request.model} now={now} onPick={id => { onOpen(id); choose('theater'); }} />))}
      <i className="sgg-fill" aria-hidden="true" />
    </div>
  </div>{deckBar}{dropDeck}{resultMenu}</Drag.Provider></Options.Provider>;
  return <Options.Provider value={options}><Drag.Provider value={dragApi}>
    <div className="sgf" ref={scroller} data-view={view} data-holding={held ? '' : undefined} tabIndex={0} aria-label="Results. Up and Down move between them, Enter switches between Feed and Theater.">
      <div className="sgf-list">{ordered.map((record, i) => <Card key={record.id} record={record} modelName={modelNames[record.request.model] || record.request.model} now={now} active={theater ? record.id === focusId : record.id === activeId} index={Math.min(6, ordered.length - 1 - i)} onOpen={onOpen} onChanged={() => setReload(n => n + 1)} onUsePrompt={onUsePrompt} onExpand={theater ? undefined : id => { onOpen(id); choose('theater'); }} />)}</div>
    </div>
    {deckBar}{dropDeck}{resultMenu}
  </Drag.Provider></Options.Provider>;
}
