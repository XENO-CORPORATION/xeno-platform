import React, { useCallback, useEffect, useState } from 'react';
import { Check, Laptop, Pencil, Plus, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react';
import AccountSettingsNav from './AccountSettingsNav';
import ResourceState from '../platform/ResourceState';
import {
  createSpawnProfile,
  forgetSpawnDevice,
  isStaleProfile,
  listSpawnDevices,
  listSpawnProfiles,
  removeSpawnProfile,
  renameSpawnProfile,
  type SpawnSyncDevice,
  type SpawnSyncedProfile,
} from '../../services/spawnProfileService';
import type { SpawnProfileProvider, SpawnProfileVendor } from '../../lib/spawnProfileBundle';
import './spawn-profiles.css';

const VENDORS: Array<{ value: SpawnProfileVendor; label: string }> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'agy', label: 'agy' },
  { value: 'opencode', label: 'opencode' },
  { value: 'xeno-agent', label: 'XENO Agent' },
];

const vendorLabel = (vendor?: string) => VENDORS.find((item) => item.value === vendor)?.label ?? vendor ?? 'Unknown agent';
const providerLabel = (provider?: SpawnProfileProvider) => provider === 'xeno' ? 'XENO mode' : provider === 'vendor' ? 'Vendor sign-in' : 'Choose on device';

