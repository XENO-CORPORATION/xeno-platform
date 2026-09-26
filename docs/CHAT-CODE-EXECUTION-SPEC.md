# Per-chat code execution in XENO Chat — proposal

**Status:** PROPOSAL, 2026-09-26. **Blocked on one decision (§4) + approval before build.**
Nothing below is built yet.

**What this owns:** the subsystem that gives each chat an isolated place to run code — a
*persistent per-chat workspace* plus an *on-demand ephemeral sandbox* — and how generated files
persist and get metered. It sits **under** `CHAT-TOOL-CALLING-PLAN.md`: the `run_code` tool is a
tool on that plan's existing loop (§5 here), and it reuses that plan's per-iteration `requestId` +
hold→run→settle metering discipline verbatim. This doc does not re-specify the loop; it specifies
the compute and storage the loop's new tool binds to.

## 1. Why this exists

The owner asked for ChatGPT/Claude parity: *"do we have all of these? if not we need to implement
all of them at proper scale … account etc based logic."* The industry model (the analysis the owner
pasted, corroborated below) is three parts, and they are **decoupled on purpose**:

| Part | ChatGPT / Claude | What it is |
|---|---|---|
| **Workspace** | persistent per *conversation* | the files a chat accumulates — survive between turns and across days |
| **Compute** | ephemeral, on-demand, **shared pool** | a container spun up *when a tool is called*, torn down when idle. **Not** one VM per chat, **not** one per account |
| **Tool** | model-invoked | the model decides to run code; output + files stream back |

The load-bearing insight is that **only the workspace is per-chat and persistent; the compute is
ephemeral and pooled.** That is what makes "at proper scale" tractable: we size compute to
*concurrency* (how many chats are running code right now), never to *chat count*.

## 2. What is actually built today (measured, not assumed — 2026-09-26)

| Piece | State | Where |
|---|---|---|
| One-shot code runner | ✅ deployed | `xenorun` service (`XENORUN_URL=http://xenorun:3000`), Piston-style, **stateless** — one fresh Docker container per exec, `/workspace` is a 256 MB tmpfs discarded on exit (`xenorun/src/engine/executor.ts`) |
| Manual "Run" button | ✅ works | `handleCodeBlockRun` → `/api/piston/execute` → xenorun. The **model cannot invoke it** |
| Chat tool loop | ✅ works | `streamToolLoop` in `chatToolLoop.js`; offers `WEB_SEARCH_TOOL` + `GENERATE_IMAGE_TOOL` (`aiRoutes.js:610`). **No code tool** |
| Per-chat workspace | ❌ none | `chat_conversations` has no workspace; no `chat_workspaces` table; no per-chat file store |
| On-demand stateful sandbox | ❌ none | xenorun is one-shot; nothing restores prior files into a run |
| `xeno-use` `/v1/use` service | ❌ **not deployed anywhere** | the owned hardened substrate (gVisor/Docker broker, `sandbox.spawn/exec/exec_stream`, structured mounts) exists as a repo with a built `apps/api`, but **runs on no host** and is referenced nowhere in this backend |

So we have **isolation for a snippet** (xenorun, live) but **no per-chat statefulness and no
model-invoked tool** — the two things parity requires. And the *hardened* substrate we own is not
yet a running service.

## 3. Evidence — what the leaders do, and the mistakes to avoid

- **ChatGPT (Code Interpreter / "Advanced Data Analysis")** runs a per-conversation Python sandbox:
  a persistent working directory (`/mnt/data`) scoped to the conversation, on an ephemeral,
  network-isolated container that idles out (~20 min of inactivity is the widely-reported window)
  and is recreated on the next call with the working directory restored. Files created are offered
  as downloads. Compute is a shared pool, not a per-user VM.
- **Claude (Code Execution tool / Files API)** runs a container-based bash+Python sandbox with a
  per-container filesystem, memory/CPU/time limits and no outbound network by default; files persist
  for the container's life and can be carried via the Files API.
- **Documented mistakes to avoid:** (a) *always-on per-chat compute* does not scale and is what
  neither leader does — bind compute to concurrency; (b) *network-enabled sandboxes by default* are
  an SSRF/exfiltration surface — both leaders default to **no egress**; (c) *unbounded workspaces*
  cost storage forever — both cap and expire; (d) *trusting the model to stay within a budget* — the
  cap must be enforced by the substrate, the same lesson `CHAT-TOOL-CALLING-PLAN.md` records for the
  search budget.

Separate evidence from inference: the per-conversation persistence and idle-recreate behaviour are
observed/documented product behaviour; exact idle timeouts and pool internals are not published and
are treated here as design targets, not facts.

## 4. THE DECISION — which compute substrate (owner's call, one of them is infra-gated)

Everything else in this doc is ours to build regardless. This is the fork, because the two branches
are **materially different work** and one commits new always-on infrastructure on a
capacity-constrained single node.

### Path A — deploy `xeno-use` `/v1/use` as the substrate  ✅ recommended

Stand up the owned, hardened sandbox service; the chat backend consumes it **out of process** over
`/v1/use/*` (the AGPL boundary is mandatory — root CLAUDE.md §5b). Spawn a sandbox on a `run_code`
call, mount the chat's workspace, `exec_stream` the code, snapshot new files back, destroy on idle.

