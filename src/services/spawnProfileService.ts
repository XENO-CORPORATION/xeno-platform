import {
  buildSpawnProfileBundle,
  renameSpawnProfileBundle,
  type SpawnProfileBundle,
  type SpawnProfileProvider,
  type SpawnProfileVendor,
} from '../lib/spawnProfileBundle';

export interface SpawnSyncedProfile {
  profileId: string;
  rev: number;
  bundle?: SpawnProfileBundle;
  deleted?: boolean;
  updatedAt?: string;
}

export class SpawnProfileApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'SpawnProfileApiError';
    this.status = status;
    this.code = code;
  }
}

async function spawnFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    const error = data.error;
    throw new SpawnProfileApiError(
      (typeof error === 'string' && error) || error?.message || `Spawn profile request failed (${res.status}).`,
      res.status,
      typeof error?.code === 'string' ? error.code : undefined,
    );
  }
  return data as T;
}
const spawnProfileFetch = <T,>(path: string, options: RequestInit = {}) => spawnFetch<T>(`/api/v2/spawn/profiles${path}`, options);

export const listSpawnProfiles = async (): Promise<SpawnSyncedProfile[]> => {
  const data = await spawnProfileFetch<{ profiles?: SpawnSyncedProfile[] }>('');
  return (data.profiles ?? []).filter((profile) => !profile.deleted && profile.bundle);
};

export const createSpawnProfile = async (input: {
  name: string;
  vendor: SpawnProfileVendor;
  provider: SpawnProfileProvider;
}): Promise<SpawnSyncedProfile> => {
  const id = crypto.randomUUID();
  const bundle = buildSpawnProfileBundle({ id, ...input });
  const done = await spawnProfileFetch<{ profileId: string; rev: number }>(`/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ baseRev: 0, bundle }),
  });
  return { profileId: done.profileId, rev: done.rev, bundle, updatedAt: new Date().toISOString() };
};

/** A 409 from rename or remove means the profile changed on a device, or in another tab, since this page read it. */
export const isStaleProfile = (error: unknown) => error instanceof SpawnProfileApiError && error.status === 409;

/** Rename on the account. Only the name changes: the rest of the definition, config files included, is sent back as it was. */
export const renameSpawnProfile = async (profile: SpawnSyncedProfile, name: string): Promise<SpawnSyncedProfile> => {
  if (!profile.bundle) throw new SpawnProfileApiError('This profile has no definition to rename.', 400);
  const bundle = renameSpawnProfileBundle(profile.bundle, name);
  const done = await spawnProfileFetch<{ profileId: string; rev: number }>(`/${encodeURIComponent(profile.profileId)}`, {
    method: 'PUT',
    body: JSON.stringify({ baseRev: profile.rev, bundle }),
  });
  return { ...profile, rev: done.rev, bundle, updatedAt: new Date().toISOString() };
};

/** Remove from the account. Each device that has it is then asked whether to remove its own copy; none is removed on its own. */
export const removeSpawnProfile = async (profile: SpawnSyncedProfile): Promise<void> => {
  await spawnProfileFetch(`/${encodeURIComponent(profile.profileId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ baseRev: profile.rev }),
  });
};

export interface SpawnSyncDevice {
  deviceId: string;
  name: string;
  version: string | null;
  profiles: number;
  conflicts: number;
  lastSyncAt: string;
}

export const listSpawnDevices = async (): Promise<SpawnSyncDevice[]> =>
  (await spawnFetch<{ devices?: SpawnSyncDevice[] }>('/api/v2/spawn/devices')).devices ?? [];

/** Forget a device from the list. It signs nothing out; the device appears again on its next sync. */
export const forgetSpawnDevice = async (deviceId: string): Promise<void> => {
  await spawnFetch(`/api/v2/spawn/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
};
