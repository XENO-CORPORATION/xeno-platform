export type SpawnProfileVendor = 'claude' | 'codex' | 'agy' | 'opencode' | 'xeno-agent';
export type SpawnProfileProvider = 'vendor' | 'xeno' | null;
export interface SpawnProfileBundle {
  schema: 1;
  id: string;
  name: string;
  vendor: SpawnProfileVendor;
  provider: SpawnProfileProvider;
  agentId: string | null;
  files: Record<string, string>;
}
export const SPAWN_PROFILE_VENDORS: SpawnProfileVendor[];
export function buildSpawnProfileBundle(input: {
  id: string;
  name: string;
  vendor: SpawnProfileVendor;
  provider: SpawnProfileProvider;
}): SpawnProfileBundle;
export function renameSpawnProfileBundle(bundle: SpawnProfileBundle, name: string): SpawnProfileBundle;
