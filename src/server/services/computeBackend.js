/**
 * The platform's door to xeno-compute — the service that places, starts and stops real machines (xeno-compute/SPEC.md
 * §6). The platform owns the record and the money; it never runs a machine itself.
 *
 * xeno-compute is docs-first and has no running service yet. So the default backend REFUSES every call with
 * `compute_unavailable` unless XENO_COMPUTE_API_URL is set: nothing pretends a machine started, and no time is billed
 * for a machine that does not exist. Tests (and, later, the real client) are injected with setComputeBackend().
 */

export class ComputeUnavailable extends Error {
  constructor(message = 'XENO Compute is not available yet') { super(message); this.name = 'ComputeUnavailable'; this.code = 'compute_unavailable'; this.statusCode = 503; }
}

/** The calls the platform makes. Each takes the platform's machine id, so a retry is idempotent on the other side. */
const unavailable = {
  name: 'unavailable',
  async create() { throw new ComputeUnavailable(); },
  async start() { throw new ComputeUnavailable(); },
  async stop() { throw new ComputeUnavailable(); },
  async remove() { throw new ComputeUnavailable(); },
  async exec() { throw new ComputeUnavailable(); },
  async readFile() { throw new ComputeUnavailable(); },
  async writeFile() { throw new ComputeUnavailable(); },
};

function httpBackend(baseUrl, token) {
  // start and stop move the machine's home folder (put back on start, saved on stop), which can take minutes
  const call = async (path, body, timeoutMs = 30_000) => {
    const res = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((e) => { throw new ComputeUnavailable(`XENO Compute did not answer: ${e.message}`); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `XENO Compute refused (${res.status})`), { code: data.code || 'compute_refused', statusCode: 502 });
    return data;
  };
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const refused = async (res) => {
    const data = await res.json().catch(() => ({}));
    return Object.assign(new Error(data.error || `XENO Compute refused (${res.status})`), { code: data.code || 'compute_refused', statusCode: res.status === 409 ? 409 : 502 });
  };
  const io = async (path, init, timeoutMs) => {
    const res = await fetch(new URL(path, baseUrl), { ...init, headers: { ...auth, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) })
      .catch((e) => { throw new ComputeUnavailable(`XENO Compute did not answer: ${e.message}`); });
    if (!res.ok) throw await refused(res);
    return res;
  };
  return {
    name: 'http',
    /** Run one command; resolves to the machine's streaming NDJSON Response. */
    exec: (m, body) => io(`/v1/machines/${m.id}/exec`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, body.timeoutMs + 30_000),
    readFile: async (m, path) => Buffer.from(await (await io(`/v1/machines/${m.id}/files?path=${encodeURIComponent(path)}`, { method: 'GET' }, 120_000)).arrayBuffer()),
    writeFile: async (m, path, buf) => (await io(`/v1/machines/${m.id}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body: buf }, 120_000)).json(),
    create: (m) => call('/v1/machines', { machineId: m.id, workspaceId: m.workspaceId, size: m.size, image: m.image }),
    start: (m) => call(`/v1/machines/${m.id}/start`, {}, 15 * 60_000),
    stop: (m) => call(`/v1/machines/${m.id}/stop`, {}, 15 * 60_000),
    remove: (m) => call(`/v1/machines/${m.id}/delete`, {}),
  };
}

let override = null;
export function setComputeBackend(b) { override = b; }
export function computeBackend() {
  if (override) return override;
  const url = process.env.XENO_COMPUTE_API_URL;
  return url ? httpBackend(url, process.env.XENO_COMPUTE_API_TOKEN || '') : unavailable;
}
