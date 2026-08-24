# Chat — handoff to backend

The front end of the chat is finished and verified. This is what a backend engineer
needs in order to pick it up, and — more usefully — what has **not** been proven.

Branch: `feature/project-settings-one-door`. Both this repo and
`../xeno-elements-foundations` (`feat/soft-chrome`) are pushed and clean.

The design-system side of the work is recorded in `CHAT-ELEMENTS-SPEC.md`. You do not
need to read it to work on the backend. It matters here only for one rule: **the chat's
markup and its `data-` attributes are a tested surface.** Ten tests and sixteen probes
select on them. Changing a `data-` hook or a control's class to make a backend change
easier will go red, and §5.5 exists because that happened four times.

---

## 1. The contract, as it actually stands

**The backend is already implemented and mounted.** This is not a build-it task.

| | |
|---|---|
| Persistence client | `src/services/chatService.ts` — 21 methods |
| Server routes | `src/server/routes/chatRoutes.js` — 21 routes, mounted at `/api/chat` (`index.js:610`) |
| Generation | `POST /api/chat/generate` — handled inline at `src/server/index.js:1160` |

Every client method has a matching route. Checked one by one, not assumed.

`/api/chat` sits behind `databaseMiddleware` + `chatAuthMiddleware`; `/api/chat/generate`
behind `databaseMiddleware` + `authMiddleware` and a `generationLimiter` (`index.js:200`).

### Other endpoints the chat calls

`/api/ai/chat` · `/api/fetch-metadata` · `/api/piston/runtimes` · `/api/piston/execute` ·
`/api/browser/{action,content,render,screenshot-url}` · `/api/openai-realtime-webrtc`

### Auth

One boundary, one token. `chatService.ts:89`:

```js
const token = localStorage.getItem('xenoos_auth_token');
// -> Authorization: `Bearer ${token}`
```

Without it every `/api/chat` call is a 401. That is the reason for the gap in §2.

---

## 2. What has NOT been verified, and it is the first thing to do

**The send path has never been observed reaching the database.**

Everything upstream of the network call is proven: the composer, the optimistic
message, the streaming UI, the error branches. What has never run end to end is

```
composer -> POST /api/chat/generate -> chatService.addMessagesBatch -> rows in the DB
```

It is blocked on a local 401/500, i.e. on nobody having signed in while testing. It is
**not** a known bug — it is an unobserved path, which is a different and more dangerous
thing to inherit. Treat it as unproven until you watch the rows land.

The same blocker hides **107 of 245 adopted UI components** from the probe suite
(`npm run probe:chat:full` reports coverage). Projects, artifacts, scheduled tasks,
share links, attachments and the customize page are all decided in source and never
once measured in a browser, because the mock does not render them and the real data
needs a session.

**Signing in locally unblocks both at once.** It is the highest-value single action
available on this codebase right now.

---

## 3. The mock will lie to you if you do not know it is there

`src/components/playground/Chat/chatMock.ts:31`

```ts
const MOCK_ENABLED =
  (import.meta.env.DEV && readFlag() !== 'off') || readFlag() === 'on';
```

**In dev it is ON by default.** So a chat that answers you locally may not have touched
your server at all. Before debugging anything backend-shaped:

```js
localStorage.setItem('xeno_chat_mock', 'off'); // then reload
```

The gate is correct — `import.meta.env.DEV` means it cannot ship — but it is the first
thing to rule out when a request you expected never arrives.

---

## 4. Running it

```bash
npm run dev     # concurrently: the API server AND vite on :5183
```

`npm run start` alone gives you the Vite half only, and then **every** `/api/*` call is
connection-refused. That looks exactly like a broken backend and is not one.

**Known state right now:** the server on :5183 needs a restart before it will serve.
Installing a devDependency moved Vite's optimize-dep hash and the running process kept
serving the old one, so `react-dom_client` returns `504 Outdated Optimize Dep` and the
chat root never mounts. The route still answers 200 and the module still compiles. A
reload does not clear it; a restart does.

To run the probes without touching a server someone else is using:

```bash
npx vite --config vite.probe.config.ts          # :5199, its own cacheDir
CHAT_ORIGIN=http://localhost:5199 npm run probe:chat
```

---

## 5. Gates, and what each one is actually for

```bash
npm run check:types        # ratchet: fails if type errors RISE (baseline 456 / 20 in chat)
npm run check:names        # undeclared identifiers -> ReferenceError at runtime
npm run check:jsx-comments # comments that render as visible text
npm run test:chat          # 10 tests
npm run probe:chat         # 14 browser probes, ~190s
```

Two of these exist because of failures worth knowing about before you trust a green run:

- **`check:types` is a ratchet, not a gate.** There was no typechecker at all: `typescript`
  was absent from `devDependencies`, so `npx tsc` fetched a **joke package** of that name
  which prints a banner and **exits 0**. The first check of this repo came back "0 errors"
  and was nearly believed. Lower the baseline when the count falls; never raise it.
- **`check:names` exists because the build strips types without checking them.** Vite/esbuild
  will happily ship a `ReferenceError`. Seven still exist outside the chat (Office,
  AudioGeneration, ImageStudio) — pre-existing, reported, not fixed here.

---

## 6. Open, and whose

| | Owner |
|---|---|
| Sign in locally: proves the send path, unblocks 107 unmeasured components | **backend / whoever has a session** |
| 7 `ReferenceError`s outside the chat — `npm run check:names` lists them with file and line | the authors of those files (fixes need their intent) |
| Add `@xenosystem/*` path mapping fallout: 18 pre-existing app-logic type errors in the chat (`ChatMessage.modelId`, `XenoSource` shapes, `BrowserAction`) | product |
| 2 `style` props on adopted components — §3.4 forbids them; both change appearance if removed | design |
| `--chat-overlay` / `--chat-control-strong` have no variant member; the blue cluster in `SearchChatInterface`; per-theme token collisions | design system — `DESIGN_SYSTEM.md` is **LOCKED** |
| `src/pages/Dashboard.tsx` is unreferenced — delete or keep | product |

---

## 7. If you change the front end

Run `npm run test:chat` **before** you touch anything, so you know which reds are yours.
That is not boilerplate: a hook was dropped and a test stayed red for days because nobody
had a baseline.

And do not restart a dev server you did not start. It is somebody's working session, and
`vite.probe.config.ts` above exists precisely so you never have to.
