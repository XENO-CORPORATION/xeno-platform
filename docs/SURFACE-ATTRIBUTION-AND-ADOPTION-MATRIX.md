# Surface Attribution, Cross-Product Adoption Matrix & BYOK Boundaries

**Document Date:** 2026-09-16  
**Status:** Canonical Platform Architecture & Adoption Status

---

## 1. Cross-Product Surface Adoption Matrix

Telemetry and quota auditing rely on the `X-Xeno-Surface` header passed from client applications to the platform and gateway. 

Attribution is **never authorization**: a surface header indicates caller context for telemetry and spend categorization; server-side authentication (session cookie, DPoP token, or API key) remains solely authoritative for user identity and entitlement.

| Product | Caller / Transport | Header Propagated | Server Normalization | Stored Record | Implementation Status | Runtime Verification |
|---|---|---|---|---|---|---|
| **Web Platform (xenostudio)** | Web BFF (`/api/ai/*`) | `X-Xeno-Surface: xenostudio` | `aiRoutes.js` default | `usage_records.surface = 'xenostudio'` | Merged & Deployed | Verified (BFF request chain) |
| **XENO CLI (`xeno-agent-cli`)** | CLI HTTP / DPoP | `X-Xeno-Surface: xeno-cli` | Mapped from client ID / header | `usage_records.surface = 'xeno_cli'` | Merged | Verified in CLI test suite |
| **XENO Hub (`xeno-hub`)** | Desktop Electron / Loopback BFF | `X-Xeno-Surface: xeno-hub` | Normalized | `usage_records.surface = 'xeno_hub'` | Merged | Verified in Hub test harness |
| **XENO Pixel (`xeno-pixel`)** | Electron / Native HTTP | `X-Xeno-Surface: xeno-pixel` (WIP) | Ready in gateway | Pending caller integration | In Progress (unwired in `xeno-ai.ts`) | Desktop WIP |
| **XENO Motion (`xeno-motion`)** | Electron / Native HTTP | Licence client lacks surface header | Ready in gateway | Fallback to `legacy:unknown` | Adoption Required | Copied licence client needs update |
| **XENO Sound (`xeno-sound`)** | Electron / Native HTTP | Planned via shared `@xeno-corporation/account` | Ready in gateway | Fallback to `legacy:unknown` | Planning | Pending SDK adoption |
| **XENO Canvas (`xeno-canvas`)** | Web / Desktop Client | `@xeno-corporation/account-client@0.1.1` | Normalized | `usage_records.surface = 'xeno_canvas'` | Merged | Client package installed |

---

## 2. Architectural Reality: Routing Paths vs. Telemetry

The XENO inference routing engine provides three distinct execution tiers:

1. **Path 1: Managed European Cloud Inference**
   - Routes through `xeno-api-platform` (`aiRoutes.js`).
   - Metered via `creditLedgerV2.js`.
   - **Telemetry:** Stamped with `X-Xeno-Surface`, recorded in database usage logs.
2. **Path 2: Bring Your Own Key (BYOK)**
   - Routes through `xeno-api-proxy` with cryptographic grants.
   - User pays upstream provider directly; XENO fees are €0.
   - **Telemetry:** Stamped with `X-Xeno-Surface` and recorded for audit/usage visibility without decrementing XENO quota.
3. **Path 3: Local Sovereign Engine (`xeno-rt`)**
   - Executed locally via Rust runtime on user hardware (GGUF / Metal / Vulkan / CUDA).
   - **Telemetry:** 100% air-gapped and sovereign. Zero network egress to XENO servers. By architectural design, local `xeno-rt` calls cannot and do not transmit `X-Xeno-Surface` telemetry to cloud auditing databases.

---

## 3. Investor Document Claim Review (Blueprint Line 374)

In `fundraising/investor-pack/XENO_COMPLETE_ECOSYSTEM_AND_ARCHITECTURE_BLUEPRINT.md` line 374:
> *"3. Surface Stamping: Every inference call carries `X-Xeno-Surface` telemetry, ensuring precise cross-app usage auditing."*

### Findings:
1. **Air-Gap Inconsistency:** The claim asserts *every* inference call carries surface telemetry, but Section 5 simultaneously and correctly champions Path 3 (`xeno-rt`) as "100% Air-Gapped & Sovereign". A truly air-gapped local model execution does not send telemetry packets to the cloud.
2. **Product Rollout Status:** While the platform gateway and Web/CLI/Hub callers are implemented and verified, creative desktop runtimes (Pixel, Motion, Sound) have not yet completed live production deployment of the canonical surface-stamped inference client.
3. **Actionable Recommendation for Document Owner:**
   - Clarify the wording in external presentations: *"Every cloud-routed inference call carries `X-Xeno-Surface` telemetry..."*
   - Do not unilaterally edit or distribute external investor decks without operator authorization.

---

## 4. BYOK Infrastructure & Host Boundaries (.224 vs .225)

There is a documented architectural distinction between host roles:
- **API VPS (`.224`):** Hosts `xeno-api-platform` Next.js portal, dashboard pages (`portal/app/dashboard/inference/page.tsx`, `portal/app/dashboard/byok/page.tsx`), and the egress proxy (`xeno-api-proxy`).
- **Platform Origin (`.225`):** Hosts the canonical platform origin database and account key vault.

### Safeguards & Invariants:
1. **No Duplicate Key Vaults:** The BYOK secret-box vault will not be duplicated onto `.224` to avoid dual-custody security degradation.
2. **No Secret Copying:** `SECRET_BOX_KEY` must never be casually copied across host boundaries without an explicit cryptographic key-exchange architecture.
3. **Fail-Closed Routing:** If a BYOK credential fails, expires, or is revoked, the system must fail closed and NEVER silently fall back to charging the user's XENO allowance or usage credits.
