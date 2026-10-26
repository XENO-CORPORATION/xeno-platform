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
};

function httpBackend(baseUrl, token) {
  const call = async (path, body) => {
    const res = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => { throw new ComputeUnavailable(`XENO Compute did not answer: ${e.message}`); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `XENO Compute refused (${res.status})`), { code: data.code || 'compute_refused', statusCode: 502 });
    return data;
  };
  return {
    name: 'http',
    create: (m) => call('/v1/machines', { machineId: m.id, workspaceId: m.workspaceId, size: m.size, image: m.image }),
    start: (m) => call(`/v1/machines/${m.id}/start`, {}),
    stop: (m) => call(`/v1/machines/${m.id}/stop`, {}),
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
