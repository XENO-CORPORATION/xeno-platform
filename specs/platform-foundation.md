# XENO Platform Foundation

Status: implementation contract

Scope: `xeno-platform` authenticated web workspace

Risk tier: Tier 2 (broad, reversible application changes; account and workspace security surfaces)

## Objective

Build the product-neutral foundation that every XENO product will enter through: a truthful dashboard, account and workspace administration, universal navigation and command discovery, notifications and activity, integrations, billing, security, and reusable platform interaction primitives.

This work prepares the platform for product implementations. It does not implement the CRM, contract-review, workflow-editor, document, spreadsheet, media, or other product-specific screens shown in the visual references.

## Evidence ledger

| Fact | Status | Evidence |
|---|---|---|
| The authenticated shell and overview routes already live under `/overview`. | KNOWN | `src/pages/Overview.tsx` |
| The dashboard reads real ledger, project, and scheduled-task services; unavailable values must not be coerced to zero. | KNOWN | `src/components/overview/Overview.tsx`, `/api/dashboard/stats` |
| Workspaces, members, invites, billing, budgets, ownership transfer, and audit events have server routes and a typed client. | KNOWN | `src/server/routes/workspaceRoutes.js`, `src/services/accountService.ts` |
| Account overview and notifications have authenticated read endpoints. | KNOWN | `src/server/routes/accountRoutes.js` |
| Profile, preferences, team, and billing pages already exist but do not share a settings information architecture. | KNOWN | `src/components/account/*Page.tsx` |
| Workspace and team UI currently fabricate development workspaces, members, sessions, roles, API keys, and audit data when the API is unavailable. | KNOWN | `src/contexts/WorkspaceContext.tsx`, `src/components/account/TeamPage.tsx` |
| The overview command controls route to search rather than opening a platform command palette. | KNOWN | `src/components/overview/OverviewTaskbar.tsx`, `src/components/overview/Overview.tsx` |
| Connector preferences exist for chat, but a workspace integration-management contract is not present. | KNOWN | `/api/chat/customize/connectors`, `src/services/chatService.ts` |
| Account-session inventory, 2FA management, SSO, SCIM, custom roles, and API-key management are not backed by the workspace client contract. | KNOWN | service and route audit; no matching workspace/account API |
| XENO web products are hosted services, so `app.quit` and desktop discovery-file semantics do not apply. | KNOWN | `../../../XENO AGENT CAPABILITY - SPEC.md` section 17.4 addendum |
| Product-specific implementations will consume these primitives later. | INFERRED | user-directed sequencing and visual references |

Unknowns stay visible as unavailable capabilities. They must not be represented by generated fixtures, random tokens, enabled switches, or optimistic success messages.

## Locked invariants

1. **Confirmed data only.** A signed-in surface may show loading, empty, unavailable, or forbidden. It may never substitute fabricated account or workspace data.
2. **Agent-ready operation metadata.** Human controls consume one typed command registry. This slice publishes capability metadata for those operations; it does not claim runtime human/agent parity until an authenticated capability adapter calls the same functions in an integration test.
3. **Read before write.** Every mutation has a corresponding read and exposes server-confirmed state after completion.
4. **Workspace scope is explicit.** Workspace operations take a workspace identifier; no mutation depends on the currently visible row, open menu, or implicit selection.
5. **Authorization is server-owned.** UI visibility is guidance only. The server remains authoritative for membership, role, billing, and security decisions.
6. **No weakened authentication.** The platform remains the OIDC authority and this slice adds no token storage. The existing web access-token-in-localStorage path is a known prerequisite defect against `XENO AUTH - SPEC.md`; memory access plus httpOnly refresh migration is required before production qualification.
7. **Hosted lifecycle.** The capability catalogue exposes status and product-neutral platform reads/mutations, never a shared-service quit operation.
8. **Accessible interaction.** Dialogs, drawers, menus, and command search support keyboard operation, Escape, labelled controls, focus return, and reduced motion.
9. **Responsive shell.** The rail/sidebar, command palette, settings, tables, and drawers remain usable at desktop and narrow widths.
10. **No product coupling.** Foundation modules may name platform concepts—account, workspace, project, automation, notification, integration, billing—not product editor internals.

## Foundation architecture

### Shared command layer

A product-neutral command registry describes stable command IDs, labels, groups, keywords, destinations, availability, and execution. The command palette, sidebar shortcuts, and future agent/capability adapter consume this registry.

Initial read/navigation verbs:

- `platform.app.status`
- `platform.dashboard.open`
- `platform.search.open`
- `platform.account.open_profile`
- `platform.account.open_settings`
- `platform.workspace.open_members`
- `platform.workspace.open_activity`
- `platform.integrations.open`
- `platform.billing.open`

Workspace mutations continue to use `accountService` as their canonical implementation. A later transport adapter may expose the same functions externally; this slice does not introduce an unauthenticated local capability server into the hosted web service.

### Role, scope, and durability policy

| Operation | Viewer/member | Admin | Owner | Scope |
|---|---:|---:|---:|---|
| Read members, workspace billing, workspace activity | yes | yes | yes | selected workspace membership |
| Invite/revoke/resend and update non-owner roles | no | yes | yes | explicit workspace id |
| Remove another member | no | yes | yes | explicit workspace id; owner excluded |
| Transfer ownership, billing mode, subscription | no | no | yes | explicit workspace id |
| Account profile, password, deletion, preferences | account owner | account owner | account owner | authenticated account |

