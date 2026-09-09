import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Laptop, Loader2, Lock, RefreshCw, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';
import { userDataService, type UserSettings } from '../../services/userDataService';
import ResourceState from '../platform/ResourceState';
import { getAccountSessions, revokeAccountSession, type AccountSession } from '../../services/accountService';
import AccountSettingsNav from './AccountSettingsNav';
import AccountActionDialog from '../platform/AccountActionDialog';
import {
  getPlatformThemePosition,
  normalizePlatformTheme,
  normalizePlatformThemeBrightness,
  savePlatformTheme,
  type PlatformThemePreference,
} from '../../platform/platformTheme';

const SettingsPage: React.FC = () => {
  const navigate = useNavigate(); const { logout } = useAuth();
  const [settings, setSettings] = useState<UserSettings>({}); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false); const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false); const [deletePassword, setDeletePassword] = useState('');
  const [sessions, setSessions] = useState<AccountSession[]>([]); const [sessionsLoading, setSessionsLoading] = useState(true); const [sessionBusy, setSessionBusy] = useState('');
  const [sessionsError, setSessionsError] = useState('');
  const [sessionAction, setSessionAction] = useState<AccountSession | null>(null);
  const confirmedRevocation = useRef<string>();
  useEffect(() => { userDataService.getSettings().then(setSettings).catch((err) => setError(err instanceof Error ? err.message : 'Settings unavailable')).finally(() => setLoading(false)); }, []);
  const loadSessions = async () => { setSessionsLoading(true); setSessionsError(''); try { const result = await getAccountSessions(); setSessions(result.sessions); } catch (err) { setSessions([]); setSessionsError(err instanceof Error ? err.message : 'Sessions unavailable'); } finally { setSessionsLoading(false); } };
  useEffect(() => { void loadSessions(); }, []);
  const revokeSession = (session: AccountSession) => { confirmedRevocation.current = undefined; setSessionAction(session); };
  const confirmSessionRevocation = async (session: AccountSession) => {
    setSessionBusy(session.id); setError('');
    try {
      if (confirmedRevocation.current !== session.id) {
        const receipt = await revokeAccountSession(session.id);
        if (receipt.revoked_session_id !== session.id) throw new Error('The server did not confirm the requested session revocation.');
        confirmedRevocation.current = session.id;
      }
      if (session.current) { logout?.(); navigate('/login'); return; }
      const readBack = await getAccountSessions();
      setSessions(readBack.sessions);
      if (readBack.sessions.some(item => item.id === session.id)) throw new Error('The session is still active after revocation.');
      setNotice('Session revoked and confirmed absent from the active session list.');
    } finally { setSessionBusy(''); }
  };
  const update = async (path: string, value: unknown) => { setSaving(true); setError(''); setNotice(''); try { const next = await userDataService.updateSetting(path, value); setSettings(next); setNotice('Settings saved and confirmed by the server.'); } catch (err) { setError(err instanceof Error ? err.message : 'The server did not confirm this setting.'); } finally { setSaving(false); } };
  const updateTheme = async (nextTheme: PlatformThemePreference, nextBrightness: number) => { setSaving(true); setError(''); setNotice(''); try { const confirmed = await savePlatformTheme(nextTheme, nextBrightness); setSettings((current) => ({ ...current, appearance: { ...current.appearance, theme: confirmed.preference, themeBrightness: confirmed.brightness } })); setNotice('Platform theme saved and applied everywhere.'); } catch (err) { setError(err instanceof Error ? err.message : 'The server did not confirm this theme.'); } finally { setSaving(false); } };
  const changePassword = async () => { setError(''); if (!currentPassword || newPassword.length < 6 || newPassword !== confirmPassword) { setError('Enter the current password and matching new passwords of at least 6 characters.'); return; } setSaving(true); try { const result = await authService.changePassword(currentPassword, newPassword); if (!result.success) throw new Error(result.error || 'Password update failed'); setPasswordOpen(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setNotice('Password changed successfully.'); } catch (err) { setError(err instanceof Error ? err.message : 'Password update failed'); } finally { setSaving(false); } };
  const deleteAccount = async () => { if (!deletePassword) { setError('Password is required to delete the account.'); return; } setSaving(true); try { const result = await authService.deleteAccount(deletePassword); if (!result.success) throw new Error(result.error || 'Account deletion failed'); logout?.(); navigate('/'); } catch (err) { setError(err instanceof Error ? err.message : 'Account deletion failed'); setSaving(false); } };
  if (loading) return <main className="xeno-platform-page"><ResourceState kind="loading" title="Loading account settings" /></main>;
  const theme = normalizePlatformTheme(settings.appearance?.theme) || 'system'; const themeBrightness = normalizePlatformThemeBrightness(settings.appearance?.themeBrightness); const fontSize = settings.appearance?.fontSize || 'medium';
  return <main className="xeno-platform-page xeno-account-page"><header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Account</span><h1>Settings</h1><p>Preferences persist through the authenticated user-data service.</p></div>{saving ? <span className="xeno-saving"><Loader2 size={15} className="xeno-spin" />Saving</span> : null}</header>
    <AccountSettingsNav />
    {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}{notice ? <div className="xeno-inline-success" role="status"><Check size={15} />{notice}</div> : null}
    <section className="xeno-settings-grid"><article id="appearance" className="xeno-settings-card"><header><Settings size={17} /><span><h2>Appearance</h2><p>One theme for the entire platform</p></span></header><label>Theme<select value={theme} disabled={saving} onChange={(event) => { const nextTheme = event.target.value as PlatformThemePreference; void updateTheme(nextTheme, getPlatformThemePosition(nextTheme, themeBrightness)); }}><option value="system">System</option><option value="dark">Dark</option><option value="dim">Dim</option><option value="light">Light</option><option value="custom">Custom</option></select></label><label>Theme brightness<input type="range" min="0" max="100" step="5" value={theme === 'custom' ? themeBrightness : getPlatformThemePosition(theme, themeBrightness)} disabled={saving} aria-label="Platform theme brightness" onChange={(event) => { const nextBrightness = normalizePlatformThemeBrightness(event.target.value); setSettings((current) => ({ ...current, appearance: { ...current.appearance, theme: 'custom', themeBrightness: nextBrightness } })); }} onPointerUp={(event) => void updateTheme('custom', normalizePlatformThemeBrightness(event.currentTarget.value))} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) void updateTheme('custom', normalizePlatformThemeBrightness(event.currentTarget.value)); }} /></label><label>Interface font size<select value={fontSize} disabled={saving} onChange={(event) => update('appearance.fontSize', event.target.value)}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></article>
      <article id="security" className="xeno-settings-card"><header><Lock size={17} /><span><h2>Password</h2><p>Change with current-password verification</p></span></header>{passwordOpen ? <div className="xeno-form-stack"><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" /><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" /><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" /><div><button type="button" className="xeno-page-button" onClick={() => setPasswordOpen(false)}>Cancel</button><button type="button" className="xeno-page-button is-primary" disabled={saving} onClick={changePassword}>Save password</button></div></div> : <button type="button" className="xeno-page-button" onClick={() => setPasswordOpen(true)}>Change password</button>}</article>
      <article className="xeno-settings-card is-danger"><header><AlertTriangle size={17} /><span><h2>Delete account</h2><p>Permanent authenticated operation</p></span></header>{deleteOpen ? <div className="xeno-form-stack"><input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Confirm your password" /><div><button type="button" className="xeno-page-button" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="xeno-page-button is-danger" disabled={saving} onClick={deleteAccount}><Trash2 size={14} />Delete permanently</button></div></div> : <button type="button" className="xeno-page-button is-danger" onClick={() => setDeleteOpen(true)}>Delete account</button>}</article>
    </section>
    <section className="xeno-data-card xeno-session-card"><header><div><h2>Active sessions</h2><p>Devices currently authorized to use your account.</p></div><button type="button" className="xeno-page-button" disabled={sessionsLoading} onClick={() => void loadSessions()}><RefreshCw size={14} />Refresh</button></header>{sessionsLoading ? <ResourceState kind="loading" title="Loading active sessions" /> : sessionsError ? <ResourceState kind="error" title="Session service unavailable" detail={sessionsError} actionLabel="Try again" onRetry={() => void loadSessions()} /> : sessions.length ? sessions.map((session) => <article className="xeno-session-row" key={session.id}><span className="xeno-data-icon"><Laptop size={16} /></span><span><strong>{session.browser || session.device_type || 'Authorized session'}{session.current ? <em><ShieldCheck size={12} />Current</em> : null}</strong><small>{[session.os, session.ip_address].filter(Boolean).join(' · ') || session.user_agent || 'Device details unavailable'}</small><small>Last active {new Date(session.last_active_at || session.created_at).toLocaleString()} · expires {new Date(session.expires_at).toLocaleDateString()}</small></span><button type="button" className="xeno-row-action" disabled={sessionBusy === session.id} onClick={() => void revokeSession(session)}>{sessionBusy === session.id ? 'Revoking…' : session.current ? 'Log out' : 'Revoke'}</button></article>) : <ResourceState kind="empty" title="No active sessions" detail="The server confirmed that this account has no active sessions." />}</section>
    {sessionAction ? <AccountActionDialog key={sessionAction.id} title="Revoke session"
      detail={`Log out ${sessionAction.current ? 'this session' : sessionAction.browser || sessionAction.device_type || 'this device'}?`}
      confirmLabel={confirmedRevocation.current === sessionAction.id ? 'Check revocation' : 'Revoke session'} destructive
      onConfirm={() => confirmSessionRevocation(sessionAction)} onClose={() => setSessionAction(null)}
      recovery={sessionAction.current ? { label: 'Sign in again', onRecover: () => { logout?.(); navigate('/login'); } } : undefined} /> : null}
  </main>;
};
export default SettingsPage;
