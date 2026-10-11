# Shared Studio and chat generation

This document owns the generation request/approval/job contract shared by Studio → Generate and the chat composer. It extends `CHAT-TOOL-CALLING-PLAN.md` and the workspace-root `XENO MODES - SPEC.md` (Generate belongs to Studio, not another workspace mode). A separate contract is necessary because generation spends credits and continues across page refreshes; the existing search/tool plan does not specify either lifecycle. Owner approved implementation and deployment on 2026-10-11 after local composer review.

## Contract

Typing `@image`, `@video`, `@audio` or `@3d` opens the platform's actual selector above the composer at its full width. Choosing a type preserves the prompt and attachments and changes the same composer's controls to model | ratio | effort/quality | remaining supported settings |. Type labels have no leading icon. The selected model and values must govern the real generation, not an LLM's optional interpretation of them. Studio Generate, chat and agent capabilities call one server-owned generation service. Agent-originated generation proposes a request and cannot spend until the person approves its exact model, prompt, references and cost. Direct Send in generation mode is the person's approval.

## Evidence ledger (2026-10-11)

- KNOWN: original preview `GenerateMode.tsx` contains a browser-only model catalog; `ChatWithLLM.tsx` still sends ordinary chat with `selectedModel`. No generation backend reads those controls. This is not production wiring.
- KNOWN: `chatStream.ts` whitelists outbound request fields; new request fields must be explicitly serialized and validated server-side.
- KNOWN: `/api/ai/chat/stream` currently acquires a text-model hold before its tool loop. Direct generation must bypass that text dispatch and hold.
- KNOWN: strict `chatTurnRecord.js` and chat route asset checks govern persisted image steps. A saved presentation step is not spend authorization.
- KNOWN: live gateway `/v1/models` answered HTTP 200 on 2026-10-11 with five image models and eight video models, each publishing `execution.endpoint` and async job support. Audio and 3D were absent; embedding is not a generation model.
- KNOWN: live `xeno-api-proxy/src/glabs-contract.js` validates Google image ratios 1:1, 16:9, 9:16, 4:3, 3:4; Google video ratios 16:9 and 9:16, no duration selector, and reference modes `start_image` and `ingredients` (Omni only). Validator acceptance is not proof the adapter honors references.
- KNOWN: live gateway `/v1/jobs` accepts `{endpoint,body,metadata}` under an Idempotency-Key and exposes status/result/cancel. The gateway owns provider job durability.
- UNKNOWN: qualified platform audio/3D adapters and their live providers. Resolve from existing code and safe runtime discovery before advertising availability.
- KNOWN: `utils/inferenceMeter.js:282` owns media reserve/run/settle/void; `utils/creditLedgerV2.js` owns holds and settlement. Durable work needs a recoverable handle across that lifecycle, not its current request-local wrapper.
- KNOWN: `services/libraryAssets.js:185` owns managed artifact registration and quarantine; `services/chatProjectAuthority.js:96` owns project attachment. `workers/chatScheduledWorker.js:168` is the existing leased/Postgres/staged-result recovery precedent. `backgroundJobs.js` is not a crash-durable media executor.

## Concrete interfaces and lifecycle

`GET /api/generations/catalog` returns the four type records, real model descriptors and supported option/reference limits, existing local action tariff, and availability with its evidence source. `POST /api/generations` validates `{type,model,prompt,settings,referenceAssetIds,projectId?,conversationId?,area?,requestKey}` and creates an owner-bound durable record. Human sessions submit directly as approved; resolved agent principals create `awaiting_approval` only. No caller-supplied principal/source/approval flag grants authority. `GET /api/generations?type=&projectId=` lists accessible records; `GET /api/generations/:id` returns progress/results. `POST /api/generations/:id/approve` is human-only, binds the persisted immutable request and refreshed quote. `POST .../cancel` records cancellation intent and reconciles the provider's actual state. `POST .../retry` creates a new request key and returns a new record only for a definitive terminal failure; accepted-unresolved work cannot be retried.

