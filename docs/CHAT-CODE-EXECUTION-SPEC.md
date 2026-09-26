# Per-chat code execution in XENO Chat — proposal

**Status:** PROPOSAL, 2026-09-26 (corrected same day — see §0). Nothing below is built yet.

**What this owns:** the subsystem that gives each chat an isolated place to run code — a
*persistent per-chat workspace* plus *ephemeral, pooled compute* — and how generated files persist
and get metered. It sits **under** `CHAT-TOOL-CALLING-PLAN.md`: the `run_code` tool is a tool on that
plan's existing loop (§5 here), and it reuses that plan's per-iteration `requestId` + hold→run→settle
metering discipline verbatim. This doc specifies the compute and storage the loop's new tool binds to.

## 0. Correction — the substrate is `xenorun`, NOT `xeno-use`

The first draft proposed running chat code on `xeno-use`. **That was wrong**, and the layer boundary
is worth stating so it is not re-confused:

| Repo | What it is | Chat code execution? |
|---|---|---|
| **`xeno-use`** | the agent's **hands** — *device / computer use*. Screenshot, click, drag, type, launch/kill apps, a11y tree, across desktop/mobile/tablet/VR. Its "sandbox" is where a *device session* runs; its verbs are `use.click`, `use.screenshot`, … It has **no run-code verb**. | ❌ out of scope. Using it here is the computer-use layer doing a job it does not own. |
| **`xenorun`** | the owned **code-execution engine**: Docker-isolated, multi-language (Python/JS/TS/Go/Rust/…), resource limits, **real-time streaming**, MIT-licensed. Already deployed (`XENORUN_URL`). | ✅ this is the substrate. |

The correction makes the design **simpler and stronger**, not a compromise: xenorun is the layer that
already owns "run code," it is deployed, it is MIT (no AGPL out-of-process hop), and its streaming is
native. There is **no substrate fork** — the only reason the first draft had one was the wrong premise.

## 1. Why this exists

The owner asked for ChatGPT/Claude parity: *"do we have all of these? … account etc based logic."*
The industry model (the analysis the owner pasted, corroborated in §3) is three parts, **decoupled on
purpose**:

| Part | ChatGPT / Claude | Ours |
|---|---|---|
| **Workspace** | persistent per *conversation* | per-chat, platform-owned: Postgres + R2 |
| **Compute** | ephemeral, on-demand, **pooled** — not one VM per chat, not per account | **`xenorun`**, one-shot per exec |
| **Tool** | model-invoked | `run_code` on the existing tool loop |

The load-bearing insight: **only the workspace is per-chat and persistent; the compute is ephemeral.**
That is what makes "proper scale" tractable — compute is sized to *concurrency*, never to chat count —
and xenorun's existing one-shot model **already is** that ephemeral compute. Statefulness is supplied
by the platform **restoring the chat's workspace into each run and capturing what the run writes**, not
by keeping a container alive. So there are no idle per-chat containers to reap — a real simplification
the correct architecture buys us over a naive "one sandbox per chat."

## 2. What is actually built today (measured — 2026-09-26)

| Piece | State | Where |
|---|---|---|
| Code-execution engine | ✅ deployed | `xenorun` (`XENORUN_URL=http://xenorun:3000`), Docker-isolated, multi-language, WebSocket streaming, resource limits |
| Backend proxy to it | ✅ | `/api/piston/execute` + `/api/piston/runtimes` in `src/server/index.js` (Piston-compatible shape) |
| Manual "Run" button | ✅ works | `handleCodeBlockRun` → `/api/piston/execute`. The **model cannot invoke it** |
| Statefulness | ❌ **none** | each exec gets a fresh 256 MB `/workspace` tmpfs, discarded on exit (`xenorun/src/engine/executor.ts`); no files carried in or out |
| Chat tool loop | ✅ works | `streamToolLoop`; offers `WEB_SEARCH_TOOL` + `GENERATE_IMAGE_TOOL` (`aiRoutes.js:610`). **No code tool** |
| Per-chat workspace | ❌ none | `chat_conversations` has no workspace; no `chat_workspaces` table; no per-chat file store |

So xenorun gives us **isolated one-shot execution** (live). The two gaps for parity are: (a) it takes
no input files and returns no output files — it is snippet-in, stdout-out; and (b) the model can't call
it. Both are additive.

## 3. Evidence — what the leaders do, and the mistakes to avoid

- **ChatGPT (Code Interpreter / Advanced Data Analysis):** a per-conversation working directory
  (`/mnt/data`) on an ephemeral, network-isolated container that idles out and is recreated with the
  working directory restored. Files created are offered as downloads. Compute is a shared pool.