- **For:** it is the layer we already own and specced for exactly this (gVisor isolation,
  `exec_stream`, structured mounts, no-egress default). Building per-chat statefulness anywhere else
  is **re-implementing xeno-use's job in the wrong repo** — the "never re-implement a lower rung
  locally; extend, don't route around" rule. It is the *hardened* form, which the "build the hardened
  thing first" rule requires. On-demand + pooled, so it is sized to concurrency.
- **Against / cost:** `xeno-use` is **not deployed**. This needs a host with Docker (ideally gVisor)
  and RAM headroom, the `apps/api` image built and run, network path + auth to the chat backend, and
  the exec-stream verb over the public surface. On `bnkr-node-001` (one node, ~12 GB free when last
  measured, disks on the workstation) this is a **capacity/operator decision**, not something to spin
  up silently. This is the single gate.

### Path B — grow the deployed `xenorun` into a stateful per-chat runner  ⚠️ not recommended

Add workspace restore/capture around xenorun's one-shot exec so it *behaves* per-chat.

- **For:** no new infra; xenorun is already live and is already the chat's code compute.
- **Against:** xenorun is plain Docker (no gVisor) and a Piston-clone for snippets. Making it the
  load-bearing per-chat sandbox ships the **weaker form as the real thing** — exactly what "build the
  hardened thing first" forbids unless declared a named stand-in — and leaves **two sandbox
  substrates forever**, the "route around the gap and the gap is permanent" failure. It also
  duplicates mounts/streaming/lifecycle that xeno-use already implements.

**Recommendation: Path A.** If capacity blocks deploying xeno-use now, the honest interim is *not*
Path B-as-permanent; it is to build everything behind the `SandboxSession` seam (§6) against the
`/v1/use` contract, ship the workspace + tool + persistence + metering, and keep the compute call
returning a clear "code execution is warming up" until the service is deployed — a named,
visible stand-in with the replacement named, not a second substrate that quietly becomes load-bearing.

## 5. The `run_code` tool (lives on the CHAT-TOOL-CALLING-PLAN loop)

- A new tool offered beside `WEB_SEARCH_TOOL` / `GENERATE_IMAGE_TOOL`, gated on the sandbox service
  being reachable (so it never advertises a capability it lacks — the plan's core rule).
- Reuses the plan's **per-iteration `requestId`** and hold→run→settle metering. Inference is metered
  as today; **execution is metered separately** (§7) — they are different resources.
- Budget: an execution cap per turn, enforced server-side, stop-and-answer on cap (mirrors the search
  budget rules), count surfaced so cost is visible.
- No egress from the sandbox by default; no consent prompt for running (parity with the leaders), but
  network access, if ever added, is a separate gated decision.

## 6. Architecture — the seam and the data model (both substrate-agnostic, buildable now)

- **`chat_workspaces`** (Postgres): `chat_id → workspace_id`, an R2 prefix, size + file count, last
  activity, quota. One per conversation, created lazily on first `run_code`. Additive migration.
- **Workspace bytes in R2** under the workspace prefix, written through the **one gated choke point**
  (`scripts/lib/r2-upload.mjs` / the runtime equivalent — ABSOLUTE RULE §2b), never a second uploader.
- **`SandboxSession`** interface in the chat backend — `open(workspace) / exec_stream(code) /
  listNewFiles() / close()` — implemented against `/v1/use/*` (Path A). This is the seam that keeps
  the substrate swappable and keeps the AGPL boundary out-of-process.
- **Isolation is per CHAT, not per account:** the workspace is keyed by `chat_id`, and a sandbox
  mounts exactly one chat's workspace. Two chats of the same user never share a filesystem.

## 7. Files, persistence, metering, lifecycle

- **Generated files** are captured from the sandbox → written to the workspace prefix in R2 → surfaced
  as **Library assets** through the *existing* ingestion path (quarantine → scan → ready), so they get
  the same safety gating, previews and Context-Panel/Library opening we just built for chat images.
- **Metering:** execution (wall/CPU time) holds and settles on the **credits ledger** as its own
  line, distinct from inference credits. Zero-work execs void the hold (mirrors 0-token turns).
- **Lifecycle:** sandbox is created on a `run_code` call with the workspace restored, idle-destroyed
  (~20 min target), recreated on the next call with the workspace intact. The **workspace persists**;
  the **compute does not**.
- **Quotas:** per-workspace size cap and expiry (avoids the unbounded-workspace mistake in §3).

## 8. Build order (causality, not preference)

0. **This proposal + the §4 substrate decision + approval.** ← gate
1. **Substrate available:** deploy `xeno-use` `/v1/use` (Path A, the one infra item) — or agree the
   named-stand-in interim.
2. `chat_workspaces` model + R2 prefix (no infra).
3. `SandboxSession` seam → `/v1/use` (out-of-process AGPL boundary).
4. `RUN_CODE_TOOL` on the existing loop (metering reused from the tool-calling plan).
5. File capture → workspace R2 → Library ingestion.
6. Execution metering on the ledger.
7. Idle-destroy / recreate lifecycle + workspace quotas.

Each increment is a separate commit with its own outcome-pinned, mutation-checked gate, per the
repo's testing discipline. No increment past step 1 can be *verified end to end* until the substrate
is a running service — which is why step 1 is the gate and not an afterthought.
