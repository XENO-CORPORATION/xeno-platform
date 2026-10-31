import React, { useEffect, useRef, useState } from 'react';
import { generations, generationPath, generationAuthHeaders, isGenerationTerminal, type Generation, type GenerationQuote, type GenerationRequest, type GenerationCatalog } from '@/lib/generations';
import LibraryAssetImage from '@/components/library/LibraryAssetImage';
import './chatQuestion.css';
import { libraryService } from '@/services/libraryService';
/** Native playback only after the authorized asset reports a playable MIME. */
function GenerationMedia({assetId, type}:{assetId:string;type:string}) {
  const [media,setMedia]=useState<{url:string;mime:string}|null>(null);
  const [error,setError]=useState('');
  const [pending,setPending]=useState(true);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    setPending(true);setMedia(null);setError('');
    const load=async()=>{try {
      const response=await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/content`,{method:'HEAD',credentials:'same-origin',headers:generationAuthHeaders(),signal:controller.signal});
      if(response.status===423){setPending(true);timer=setTimeout(load,2000);return;}
      if(!response.ok)throw new Error(`Result unavailable (${response.status})`);
      const mime=(response.headers.get('content-type')||'').split(';')[0];
      const url=await libraryService.createSignedLink(assetId);
      if(controller.signal.aborted)return;
      setMedia({url,mime});setPending(false);
    }catch(e){if(!controller.signal.aborted){setPending(false);setError(e instanceof Error?e.message:'Result unavailable');}}};
    void load();return()=>{controller.abort();clearTimeout(timer);};
  },[assetId,reload]);
  if(pending)return <p role="status">Checking result scan and playback…</p>;
  if(error)return <p role="alert">{error} <button type="button" className="chat-q-btn" onClick={()=>setReload(n=>n+1)}>Reload result</button></p>;
  if(!media)return null;
  return <>{type==='video' && media.mime.startsWith('video/') ? <video controls preload="metadata" src={media.url} aria-label="Generated video" className="max-w-full"/> : type==='audio' && media.mime.startsWith('audio/') ? <audio controls preload="metadata" src={media.url} aria-label="Generated audio"/> : null}<a href={media.url} target="_blank" rel="noopener noreferrer">Open {type} result</a></>;
}
const say = (value: string) => { const text = String(value).replace(/_/g, ' '); return /^[a-z]/.test(text) ? text[0].toUpperCase() + text.slice(1) : text; };
const TYPE_LABEL: Record<string, string> = { image: 'Image', video: 'Video', audio: 'Audio', '3d': '3D' };
/** What a failure code means to the person. An unknown code is shown as it is rather than hidden. */
export const GENERATION_FAILURE: Record<string, string> = {
  provider_failed: 'The model service could not make this. Nothing was charged.',
  gateway_refused: 'The model service refused this request. Nothing was charged.',
  INSUFFICIENT_CREDITS: 'Not enough credits for this generation.',
  USAGE_CREDITS_DISABLED: 'Usage credits are turned off for this account.',
  plan_watermark_unsupported: 'This type is not available on the Free plan.',
  reference_not_ready: 'A reference image is still being checked. Try again in a moment.',
  reference_forbidden: 'A reference image is no longer available to you.',
  generation_admission_refused: 'This request could not be started. Nothing was charged.',
};
/** The setting keys read as words in a chip: `9:16`, `High`, `2 images`. */
const SETTING_LABEL: Record<string, string> = { ratio: 'Ratio', quality: 'Quality', n: 'Count', mode: 'Mode', resolution: 'Resolution' };
/** Settings a person may change on a proposal before approving it. `mode` stays the agent's: it is tied to the references. */
const EDITABLE = new Set(['ratio', 'quality', 'resolution']);
/** The model's own name, as the catalogue writes it, rather than the raw id. */
const modelLabel = (id: string) => String(id).split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const creditWord = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;
const sameSettings = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// One catalogue read per page: which values each model accepts for each setting (the server validates the same list).
let catalogOnce: Promise<GenerationCatalog> | null = null;
const catalog = () => (catalogOnce ??= generations.catalog().catch((e) => { catalogOnce = null; throw e; }));
function useModelSettings(model: string | undefined) {
  const [values, setValues] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!model) return; let live = true;
    catalog().then((c) => { const m = c.types.flatMap((t) => t.models).find((x) => x.id === model); if (live && m) setValues(Object.fromEntries(Object.entries(m.settings).map(([k, v]) => [k, v.values]))); }, () => {});
    return () => { live = false; };
  }, [model]);
  return values;
}

/** What each option looks like before it is chosen: a frame at the real proportion, or bars up to the level. */
const QUALITY_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3 };
function OptionPreview({ kind, value }: { kind: string; value: string }) {
  if (kind === 'ratio' && /^\d+:\d+$/.test(value)) {
    const [w, h] = value.split(':').map(Number), k = 12 / Math.max(w, h);
    return <span className="chat-q-gen-frame" aria-hidden="true"><i style={{ width: Math.round(w * k), height: Math.round(h * k) }} /></span>;
  }
  if (kind === 'quality') { const n = QUALITY_LEVEL[value] || 0; return <span className="chat-q-gen-bars" aria-hidden="true">{[1, 2, 3].map((l) => <i key={l} data-on={l <= n || undefined} />)}</span>; }
  return null;
}

/** A setting as a chip that opens into its options: a column of small plates under it, chosen with mouse or arrows. */
function SettingPick({ kind, value, options, disabled, onChange }: { kind: string; value: string; options: string[]; disabled: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    requestAnimationFrame(() => (box.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? box.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus({ preventScroll: true }));
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const label = SETTING_LABEL[kind] || say(kind);
  const shown = kind === 'n' ? value : say(value);
  if (disabled || options.length < 2) return <span className="chat-q-gen-chip">{label} <b>{shown}</b></span>;
  const keys = (e: React.KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); chip.current?.focus(); }
  };
  return <div className="chat-q-gen-pick" ref={box} data-open={open || undefined}>
    <button ref={chip} type="button" className="chat-q-gen-chip" data-pick aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      {label} <b>{shown}</b><svg className="chat-q-gen-caret" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M1.5 3 4 5.5 6.5 3" /></svg>
    </button>
    {open && <div className="chat-q-gen-menu" role="listbox" aria-label={label} onKeyDown={keys}>
      {options.map((o, i) => <button key={o} type="button" role="option" aria-selected={o === value} className="chat-q-gen-opt" style={{ ['--i' as string]: i }} onClick={() => { onChange(o); setOpen(false); chip.current?.focus(); }}>
        <OptionPreview kind={kind} value={o} /><span>{kind === 'n' ? o : say(o)}</span>
        <svg className="chat-q-gen-tick" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M1.5 5.2 4 7.5l4.5-5" /></svg>
      </button>)}
    </div>}
  </div>;
}

/**
 * An image (or video) the model prepared and the person has not agreed to yet, and the record of one that ran.
 *
 * The cost is quoted on open, not behind a button: the person asked for the image, so the only question left is yes
 * or no. Before saying yes they may change its settings (ratio, quality — from the model's own catalogue); the price is
 * quoted again for exactly those settings, and approving runs THEIR version as a new generation while the agent's
 * proposal stays as it was and points at it (`replacedBy`), which this card then follows.
 */
export function GenerationRecord({ id }: { id: string }) {
  const [current, setCurrent] = useState(id);
  const [record, setRecord] = useState<Generation | null>(null);
  const [quote, setQuote] = useState<GenerationQuote | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [whole, setWhole] = useState(false);
  useEffect(() => { setCurrent(id); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setRecord(null); setQuote(null); setDraft(null);
    const load = async () => {
      try {
        const value = await generations.get(current, controller.signal); if (controller.signal.aborted) return;
        if (value.replacedBy) { setCurrent(value.replacedBy); return; }   // the person approved their own version of it
        setRecord(value); setError(''); if (!isGenerationTerminal(value.state)) timer = setTimeout(load, 2500);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Status unavailable'); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [current, reload]);
  const settings = draft ?? record?.request.settings ?? {};
  const waiting = record?.state === 'awaiting_approval';
  // The price of exactly what will run: the proposal, or the person's settings. A quote expires, so a stale one is
  // fetched again rather than kept; the server re-checks the token against the request when it is approved.
  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (!record || !waiting) return;
    let live = true; setQuote(null);
    const { requestKey: _k, ...request } = record.request as GenerationRequest & { requestKey?: string };
    generations.quote({ ...request, settings })
      .then((next) => { if (live) setQuote(next); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'This request cannot be priced right now.'); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, waiting, settingsKey]);
  const values = useModelSettings(record?.request.model);
  /**
   * One action at a time. A refused approval clears the quote rather than retrying it here: the effect above
   * re-quotes the current request, so an expired price heals itself and a request that genuinely cannot be
   * priced says so once rather than looping.
   */
  const act = async (action: 'quote' | 'approve' | 'cancel') => {
    if (!record || busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'quote') { const { requestKey: _k, ...request } = record.request as GenerationRequest & { requestKey?: string }; setQuote(await generations.quote({ ...request, settings })); }
      else if (action === 'approve' && quote) {
        const changed = draft && !sameSettings(draft, record.request.settings || {});
        const next = await generations.approve(record, quote, changed ? draft! : undefined);
        setQuote(null); setDraft(null);
        if (next.id !== record.id) setCurrent(next.id); else { setRecord(next); setReload(n => n + 1); }
      }
      else if (action === 'cancel') { setRecord(await generations.cancel(current)); setQuote(null); setReload(n => n + 1); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request refused');
      if (action === 'approve') { setQuote(null); setReload(n => n + 1); }
    } finally { setBusy(false); }
  };
  if (!record) return <section className="chat-q chat-q-gen" data-generation-id={current} aria-live="polite"><p className="chat-q-gen-loading">Loading the request…</p>{error && <p role="alert">{error} <button type="button" className="chat-q-btn" data-variant="ghost" onClick={() => setReload(n => n + 1)}>Reload status</button></p>}</section>;
  const references = record.request.referenceAssetIds || [];
  const quoteReady = !!quote && Date.parse(quote.expiresAt) > Date.now();
  const live = !isGenerationTerminal(record.state);
  const entries = Object.entries(settings);
  const note = waiting ? 'Nothing has been generated or charged yet.' : record.state === 'cancelled' && !record.resultAssetIds.length ? 'Cancelled. Nothing was generated or charged.' : '';
  return <div className="chat-q-gen-wrap" data-generation-id={record.id} data-state={record.state}>
    <section className="chat-q chat-q-gen" data-generation-id={record.id} data-state={record.state} aria-live="polite">
      <header className="chat-q-gen-head">
        <i className="chat-q-gen-mark" data-live={live || undefined} aria-hidden="true" />
        <a className="chat-q-gen-title" href={generationPath(record.type, record.id)} target="_top">{TYPE_LABEL[record.type] || record.type}</a>
        <small className="chat-q-gen-model">{modelLabel(record.request.model)}</small>
        <span className="chat-q-gen-state" data-live={live || undefined} data-terminal={isGenerationTerminal(record.state) || undefined}>{say(record.state)}</span>
      </header>

      {references.length > 0 && <div className="chat-q-gen-refs" aria-label={`${references.length} reference ${references.length === 1 ? 'image' : 'images'}`}>
        {references.map(assetId => <LibraryAssetImage key={'reference:'+assetId} asset={{assetId,name:'Reference',mimeType:'image/*',contentUrl:''}} alt="Reference for this generation" />)}
      </div>}

      <div className="chat-q-gen-prompt">
        <button type="button" data-open={whole || undefined} aria-expanded={whole} title={whole ? 'Show less' : 'Show the whole prompt'} onClick={() => setWhole(v => !v)}>{record.request.prompt}</button>
      </div>

      {record.state !== 'awaiting_approval' && record.error && <p className="chat-q-gen-error" role="alert">{GENERATION_FAILURE[record.error.code || ''] || record.error.message || record.error.code}</p>}

      {record.resultAssetIds.length > 0 && <div className="chat-q-gen-results">
        {record.resultAssetIds.map(assetId => record.type === 'image' ? <LibraryAssetImage key={assetId} asset={{assetId,name:record.request.prompt,mimeType:'image/*',contentUrl:''}} alt={record.request.prompt} /> : <GenerationMedia key={assetId} assetId={assetId} type={record.type}/>)}
      </div>}
    </section>

    {/* under the card: its settings (changeable while it waits), what has happened so far, and the decision */}
    <div className="chat-q-gen-foot">
      <div className="chat-q-gen-settings">
        {entries.map(([key, value]) => <SettingPick key={key} kind={key} value={String(value)} options={waiting && EDITABLE.has(key) ? (values[key] || []) : []} disabled={!waiting || busy} onChange={(v) => setDraft({ ...settings, [key]: v })} />)}
      </div>
      {note && <p className="chat-q-gen-note">{note}</p>}
      <div className="chat-q-gen-actions">
        {waiting && !quoteReady && !busy && error && <button className="chat-q-gen-text" type="button" onClick={() => void act('quote')}>Price it again</button>}
        {(waiting || live) && <button className="chat-q-gen-text" type="button" disabled={busy} onClick={() => void act('cancel')}>Cancel</button>}
        {waiting && <button className="chat-q-gen-go" type="button" disabled={busy || !quoteReady} onClick={() => void act('approve')}>{busy ? 'Starting…' : quoteReady ? `Generate · up to ${creditWord(quote!.maxRetailCredits)}` : 'Pricing…'}</button>}
      </div>
    </div>
    {error && <p className="chat-q-gen-error" role="alert">{error}{!waiting && <> <button type="button" className="chat-q-gen-text" onClick={() => setReload(n => n + 1)}>Reload status</button></>}</p>}
  </div>;
}
