# Recreating XENO Corporation in XENO — the company blueprint

Owner, 2026-10-20: *"be completely ready to recreate XENO in XENO … we are missing for Corpo also Company … and we
are also missing a lot of employee features of this company that we have, xenosystem"*.

## What it is

`src/server/data/companyBlueprints.js` → `xeno-corporation`: a first-party pack with a `company` section. It is
applied by `services/modeApply.js` **plan → apply**, like any trade pack. Nobody writes SQL by hand. Through the
owning services it creates:

| record | from | count (dry run, 2026-10-20) |
|---|---|---|
| division (one per ecosystem layer in the root `CLAUDE.md`), headed by the applier | `workforceDivisions.create/update` | 9 |
| team (one per product), owned by the workspace and by its division | workforce resource command (`kind: 'team'`) | 56 |
| product agent (one per team, the delegate for that product's tasks) | `platformAgents.create`, made inside the company | 56 |
| the applier's employee profile, title "Founder & CEO" | `workforce_employee_profiles` | 1 |
| Places building | nothing is written: Places derives floors from divisions and pods from teams | 1 |

The divisions are Platform & Infrastructure, Native Engine & Inference, Agent & Automation, Shared Engine & UI
Platform, Creative Apps, Libraries & Connect, Office & Communications, Media & Content, and Science & Research. The
pack is `status: 'draft'`. Correct the names and the split in that file before you apply it.

## One limit is in the way, and the plan says so

Each account may own **5 agents** (`DEFAULT_AGENT_CAP`, `agentIdentity.js`). With agents included, the plan lists
the conflict `agents:needs 56, …`, and apply refuses it with `agent_cap_reached`. It writes nothing, so it can never
create half a company. You can either:

- apply with `answers: { agents: "no" }`, which creates the divisions, teams and profile now. Add agents later, or
- raise the cap first. That is a pricing/limit decision for the owner (`XENO PRICING - STANDARD & LEDGER.md` §6), not a code change made here.

## How to apply it (a human workspace admin; never run against production without the owner's yes)

1. Make or choose the **company** workspace for XENO (a personal workspace is refused).
2. Dry run, which writes nothing:
   `POST /api/v2/workspaces/<id>/modes/plan` `{ "packId": "xeno-corporation", "answers": { "agents": "no" } }`
   (or MCP `modes_plan`). Read `plan.counts`, `plan.records`, `plan.conflicts`; keep `planHash`.
3. Apply it as the human admin who read the plan:
   `POST …/modes/apply` `{ packId, answers, planHash, idempotencyKey, confirm: true }`. It runs in ONE transaction
   with one receipt. A retry with the same key returns the same receipt, and a changed plan is refused. An agent is
   refused (`human_admin_must_confirm`).
4. Then use **Workspace → Directory** to set titles, managers and teams for people (People API below), and onboard each member.
5. Undo: `modes/revert` leaves the structure in place. It lists divisions, teams and agents as *kept*, because
   people are working in them. Archive them from Divisions / Agents instead.

Proven on real Postgres by `src/server/tests/workforce-people.test.mjs` §8. That run covers plan writes nothing, the
agent refusal, refusal over the limit with nothing written, apply creating exactly the planned counts, replay, and
revert keeping the structure.

## The employee features (same change)

The decision (xeno-company SPEC §7.3, employment contract shape) is **DECIDED 2026-10-20**. Employment is an
ADMISSION plus a TITLE (XENO-WORKFORCE-01 LIFE-01, D18):

- Membership stays in the workspace's `relationship_tuples`.
- Divisions and teams stay in their own tables.
- `workforce_employee_profiles` is an annex. It holds title, division, team, manager, start/end date, location,
  time zone, working hours and private contact. It is never read for a permission decision.

| feature | API (`/api/people`) | MCP |
|---|---|---|
| directory + search | `GET /?workspace=&q=` | `people_directory` |
| profile (private fields: self, admins, managers above) | `GET/PATCH /:id` | `people_get`, `people_update_profile` (agents refused) |
| org chart (humans + agents) | `GET /org-chart` | `people_org_chart` |
| my work (tasks, reviews, runs, assignments, reports) | `GET /me/work` | `people_my_work` |
| time off → availability (Places shows `away`) | `POST /time-off` | `people_add_time_off` (agents refused) |
| onboarding (a project of XENO Tasks, once) | `POST /:id/onboard` | — |
| offboarding (reports/headships to the manager, access removed via member removal; own resources listed for OWN-05) | `GET /:id/offboard-plan`, `POST /:id/offboard` | — |

Access is mutation-checked by `scripts/workforce-people-mutation.mjs`: 9 of 9 mutations are caught.
