# Workspace hierarchy implementation evidence — 2026-09-04

Requirement: user-supplied **XENO Workspace, Teams, Agents & Projects Hierarchy Specification**, dated 2026-09-03. This record does not replace or relax it. Overall status: incomplete.

## Existing authorities

Platform workspaces live in `workspaces`; memberships and roles use `relationship_tuples`. Projects live in `chat_projects`; conversations reference stable project IDs. Agent Interface already declares workspace/team/agent topology in `packages/ui/src/stores/workspaceStore.ts`. Its local IDs and paths are not equivalent to platform UUIDs and server principals. Copying its objects into the website would create another authority. Platform TeamPage manages workspace membership, not operational teams.

## Implemented

- Chat workspace UUIDs from header, body and query must agree; malformed context never becomes personal scope.
- Membership and project/conversation scope are checked before handlers run. Existing resource authorization still applies independently.
- Active-workspace conversation lists include direct and project-owned conversations only within that workspace.
- Project creation honors validated scope. Project-page reads and mutation completions discard results after a workspace switch; old drawers cannot appear under another workspace heading.
- Verification: 54 middleware/project-semantics/foundation tests, TypeScript, and a real local Postgres transaction proving cross-workspace denial even for an owner of both workspaces. Test rows rolled back.

### Operational teams continuation

- Added canonical `workspace_teams`, many-to-many project assignments and single-team-per-workspace canonical agent assignments. Composite foreign keys prevent cross-workspace project bindings.
- Authenticated CRUD checks workspace context and admin authority. Mutations lock the workspace, reject stale versions and commit assignments with mandatory audit records in one transaction. Archiving removes bindings, not projects, agents or files.
- `/overview/teams` is distinct from workspace membership at `/overview/team`. Navigation, settings and command search expose Teams. Project details read their assigned teams from the same API. Drafts and asynchronous completions are isolated on workspace switches.
- New assignments accept only caller-owned active canonical agent identities. Existing assignments can be retained by workspace admins. These are organizational assignments, not execution grants; runtime personas are not matched by name.
- Verification: 65 passing tests, zero skipped, across workspace-team, workspace-scope, database-scope, platform-foundation and project-semantics suites against local Postgres; TypeScript passed. Database fixtures rolled back, including the audit-failure case.
- Browser verification: create, reload, rename and archive a temporary team using the existing local login; dark and light rendering checked, original System theme restored. The temporary team is archived with its audit history retained. This account has no active projects or assignable agents, so checkbox assignment behavior is database-tested, not browser-qualified with real assignments.
- Local migration `20260904140000-workspace-operational-teams` ran through the normal migration runner, backend restarted on port 8090, and the authenticated Teams API was exercised by the browser. No production deployment or production migration was performed.

### UI design authority boundary

The Teams page reuses existing platform theme classes and the shared Checkbox; it introduces no palette or stylesheet. The platform currently lacks the XENO Elements React renderer dependency, so this is not declaration-backed design-system conformance. Teams has 10 button JSX sites, two shared Checkbox sites, one input, one textarea and three section sites; project assignment details add one button. Adopting canonical declaration-backed controls remains a tracked platform design-system task, not a claimed result of this hierarchy slice.

## Remaining acceptance criteria

1. Shared workspace/project IDs, host identity and folder-grant binding; preserve creative/document projects as well as codebases. Explicitly migrate legacy personal projects. Non-workspace clients currently retain personal mode.
2. Bind runtime personas to canonical identities; do not equate them by name. Persistent operational teams, authenticated CRUD, audit and project/agent assignment storage are implemented, but assignments alone are not effective runtime permissions.
3. Effective permission intersection: workspace grant, then team restriction, then agent restriction. Empty inherits its parent, never widens it. Enforce canonical paths and host grants at execution.
4. Stable workspace/team/agent/project/host task bindings, including schedules and library access. This pass is not a universal resource-scope audit.
5. Fleet navigation, real scoped metrics, host-backed folder linking/explorer. Team management is implemented. Unlink must remove bindings, never user files.
6. Cross-consumer tests for switches, simultaneous edits, denied access, disconnected hosts, symlinks and scheduled execution.

## Coordination boundary

Agent Interface has pre-existing uncommitted changes in `packages/contract/src/index.ts`, `packages/host/src/workspace/WorkspaceHostService.ts`, `packages/host/src/state/SqliteAgentStateRepository.ts`, host adapters and agent stores. The inspected diff changes conversation host binding, managed roots and PTY authorization: the authority surfaces needed next. They were not changed in this pass. Coordinate ownership before modifying that contract instead of overwriting it or creating a competing host authority.

The continuation above proves the new router on the local backend only. No production deployment was performed; it does not establish production readiness or completion of the remaining cross-consumer hierarchy requirements.
