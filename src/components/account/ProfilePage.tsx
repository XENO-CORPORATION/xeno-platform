import React, { useEffect, useState } from 'react';
import { AtSign, Calendar, Check, Coins, Mail, ShieldCheck, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';
import ResourceState from '../platform/ResourceState';
import AccountSettingsNav from './AccountSettingsNav';

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading, refreshUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [username, setUsername] = useState(user?.username || '');

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name || '');
    setUsername(user.username || '');
  }, [user]);

  const cancel = () => {
    setDisplayName(user?.display_name || '');
    setUsername(user?.username || '');
    setIsEditing(false);
    setError('');
  };

  const save = async () => {
    if (!user) return;
    const nextDisplayName = displayName.trim();
    const nextUsername = username.trim().toLowerCase();
    if (!nextDisplayName || !nextUsername) {
      setError('Display name and username are required.');
      return;
    }
    const updates: { display_name?: string; username?: string } = {};
    if (nextDisplayName !== user.display_name) updates.display_name = nextDisplayName;
    if (nextUsername !== user.username) updates.username = nextUsername;
    if (!Object.keys(updates).length) { setIsEditing(false); return; }
    setIsSaving(true); setError(''); setSuccess('');
    try {
      const result = await authService.updateProfile(updates);
      if (!result.success) throw new Error(result.error || 'The server did not confirm this profile update.');
      await refreshUser();
      setIsEditing(false);
      setSuccess('Profile updated and confirmed by the server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile update failed.');
    } finally { setIsSaving(false); }
  };

  if (isLoading) return <main className="xeno-platform-page"><ResourceState kind="loading" title="Loading your profile" /></main>;
  if (!user) return <main className="xeno-platform-page"><ResourceState kind="unavailable" layout="page" previewLabel="Account / Profile" title="Your profile is waiting for you" detail="Sign in to view and manage the identity attached to your XENO account." actionLabel="Sign in" onRetry={() => navigate('/login?returnUrl=%2Foverview%2Fprofile')} secondaryActionLabel="Back to dashboard" onSecondaryAction={() => navigate('/overview')} /></main>;

  const joined = new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const initials = (user.display_name || user.username || user.email || 'XENO').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return <main className="xeno-platform-page xeno-account-page">
    <header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Account</span><h1>Profile</h1><p>Manage the identity attached to your XENO account.</p></div><div className="xeno-header-actions">{isEditing ? <><button type="button" className="xeno-page-button" disabled={isSaving} onClick={cancel}>Cancel</button><button type="button" className="xeno-page-button is-primary" disabled={isSaving} onClick={save}><Check size={15} />{isSaving ? 'Saving…' : 'Save changes'}</button></> : <button type="button" className="xeno-page-button is-primary" onClick={() => { setSuccess(''); setError(''); setIsEditing(true); }}>Edit profile</button>}</div></header>
    <AccountSettingsNav />
    {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}{success ? <div className="xeno-inline-success" role="status"><Check size={15} />{success}</div> : null}
    <section className="xeno-profile-layout">
      <aside className="xeno-profile-summary"><div className="xeno-profile-avatar" aria-hidden="true">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials}</div><h2>{user.display_name || user.username}</h2><p>@{user.username}</p><span className={`xeno-account-status ${user.is_active ? 'is-active' : ''}`}>{user.is_active ? 'Active account' : 'Inactive account'}</span><dl><div><dt><Coins size={14} />Credit balance</dt><dd>{user.credits.toLocaleString()}</dd></div><div><dt><Calendar size={14} />Member since</dt><dd>{joined}</dd></div></dl></aside>
      <div className="xeno-data-card xeno-profile-fields"><header><h2>Personal information</h2><span>{isEditing ? 'Editing' : 'Server confirmed'}</span></header><div className="xeno-profile-form">
        <label><span><User size={14} />Display name</span>{isEditing ? <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /> : <strong>{user.display_name || 'Not set'}</strong>}</label>
        <label><span><AtSign size={14} />Username</span>{isEditing ? <input value={username} onChange={(event) => setUsername(event.target.value.replace(/\s/g, '').toLowerCase())} autoComplete="username" /> : <strong>@{user.username}</strong>}</label>
        <label className="is-wide"><span><Mail size={14} />Email address</span><strong>{user.email}</strong>{user.email_verified ? <em><ShieldCheck size={14} />Verified</em> : <em className="is-pending">Not verified</em>}</label>
      </div></div>
    </section>
    {isEditing ? <div className="xeno-sticky-savebar"><span>Your profile has unsaved changes.</span><div><button type="button" className="xeno-page-button" disabled={isSaving} onClick={cancel}>Cancel</button><button type="button" className="xeno-page-button is-primary" disabled={isSaving} onClick={save}><Check size={15} />{isSaving ? 'Saving…' : 'Save changes'}</button></div></div> : null}
  </main>;
};

export default ProfilePage;