Use an additive `media_generations` table in the existing migration chain: stable UUID id, owner/actor identity, validated placement, immutable request JSON/hash and request key unique per owner, approval state, lifecycle state, deterministic ledger hold identity, gateway job id/key, result asset ids, safe error metadata, lease owner/expiry, timestamps. Check authority at each write/read; caller visibility does not grant edit/spend. A bounded database worker claims by row lock/SKIP LOCKED and uses existing hold operations; on restart it resumes the gateway job, imports durable outputs, and settles once. Persist intent before provider submit; retry submission only using the identical gateway Idempotency-Key (replay, never a new execution). Preserve output import state separately from gateway success and ledger settlement. Cancellation is requested, not confirmed until observed.

State flow: `awaiting_approval → queued → submitting → running → importing → succeeded`; failures before provider acceptance become `failed`; ambiguous acceptance/readback becomes `reconciling` and remains discoverable; cancellation moves through `cancel_requested` to an observed provider terminal state. Unknown catalog/adapters do not dispatch. Audio/3D stay unavailable with the missing provider named until a real supported backend is qualified; image/video are the currently measurable generation modalities. This is a declared incomplete breadth requirement, not a fabricated implementation or retired promise.

Chat direct mode serializes a typed generation request and calls the generation REST service without invoking the text LLM. Agent tool calls propose generation and emit an approval step bound to the durable id; approval uses the same REST service. Studio lists and opens `/workspace/studio/generate/<type>/g/<generation-id>` with parent breadcrumb and supports refresh/Back/fresh entry. Both surfaces read stored job state and artifacts rather than re-execute on mount.

## Invariants and acceptance checks

1. Catalog and validation share one server declaration. UI models/settings/costs are fetched, never a second hardcoded authority. Check: catalog/request boundary test rejects invented model, unsupported setting and reference count before dispatch/hold.
2. No reference is silently dropped and no selected model/shape is silently replaced. Explicit model/ratio choices are pinned; a refusal offers a new choice. Check: recording upstream asserts distinguishing model, ratio, quality and reference bytes.
3. Agent proposals spend zero; approval binds owner, request version/hash and expiry. Double approval produces at most one provider job/hold. Check: concurrent approve/replay, foreign user, tampering, expired proposal and denial tests.
4. Direct generation invokes no text-model inference. Check: real HTTP integration recorder sees generation only; text dispatch spy remains unused.
5. Generation is durable. Submit returns a stable local id/URL; refresh/list/status/cancel/retry use that id, not a display name. Accepted-but-unresolved gateway work is never resubmitted automatically. Check: service restart + refresh + upstream acceptance timeout and reconciliation tests.
6. Existing ledger owns money. Failed pre-admission costs zero; terminal failure releases the hold; successful saved output settles once; uncertain provider acceptance retains a recoverable pending state rather than a false failure. Check: real DB/recording-gateway money tests.
7. Library ingestion/access controls own output bytes. Reference asset access and scan readiness are checked server-side before dispatch. Untrusted output URLs use the existing bounded, SSRF-safe asset fetch path without gateway credentials. Check: foreign/quarantined reference, private-IP redirect, oversized result, save failure and readback tests.
8. Every advertised modality has a real adapter and model catalog. Absence is explicit with its owning layer; it is not a fabricated successful generation. Check: per-modality provider fixture contract plus qualified live output where available.
9. Preserve composer design and keyboard behavior. @ list is full box width and 8px above; type labels text only; dividers including final one; Back/refresh and mobile work; changing type preserves text/references but invalid settings cannot dispatch. Check: real workspace+React browser fixture at desktop/phone sizes.
10. Studio and chat/agent bindings call the same service and expose truthful progress/results. Check: source reachability plus HTTP/UI flow on the same durable job.

## Failure vocabulary

Catalog unavailable → show retryable unavailable, not an empty model list. Quota spent → show the actual quota refusal and reset only if reported, not a guessed reset. Unsupported model/options/reference → validation refusal before money. Provider acceptance uncertain → pending/reconciling, status link, no automatic resubmit. Provider terminal failure/cancel → failed/cancelled with ledger disposition. Storage/scan pending → importing/scanning, no fabricated completed output. Approval denied/expired → no dispatch. Network loss → job continues and reopens by stable id.

## Implementation sequence

1. Complete inventory and refine exact interfaces/storage against existing owners; independent falsification before production implementation.
2. Server catalog, validation and durable generation service with existing ledger/library hooks; REST/capability bindings and model-free integration tests.
3. Real composer catalog/settings/send, agent proposal/approval and persisted result/progress integration.
4. Studio Generate routes and shared UI using the same service. Preserve legacy routes until equivalent replacement paths work; no mass removal.
5. Targeted tests, typecheck/build and actual browser acceptance. Deploy from merged approved ref with existing backend/frontend scripts; verify live catalog, route content, noindex and one bounded generation qualification per available adapter. Keep unsupported modalities explicit rather than claim completion.

