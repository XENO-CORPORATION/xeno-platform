import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AccountApiError, readProjectPublication, previewProjectPublication, mutateProjectPublication,
  readProjectPublicationOperation, type ProjectPublicationContent, type ProjectPublicationState,
  type ProjectPublicationRequest, type ProjectPublicationPreview } from '../../services/accountService';
import ResourceState from '../platform/ResourceState';

const empty: ProjectPublicationContent = { schemaVersion: 1, title: '', purpose: '', license: '', termsVersion: '', contributionGuide: '', roadmap: '', updates: '' };
export function PublicationProjection({ value }: { value: ProjectPublicationPreview['projection'] }) {
  return <div className="legal-prose"><h2>{value.title}</h2><p>{value.purpose}</p>
    <h3>Published by</h3><p>{value.maintainer.displayName} (@{value.maintainer.handle})</p>
    <h3>License and terms</h3><p>{value.license}</p><p>Terms version: {value.termsVersion}</p>
    <h3>Contribution guide</h3><p>{value.contributionGuide}</p>
    <h3>Published roadmap</h3><p>{value.roadmap || 'No roadmap has been published.'}</p>
    <h3>Published updates</h3><p>{value.updates || 'No updates have been published.'}</p>
    <p>This page grants no workspace membership, repository access, execution or spending permission.</p></div>;
}

