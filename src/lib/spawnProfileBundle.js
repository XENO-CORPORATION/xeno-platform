// The one shape a website-created Spawn profile takes before it reaches
// /api/v2/spawn/profiles. It is a profile DEFINITION only: no config files,
// so nothing in it can be a vendor credential or a session transcript.
// Spawn's sync applies the same bundle shape on every device.

export const SPAWN_PROFILE_VENDORS = ['claude', 'codex', 'agy', 'opencode', 'xeno-agent'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildSpawnProfileBundle({ id, name, vendor, provider }) {
  if (!UUID.test(String(id ?? ''))) throw new Error('A Spawn profile id must be a UUID.');
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.length > 60) throw new Error('Give the Spawn profile a name of 1 to 60 characters.');
  if (!SPAWN_PROFILE_VENDORS.includes(vendor)) throw new Error('Choose a supported Spawn agent for the profile.');
  if (provider !== null && provider !== 'vendor' && provider !== 'xeno') throw new Error('Choose how the profile should sign in.');
  return { schema: 1, id, name: cleanName, vendor, provider, agentId: null, files: {} };
}

// A rename from the website keeps everything else in the bundle as it is, config files included: rebuilding the bundle
// from the name alone would sync empty config to every device. Only the name changes.
export function renameSpawnProfileBundle(bundle, name) {
  if (!bundle || bundle.schema !== 1 || typeof bundle.id !== 'string') throw new Error('This Spawn profile cannot be renamed here.');
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.length > 60) throw new Error('Give the Spawn profile a name of 1 to 60 characters.');
  return { ...bundle, name: cleanName };
}
