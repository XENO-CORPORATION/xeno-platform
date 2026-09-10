# Backup restore rehearsal — 2026-09-10

**DATA-1.** The backups were healthy and had never been restored from. An
unrehearsed backup is a hypothesis; this is the measurement.

Rehearsed in a **throwaway PostgreSQL container** on the same pinned image as
production, with `backups/` mounted read-only. Production's own instance was never
written to and never restored into.

## Result

| | |
|---|---|
| dump | `xenostudio-20260910T031501.dump`, 726,570,813 bytes, taken 03:15 today |
| format | custom (`PGDMP`), 218 `TABLE DATA` entries |
| restore | **exit 0, 45 seconds, zero errors** (`--no-owner --no-privileges --jobs 2`) |

### Table set

222 in production, 218 restored. The four absent are **`browser_session_state`,
`workspace_teams`, `workspace_team_projects`, `workspace_team_agents`** — every one
created by a migration this morning's deploy applied at 06:44, *after* the 03:15
dump. Nothing else is missing, and **nothing exists in the restore that production
does not have**, so there are no orphans.

That is the expected shape and worth stating plainly: a restore of last night's
backup lands on last night's schema, and the fail-closed startup pipeline re-runs
the pending migrations. It is not a gap; it is the reason startup owns migrations.

### Row counts

| table | production | restored | |
|---|---|---|---|
| users | 25 | 25 | identical |
| credit_accounts | 50 | 50 | identical |
| credit_transactions | 147,851 | 147,846 | 5 written since 03:15 |
| oauth_accounts | 7 | 7 | identical |
| api_keys | 40 | 40 | identical |
| forum_threads / forum_posts | 9 / 18 | 9 / 18 | identical |
| email_logs | 32 | 32 | identical |
| security_events | 301 | 300 | 1 written since 03:15 |
| workspaces | 14 | 14 | identical |

Only the two tables that take live writes differ, by exactly the traffic since the
dump. **The backups restore.**

## Two things found while doing it

🔴 **Three xeno-post PRODUCTION volumes sit dangling on this box** —
`xeno-post_media-data`, `xeno-post_postgres-data`, `xeno-post_redis-data`, created
2026-06-14. Docker reports them as dangling because nothing here references them,
so **`docker volume prune` on this host would delete xeno-post's database.** The
rehearsal's own anonymous volume was removed by name after checking its creation
timestamp, never by pruning. Either re-attach those volumes or move them
deliberately; leaving them dangling next to a routine cleanup command is the hazard.

⚠️ **The root filesystem is at 91%** — 11 GB free of 116 GB, against a 1.2 GB
database and 726 MB of daily dumps. A restore needs roughly the database again.
There is room today and there will not be indefinitely.

## A figure I had been repeating, corrected

The workspace documentation says "162 of 218 accounts arrived through Sign in with
Google", and I quoted it, including in the commit message for the recovery fix.
Measured today, the live database holds **25 users, of whom 0 have a NULL
password_hash**, and 7 `oauth_accounts` rows.

So that figure describes a historical account base, not the current one. **The
recovery defect was real and the fix is right, but its blast radius today is zero
existing accounts** — it was forward-looking, not remedial. Signup reopened this
morning and every Google sign-up creates an account with no password, so it would
have started applying immediately; it simply had not yet.

Stating it the other way round would have been the more flattering version and the
false one.

## Resolved same day — the dangling xeno-post volumes

Established before touching anything:

| | platform box (stale) | xeno-post-001 (live) |
|---|---|---|
| `xeno-post_postgres-data` | 48 MB, last written **2026-06-21** | 68 MB, written **today** |
| `xeno-post_redis-data` | 60 MB, last written **2026-06-21** | 3.5 MB, current |
| `xeno-post_media-data` | 4 KB, **no files at all** | 284 KB |
| containers referencing them | **none** | 5, all healthy |

Leftovers from June, when xeno-post ran on the platform box before moving to its
own VM. Superseded by a database that has been taking writes continuously since —
restoring the stale copy would be actively harmful, not a recovery.

Archived first anyway, because the removal should be reversible even when the
reasoning is sound: `/mnt/projects/_archive/xeno-post-platformbox-leftovers-20260910.tar.gz`,
10.3 MB, 1,482 entries, verified to contain both data directories before anything
was deleted.

Then removed **by name, one at a time** — never `docker volume prune`, which was
the entire hazard. Afterwards: **0 dangling volumes**, all 6 `xeno-platform_*`
volumes intact, and xeno-post-001 unchanged with 5 healthy containers and
post.xenostudio.ai answering 200.

The hazard is gone rather than documented: a routine `docker volume prune` on this
host can no longer delete another product's database, because there is nothing
dangling left for it to take.

⚠️ Still open on this box: the **13 GB of chat-cutover dumps**. Those are backup
data from a completed migration, and deleting 13 GB of dumps is the operator's
call, not mine. Disk is at 87%.
