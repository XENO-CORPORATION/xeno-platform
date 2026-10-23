import {
  buildSpawnProfileBundle,
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

async function spawnProfileFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v2/spawn/profiles${path}`, {
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