- **Claude (Code Execution tool / Files API):** container-based bash+Python sandbox, per-container
  filesystem, memory/CPU/time limits, **no outbound network by default**, files carried via Files API.
- **Mistakes to avoid:** (a) *always-on per-chat compute* does not scale — neither leader does it;
  bind compute to concurrency (xenorun already does). (b) *network-enabled sandboxes by default* are an
  SSRF/exfiltration surface — both default to no egress; **verify xenorun runs `--network none`**.
  (c) *unbounded workspaces* cost storage forever — cap and expire. (d) *trusting the model to stay in
  budget* — the cap is enforced by the substrate, the same lesson `CHAT-TOOL-CALLING-PLAN.md` records
  for search.

Evidence vs inference: per-conversation persistence and no-egress defaults are documented product
behaviour; exact idle timeouts and pool internals are unpublished and treated as design targets.

## 4. The one design choice (mine to recommend; not an infra/owner gate)

With xeno-use gone, there is no infrastructure decision and no substrate fork. The only choice left is
**where the "run with these input files, return these output files" capability lives**, and it has a
clear right answer:

- **Recommended — add file-in/file-out to `xenorun`.** A general primitive extension: an exec accepts a
  set of input files written into `/workspace` before it runs, and returns the files present in
  `/workspace` after. This is reusable by any consumer, keeps xenorun the owner of "execute with
  files," and keeps the chat backend thin. xenorun stays a *stateless* engine — it never learns what a
  "chat" is; the platform supplies the files each call. This is "extend the owned layer that owns this."
- **Rejected — emulate it in the chat backend** by base64-injecting files into the exec command and
  scraping stdout for outputs. It works without touching xenorun but bakes a fragile file protocol into
  a consumer and gives no other consumer the capability. A route-around, not an extension.

## 5. The `run_code` tool (lives on the CHAT-TOOL-CALLING-PLAN loop)

- A new tool offered beside `WEB_SEARCH_TOOL` / `GENERATE_IMAGE_TOOL`, gated on xenorun being reachable
  (so it never advertises a capability it lacks — the plan's core rule).
- Reuses the plan's **per-iteration `requestId`** and metering for the inference calls. **Execution is
  metered separately** (§7) — different resource.
- Budget: an execution cap per turn, enforced server-side, stop-and-answer on cap (mirrors search).
- No egress from the sandbox (verify xenorun's network posture); no consent prompt to run (parity).

## 6. Architecture — the seam and the data model

- **`chat_workspaces`** (Postgres): `chat_id → workspace_id`, an R2 prefix, size + file count, last
  activity, quota. One per conversation, created lazily on first `run_code`. Additive migration.
- **Workspace bytes in R2** under the workspace prefix, written through the **one gated choke point**
  (`scripts/lib/r2-upload.mjs` / the runtime equivalent — ABSOLUTE RULE §2b), never a second uploader.
- **`SandboxSession`** helper in the chat backend — `open(workspace)` restores the workspace's files,
  `exec(code)` runs via xenorun's file-in/file-out API and streams output, `collectOutputs()` returns
  the files the run wrote. A thin wrapper over the xenorun proxy; no new transport.
- **Isolation is per CHAT, not per account:** the workspace is keyed by `chat_id`; a run is handed
  exactly one chat's files. Two chats of the same user never share a filesystem.

## 7. Files, persistence, metering

- **Generated files** are captured from the run → written to the workspace prefix in R2 → surfaced as
  **Library assets** through the *existing* ingestion path (quarantine → scan → ready), so they get the
  same safety gating, previews and Context-Panel/Library opening we just built for chat images.
- **Metering:** execution (wall/CPU time) holds and settles on the **credits ledger** as its own line,
  distinct from inference credits. Zero-work execs void the hold (mirrors 0-token turns).
- **Quotas:** per-workspace size cap and expiry (avoids the unbounded-workspace mistake in §3).

## 8. Build order (causality, not preference)

0. **This proposal + approval.** (No infra decision — the substrate is xenorun, already deployed.)
1. **`xenorun` gains file-in/file-out** (general primitive extension, in the xenorun repo). Verify its
   `--network none` posture while there.
2. **`chat_workspaces` model** + R2 prefix (platform, additive migration).
3. **`SandboxSession`** wrapper → restore workspace, exec via xenorun, collect outputs.
4. **`RUN_CODE_TOOL`** on the existing loop (metering reused from the tool-calling plan).
5. **Output files → workspace R2 → Library ingestion.**
6. **Execution metering** on the ledger + workspace quotas.

Each increment is a separate commit with its own outcome-pinned, mutation-checked gate, per the repo's
testing discipline. Steps 2–6 are platform-only and need no new infrastructure; step 1 is a small,
general, additive change to an already-deployed MIT engine.
