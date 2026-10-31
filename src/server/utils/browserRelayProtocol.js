/**
 * The XENO Extension relay wire: frame shapes, validation and the one place a frame's meaning is decided.
 * Pure — no database, no socket — so the rules are testable without a connection, and the service
 * (`services/browserRelay.js`) never re-decides what a frame is.
 *
 * Contract: `docs/CHAT-TOOL-CALLING-PLAN.md` → "Browser tools". Agreed with the xeno-extension session
 * 2026-10-16/17. The extension builds to this; changing a frame here is a coordinated change.
 *
 * 🔴 WHY EVERY FRAME IS VALIDATED RATHER THAN TRUSTED. The peer is an extension running inside a browser
 * the person also uses to visit arbitrary web pages. A malformed or oversized frame is not a bug to
 * tolerate — it is either a broken build or a hostile page trying to steer the relay. Both are refused
 * with a reason, because a dropped frame and a refused frame must never look alike (§8: an error is
 * actionable, a silence is not).
 *
 * Frames are JSON text, one per WebSocket message, bounded at MAX_FRAME_BYTES. A tool RESULT may carry
 * page content, which is `untrusted` by construction (§5) — it is relayed to the model and never
 * executed as an instruction.
 */

/** A frame larger than this is refused before it is parsed. A browser tool result can hold page text. */
export const MAX_FRAME_BYTES = 1024 * 1024;

/** Tool names must survive a round trip through every provider's function-name rule (§3.1). */
export const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** The extension declares its whole tool set once, in `hello`; this caps what one browser may offer. */
export const MAX_TOOLS = 64;

/** A protocol error carries a code the extension can switch on, never a sentence it must parse. */
export class RelayProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.closeCode = 1002;   // WS protocol error — the peer sent something this protocol does not define
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;

/** Parse one inbound frame. Throws `RelayProtocolError` with a code the extension can act on. */
export function parseFrame(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
    throw new RelayProtocolError('frame_too_large', `Frames must be under ${MAX_FRAME_BYTES} bytes.`);
  }
  let frame;
  try { frame = JSON.parse(text); } catch { throw new RelayProtocolError('bad_frame', 'Every frame is JSON.'); }
  if (!isObject(frame)) throw new RelayProtocolError('bad_frame', 'Every frame is a JSON object.');
  if (!short(frame.type, 32)) throw new RelayProtocolError('bad_frame', 'Every frame carries a type.');
  return frame;
}

/** The tool list the extension declares in `hello`. Shapes are passed through verbatim: the chat's
 *  model needs the schema the extension gives its own loop, and translating it here would be a second
 *  definition of the same tool (the drift §12.1 rule 4 exists to prevent). */
export function parseTools(raw) {
  if (!Array.isArray(raw)) throw new RelayProtocolError('bad_hello', 'hello.tools must be an array.');
  if (raw.length > MAX_TOOLS) throw new RelayProtocolError('bad_hello', `A browser may offer at most ${MAX_TOOLS} tools.`);
  const seen = new Set();
  const tools = [];
  for (const t of raw) {
    if (!isObject(t) || !TOOL_NAME.test(String(t.name || ''))) {
      throw new RelayProtocolError('bad_hello', 'Each tool needs a name matching ^[a-z][a-z0-9_]{0,63}$.');
    }
    if (seen.has(t.name)) throw new RelayProtocolError('bad_hello', `Duplicate tool name: ${t.name}`);
    seen.add(t.name);
    tools.push({
      name: t.name,
      description: typeof t.description === 'string' ? t.description.slice(0, 2000) : '',
      parameters: isObject(t.parameters) ? t.parameters : { type: 'object', properties: {} },
    });
  }
  return tools;
}

/** The projects a Corpus PC turned on, from its `hello`. An id and a name. A name is only ever a folder's last segment, so anything
 *  longer is cut to that: this row is read back to agents, and a full path says who someone is and how their disk is laid out. */
export const MAX_PROJECTS = 200;
export function parseProjects(raw) {
  if (!Array.isArray(raw)) throw new RelayProtocolError('bad_hello', 'hello.projects must be an array.');
  if (raw.length > MAX_PROJECTS) throw new RelayProtocolError('bad_hello', `A PC may offer at most ${MAX_PROJECTS} projects.`);
  const seen = new Set();
  return raw.map((p) => {
    if (!isObject(p) || !/^[A-Za-z0-9_-]{1,64}$/.test(String(p.id || ''))) throw new RelayProtocolError('bad_hello', 'Each project needs an id.');
    if (seen.has(p.id)) throw new RelayProtocolError('bad_hello', `Duplicate project id: ${p.id}`);
    seen.add(p.id);
    const name = String(p.name ?? '').split(/[\\/]/).filter(Boolean).pop()?.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
    if (!name) throw new RelayProtocolError('bad_hello', 'Each project needs a name.');
    return { id: p.id, name };
  });
}

/** `auth` — the extension's first frame, carrying the access token and its DPoP proof. */
export function parseAuth(frame) {
  if (!short(frame.accessToken, 8192)) throw new RelayProtocolError('bad_auth', 'auth.accessToken is required.');
  if (!short(frame.dpop, 8192)) throw new RelayProtocolError('bad_auth', 'auth.dpop (the proof) is required.');
  return { accessToken: frame.accessToken, proof: frame.dpop };
}

