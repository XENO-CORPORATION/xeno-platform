import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import { generationAuthHeaders, generations, type Generation, type GenerationType } from '@/lib/generations';
import { StudioGenerationFeed, reportLanding, takeHandoff, useResultMedia, type FeedOptions } from './StudioGenerationFeed';
import { Wave } from './StudioAudio';
import './studioFeed.css';

/** Studio › Enhance › <type> (its own section, beside Generate). It is the SAME feed as the Generate pages
    (Feed, Theater, Grid, the same cards, keys and addresses), fed with enhancements instead of generations,
    and each result carries its before and after. Under it sits the same kind of box; here the box holds the
    results you can enhance. The source is never replaced: an enhancement is a new result linked to it.
    The server contract this page speaks (`/api/enhancements`) is NOT built yet. Until it answers, every
    operation is shown as not available and nothing can be started. */
type Operation = { id: string; type: GenerationType; name: string; blurb?: string; options?: Record<string, { values: string[]; default?: string }>; maxRetailCredits?: number };
type Enhancement = { id: string; type?: GenerationType; state: string; operation: string; options: Record<string, string>; sourceGenerationId: string; sourceAssetId: string; resultAssetId: string | null; createdAt?: string; error?: { code?: string; message?: string } | null };
const TYPE_NAME: Record<GenerationType, string> = { image: 'Image', video: 'Video', audio: 'Audio', '3d': '3D' };
const NOUN: Record<GenerationType, string> = { image: 'an image', video: 'a video', audio: 'a sound', '3d': 'a 3D model' };
/** What each type can be asked for. Shown even before the server offers them, so the page says what is coming. */
const PLANNED: Operation[] = [
  { id: 'upscale', type: 'image', name: 'Upscale' }, { id: 'restore', type: 'image', name: 'Restore' }, { id: 'remove-background', type: 'image', name: 'Remove background' },
  { id: 'upscale', type: 'video', name: 'Upscale' }, { id: 'smooth', type: 'video', name: 'Smoother motion' }, { id: 'stabilise', type: 'video', name: 'Stabilise' },
  { id: 'denoise', type: 'audio', name: 'Remove noise' }, { id: 'separate', type: 'audio', name: 'Separate stems' }, { id: 'level', type: 'audio', name: 'Level loudness' },
  { id: 'retopologise', type: '3d', name: 'Retopologise' }, { id: 'reduce', type: '3d', name: 'Reduce polygons' }, { id: 'textures', type: '3d', name: 'Sharper textures' },
];
async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/enhancements' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { ...generationAuthHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error?.message || data?.message || (response.status === 404 ? 'not_built' : 'The enhance service did not answer.'));
  return data as T;
}

function Thumb({ record, active, onPick }: { record: Generation; active: boolean; onPick: () => void }) {
  const { media } = useResultMedia(record.resultAssetIds[0]);
  return <button type="button" className="sge-thumb" aria-pressed={active} title={record.request.prompt} onClick={onPick}>
    {media && media.mime.startsWith('image/') ? <img src={media.url} alt="" loading="lazy" /> : media && media.mime.startsWith('video/') ? <video src={media.url} muted preload="metadata" /> : media && media.mime.startsWith('audio/') ? <Wave url={media.url} progress={0} /> : <b>{TYPE_NAME[record.type]}</b>}
  </button>;
}

