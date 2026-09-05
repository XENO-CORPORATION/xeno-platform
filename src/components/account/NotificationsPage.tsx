import React, { useCallback, useEffect, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { getNotifications, type Notification } from '../../services/accountService';
import ResourceState from '../platform/ResourceState';
import { useNavigate } from 'react-router-dom';
import AccountSettingsNav from './AccountSettingsNav';

const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setState('loading'); setError('');
    try { const result = await getNotifications(); setItems(result.notifications); setState('ready'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Notifications are unavailable'); setState('error'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <main className="xeno-platform-page xeno-account-page"><header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Account</span><h1>Notifications</h1><p>Confirmed account, workspace, and security signals.</p></div><button type="button" className="xeno-page-button" onClick={load}><RefreshCw size={15} />Refresh</button></header>
    <AccountSettingsNav />
    {state === 'loading' ? <ResourceState kind="loading" /> : state === 'error' ? <ResourceState kind="error" detail={error} onRetry={load} /> : items.length === 0 ? <ResourceState kind="empty" title="You are all caught up" detail="New account and workspace signals will appear here." /> : <section className="xeno-data-card" aria-label="Notifications">{items.map((item) => <article className="xeno-notification-row" key={item.id}><span className="xeno-data-icon"><Bell size={16} /></span><span><strong>{item.title}</strong><small>{item.message}</small></span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>{item.type === 'workspace_invite' ? <button type="button" className="xeno-row-action" onClick={() => navigate('/overview/team')}>Review</button> : item.id === 'verify-email' ? <button type="button" className="xeno-row-action" onClick={() => navigate('/overview/profile')}>Verify</button> : null}</article>)}</section>}
  </main>;
};
export default NotificationsPage;
