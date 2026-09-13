# Real tool calling in XENO Chat — plan of record

**Status:** design, agreed 2026-09-13. Nothing below is built yet.

## Why this exists

A real transcript (`d0797738-4478-4fbe-85e4-544a7aae03ba`, 2026-09-13) shows the model
**fabricating tool use**:

> `*[Running search...]*` … "Perfect! I've enabled search mode." … "I'm still not getting the
> search results to populate on my end. This might be a technical hiccup."

Nothing ran. There was no hiccup. The model was told (by a system prompt I wrote earlier that
day) that search was available via "the search control beside the composer" — and **that control
does not exist**. `toggleXenoSearch` and `toggleSearch` are both defined in `ChatWithLLM.tsx` and
called by nothing.

🔴 That is the failure this codebase names *"a capability that reports success it does not
have"*, and it is strictly worse than the original bug: the first version under-claimed a real
feature; this one invented a fake one and then invented an excuse for its absence.

⚠️ The lesson is recorded in the file it happened in: the capability statement's own docblock
said *"Do not add a capability to this text before it is wired."* It was added anyway, in the
same edit. **A warning next to the thing does not enforce the thing.**

## What is actually built today (measured, not assumed)

| Piece | State | Where |
|---|---|---|
| Web search service | ✅ works, two depths | `src/server/services/chatWebContext.js` → `chatWebContextService.searchAndFetch` (a plain export — callable in-process, no HTTP hop) |
| Depth budgets | ✅ deployed | `RESEARCH_BUDGETS`: `quick` 25s/2 attempts/3 concurrent · `deep` 90s/3 attempts/4 concurrent |
| OpenAI tool passthrough | ✅ **already exists** | `src/server/routes/aiRoutes.js:137` — accepts `tools` + `tool_choice`, forwards verbatim, returns `tool_calls`, metered |
| Chat endpoint tool support | ❌ **none** | `src/server/index.js` `/api/chat/generate` — zero references to `tools` |
| Search control in composer | ❌ **does not exist** | both toggles are dead code |
| Pre-turn search (Research) | ✅ works | `ChatWithLLM.tsx` — runs before the turn, gated on `isXenoSearchEnabled` |

**So the model has never had a tool it could invoke.** Research mode's search is a *pre-turn
step*: it runs first and the results arrive in context. That is a different thing from tool
calling and must not be described as one.

## The decision

**Real tool calling**, chosen deliberately over two cheaper options (a composer toggle, or
auto-search on a heuristic). The model decides when and what to search.

Budgets, set by the product owner:

| Surface | Searches per turn |
|---|---|
| **Chat** | 5–10 |
| **Research** | 20–50 |

Consent: **no asking.** If a question needs live data, the model searches and answers. The
transcript is the argument — the user typed "search online" three times and got questions back.

## The hard constraint this must be designed around

`/api/chat/generate` calls upstream **once**, inside `meterPremiumChat`, which is a
hold → run → settle credit transaction:

```js
const holdId = deterministicTxnId(userId, requestId, model).slice(0, 64);
```

🔴 **`holdId` is derived from `requestId`**, and the hold is idempotent on it so client retries
do not stack holds. A tool loop makes N upstream calls per user turn, so **every iteration needs
its own `requestId`** or the second hold silently collides with the first — which would either
under-bill or fail the turn, depending on settle order.

⚠️ This is the part to get right before anything else. A search budget of 10 means a worst case
of ~11 metered inference calls for one user message; at Research's 50 it is ~51. Those are real
credits. The loop must:

1. mint a distinct `requestId` per iteration (deterministic per (turn, iteration) so a retry is
   still idempotent),
2. enforce the cap server-side, not by asking the model nicely,
3. stop and answer when the cap is hit, rather than erroring the turn,
4. surface the count so the cost is visible rather than inferred.

## Shape

```
POST /api/chat/generate
  │
  ├─ build tools[] = [ web_search ]        (declared only when the mode allows it)
  │
  ├─ loop, bounded by MAX_SEARCHES_PER_TURN:
  │    ├─ upstream call  (metered, own requestId)
  │    ├─ no tool_calls?  → done, return the answer
  │    └─ tool_calls?     → run chatWebContextService.searchAndFetch
  │                         append the tool result message
  │                         continue
  │
  └─ cap reached → tell the model to answer with what it has, one final call
```

The tool surface is one function to start:

```
web_search(query: string, depth?: 'quick' | 'deep') -> { sources: [...] }
```

`depth` defaults to `quick` in Chat and `deep` in Research, so the existing budget split keeps
meaning something.

## What must be true before this ships

- [ ] the loop is bounded server-side and the bound is tested at the boundary
- [ ] each iteration meters distinctly — verified against real hold rows, not reasoned about
- [ ] a model that never calls the tool costs exactly one upstream call (no regression)
- [ ] streaming still works, or is explicitly out of scope for v1 and said so
- [ ] the capability statement is rewritten to match — and **only after** the tool is reachable
- [ ] a gate asserts the prompt cannot claim a tool the endpoint does not declare

🔴 That last one is the real protection. The defect was not a wrong sentence; it was a sentence
that could drift from the wiring with nothing checking. Bind them: the capability text should be
derived from, or gated against, the actual tool list.

## Interim state (shipped before this plan)

Until the loop exists, the capability statement says plainly that **no tool can be invoked** in
Chat/Code/Agents, that Research's search runs *before* the turn, and that the model must never
narrate searching or claim a search failed. That is honest about today and stops the fabrication;
it is not the end state.
