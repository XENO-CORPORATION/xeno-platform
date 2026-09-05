import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Clock3, Plug, Search, ShieldCheck, X } from 'lucide-react';
import chatService from '../../services/chatService';
import ResourceState from '../platform/ResourceState';
import AccountSettingsNav from './AccountSettingsNav';
import DrawerLayoutControl, { type DrawerLayout } from '../platform/DrawerLayoutControl';

interface ConfirmedConnector {
  id?: string;
  key?: string;
  connector_key?: string;
  name?: string;
  type?: string;
  description?: string;
  status?: string;
  updated_at?: string;
}

const IntegrationsPage: React.FC = () => {
  const [items, setItems] = useState<ConfirmedConnector[]>([]);
  const [selected, setSelected] = useState<ConfirmedConnector | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [drawerLayout, setDrawerLayout] = useState<DrawerLayout>(() => localStorage.getItem('xeno_detail_layout') === 'full' ? 'full' : 'side');
  const changeDrawerLayout = (layout: DrawerLayout) => { setDrawerLayout(layout); localStorage.setItem('xeno_detail_layout', layout); };

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('The connector service did not respond within 12 seconds.')), 12_000));
      setItems(await Promise.race([chatService.getConnectors(), timeout]));
      setState('ready');
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : 'The connector service did not return confirmed state.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <main className="xeno-platform-page xeno-account-page">
    <header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Workspace</span><h1>Integrations</h1><p>Only connectors qualified by the server and attached to this account appear here.</p></div></header>
    <AccountSettingsNav />
    {items.length ? <div className="xeno-project-toolbar"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search integrations" /></label></div> : null}
    {state === 'loading' ? <ResourceState kind="loading" title="Loading confirmed integrations" detail="Reading qualified connector records from the account service." />
      : state === 'error' ? <ResourceState kind="error" layout="page" previewLabel="Workspace / Integrations" title="We couldn't load integrations" detail={error} actionLabel="Try again" onRetry={() => void load()} />
      : items.length === 0 ? <ResourceState kind="empty" layout="page" previewLabel="Workspace / Integrations" title="No qualified integrations" detail="The server has not qualified or connected any provider for this account. Static provider cards are intentionally not shown as real connections." />
      : <div className="xeno-integration-grid">{items.filter((item) => !query.trim() || `${item.name || ''} ${item.key || ''} ${item.type || ''} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())).map((item) => {
        const key = item.connector_key || item.key || item.id || item.name || 'connector';
        return <button type="button" key={key} className="xeno-integration-card" onClick={() => setSelected(item)}><span className="xeno-integration-logo"><Plug size={22} /></span><span><strong>{item.name || key}</strong><small>{item.type || 'Connector'}</small><p>{item.description || 'Server-qualified workspace connector.'}</p></span><span className="xeno-availability">{item.status || 'not connected'}</span><ChevronRight size={16} /></button>;
      })}</div>}
    {selected ? <div className="xeno-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className={`xeno-detail-drawer xeno-integration-drawer${drawerLayout === 'full' ? ' is-fullpage' : ''}`} role="dialog" aria-modal="true" aria-label={`${selected.name || 'Connector'} details`}><header><span className="xeno-integration-logo"><Plug size={22} /></span><span><small>{selected.type || 'Connector'}</small><h2>{selected.name || selected.connector_key || selected.key}</h2></span><span className="xeno-availability">{selected.status || 'not connected'}</span><DrawerLayoutControl value={drawerLayout} onChange={changeDrawerLayout} /><button type="button" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button></header><nav className="xeno-drawer-tabs" aria-label="Integration detail sections"><button type="button" className="is-active">Overview</button><button type="button" disabled>Activity</button><span>Authenticated record</span></nav><section><div className="xeno-truth-banner"><ShieldCheck size={17} /><span><strong>Server-confirmed record</strong><small>This state came from the authenticated connector service.</small></span></div><div className="xeno-drawer-hero"><span className="xeno-integration-logo"><Plug size={24} /></span><div><span className="xeno-page-eyebrow">Integration overview</span><h3>{selected.name || selected.connector_key || selected.key}</h3><p>{selected.description || 'No additional provider description was returned.'}</p></div></div><dl className="xeno-drawer-facts"><div><dt>Status</dt><dd>{selected.status || 'not connected'}</dd></div><div><dt>Type</dt><dd>{selected.type || 'Connector'}</dd></div><div><dt>Record key</dt><dd>{selected.connector_key || selected.key || selected.id || 'Not returned'}</dd></div>{selected.updated_at ? <div><dt><Clock3 size={13} />Last updated</dt><dd>{new Date(selected.updated_at).toLocaleString()}</dd></div> : null}</dl></section></aside></div> : null}
  </main>;
};

export default IntegrationsPage;
