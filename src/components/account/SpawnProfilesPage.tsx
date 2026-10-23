import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, RefreshCw, TerminalSquare } from 'lucide-react';
import AccountSettingsNav from './AccountSettingsNav';
import ResourceState from '../platform/ResourceState';
import {
  createSpawnProfile,
  listSpawnProfiles,
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

const SpawnProfilesPage: React.FC = () => {
  const [profiles, setProfiles] = useState<SpawnSyncedProfile[]>([]);
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<SpawnProfileVendor>('claude');
  const [provider, setProvider] = useState<SpawnProfileProvider>('vendor');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setProfiles(await listSpawnProfiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spawn profiles could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

        <section className="xeno-data-card xeno-spawn-profile-list" aria-live="polite">
          <header>
            <h2>Your Spawn profiles</h2>
            <span>{profiles.length} synced</span>
          </header>
          {isLoading ? (
            <ResourceState kind="loading" title="Loading Spawn profiles" />
          ) : profiles.length ? (
            <ul>
              {profiles.map((profile) => (
                <li key={profile.profileId}>
                  <div>
                    <strong>{profile.bundle?.name ?? profile.profileId}</strong>
                    <span>{vendorLabel(profile.bundle?.vendor)} · {providerLabel(profile.bundle?.provider)}</span>
                  </div>
                  <div className="xeno-spawn-profile-meta">
                    <span>Revision {profile.rev}</span>
                    {profile.updatedAt ? <time dateTime={profile.updatedAt}>{new Date(profile.updatedAt).toLocaleDateString()}</time> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="xeno-spawn-profile-empty">
              <TerminalSquare size={22} />
              <strong>No Spawn profiles yet</strong>
              <p>Create one here, or run <code>spawn profiles sync</code> after creating profiles in Spawn.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
};

export default SpawnProfilesPage;
