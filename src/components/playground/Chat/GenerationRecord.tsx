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
/** Presentation holds only an ID. Read server authority afresh, including on refresh. */
export function GenerationRecord({ id }: { id: string }) {
  const [record, setRecord] = useState<Generation | null>(null);
  const [quote, setQuote] = useState<GenerationQuote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setRecord(null); setQuote(null);
    const load = async () => {
      try { const value = await generations.get(id, controller.signal); if (controller.signal.aborted) return; setRecord(value); setError(''); if (!isGenerationTerminal(value.state)) timer = setTimeout(load, 2500); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Status unavailable'); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, reload]);
  const act = async (action: 'quote' | 'approve' | 'cancel') => {
    if (!record || busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'quote') { const next=await generations.quote(record.request); if(next.requestHash !== record.requestHash) throw new Error('The request changed. Reload its status before approval.'); setQuote(next); }
      else if (action === 'approve' && quote) { setRecord(await generations.approve(record, quote)); setQuote(null); setReload(n => n + 1); }
      else if (action === 'cancel') { setRecord(await generations.cancel(id)); setReload(n => n + 1); }
    } catch(e) { setError(e instanceof Error ? e.message : 'Request refused'); if (action === 'approve') setQuote(null); }
    finally { setBusy(false); }
  };
  return <section className="chat-q" data-generation-id={id} aria-live="polite">
    {record ? <>
      <div className="chat-q-head"><div className="chat-q-text"><a href={generationPath(record.type, id)} target="_top">{TYPE_LABEL[record.type] || record.type} · {record.request.model}</a><small>{say(record.state)}</small></div></div>
      <div className="chat-q-rec-body"><p>{record.request.prompt}</p>
      
      <p>{Object.values(record.request.settings).map(v => say(String(v))).join(' · ')}{record.request.referenceAssetIds.length ? ` · ${record.request.referenceAssetIds.length} references` : ''}</p>
      {record.request.referenceAssetIds.map(assetId => <LibraryAssetImage key={'reference:'+assetId} asset={{assetId,name:'Reference',mimeType:'image/*',contentUrl:''}} alt="Generation reference" />)}
      {record.state === 'awaiting_approval' && <>
        <p>Nothing has been generated or charged yet. Check the request, then approve it.</p>
        {!quote || Date.parse(quote.expiresAt) <= Date.now() ? <button className="chat-q-btn" type="button" disabled={busy} onClick={() => void act('quote')}>Show the cost</button> : <>
          <p>Up to {quote.maxRetailCredits} credits</p>
          <button className="chat-q-btn" type="button" disabled={busy || Date.parse(quote.expiresAt) <= Date.now()} onClick={() => void act('approve')}>Approve and generate</button>
        </>}
      </>}
      {!isGenerationTerminal(record.state) && <button className="chat-q-btn" type="button" disabled={busy} onClick={() => void act('cancel')}>{record.state === 'awaiting_approval' ? 'Decline' : 'Cancel'}</button>}
      {record.error && <p role="alert">{GENERATION_FAILURE[record.error.code || ''] || record.error.message || record.error.code}</p>}
      {record.resultAssetIds.map(assetId => record.type === 'image' ? <LibraryAssetImage key={assetId} asset={{assetId,name:record.request.prompt,mimeType:'image/*',contentUrl:''}} alt={record.request.prompt} /> : <GenerationMedia key={assetId} assetId={assetId} type={record.type}/>)}
      </div>
    </> : <p>Loading generation…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>Reload status</button></p>}
  </section>;
}