/** "just now", "5 min ago", "3 h ago", or the date. */
const ago = (iso: string | undefined, now = Date.now()) => {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

const STALE = 'This profile changed on one of your devices since this page loaded. The list is up to date now; try again.';

const SpawnProfilesPage: React.FC = () => {
  const [profiles, setProfiles] = useState<SpawnSyncedProfile[]>([]);
  const [devices, setDevices] = useState<SpawnSyncDevice[]>([]);
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<SpawnProfileVendor>('claude');
  const [provider, setProvider] = useState<SpawnProfileProvider>('vendor');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [listed, synced] = await Promise.all([listSpawnProfiles(), listSpawnDevices().catch(() => [] as SpawnSyncDevice[])]);
      setProfiles(listed);
      setDevices(synced);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spawn profiles could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** One action at a time; a stale revision reloads the list rather than overwriting what a device just wrote. */
  const act = async (key: string, run: () => Promise<string>) => {
    setBusy(key);
    setError('');
    setSuccess('');
    try {
      setSuccess(await run());
    } catch (err) {
      if (isStaleProfile(err)) { setError(STALE); await load(); }
      else setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsCreating(true);
    setError('');
    setSuccess('');
    try {
      const created = await createSpawnProfile({ name, vendor, provider });
      setProfiles((current) => [created, ...current.filter((profile) => profile.profileId !== created.profileId)]);
      setName('');
      setSuccess(`“${created.bundle?.name}” is in your account. A signed-in Spawn picks it up at start and within 30 seconds while running; for an already-open terminal, spawn profiles sync does it now.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Spawn profile could not be created.');
    } finally {
      setIsCreating(false);
    }
  };

  const saveRename = (profile: SpawnSyncedProfile) => act(`rename:${profile.profileId}`, async () => {
    const value = renaming?.value.trim() ?? '';
    if (!value || value === profile.bundle?.name) { setRenaming(null); return ''; }
    const renamed = await renameSpawnProfile(profile, value);
    setProfiles((current) => current.map((p) => p.profileId === renamed.profileId ? renamed : p));
    setRenaming(null);
    return `Renamed to “${renamed.bundle?.name}”. Your devices take the new name on their next sync.`;
  });

  const remove = (profile: SpawnSyncedProfile) => act(`remove:${profile.profileId}`, async () => {
    await removeSpawnProfile(profile);
    setProfiles((current) => current.filter((p) => p.profileId !== profile.profileId));
    setRemoving(null);
    return `“${profile.bundle?.name ?? profile.profileId}” is removed from your account. Each device that has it asks you, in spawn profiles, whether to remove its own copy too; nothing is removed on a device without that.`;
  });

  const forget = (device: SpawnSyncDevice) => act(`forget:${device.deviceId}`, async () => {
    await forgetSpawnDevice(device.deviceId);
    setDevices((current) => current.filter((d) => d.deviceId !== device.deviceId));
    return `“${device.name}” is no longer listed. Nothing on it was changed; it appears again the next time it syncs.`;
  });

  return (
    <main className="xeno-platform-page xeno-account-page xeno-spawn-profiles-page">
      <header className="xeno-platform-page-header">
        <div>
          <span className="xeno-page-eyebrow">Account</span>
          <h1>Spawn profiles</h1>
          <p>Create agent profiles here and use them in XENO Spawn on your devices. Sign-ins and conversations stay on each device.</p>
        </div>
        <div className="xeno-header-actions">
          <button type="button" className="xeno-page-button" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </header>

      <AccountSettingsNav />
      {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}
      {success ? <div className="xeno-inline-success" role="status"><Check size={15} />{success}</div> : null}

      <section className="xeno-spawn-profiles-layout">
        <form className="xeno-data-card xeno-spawn-profile-create" onSubmit={create}>
          <header>
            <h2><TerminalSquare size={17} /> New profile</h2>
            <span>Account synced</span>
          </header>
          <label>
            <span>Profile name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Research" autoComplete="off" />
          </label>
          <label>
            <span>Agent</span>
            <select value={vendor} onChange={(event) => setVendor(event.target.value as SpawnProfileVendor)}>
              {VENDORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>How it signs in</span>
            <select value={provider ?? 'vendor'} onChange={(event) => setProvider(event.target.value as SpawnProfileProvider)}>
              <option value="vendor">The agent’s own sign-in</option>
              <option value="xeno">XENO mode</option>
            </select>
          </label>
          <button type="submit" className="xeno-page-button is-primary" disabled={isCreating || !name.trim()}>
            <Plus size={15} /> {isCreating ? 'Creating…' : 'Create profile'}
          </button>
          <p>Creating a profile does not copy a sign-in or a conversation. Spawn creates the matching empty profile locally, and the agent signs in there once.</p>
        </form>

        <div className="xeno-spawn-profile-column">
          <section className="xeno-data-card xeno-spawn-profile-list" aria-live="polite">
            <header>
              <h2>Your Spawn profiles</h2>
              <span>{profiles.length} synced</span>
            </header>
            {isLoading ? (
              <ResourceState kind="loading" title="Loading Spawn profiles" />
            ) : profiles.length ? (
              <ul>
                {profiles.map((profile) => {
                  const id = profile.profileId, label = profile.bundle?.name ?? id;
                  const isRenaming = renaming?.id === id, isRemoving = removing === id;
                  return (
                    <li key={id} data-profile-id={id}>
                      <div className="xeno-spawn-profile-main">
                        {isRenaming ? (
                          <form className="xeno-spawn-profile-rename" onSubmit={(event) => { event.preventDefault(); void saveRename(profile); }}>
                            <input aria-label={`New name for ${label}`} value={renaming.value} maxLength={60} autoComplete="off" autoFocus
                              onChange={(event) => setRenaming({ id, value: event.target.value })}
                              onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} />
                            <button type="submit" className="xeno-page-button is-primary" disabled={busy !== null || !renaming.value.trim()}>Save</button>
                            <button type="button" className="xeno-page-button" onClick={() => setRenaming(null)}>Cancel</button>
                          </form>
                        ) : (
                          <>
                            <strong>{label}</strong>
                            <span>{vendorLabel(profile.bundle?.vendor)} · {providerLabel(profile.bundle?.provider)}</span>
                          </>
                        )}
                        {isRemoving ? (
                          <div className="xeno-spawn-profile-confirm" role="group" aria-label={`Remove ${label}`}>
                            <p>Remove “{label}” from your account? Each device that has it asks you whether to remove its own copy too, with its sessions and sign-in there. Nothing is removed on a device without that.</p>
                            <div>
                              <button type="button" className="xeno-page-button is-danger" disabled={busy !== null} onClick={() => void remove(profile)}>
                                <Trash2 size={14} /> {busy === `remove:${id}` ? 'Removing…' : 'Remove from account'}
                              </button>
                              <button type="button" className="xeno-page-button" onClick={() => setRemoving(null)}>Keep it</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="xeno-spawn-profile-meta">
                        {profile.updatedAt ? <time dateTime={profile.updatedAt} title={new Date(profile.updatedAt).toLocaleString()}>Changed {ago(profile.updatedAt)}</time> : null}
                        {!isRenaming && !isRemoving ? (
                          <div className="xeno-spawn-profile-actions">
                            <button type="button" className="xeno-page-button" disabled={busy !== null || !profile.bundle}
                              onClick={() => { setRemoving(null); setRenaming({ id, value: label }); }}>
                              <Pencil size={13} /> Rename
                            </button>
                            <button type="button" className="xeno-page-button is-danger" disabled={busy !== null}
                              onClick={() => { setRenaming(null); setRemoving(id); }}>
                              <Trash2 size={13} /> Remove
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="xeno-spawn-profile-empty">
                <TerminalSquare size={22} />
                <strong>No Spawn profiles yet</strong>
                <p>Create one here, or run <code>spawn profiles sync</code> after creating profiles in Spawn.</p>
              </div>
            )}
          </section>

          <section className="xeno-data-card xeno-spawn-profile-list xeno-spawn-device-list" aria-live="polite">
            <header>
              <h2><Laptop size={16} /> Your devices</h2>
              <span>{devices.length ? `${devices.length} syncing` : ''}</span>
            </header>
            {isLoading ? null : devices.length ? (
              <ul>
                {devices.map((device) => (
                  <li key={device.deviceId} data-device-id={device.deviceId}>
                    <div className="xeno-spawn-profile-main">
                      <strong>{device.name}</strong>
                      <span>
                        {device.profiles} profile{device.profiles === 1 ? '' : 's'}
                        {device.version ? ` · Spawn ${device.version}` : ''}
                        {device.conflicts ? ` · ${device.conflicts} waiting for your choice there (spawn profiles)` : ''}
                      </span>
                    </div>
                    <div className="xeno-spawn-profile-meta">
                      <time dateTime={device.lastSyncAt} title={new Date(device.lastSyncAt).toLocaleString()}>Last synced {ago(device.lastSyncAt)}</time>
                      <div className="xeno-spawn-profile-actions">
                        <button type="button" className="xeno-page-button" disabled={busy !== null} onClick={() => void forget(device)}>Forget</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="xeno-spawn-profile-empty">
                <p>No device has synced yet. A signed-in Spawn shows up here after its first sync.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
};

export default SpawnProfilesPage;