export function StudioEnhance({ kind, activeId, onOpen }: { kind: GenerationType; activeId: string | null; onOpen: (id: string, replace?: boolean) => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [sources, setSources] = useState<Generation[] | null>(null);
  const [offered, setOffered] = useState<Operation[] | null>(null); // null = the service is not built or did not answer
  const sent = useRef(takeHandoff('enhance-' + kind)).current; // a result sent here from another page
  const [sourceId, setSourceId] = useState<string | null>(() => sent?.generationId ?? null);
  const [operationId, setOperationId] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [made, setMade] = useState(0); // a new enhancement was started: the feed reads again
  const before = useRef(new Map<string, string>()); // enhancement id -> the asset it was made from
  useEffect(() => { setRoot(anchor.current?.closest<HTMLElement>('.chat-themed') ?? document.body); }, []);
  useEffect(() => {
    const controller = new AbortController();
    generations.list({ type: kind }, controller.signal).then(list => { if (!controller.signal.aborted) setSources(list.filter(g => g.state === 'succeeded' && g.resultAssetIds[0])); }, () => { if (!controller.signal.aborted) setSources([]); });
    call<{ operations: Operation[] }>('/catalog', undefined, controller.signal).then(d => { if (!controller.signal.aborted) setOffered(d.operations); }, () => { if (!controller.signal.aborted) setOffered(null); });
    return () => controller.abort();
  }, [kind]);
  // A result sent here lands on its place in the box.
  useEffect(() => { if (sent) reportLanding(() => document.querySelector('.sge-thumb[aria-pressed="true"]')); }, [sent]);
  const source = sources?.find(g => g.id === sourceId) ?? null;
  useEffect(() => { if (!sourceId && sources?.length) setSourceId(sources[0].id); }, [sources, sourceId]);
  const choices = useMemo(() => {
    const live = (offered || []).filter(o => o.type === kind);
    const planned = PLANNED.filter(o => o.type === kind && !live.some(l => l.id === o.id));
    return [...live.map(o => ({ ...o, ready: true })), ...planned.map(o => ({ ...o, ready: false }))];
  }, [kind, offered]);
  const operation = choices.find(o => o.id === operationId) ?? choices[0] ?? null;
  useEffect(() => { if (operation && operation.id !== operationId) setOperationId(operation.id); }, [operation, operationId]);
  const valueOf = (key: string) => options[`${operation?.id}:${key}`] ?? operation?.options?.[key].default ?? operation?.options?.[key].values[0] ?? '';
  const names = useMemo(() => Object.fromEntries(choices.map(o => [o.id, o.name])), [choices]);
  const sourcesRef = useRef(sources); sourcesRef.current = sources;
  // The feed's records: each enhancement, shaped like the results the feed already knows how to show.
  const load = useCallback(async (signal: AbortSignal): Promise<Generation[]> => {
    let list: Enhancement[] = [];
    try { list = (await call<{ enhancements: Enhancement[] }>('?type=' + encodeURIComponent(kind), undefined, signal)).enhancements; }
    catch (e) { if (e instanceof Error && e.message !== 'not_built') throw e; } // not built yet reads as an empty history
    return list.map(job => {
      before.current.set(job.id, job.sourceAssetId);
      const from = sourcesRef.current?.find(g => g.id === job.sourceGenerationId);
      return { id: job.id, type: kind, state: job.state, request: { type: kind, model: job.operation, prompt: from?.request.prompt || 'Enhanced result', settings: job.options || {}, referenceAssetIds: [] }, requestHash: '', version: 1, quote: { quoteToken: '', requestHash: '', tariffRevision: '', maxRetailCredits: 0, expiresAt: '' }, resultAssetIds: job.resultAssetId ? [job.resultAssetId] : [], error: job.error ?? null, createdAt: job.createdAt };
    });
  }, [kind]);
  const feed = useMemo<FeedOptions>(() => ({
    load, plain: true,
    compareWith: record => before.current.get(record.id),
    pathOf: record => `/workspace/studio/enhance/${kind}/e/${record.id}`,
    empty: { title: 'Nothing enhanced yet', text: `Pick ${NOUN[kind]} in the box below, choose what to do to it, and send. Each result keeps its before and after.` },
  }), [load, kind]);
  const start = async () => {
    if (!source || !operation?.ready || busy) return;
    setBusy(true); setNote('');
    try {
      const chosen = Object.fromEntries(Object.keys(operation.options || {}).map(key => [key, valueOf(key)]));
      const { enhancement } = await call<{ enhancement: Enhancement }>('', { type: kind, sourceGenerationId: source.id, sourceAssetId: source.resultAssetIds[0], operation: operation.id, options: chosen });
      setMade(n => n + 1); onOpen(enhancement.id);
    } catch (e) { setNote(e instanceof Error && e.message !== 'not_built' ? e.message : 'Enhance is not available yet.'); }
    finally { setBusy(false); }
  };
  const page = <div className="sge">
    <div className="sge-feed">
      {sources ? <StudioGenerationFeed type={kind} modelNames={names} activeId={activeId} reloadKey={made + sources.length} onOpen={onOpen} onUsePrompt={() => {}} references={{ max: 0, used: 0 }} onAddReference={() => {}} options={feed} /> : <div className="sgf-empty" role="status"><p>Loading</p></div>}
    </div>
    <div className="sge-console">
      {/* Built like the prompt box: one plate, and its controls in a row underneath. Here the plate holds your results. */}
      <div className="sge-box">{sources && sources.length > 0 ? <div className="sge-strip" aria-label={`Your ${TYPE_NAME[kind].toLowerCase()} results`}>{sources.slice(0, 40).map(g => <Thumb key={g.id} record={g} active={g.id === sourceId} onPick={() => { setSourceId(g.id); setNote(''); }} />)}</div> : <p className="sge-box-empty">{sources ? `Make ${NOUN[kind]} first. Every finished one can be enhanced here.` : 'Loading your results'}</p>}</div>
      <div className="sge-bar">
        <span className="sge-kind">{TYPE_NAME[kind]}</span>
        <div className="sge-ops" role="radiogroup" aria-label="What to do">
          {choices.map(o => <button key={o.id} type="button" role="radio" aria-checked={operation?.id === o.id} data-ready={o.ready || undefined} title={o.ready ? o.blurb : 'Not available yet'} onClick={() => { setOperationId(o.id); setNote(''); }}>{o.name}</button>)}
        </div>
        {operation?.ready && Object.entries(operation.options || {}).map(([key, option]) => <div key={key} className="sge-ops sge-opt" role="radiogroup" aria-label={key}>{option.values.map(v => <button key={v} type="button" role="radio" aria-checked={valueOf(key) === v} onClick={() => setOptions(now => ({ ...now, [`${operation.id}:${key}`]: v }))}>{v}</button>)}</div>)}
        <span className="sge-say" role="status">{note || (!operation ? '' : !operation.ready ? 'Not available yet' : operation.maxRetailCredits != null ? `${operation.maxRetailCredits} credits` : '')}</span>
        <button type="button" className="sge-go" disabled={!operation?.ready || busy || !source} aria-label={operation ? `${operation.name} the chosen ${TYPE_NAME[kind].toLowerCase()}` : 'Enhance'} onClick={() => void start()}><ArrowUp size={16} /></button>
      </div>
    </div>
  </div>;
  return <><span ref={anchor} hidden />{root && createPortal(page, root)}</>;
}
