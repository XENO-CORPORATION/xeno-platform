# Who is on a document, a chat or a picture in a project (2026-11-08)

**Status: PROPOSED — waiting for the owner's yes. Nothing here is built.**

**Owner, 2026-11-06:** *"we want the canvas to be the full infinite canvas of the project … if we create a text file
there, or deploy whatever node there for image, or a chat session there, all should be part of the project and
assigned people and arranged in the project."*

## The gap (measured 2026-11-08)

Every node on the project canvas has a person in its corner (`whoOf` in `platform-canvas.js`). For a **task** that
person is real: it is the task's assignee (or agent delegate), set through `PATCH /api/tasks/:key`, checked by
`assertAssignable`, notified, and shown everywhere the task is. For a **document, a chat or a picture** it is only
`node.who` on the canvas JSON (`services/canvases.js cleanContent`): nobody is told, nothing else in the project
shows it, an agent cannot read it except by reading that canvas, and a second canvas showing the same document can
say someone else.

Searched every repo under `X:\code\xeno-corporation` for an existing model to reuse (owners, assignees,
collaborators, responsibility, workforce, project membership, sharing, chat participants, task links). There is
none that fits:

| candidate | what it is | why it does not fit |
|---|---|---|
| `tasks.assignee_id / delegate_id / reviewer_id` | the one real assignment | only on tasks; a task can name one chat (`conversation_id`) and Storage folders (`task_folders`), never one file or a generation |
| `relationship_tuples` on `project:` | access (viewer < reviewer < editor < admin) | permission, not responsibility; a new relation name would mean "may" in one place and "is on it" in another |
| `storage_shares` | a file owner's grant to a person | permission, per file owner, not per project |
| `chat_live_participants` | who joined a shared live chat | joined by a link, humans only; not assigned |
| `workforce_project_participations` | an agent/team's responsibility in a project | project level only, agents and teams only, needs an accepted assignment |
| `contributions.responsible_user_id` | a submission's reviewer | points at legacy `project_tasks`, not files or chats |
| `media_generations` | owner/actor of a generation | the payer; immutable by trigger |

So making the person real needs a new record. That is a schema and an API contract other products will read (the
canvas, Projects › Team assignments, the people pages, agents through MCP), so it is a one-way door.

## Options, and what the leaders do

1. **A person property on any item in the project (recommended).** Notion's *Person* property on a database page,
   Monday's *People* column, Airtable's *Collaborator* field, Miro's card assignee: a project item carries the people
   responsible for it, separately from who may open it and from the work items about it. Linear keeps assignees on
   issues only, and its documents have an author and subscribers — which is why teams there make an issue per
   document; that is option 2.
2. **The task is the carrier.** "Assign" on a document node makes (or finds) a task "Work on ‹document›" assigned to
   that person, linked to the item. Reuses notifications, review, agent delegation and work reports. But it turns
   every "this is Ada's" into a piece of work in the task list, and a task cannot point at one file or a generation
   today, so it needs a new link column anyway — a schema change either way.
3. **Keep it on the canvas only** (today). No schema change, and the person means nothing outside that one canvas.
   This is the state the owner's words rule out.

## Recommendation: option 1

A new table, additive, in this repo (the platform owns projects):

```
project_item_people
  id            uuid pk
  project_id    uuid not null → chat_projects(id) on delete cascade
  item_kind     text not null check (item_kind in ('file','chat','generation'))
  item_id       uuid not null          -- a file (file_id, any version), a conversation, a generation
  principal_id  uuid not null → users(id)   -- a person or an agent (agents are users, agent_identities)
  role          text not null default 'responsible' check (role in ('responsible'))
  assigned_by   uuid not null → users(id)
  assigned_at   timestamptz not null default now()
  ended_at      timestamptz             -- ended, never deleted (who was on it stays readable)
  unique (project_id, item_kind, item_id, principal_id) where ended_at is null
```

- **Rules, from tasks:** only a project editor assigns; the person must hold `viewer` on the project
  (`assertAssignable`'s rule: "share it with them first"); an agent is allowed and appears as an agent; the item must
  be in the project (file in its folders or `chat_project_assets`, chat with `project_id`, generation with
  `project_id`).
- **One service** (`services/projectItemPeople.js`) used by the route (`/api/projects/:id/items/:kind/:id/people`), XENO
  MCP (`projects_item_people_*`, scope `tasks:write` like the canvas) and the canvas. The canvas stops storing a person
  for these kinds: `whoOf` reads it live from `records`, as it does for tasks, so every canvas and every screen agrees.
  `node.who` stays readable for one release as a fallback, then is dropped by `cleanContent`.
- **Who is told:** the assigned person gets a notification, through the existing notifications service.
- **Where it shows:** the canvas corner, the item's own page (Write, Chat header, Library details), Projects › Team
  assignments, and the person's own "on me" list.

## Blast radius (step 2 inventory)

- New: one table, one service, one route group, one MCP tool set, one migration.
- Changed: `services/canvases.js` (records resolve people for files, chats, generations), `platform-canvas.js`
  (`whoOf`, `whoPick`), the Team assignments tab.
- Existing data: `node.who` on canvases. Measure before migrating (count of canvas nodes with `who` per kind); the
  migration copies each into a row only where the item is in the canvas's project and the person still has access.
- Nothing published or shipped depends on it yet.

## Making it two-way, and the rollback

- Additive migration with a tested DOWN (drop the table); the canvas keeps reading `node.who` when no row exists, so
  dropping the table returns exactly today's behaviour.
- Feature gate `PROJECT_ITEM_PEOPLE` (fails closed: off = today's canvas-only person) until the owner has used it.

## What would make us revisit

- If people expect "assigned" to mean "has work to do with a due date", option 2 (tasks) is the right shape after all.
- If a second kind of person is needed (reviewer, approver), the `role` check widens; that is a new decision.