The server remains authoritative. Workspace-scoped lists clear when scope changes and responses captured for an older workspace are discarded. Email-matched invitations require the canonical authentication layer to guarantee a verified, unique email before production qualification. Membership, ownership, seat reservation, invite acceptance, and activity writes require transactional postconditions and concurrency tests; until activity is inseparable from mutations, the UI calls it workspace activity rather than a complete security audit log.

### Shared interaction primitives

- Command palette with grouped results, keyboard navigation, recent commands, and no-results state.
- Side drawer shell for integration details and future contextual inspectors.
- Resource state component for loading, empty, unavailable, forbidden, and retry states.
- Settings shell with account/workspace navigation and capability-aware sections.
- Status badges and data-list/table primitives that use semantic values rather than visual-only color.

### Routes

| Route | Responsibility |
|---|---|
| `/overview` | Product-neutral dashboard and recent confirmed work |
| `/overview/profile` | Account profile |
| `/overview/settings` | Personal preferences and settings index |
| `/overview/team` | Workspace members and invites |
| `/overview/team/settings` | Backed workspace settings only |
| `/overview/team/security` | Backed policy status; unavailable capabilities clearly named |
| `/overview/team/activity` | Real workspace audit events |
| `/overview/notifications` | Real account notification feed |
| `/overview/integrations` | Integration catalogue and connection status from declared providers |
| `/overview/billing` | Account/workspace plan, entitlements, credits, and checkout consent |

## Implementation slices

### Slice 1 — truthful foundation

- Remove development fallback identities and account/security fixtures.
- Preserve the existing real dashboard work.
- Add explicit failure and empty states to workspace/account surfaces.
- Load real notification and workspace-audit data.

### Slice 2 — shell and commands

- Install the canonical command registry and palette.
- Wire every `Command/Ctrl+K` entry to the same palette.
- Add notification and integration destinations to the shell.
- Keep navigation configuration in one module.

### Slice 3 — account and workspace

- Consolidate the settings information architecture without duplicating services.
- Make workspace switching, membership, invitations, role changes, ownership transfer, billing, and audit review use existing typed services.
- Render unsupported SSO, SCIM, custom roles, session inventory, 2FA management, and workspace API keys as unavailable—not interactive fiction.

### Slice 4 — integrations and drawers

- Add a product-neutral integration catalogue with honest states: available, connected, action required, planned.
- Use a side drawer for details, permissions, setup status, and documentation metadata.
- Do not treat chat model connector preferences as workspace OAuth connections.

### Slice 5 — agent readiness and proof

- Generate a source-derived agent-readiness ledger for foundation actions; runtime parity remains pending an authenticated adapter.
- Gate absence of fabricated platform fixtures and duplicate command handlers.
- Run typecheck, focused tests, production build, and rendered-browser checks at desktop and narrow widths.

## Mechanical acceptance criteria

1. `rg "DEV_WORKSPACES|DEV_MEMBERS|DEV_SESSIONS|DEV_ROLES|DEV_API_KEYS|DEV_AUDIT" src/contexts src/components/account` returns no live platform fixtures.
2. Every global command entry invokes the same palette; no overview command entry routes directly to chat search.
3. Notifications call `/api/account/notifications`; workspace activity calls `/api/workspaces/:id/audit`.
4. Unsupported security/integration features contain no random credentials, local-only toggle success, or fake connected status.
5. Workspace switch, member/invite operations, profile settings, billing, and dashboard reads preserve their existing server authorization paths.
6. Command palette supports `Ctrl+K` and `Meta+K`, ArrowUp/ArrowDown, Enter, and Escape.
7. Typecheck and production build pass from current source; verification must not rely on a stale `dist` directory.
8. Focused platform-foundation tests prove command uniqueness, truthful data boundaries, route reachability, and agent-readiness declarations.
9. Production qualification additionally requires a revision-tied real server and test database, seeded multi-role accounts, durable reload proof, and 401/403/404/409/500 plus cross-workspace race cases. Source tests, typecheck, and bundle build do not substitute for that gate.

## Explicit non-goals

- No product-specific CRM, tasks, contracts, workflow canvas, document editor, or model-selection implementation.
- No production deployment, release, database cutover, provider-console mutation, or paid external generation.
- No invented provider connections or OAuth credentials.
- No replacement or weakening of the locked XENO authentication authority.

## Qualification record — 2026-09-03

- **Local source and gates:** the canonical `npm test` chain, TypeScript typecheck, and production
  build pass. The platform-foundation suite passes 25/25, the safe-arithmetic suite passes 3/3,
  and the gate-reachability check confirms the new suites cannot silently become orphaned.
- **Authenticated rendered routes:** `/overview`, `/overview/projects`, `/overview/team`,
  `/overview/notifications`, `/overview/usage-analytics`, `/overview/billing`, and
  `/overview/settings` rendered in the local browser with the signed-in Gmail account and real
  account/workspace data. The full-height application shell occupies the viewport. System and dark
  theme paths use shared theme tokens rather than separate mock surfaces.
- **Truthful unavailable states:** `/overview/integrations` reports the connector-service timeout
  after 12 seconds, while Settings reports `Session service unavailable — Not found` for the
  undeployed active-session route. Neither path fabricates successful state.
- **Not production-qualified:** the canonical browser-token migration, revision-matched backend
  deployment, live billing catalog/webhook/refund proof, tax and operator compliance settings,
  multi-role authorization/race testing, and production observability/rollback exercise remain
  release gates. Local source/build/browser proof does not close them.

## Rollback

All work is confined to authenticated web-platform source, tests, and documentation. Revert the foundation commits/files and restore the previous overview routes; no schema or production data mutation is part of this program.
