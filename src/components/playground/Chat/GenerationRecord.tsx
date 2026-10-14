import React, { useEffect, useState } from 'react';
import { generations, generationPath, generationAuthHeaders, isGenerationTerminal, type Generation, type GenerationQuote } from '@/lib/generations';
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
/** The model's own name, as the catalogue writes it, rather than the raw id. */
const modelLabel = (id: string) => String(id).split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const creditWord = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;
/**
 * An image (or video) the model prepared and the person has not agreed to yet, and the record of one that ran.
 *
 * The cost is quoted on open, not behind a button: the person asked for the image, so the only question
 * left is yes or no, and a two-step "show me the cost, then let me agree" is a step with no decision in it.
 * A failed quote still leaves the request readable, and says why it cannot be priced.
 */
export function GenerationRecord({ id }: { id: string }) {
  const [record, setRecord] = useState<Generation | null>(null);
  const [quote, setQuote] = useState<GenerationQuote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setRecord(null); setQuote(null);
    const load = async () => {
      try { const value = await generations.get(id, controller.signal); if (controller.signal.aborted) return; setRecord(value); setError(''); if (!isGenerationTerminal(value.state)) timer = setTimeout(load, 2500); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Status unavailable'); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, reload]);
  // The price of what was asked for, fetched as soon as the proposal is on screen. A quote expires, so a
  // stale one is re-fetched rather than kept; the approve carries the token, so the server re-checks it anyway.
  useEffect(() => {
    if (!record || record.state !== 'awaiting_approval') return;
    let live = true;
    generations.quote(record.request)
      .then((next) => { if (live) setQuote(next.requestHash === record.requestHash ? next : null); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'This request cannot be priced right now.'); });
    return () => { live = false; };
  }, [record]);
  /**
   * One action at a time. A refused approval clears the quote rather than retrying it here: the effect above
   * re-quotes the current request, so an expired price heals itself and a request that genuinely cannot be
   * priced says so once rather than looping.
   */
  const act = async (action: 'quote' | 'approve' | 'cancel') => {
    if (!record || busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'quote') { const next = await generations.quote(record.request); setQuote(next.requestHash === record.requestHash ? next : null); if (next.requestHash !== record.requestHash) throw new Error('The request changed. Reload its status before approving.'); }
      else if (action === 'approve' && quote) { setRecord(await generations.approve(record, quote)); setQuote(null); setReload(n => n + 1); }
      else if (action === 'cancel') { setRecord(await generations.cancel(id)); setQuote(null); setReload(n => n + 1); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request refused');
      if (action === 'approve') { setQuote(null); setReload(n => n + 1); }
    } finally { setBusy(false); }
  };
  if (!record) return <section className="chat-q chat-q-gen" data-generation-id={id} aria-live="polite"><p className="chat-q-gen-loading">Loading the request…</p>{error && <p role="alert">{error} <button type="button" className="chat-q-btn" data-variant="ghost" onClick={() => setReload(n => n + 1)}>Reload status</button></p>}</section>;
  const settings = Object.entries(record.request.settings || {});
  const references = record.request.referenceAssetIds || [];
  const waiting = record.state === 'awaiting_approval';
  const quoteReady = !!quote && Date.parse(quote.expiresAt) > Date.now();
  return <section className="chat-q chat-q-gen" data-generation-id={id} data-state={record.state} aria-live="polite">
    <header className="chat-q-gen-head">
      <i className="chat-q-gen-mark" aria-hidden="true" />
      <div className="chat-q-gen-title">
        <a href={generationPath(record.type, id)} target="_top">{TYPE_LABEL[record.type] || record.type}</a>
        <small>{modelLabel(record.request.model)}</small>
      </div>
      <span className="chat-q-gen-state" data-terminal={isGenerationTerminal(record.state) || undefined}>{say(record.state)}</span>
    </header>

    {references.length > 0 && <div className="chat-q-gen-refs" aria-label={`${references.length} reference ${references.length === 1 ? 'image' : 'images'}`}>
      {references.map(assetId => <LibraryAssetImage key={'reference:'+assetId} asset={{assetId,name:'Reference',mimeType:'image/*',contentUrl:''}} alt="Reference for this generation" />)}
    </div>}

    <div className="chat-q-gen-prompt">
      <button type="button" data-open={whole || undefined} aria-expanded={whole} title={whole ? 'Show less' : 'Show the whole prompt'} onClick={() => setWhole(v => !v)}>{record.request.prompt}</button>
    </div>

    {settings.length > 0 && <div className="chat-q-gen-settings">
      {settings.map(([key, value]) => <span key={key}><i>{SETTING_LABEL[key] || say(key)}</i>{key === 'n' ? `${value} ${record.type}s` : say(String(value))}</span>)}
    </div>}

    {record.state === 'awaiting_approval' && <>
      <p className="chat-q-gen-note">Nothing has been generated or charged yet.</p>
      {error && <p className="chat-q-gen-error" role="alert">{error}</p>}
      <div className="chat-q-gen-actions">
        <button className="chat-q-btn" data-variant="primary" type="button" disabled={busy || !quoteReady} onClick={() => void act('approve')}>{busy ? 'Starting…' : 'Generate'}{quoteReady ? ` · up to ${creditWord(quote!.maxRetailCredits)}` : ''}</button>
        <button className="chat-q-btn" data-variant="ghost" type="button" disabled={busy} onClick={() => void act('cancel')}>Cancel</button>
        {!quoteReady && !busy && <button className="chat-q-btn" data-variant="ghost" type="button" onClick={() => void act('quote')}>Price it again</button>}
      </div>
    </>}

    {record.state !== 'awaiting_approval' && <>
      {record.error && <p className="chat-q-gen-error" role="alert">{GENERATION_FAILURE[record.error.code || ''] || record.error.message || record.error.code}</p>}
      {!isGenerationTerminal(record.state) && <div className="chat-q-gen-actions"><button className="chat-q-btn" data-variant="ghost" type="button" disabled={busy} onClick={() => void act('cancel')}>Cancel</button></div>}
    </>}

    {record.resultAssetIds.length > 0 && <div className="chat-q-gen-results">
      {record.resultAssetIds.map(assetId => record.type === 'image' ? <LibraryAssetImage key={assetId} asset={{assetId,name:record.request.prompt,mimeType:'image/*',contentUrl:''}} alt={record.request.prompt} /> : <GenerationMedia key={assetId} assetId={assetId} type={record.type}/>)}
    </div>}

    {error && record.state !== 'awaiting_approval' && <p className="chat-q-gen-error" role="alert">{error} <button type="button" className="chat-q-btn" data-variant="ghost" onClick={() => setReload(n => n + 1)}>Reload status</button></p>}
  </section>;
}