/** Any frame that names one call. `callId` is the idempotency key end to end (RFC 9449's `jti` discipline
 *  applied to work instead of to a proof) — a duplicate frame about a call already finished is ignored,
 *  never executed twice. */
export function parseCallRef(frame) {
  if (!short(frame.callId, 64)) throw new RelayProtocolError('bad_call', 'callId is required.');
  return { callId: frame.callId };
}

const APPROVAL_STATES = new Set(['waiting', 'approved', 'denied']);

/** `approval` — approval happens in the browser that acts (owner decision 2026-10-16). The platform's
 *  only job is to keep the caller waiting and to say so in the transcript. */
export function parseApproval(frame) {
  const { callId } = parseCallRef(frame);
  if (!APPROVAL_STATES.has(frame.state)) {
    throw new RelayProtocolError('bad_approval', 'approval.state must be waiting, approved or denied.');
  }
  return { callId, state: frame.state };
}

/** `result` — the outcome of one call. Exactly one of `output` (ok) or `error` (not ok) is meaningful;
 *  an ok result with no output is allowed and reads as "done, nothing to report". */
export function parseResult(frame) {
  const { callId } = parseCallRef(frame);
  if (typeof frame.ok !== 'boolean') throw new RelayProtocolError('bad_result', 'result.ok must be a boolean.');
  if (!frame.ok) {
    const e = frame.error;
    if (!isObject(e) || !short(e.code, 64)) {
      throw new RelayProtocolError('bad_result', 'A failed result carries error.code.');
    }
    return {
      callId, ok: false,
      error: { code: String(e.code).slice(0, 64), message: typeof e.message === 'string' ? e.message.slice(0, 2000) : '' },
    };
  }
  return { callId, ok: true, output: frame.output === undefined ? null : frame.output };
}

/** The server's own frames. Built here so both the socket and any test speak one shape. */
/**
 * What rides this wire. The frames are the same; these are the differences, and there are few on purpose. A Corpus answer keeps its
 * whole size on the record because nothing else reads it and the row forgets it at once (browserRelay.forgetCall).
 *
 * 🔴 XENO Corpus's desktop client decides what to do from the WORDS of a 4403 reason: "scope" asks the person to sign in again, "turned off"
 * keeps its installation id, "revoked" means removed and mints a new one when the person asks. So they're a contract: reading "turned off" as
 * "removed" would let a new id walk round the person's switch. Changing one is a coordinated change, and corpus-relay.test.mjs pins all three.
 */
export const RELAY_SURFACES = Object.freeze({
  browser: Object.freeze({ surface: 'browser', path: '/api/v2/browser/connect', scope: 'browser:connect', noun: 'browser', off: 'XENO chats are not allowed to use this browser', signIn: 'Connecting a browser needs a sign-in bound to this browser’s key. Sign in from the extension.' }),
  corpus: Object.freeze({ surface: 'corpus', path: '/api/v2/corpus/connect', scope: 'corpus:connect', noun: 'PC', off: 'This PC is turned off in your XENO account', signIn: 'Connecting a PC needs a sign-in bound to this PC’s key. Sign in from XENO Corpus.', recordCap: 400_000, note: 'The answer was too long and this is only its start. Ask a narrower question.' }),
});

export const outbound = {
  challenge: (nonce) => ({ type: 'challenge', nonce }),
  ready: (installation) => ({ type: 'ready', installation }),
  call: (call) => ({
    type: 'call', callId: call.callId, tool: call.tool, args: call.args,
    conversationId: call.conversationId ?? null, turnId: call.turnId ?? null, tabGroup: call.tabGroup ?? null,
  }),
  pong: () => ({ type: 'pong' }),
  error: (code, message) => ({ type: 'error', code, message }),
};

/**
 * Close codes, and the reason the four are distinct rather than one "auth failed": the extension's
 * correct behaviour differs for each. 4401 refresh and reconnect; 4403 stop and tell the person in
 * settings; 4408 the client is broken, retry immediately; 4409 stop — another connection for this
 * installation has taken over, and reconnecting would flap the two against each other.
 */
export const CLOSE = Object.freeze({
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  NO_AUTH: 4408,
  REPLACED: 4409,
});

/** The most a result is allowed to say about itself on the wire vs on the record. A page can be
 *  arbitrarily large; the model gets a bounded transcript, never the whole DOM. */
export const RESULT_WIRE_CAP = 400_000;
export const RESULT_RECORD_CAP = 60_000;

/** Bound one result's stored copy without lying about it: the truncation is stated, never silent. */
export function boundOutput(output, cap = RESULT_RECORD_CAP, note = 'The step returned more than the turn can carry. Ask the browser for a narrower answer.') {
  const json = JSON.stringify(output ?? null);
  if (json === undefined) return { output: null, truncated: false };
  if (json.length <= cap) return { output, truncated: false };
  return {
    output: { truncated: true, excerpt: json.slice(0, cap), note },
    truncated: true,
  };
}