## Rollback

Additive data only; existing chat records/routes remain readable and rollback does not delete jobs, artifacts or ledger history. Provider jobs already admitted remain discoverable/reconcilable. Frontend may roll back immediately without losing admitted jobs. Backend first disables new generation admission, keeps this version's status/reconciliation worker available, and drains/reconciles all nonterminal jobs before reverting to a version without the new routes. If draining is impossible, retain the current backend and repair forward; restoring an old image with no reconciler is not a valid rollback. A two-version qualification must assert an admitted job remains observable and settles through this drain path. Never overwrite production compose/config or rotate credentials as part of this work.

## Falsification decisions and final money boundary

- ACCEPTED: ordinary 900-second hold/heartbeat alone cannot protect provider work during a backend outage. Add a narrow media commitment tied to its existing hold; the ONE active-hold predicate used by balance and sweep must also retain a hold attached to accepted/unresolved media work. Never revive a voided hold or repurpose workforce token-budget draws. A queued job must reserve before submit, and unresolved commitment survives clock expiry; terminal settlement/void closes it. Tests must advance time beyond expiry and restart before reconciliation.
- ACCEPTED, then premise disproved by runtime evidence: gateway durable jobs already hold/settle their API-key payer. A safe canonical `api_keys` SHA-256 lookup on 2026-10-11 showed the configured platform gateway credential belongs to the same admin human using the UI. Therefore treating it as a separate COGS wallet is wrong for the owner. Production admission must refuse same-payer double charging. The target is one platform retail hold/settlement and gateway durable execution under a qualified server-scoped media reservation. Extend an existing authenticated server-scoped authority, never a client-supplied skip-billing flag, and persist its reservation binding through gateway worker settlement/result/cancellation. No new signing identity, credential or service payer may be manufactured. This cross-service integration must be coordinated and qualified before enabling owner generation; a fail-closed seam alone is not feature completion.
- ACCEPTED: exact cost approval needs a server-issued quote. Add `POST /api/generations/quote`; its short-lived server-signed token binds actor/payer, canonical request hash, tariff revision and maximum retail cost. Direct Send includes that token. Agent proposal persists a quote and approve requires the quote/version the person saw. A stale tariff/expired quote must return `quote_changed`/`quote_expired` for re-confirmation, never silently refresh and spend. Tests mutate tariff and prompt/reference order between quote and approval.

### Charge and cost are two ledgers (decided 2026-10-11, supersedes the grant protocol drafted here)

Measured on the live gateway the same day: the platform's retail price for an image is 10 credits (`creditCosts.js` `IMAGE_COSTS`), while the gateway's durable job holds its own provider-cost price (0.05–0.07 credits for the image models) against the owner of the credential that submitted it. These are different amounts with different meanings:

- **The charge** is the person's. The platform holds it once, commits it for the life of the work, and settles it once after the output is stored and scanned (or voids it). The gateway never touches it.
- **The cost** is the house's. The gateway holds and settles it on the wallet of the platform's gateway credential, exactly as it has for every durable job since the image fallback shipped (PR #686).

So one generation produces one charge to the person. The earlier draft treated the cost entry as a second charge and proposed an opaque grant protocol so the gateway would skip it; that would have removed the house's cost record and changed a shared billing state machine to fix a problem the measurement does not show. It was not built.

The worker records the cost payer on the generation row for audit and never refuses on it. One impurity remains and is an operator item, not a code change: the gateway credential belongs to the owner's admin account, so the house cost and the owner's own charges land in the same wallet. The proper holder is a `service` principal. Do not mint or move a credential to change this.

These are changes within the existing ledger/job architecture, not a replacement or a new money store. Additive migrations must be rehearsed against a disposable DB with the existing ledger tests. Deployment requires the commitment predicate on every serving replica before any media jobs are enabled; rollback disables new admission but does not remove commitments until existing jobs are terminal.

## Current status

Inventory complete for image/video; audio/3D adapters remain unqualified. Frontend preview changes exist on `feat/generate-mode`, not deployed. Contract falsification underway; production implementation and live qualification are not complete.
