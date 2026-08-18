/*
 * Where the probes point.
 *
 * Seventeen scripts hardcoded `http://localhost:5183`, which is the user's own dev server — the one
 * thing in this repo that must not be restarted. That was fine until it was not: installing a
 * devDependency invalidated Vite's optimize-dep cache, so the running server began answering
 * `504 Outdated Optimize Dep` for `react-dom_client` and the chat root stopped mounting. The route
 * still served 200 and the module still compiled; nothing was wrong with the code, and twelve probes
 * reported a crash. There was no way to point them anywhere else.
 *
 * So: one origin, overridable.
 *
 *   CHAT_ORIGIN=http://localhost:5199 npm run probe:chat
 *
 * The default is unchanged, so nothing about the normal run moves. What it buys is a way to verify
 * against a SECOND Vite instance while the first is unavailable — started with its own `cacheDir`, so
 * it never writes to the `node_modules/.vite` the user's server is reading.
 */
export const CHAT_ORIGIN = process.env.CHAT_ORIGIN ?? 'http://localhost:5183';
export const CHAT_URL = `${CHAT_ORIGIN}/overview/chat/llm`;