export default function ProjectPublication({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const accountId = user?.id;
  const [state, setState] = useState<ProjectPublicationState | null>(null);
  const [draft, setDraft] = useState<ProjectPublicationContent>(empty);
  const [preview, setPreview] = useState<ProjectPublicationPreview | null>(null);
  const [audience, setAudience] = useState<'public' | 'unlisted'>('unlisted');
  const [pending, setPending] = useState<ProjectPublicationRequest | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const identity = useRef({ projectId, accountId });
  if (identity.current.projectId !== projectId || identity.current.accountId !== accountId) {
    identity.current = { projectId, accountId }; generation.current++;
  }
  const storagePrefix = `xeno-project-publication:${accountId}:${projectId}:`;
  const operationKey = (operationId: string) => `${storagePrefix}${operationId}`;
  const loadRecovery = () => {
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(storagePrefix)).sort();
      const records = keys.map(key => {
        const value = JSON.parse(localStorage.getItem(key) || 'null') as ProjectPublicationRequest;
        if (!value || value.projectId !== projectId || value.expectedActorAccountId !== accountId
          || !/^[a-f0-9-]{36}$/i.test(value.operationId) || key !== operationKey(value.operationId)) throw new Error('Recovery identity is invalid.');
        return value;
      });
      setPending(records[0] || null);
    } catch {
      setRecoveryBlocked(true);
      throw new Error('Publication recovery storage is unavailable or invalid. Restore the saved record before retrying; it has not been overwritten.');
    }
  };
  const refresh = async (epoch: number) => {
    if (!accountId) return;
    const result = await readProjectPublication(projectId, accountId);
    if (epoch !== generation.current) return;
    setState(result); setDraft(result.draft || empty); setPreview(null);
  };
  useEffect(() => {
    const epoch = ++generation.current;
    setState(null); setDraft(empty); setError(''); setPreview(null); setPending(null); setRevokeConfirm(false); setRecoveryBlocked(false); setBusy(false);
    if (!accountId) return;
    try { loadRecovery(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery unavailable.'); }
    void refresh(epoch).catch(cause => { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : 'Publication unavailable.'); });
    return () => { ++generation.current; };
  }, [projectId, accountId]);
  const perform = async (work: (epoch: number) => Promise<void>) => {
    if (inFlight.current || !accountId) return;
    const epoch = generation.current; inFlight.current = true; setBusy(true); setError('');
    try { await work(epoch); }
    catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : 'Publication unavailable.'); }
    finally { inFlight.current = false; if (epoch === generation.current) setBusy(false); }
  };
  const finish = async (request: ProjectPublicationRequest, epoch: number, receipt: { operationId: string; projectId: string; action: string }) => {
    if (epoch !== generation.current) return;
    if (receipt.operationId !== request.operationId || receipt.projectId !== projectId || receipt.action !== request.action) throw new Error('The operation receipt did not match. Check the same operation again.');
    localStorage.removeItem(operationKey(request.operationId));
    loadRecovery(); setRevokeConfirm(false);
    await refresh(epoch);
  };
  const send = async (request: ProjectPublicationRequest, epoch: number) => {
    // Persist identity BEFORE sending. Block if storage is unavailable; a retry
    // must not become a second publication after an ambiguous response.
    localStorage.setItem(operationKey(request.operationId), JSON.stringify(request)); setPending(request);
    try {
      const result = await mutateProjectPublication(request);
      if (result.state !== 'committed') throw new Error('Publication outcome is uncertain. Check the saved operation.');
      await finish(request, epoch, result.operation);
    } catch (cause) {
      // These are authoritative rollback responses from this operation. Transport
      // failure, identity conflict and unknown responses retain recovery identity.
      if (epoch === generation.current && cause instanceof AccountApiError
        && ['bad_input', 'publication_revision_conflict', 'preview_changed'].includes(cause.code || '')) {
        localStorage.removeItem(operationKey(request.operationId));
        loadRecovery(); setPreview(null);
        if (cause.code !== 'bad_input') await refresh(epoch);
      }
      throw cause;
    }
  };
  const submit = (action: ProjectPublicationRequest['action']) => void perform(async epoch => {
    if (!state || pending || !accountId || recoveryBlocked) return;
    const request: ProjectPublicationRequest = { projectId, expectedActorAccountId: accountId, operationId: crypto.randomUUID(),
      expectedRevision: preview && action === 'publish' ? preview.revision : state.revision, action,
      ...(action === 'draft' ? { content: draft } : action === 'publish' && preview ? { visibility: preview.visibility, previewHash: preview.previewHash } : {}) };
    await send(request, epoch);
  });
  const recover = (retry: boolean) => void perform(async epoch => {
    if (!pending) return;
    const result = await readProjectPublicationOperation({ projectId: pending.projectId,
      expectedActorAccountId: pending.expectedActorAccountId, operationId: pending.operationId });
    if (epoch !== generation.current) return;
    if (result.state === 'committed' && result.operation) await finish(pending, epoch, result.operation);
    else if (retry) await send(pending, epoch);
    else setError('This operation has not been observed. Retry keeps the same operation ID and payload.');
  });
  const makePreview = () => void perform(async epoch => {
    if (!accountId || pending) return;
    const result = await previewProjectPublication(projectId, accountId, audience);
    if (epoch === generation.current) setPreview(result);
  });
  if (!accountId) return <ResourceState kind="unavailable" title="Sign in to manage publication" />;
  if (!state && !error) return <ResourceState kind="loading" title="Loading publication" />;
  return <section className="xeno-project-form" aria-label="Project publication">
    <h3>Public project page</h3><p>Publish only the text previewed here. Private chats, files, instructions and local paths stay private.</p>
    {error && <p role="alert">{error}</p>}
    {!state && <button type="button" className="xeno-page-button" onClick={() => void perform(refresh)}>Reload publication</button>}
    {recoveryBlocked ? <p role="status">Publication changes are blocked to preserve recovery identity. Reload after restoring the saved record.</p> : pending ? <div><p role="status">An operation needs reconciliation. No new publication will be sent.</p>
      <button type="button" className="xeno-page-button" disabled={busy} onClick={() => recover(false)}>Check saved operation</button>
      <button type="button" className="xeno-page-button" disabled={busy} onClick={() => recover(true)}>Retry same operation</button></div> : state && <>
      <p>Current visibility: {state.visibility}. Draft revision: {state.revision}.</p>
      {state.visibility !== 'private' && <Link to={state.url}>Open published page</Link>}
      {(['title', 'purpose', 'license', 'termsVersion', 'contributionGuide', 'roadmap', 'updates'] as const).map(field =>
        <label key={field}>{({ title: 'Public title', purpose: 'Purpose', license: 'License / redistribution rights', termsVersion: 'Terms version', contributionGuide: 'Contribution guide', roadmap: 'Published roadmap summary', updates: 'Selected public updates' })[field]}
          <textarea value={draft[field]} disabled={busy} onChange={event => { setDraft({ ...draft, [field]: event.target.value }); setPreview(null); }} /></label>)}
      <p>Save draft to retain these edits on the server. Saving does not publish.</p>
      <button type="button" className="xeno-page-button" disabled={busy} onClick={() => submit('draft')}>Save private draft</button>
      <fieldset disabled={busy}><legend>Publication audience</legend>{(['unlisted', 'public'] as const).map(value =>
        <label key={value}><input type="radio" name={`publication-${projectId}`} checked={audience === value} onChange={() => { setAudience(value); setPreview(null); }} />{value === 'public' ? 'Public — listed in discovery' : 'Unlisted — anyone with the link, not listed'}</label>)}</fieldset>
      <button type="button" className="xeno-page-button" disabled={busy || !state.draft || JSON.stringify(draft) !== JSON.stringify(state.draft)} onClick={makePreview}>Preview saved draft</button>
      {preview && <div><p>Exact disclosure preview — {preview.visibility}. Public copies cannot be recalled.</p><PublicationProjection value={preview.projection} />
        <button type="button" className="xeno-page-button is-primary" disabled={busy} onClick={() => submit('publish')}>Confirm publication</button></div>}
      {state.visibility !== 'private' && <><button type="button" className="xeno-page-button" disabled={busy} onClick={() => setRevokeConfirm(true)}>Make private</button>
        {revokeConfirm && <div><p>Stop future public reads here? Copies already downloaded cannot be recalled.</p><button type="button" className="xeno-page-button" disabled={busy} onClick={() => submit('revoke')}>Confirm make private</button><button type="button" className="xeno-page-button" onClick={() => setRevokeConfirm(false)}>Cancel</button></div>}</>}
    </>}
  </section>;
}
