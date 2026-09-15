import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getAccountQuota, setUsageCreditsEnabled, type AccountQuota } from '../../services/usageCreditsService';
import './account-usage-credits.css';

/** One account policy, shared by the Usage and Billing pages. No optimistic consent. */
export default function AccountUsageCredits({ onBuyCredits }: { onBuyCredits: () => void }) {
  const [quota, setQuota] = useState<AccountQuota | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const load = useCallback(async () => {
    if (savingRef.current) return;
    const version = ++generation.current;
    setLoading(true);
    try {
      const next = await getAccountQuota();
      if (mounted.current && version === generation.current) { setQuota(next); setError(''); }
    } catch (e) {
      if (mounted.current && version === generation.current) setError(e instanceof Error ? e.message : 'Usage settings are unavailable.');
    } finally {
      if (mounted.current && version === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { mounted.current = false; ++generation.current; window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [load]);
  const toggle = async () => {
    if (!quota?.canManageUsageCredits || savingRef.current || loading) return;
    savingRef.current = true;
    ++generation.current;
    setSaving(true); setError(''); setNotice('');
    try {
      const next = await setUsageCreditsEnabled(!quota.usageCreditsEnabled);
      if (mounted.current) {
        setQuota(next);
        setNotice(next.usageCreditsEnabled ? 'Usage credits enabled for your account and its agents.' : 'Usage credits disabled. New requests stop at your weekly limit.');
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Your setting could not be saved.');
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const reset = quota ? new Date(quota.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return <section className="xeno-account-usage" aria-label="Plan usage and usage credits" aria-busy={loading || saving}>
    {!quota ? <div className="xeno-account-usage-body"><p>{loading ? 'Loading plan usage…' : 'Plan usage is unavailable.'}</p></div> : <>
      <article className="xeno-account-usage-body">
        <div className="xeno-account-usage-heading"><h2>Weekly usage</h2><span>{quota.metered ? `${quota.usedPercent}% used` : 'No weekly plan limit'}</span></div>
        {quota.metered && <><progress max={100} value={quota.usedPercent} aria-label="Weekly quota used" /><p>Resets {reset}. Shared by you and all your agents.</p></>}
      </article>
      {quota.exhausted && (!quota.usageCreditsEnabled || quota.usageCreditsBalance === 0) && <div className="xeno-account-usage-limit" role="status">
        <h3>Weekly limit reached</h3>
        <p>{quota.usageCreditsEnabled ? 'Add usage credits to keep working, or wait for your weekly reset.' : 'Turn on usage credits to keep working past your plan limit.'} Your weekly quota resets {reset}.</p>
      </div>}
      <article className="xeno-account-usage-body">
        <div className="xeno-account-usage-heading"><h2>Usage credits</h2><button type="button" role="switch" aria-label="Use credits after my weekly limit" aria-checked={quota.usageCreditsEnabled} disabled={!quota.canManageUsageCredits || saving || loading} onClick={() => void toggle()} className="xeno-usage-credit-switch"><span aria-hidden="true" /></button></div>
        <p>Available for metered tasks beyond your plan allowance. Promotional credits are used before purchased credits.</p>
        <div className="xeno-account-usage-heading"><strong className="xeno-usage-credit-balance">{quota.usageCreditsBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>credits</small></strong><button type="button" className="xeno-page-button" onClick={onBuyCredits}>Buy credits</button></div>
        <p>{quota.usageCreditsEnabled ? 'On — usage credits can be spent after your weekly quota runs out.' : 'Off — requests stop at your weekly limit, even if you have credits.'}</p>
        <p>Buying credits does not enable this setting. Purchased credits never expire. Turning it off does not cancel work already admitted.</p>
        {!quota.canManageUsageCredits && <p>Only the account owner can change this setting.</p>}
      </article>
    </>}
    {error && <div className="xeno-account-usage-body" role="alert"><p>{error}</p><button type="button" className="xeno-page-button" disabled={saving || loading} onClick={() => void load()}>Refresh usage</button></div>}
    {notice && <p className="xeno-account-usage-notice" role="status">{notice}</p>}
  </section>;
}
