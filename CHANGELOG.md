# XENO Platform — Changelog

Newest first. The record of each deploy is XENO Index's release record (`/workspace/releases`); this file is the
plain-words account of what changed. It starts here; earlier history is in `git log` and that record.

## 2026-11-22

**XENO Chat has its own address: chat.xenosystem.ai.** The chat opens alone, filling the window like the Gemini web app: the chat's own sidebar at the left edge with the XENO mark and "Chat", then New chat, Library, Images and Scheduled, your projects and your recent chats, and the conversation filling the rest. It is the workspace's own chat, not a copy, so the same conversations appear in both. Each place has its own address: `/` is a new chat, `/c/<id>` a conversation, `/projects/<id>/c/<id>` one in a project, `/library` and `/images` the Library and image generation, and an old workspace chat link still opens there. Until today chat.xenosystem.ai only redirected into the workspace. It now has its own sign-in (client `xeno-chat-web`) behind the site gate, as Tools and Tasks do.
- **Lighter to open.** It loads 35 scripts instead of the workspace's 96, and 72 requests instead of 154. Measured to the chat being ready against the same stand-in: 272–285 ms cold and 158 ms warm, against 310–414 and 219–283 for the workspace's chat page.
- Proof: `npm run test:chat-host-ui` (16 checks, among them new chat → reply → in the history with the address naming it), `npm run test:chat-host-mutation` (6 of 6 caught), `scripts/oidc-chat-web-client.test.mjs` (6) and `product-address.test.mjs` (3). The Tasks host and the workspace's own chat test (125 checks) are unchanged, and `nginx -t` passes with the live frontend image.

**The workspace's sidebar header is back in the sidebar.** The Tasks host's top bar (2026-11-21) was styled under the class name `ph`, which is also the workspace sidebar's own header. On every workspace page that header was pinned across the top of the window, over the page. The bar is now `xph`. Proof: `npm run test:tasks-host-ui` now also checks the main site: the sidebar header stays inside the sidebar, and it fails with the old name.

**On the agent page, a new workspace and an edit made to it at once save without a false conflict.** Creating something and changing it straight away (a workspace and the folder linked into it) showed "Workspace changes are not saved: Workspace edits conflict at …", and the change was not kept. Underneath: a new build of the agent page (`public/remote-web`, from xeno-agent-interface #270, packages 0.1.205); the same fix is in desktop 0.3.54, where it was proven on the real app.

**On the agent page you can type while your PC's model gets ready, and a PC page fits a laptop window.** The message box on a PC's chat no longer locks and unlocks while the PC's model loads, which lost what was typed in between; only Send waits until the model is ready. Inside the workspace, a PC's page now always shows the whole interface with its session list, where below 900 px (a laptop window) it fell back to the phone view and left the workspace's side panel empty. The page also no longer throws a bridge error as it unloads. Underneath: a new build of the agent page (`public/remote-web`, from xeno-agent-interface #269, packages 0.1.204), proven by that repo's `run-remote-web-agent-live.mjs` (31/31 three runs in a row on a real app and browser, including a frame 860 px wide).

**XENO Depot can ask what a repo token may do on its own repo.** Depot's repo view (which XENO Runner's run API checks access through) holds the per-repo token a caller exchanged for one repo, and the platform's authority refused those tokens. Now `POST /api/depot/authority/token` answers for a per-repo token, read-only:
- **That repo only.** Another repo, or none, is refused (403). Every other authority route (registering repos, grants, deleting) still refuses such a token.
- **Never more than the token grants.** The answer is the live grants, capped by the token's own Lore actions and the scope it was issued with. A CI run's token always answers read only, and a grant made after a token was minted shows in a fresh session, not through it.
- **Read live.** A person's token is checked against its sign-in; an agent's per-repo token now names the credential it came from, so revoking that credential ends the token at once.

Proof: `node tests/depot-authority.test.mjs` on real Postgres; `scripts/depot-authority-mutation-check.mjs` catches 30 of 30, 6 of them new (another repo answered, either cap removed, accepted on write routes, credential not re-read, credential missing from the token).

## 2026-11-21

**XENO Tasks has its own address: tasks.xenosystem.ai.** Tasks opens alone, filling the window under its own header, the one XENO Tools and XENO Workshop have: the mark and "Tasks", the views (Board, My tasks, Triage, In review), then the workspace, Search · Ctrl K, New task and your account. It is the workspace's own Tasks, not a copy: the same board, task page, New task window and agent delegation, so someone who spots a problem opens tasks.xenosystem.ai, picks the project, files it, assigns a person or an agent, and it is the same task the workspace shows. Every view has its own address there: `/` is the board, `/T-12` a task, `/My tasks` a list. task.xenosystem.ai forwards to it, and anything that isn't Tasks opens in the full workspace. Sign-in is the host's own (client `xeno-tasks-web`), behind the site gate, like Tools.
- **Faster to open.** The page loads only the 32 scripts Tasks needs, not the workspace's 95. Measured on the board against the same stand-in API: first card in 556–620 ms instead of 1191–1474 ms, 68 requests instead of 155, 2.1 MB instead of 3.8 MB uncompressed. On this host the workspace's files, whose addresses carry a hash of their bytes, are kept for a year, so a return visit downloads only the page and its data.
- Proof: `npm run test:tasks-host-ui` (18 checks, including that flow end to end), `npm run test:tasks-host-mutation` (5 of 5 caught), `scripts/oidc-tasks-web-client.test.mjs` (7), and the workspace's own Tasks test unchanged (65). `npm run measure:tasks-open` takes the numbers again.

**A shared chat's address opens that chat.** On the agent page, the address of a chat from one of your PCs (`/pc/<id>/c/<chat>`) now opens that chat after a reload, where it used to show another chat or an empty one; and a message typed straight away goes into it on the PC instead of starting a new session there. Until the chat has arrived from the PC the page says "Opening the chat…" with no message box. Underneath: a new build of the agent page (`public/remote-web`, from xeno-agent-interface #268, packages 0.1.203), proven by that repo's `run-remote-web-agent-live.mjs` (30/30 on a real app and browser, failing on the previous build).

**People invited with a personal access code are no longer bounced to "Coming soon" after a week.** A personal code lets a person past the site gate with a cookie that lasts 7 days. When that cookie ran out, a signed-in person was sent back to "Coming soon" even though their code was still valid; Andreia was, and that is how it was found. Now a signed-in account that once used a code keeps the site for as long as that code lives. Revoking or expiring the code shuts the account out at once, and a suspended account is never let in this way. Proof: `node src/server/tests/site-access-codes.test.mjs` on real Postgres (43 checks, now in the core CI suites, where it had never run) and `scripts/site-gate-account-code-mutation-check.mjs` (4 of 4 mutations caught: no admission, revoked code still admits, expired code still admits, suspended account admitted).

**The release record says which XENO Depot revision a release came from.** XENO Index (xeno-index PR #4) added a source to every release record: the Depot repo and revision a change or deploy was built from, both or neither. This platform hosts it:
- The Index code is re-vendored byte-identical (`b439d5e`), with its schema file `20261121120000-release-depot-source.sql` as a migration. The vendor gate now checks all three schema files, not two.
- **Depot's signed event feed:** `POST /api/depot/events`. It is signed the way XENO Tasks signs its webhooks (`X-Xeno-Signature: t=<unix>,v1=<HMAC-SHA256 of "t.body">`), within five minutes, with `DEPOT_EVENTS_SECRET`; a comma-separated list rotates without losing events, and unset refuses everything. The signature is checked over the exact bytes received, before anything is parsed. A push or a merged review becomes a change carrying its source, recorded once however often it arrives; other event types are acknowledged and ignored; an envelope version this build doesn't know answers 422.
- **Deploys:** `deploy-platform.mjs --depot-source <repo>@<rev>` records the revision a deploy was built from. Without it, a deploy records no source, which means "built from git", as before.

Proof: `node tests/depot-events.test.mjs` on real Postgres with the Index's three schema files (7 checks); `npm run test:depot-events-mutation` catches 6/6; release-record 57 and release-internal-notes 55 checks pass on the re-vendored code; deploy tests 29/0.

**XENO Depot can sign people in and ask who may do what on a repo (staff only).** Depot is a separate service, the way XENO Connect is: it checks tokens, never issues them, and asks the platform what the holder may do on one repo right now (`xeno-depot/docs/decisions/0001-depot-foundation.md` §3). New here:
- **The `xeno-depot` sign-in.** The Depot CLI (`xeno-depot-cli`, device grant on a terminal or loopback PKCE on a desktop) gets tokens only Depot accepts; every platform API refuses them, so a Depot sign-in can never spend credits or read files here. An agent CLI (Claude Code, Codex) can register itself for Depot scopes (`depot:read`, `depot:write`, `depot:admin`) and acts as the person's own agent for that app, with the person's access, the XENO Tasks rule. Depot scopes never share a token with another area.
- **Per-repo permissions:** `read`, `write`, `review`, `merge`, `lock`, `admin`, kept as grants in the platform's permission store. Workspace owners and admins administer every repo of their workspace; members write, lock and review; merging is an explicit grant. A token's scopes cap what its grants allow, and a repo is never confirmed to someone who cannot read it.
- **Staff only until counsel clears the name:** the product door gains a third level, `staff` (XENO staff and their own agents), and Depot's door is set to it. Opening it later is one row, no release.
- `/api/depot/authority`, called by Depot's gate with its service token (`DEPOT_SERVICE_TOKEN`; unset refuses everything).

Proof: `node tests/depot-authority.test.mjs` on real Postgres, with tokens from the real code exchange and the real client seed; 7 of 7 mutations caught (scope ceiling, staff door, unreadable repo, last admin, mixed scopes, seed audience, stale principal).

**XENO Depot's Lore server checks our tokens itself, with no call back here.** Lore v0.14.0 verifies `at+jwt` tokens and reads each repository's grants from inside the token (Depot decision 0001 §3, amended; the claim format is XO - DEPOT's reading of Lore's source).
- **The exchange.** The token endpoint does RFC 8693 for Depot: a Depot sign-in plus `resource=https://depot.xenosystem.ai/repos/<id>` becomes a token for that one repository (at most 15 minutes, `depot_resources` in Lore's format, `root_domains`, `identity` = the account id). An `xdp_` credential (`subject_token_type urn:lore:params:oauth:token-type:api-key`) becomes the agent's session token, which is then exchanged per repository the same way.
- **Read at exchange time.** Grants come from the repo's grants when each token is made, so a revoked grant, a closed door, a suspension or a revoked credential takes effect at the next exchange.
- **CI runs.** A CI machine fetches one repository's archive with a run token: Runner's agent exchanges its `xdp_` credential with `depot_run_id` and `depot_run_deadline`. It gets read on that one repository only, the run id inside, valid until the run's deadline and never more than 2 hours. A request for anything broader is refused, not narrowed, and a person's sign-in can't mint one.
- **Never handed out.** A token for one repository can't be exchanged again or used at Depot's gate. `obliterate` (destroying history) is never put in a token.
- **Separate from the platform's exchange.** Depot exchanges never reach the platform's DPoP-bound exchange, and the reverse.
- **Discovery at the issuer.** OIDC discovery is now served at `https://xenostudio.ai/.well-known/openid-configuration`, where the standard says it lives (`<issuer>/.well-known/openid-configuration`). That path used to return the website's HTML, so no standard verifier could find our keys. Pinned by `scripts/oidc-discovery-root.test.mjs`, which fails without the nginx rule.

**Headless agents can use XENO Depot with their own credential.** A build agent such as Runner has no browser to sign in with (Depot decisions 0001 §3, 0002 §2). Its person issues it an `xdp_` credential at `POST /api/depot/credentials` (and lists or revokes it there). The secret is shown once; the platform keeps only its fingerprint. With it the agent acts as itself: its own repo grants, capped by its owner's and by the credential's scopes (`depot:read` by default). Only a person who manages the agent can issue or revoke one, and an agent never can. Revoking or expiry takes effect on Depot's next request. Proof: the same suite on real Postgres, now 11 of 11 mutations caught (adding: secret not compared, revocation ignored, an agent issuing, scopes ignored).

**The Agent area's breadcrumb names your PC.** A session open on a PC read "Agent / A PC / Chat"; it now reads "Agent / bnkr / Chat", with the PC's own name. The name is the one the PC registered with, which the server already holds: the workspace reads it from `GET /api/account/remote-pcs` (your own PCs, on your web session) by the id in the address. The sealed page still tells the workspace only ids, and chat and project names stay sealed. Proof: `remote-relay.test.mjs` (41, real Postgres) and `npm run test:agent-remote-ui` (mutation-checked).

**The site's image records the commit it was built from.** The frontend image now carries `XENO_SOURCE_REVISION` as a label and in `/etc/xeno-revision`, as the backend image already did, so "which site build is live" is read from the container rather than guessed. It is kept out of the served folder. Proof: `node --test scripts/deploy-platform.test.mjs` (mutation-checked).

## 2026-11-20

**Credit holds stay fast as open holds pile up: open holds are summed once per call.** The index from earlier today held only while there were few open holds. At 1,276 the planner went back to probing every open hold once per grant (2,067,120 probes, 5.2 s) inside the account lock, and holds queued to a 70 s median. The three funding queries in `utils/usageCreditFunding.js` now sum open holds once, in a grouped join: identical rows on production data (1,620 of 1,620, 0 differing), 5,981 ms to 8.4 ms, `FOR UPDATE OF g` unchanged. Proof: the money-path suites against Postgres 15.

**Billing holds answer in a fraction of a second again, and the API gateway's ledger calls are no longer rate-limited as one person.** Every paid XENO API call places a credit hold first. The funding check behind it probed every open hold in the system once per credit grant, inside the transaction that locks the account: the busiest account (1,620 grants, 647 open holds) took 1,048,140 index probes and 2.6 s per check, holds queued to a 14 s median, and the gateway (3 s limit) answered "Billing is temporarily unavailable". A covering index (`idx_credit_hold_funding_grant_cover`, migration `20261204090000`) lets each grant read only its own funding rows: 2,610 ms to 135 ms, holds to a 0.16 s median. Separately, the global `/api/` limiter (300 a minute per credential) counted the gateway's one service token as one person for every API user, refusing balance, hold, settle and void calls with 429; a refused settle or void leaves a hold open. Calls to `/api/v2/ledger/service` that present the correct service token now skip it (`isAuthenticatedLedgerServiceCall`, same constant-time check as the router); anything else on the path still counts. Per-account limits belong at the gateway, per API key. Proof: `node tests/global-limiter-ledger-service.test.mjs` (offline, mutation-checked).

## 2026-11-19

**Open your repositories in a cloud session.** A cloud session in the Agent area gets a Repo chip beside "where it runs". It lists the repositories already on your cloud machine and the ones you let XENO see on GitHub; you can also paste any repository's address. Picking one clones it on your machine once and makes it the session's folder. "Connect GitHub" installs the XENO GitHub app (XENOSYSTEM Agent) on your account, where you choose which repositories it may see. Underneath: `services/githubApp.js` and `/api/github` (connect, the list, disconnect) on the platform's one GitHub record (the FORGE-03 tables), and `GET|POST /api/compute/cloud-agent/repositories`. XENO keeps no GitHub token: for each repository it opens, it asks GitHub for a token that works on that repository alone and runs out within the hour, hands it to the machine's clone command, and keeps only its fingerprint. Proof: `npm run test:github-repositories` (real Postgres, 36 checks).

## 2026-11-18

**A new session says where it will run.** An empty session in the Agent area shows a small card in the middle with the place it will run (your cloud machine or a PC) and how it stands right now. "Choose where it runs" opens the same list as the chip at the message box. The card goes away with the first message. Underneath: a new build of the agent page (`public/remote-web`, from xeno-agent-interface #255).

**Choose where XENO Agent runs from the message box.** A chip at the bottom left of the Agent area's message box names where this session runs (Cloud, or your PC's name), with a small square for its state. It opens a list of places, one line each. The place in use is the brighter row marked "In use". Each place shows how it stands right now: your cloud machine asleep (it starts when you send), starting or running; each PC online or offline. Local leads to the desktop app download, a PC not connected to this browser yet shows "Connect", and Connect a PC is last. Type to search, use ↑ ↓ and Enter. If a chat is in progress, moving to another place asks first: the chat stays where it runs, and the other place opens in a new session. Underneath: a new build of the agent page (`public/remote-web`, from xeno-agent-interface #254); the cloud machine's state is read with the call the page already makes, which starts nothing.

## 2026-11-15

**The Agent area is one place in the platform's design.** The agent's own sidebar now sits in the workspace's left panel, under the header the panel already has, and the conversation fills the main area. Both are drawn in the platform's colours and Inter, taken from your theme. The panel reads New session, Sessions, Runs, Checkpoints, then Mission control, Projects, Agents, Teams, Library, Tools, Scheduled and Main Chat with your chats; there is no account row, since the platform's account is the one in use. Sessions, Runs and Checkpoints open as pages in plain words. Fold the panel and the sidebar goes back beside the conversation. Underneath: the workspace shows the agent page twice (the conversation over its main slot, `/side` over its panel's body) and sends it its colours (`xeno-remote:look`); nothing of your chats passes through the workspace's page.

**All your agents' runs in one list.** `GET /api/agents/runs` lists every run of every agent you own, newest first, with the agent, the task and how it went, in the same shape as each agent's own run list (`GET /api/agents/:id/runs`), so the two always agree. It pages 1-100 at a time with a `next` cursor, and only runs still going are checked with the runner, so a long history stays one quick read. The Agent area's Runs list reads it.

**XENO Agent in the workspace is there the moment you open it.** The Agent area no longer waits on "Starting your cloud machine…". The whole interface appears at once, with your chats and somewhere to type, and no machine is started to show it: your cloud machine starts when you send a message, so a visit in which you send nothing costs nothing. The agent's own panel (New, your chats, your projects) is now the left panel, under the header the sidebar already has, in place of the separate "Cloud / Your PCs" panel; the row at its foot says where it runs and goes to your PCs. A machine that is already running (a turn you left working) is joined straight away. Underneath: the page asks how the machine stands without starting it (`GET /api/compute/cloud-agent` now also says its state and when it was last used), and the frame covers the left panel's body as well as the main area.

## 2026-11-14

**A cloud turn you walk away from is allowed to finish.** A cloud machine used to stop 30 minutes after the last tab closed, even with the agent in the middle of a turn. Now the machine is asked first: while its agent is working it keeps running, and it stops on the first check after the turn is over. It is billed for that time like any running machine. With nobody connected it runs on for at most 12 hours past its idle limit, and a machine that cannot answer stops as before.

**Chat replies appear in whole words.** While a reply is being written in Chat, it no longer appears a few letters at a time: each word shows up whole once it is complete, at a steady pace, and the newest words fade in. Code is drawn as it comes, without the fade. A reply that was already finished when you open the chat shows all at once, as before. It is the same reveal XENO Agent uses. If your system asks for reduced motion, there is no fade.

**Replies in XENO Agent on the website are written smoothly.** In the Agent area (Cloud and your PCs) a reply now appears at a steady pace and in whole words, each new word fading in, instead of in whatever pieces the network delivered. This is the remote page from XENO Agent 0.3.47 (build `index-ytXzia-S.js`). The platform's own chat is not changed by this.

**XENO Agent in the workspace opens on Cloud.** The Agent area now starts with somewhere to type: your own cloud machine, running the same XENO Agent as your PC. It starts when you open the page, keeps working after you close the tab, and stops by itself when idle; its time is paid from your credits, like every machine. A switch at the top goes between Cloud and your PCs. A chat on your own PC is end-to-end encrypted; a cloud chat is not, because XENO runs that machine, and the page says which is which. Cloud sessions are open to the accounts Cloud Shell is open to. There is no repository picker yet: in a cloud chat, ask the agent to clone the repository. The page that shows it (remote.xenosystem.ai, build `index-Bs7-KZzB.js`) is published with this.

**XENO Agent in the workspace no longer asks you to sign in again.** You are already signed in to the workspace, so the Agent area now opens on your PCs by itself. The page that shows your PCs also signs in at xenosystem.ai now, not xenostudio.ai, so opened on its own at remote.xenosystem.ai it uses the XENO session you already have. Connecting a browser to a PC with the six digits is unchanged.

**XENO Agent in the workspace is the whole app.** The Agent area now shows the same interface as the desktop app, working on your PC: your sessions on the left, tabs, and the box to type in. You can start a new chat on your PC from the browser, not only open one you shared; it needs XENO Agent 0.3.46 on that PC. Signing in there is one click: a tab opens, signs you in and closes by itself. With one connected PC it opens straight away. On a narrow screen it stays one thing at a time. Cloud sessions and a repository picker are not there yet.

**XENO Agent in the workspace shows the chats on your PCs.** The Agent area used to send you to the desktop app. It now lists your PCs and the chats you shared from them by typing `/remote` in XENO Agent. You open a chat, type, and it runs on that PC; what you type and what the agent does show in both places as it happens. The first time, you connect a browser to a PC with **Connect**: both screens show the same six digits and you allow it on the PC. No code is needed. The chats are end-to-end encrypted, so they are shown in a frame from remote.xenosystem.ai, which keeps their keys where the rest of the website cannot read them. Each PC and chat has its own address. Cloud sessions are not in this list yet.

**The page at remote.xenosystem.ai lists what a PC shares**, including chats with no project folder, and it stays up to date when a turn is started on the PC.

## 2026-11-13

**Your Spawn conversation backup works like iCloud.** A PC you sign in on can now open your conversation backup with no extra password and without another PC approving it: XENO keeps a copy of the backup's key, locked with a key of its own that is stored apart from your data. Your conversations are still encrypted on your PC before they are uploaded, so Storage only ever holds scrambled bytes. To keep a new PC from quietly opening it, its first time needs a sign-in in the last 10 minutes, and you get an email naming the device. Every time a device opens the backup it is logged where Spawn can show it. A private mode, where XENO keeps no copy of the key, will come later; turning it on deletes XENO's copy for real.

**Code runs look like the rest of XENO.** When the assistant runs code, it now shows as a step in the turn's list of steps, the same way XENO Agent shows a command: the code, what it printed, any error and how it ended open when you expand it, and each file it made is listed and opens from there. The separate white-headed box drawn inside the reply is gone.

**Your PCs and browsers show as connected when they are.** The list of your connected devices (remote control, your browser, Corpus) could show one as off while it was on, about half the time, because each of our two servers only knew the devices connected to itself. A device now counts as connected when either server has heard from it in the last minute. A device that just went off can still show as on for up to a minute.

**Attached files of any size reach the code.** The first version only worked for small files: the code service refused anything over about 1 MB, so a picture of almost a megabyte failed with "That code could not be executed." Files up to 64 MB per run now reach the code. When a run fails, the step now says why in plain words (for example, that the files were too large) instead of only that it could not run.

**Code in chat can open the files you attach.** When the assistant runs code in a chat, the pictures, documents and data you attached to that chat are now there for the code to open, exactly as you uploaded them, in an `attachments` folder. Before, the code could not see them, so the assistant asked you to upload the file again. Only files you are allowed to open are given, and a file still being checked for safety is given once the check is done; the assistant is told which files it has and which it could not have. The code can read them but not change them, and they are not copied again into your Library.

## 2026-11-12

**XENO Agent on the desktop can read your workspaces.** Its Account and members page showed "could not be verified" for everyone, because the app's sign-in was never allowed to ask to see your teams. It may now read your workspaces, their members and your invitations. Later the same day it was also allowed to manage them (invite, remove, workspace keys), as the app was designed; only an owner or admin of a workspace can still change it. You need to sign out of the app and sign in again once.

**Spawn's projects, named sessions and conversations can follow you to another PC.** XENO Spawn can now keep its projects (name, tabs and the folder on each PC) and named sessions on your account, the same way it already keeps profiles, so a second PC gets them too. It can also back up your agent conversations into your XENO Storage, in one "Spawn backup" folder that counts against your space like any other file. The backup is encrypted on your PC before it leaves: XENO stores only scrambled bytes and never has the key, not even for which project or agent a conversation belongs to. A new PC can read it only after one of your PCs approves it, or with the recovery key you keep. Lose every approved PC and the recovery key, and nobody can open the backup, including XENO. Uploads only ever add: a piece already uploaded is never replaced.

## 2026-11-09

**A workspace keeps a record of the sites it publishes.** When XENO Workshop publishes a site, it now tells the workspace what happened: the site claimed, each version published, which version went live, a rollback, a domain added or removed, a rename, a delete. The workspace keeps every version and a log of who did what and when. People with access to the workspace can read it at `/api/sites`, and agents on XENO MCP (`sites` tools). An agent may publish a preview version; making a site live or taking it down is a person's, and the database refuses it for an agent too. Workshop reports with the person's own sign-in, under the new `sites:write` permission, which Workshop receives the next time a person signs in to it.

## 2026-11-08

**A run's steps now include the ones it was refused.** Every step the platform refused an admitted run is now kept: the tool or model call it asked for, the reason, whether the run can carry on and what would let it, and when. The steps read lists them among the allowed steps, each after the step it followed. If a run keeps asking for the same refused thing, it shows once with a count and the last time it asked. Only the person who started the run sees them, and a request from anyone else leaves nothing behind. `refusalsRecorded` is now `true` for runs started from today; older runs say `false`, because their earlier refusals were not kept.

**See every step a run took.** A new read, `POST /api/workforce/run-admissions/steps/read` (and `steps_get` for agents on XENO MCP), lists each step an admitted run was allowed to take, in order: the tool it was allowed to call, or the model call, with the model, its tokens and what it was charged. It is paged, only the person who started the run can read it, and a stop shows with its reason. A step the platform refused is not stored, and the answer says so (`refusalsRecorded: false`), so an empty list never reads as "nothing was refused".

**Write a document together, live.** Two people can now write in the same document at the same time, on a project canvas or in Office › Write, or one in each: both see every keystroke as it happens, edits in the same paragraph both land, and bold, lists, callouts, links to other pages and every other kind of block or style come through exactly as written. Each person sees where the others are typing. A document node on the canvas now opens XENO Docs' own editor (the one in Write) instead of a plain text box, so formatting is never lost. One screen saves it, so there are no "someone saved a newer version" conflicts while you write together, and every save is a version you can go back to. A file this editor can't write opens read-only, as before.

**Who is on a document, a chat or a picture belongs to the project.** The person in a canvas node's corner used to be a drawing on that one canvas. Now, for documents, files, chats and pictures, it is part of the project, like a task's assignee: every canvas shows the same person, read live; the person is told; Projects › Team assignments shows what each person is on; and agents can read and set it. Only a project editor can put someone on an item, and only someone who can already see the project. A picture keeps its person when it finishes generating. It is switched on per server and starts off.

**Lend an agent into another workspace.** An agent's Lend used to offer only divisions in its own workspace, so the only way to bring it into another company was through a project or team there. Lend now also lists the divisions of every other company workspace you belong to; that workspace's admins accept it (at once, if that is you). It keeps its owner, its own division and who pays for it.

**Fonts suggests pairings.** In Studio › Libraries › Fonts, Suggest a pairing on any catalogue font asks a model which fonts go with it, optionally for what you are making, and shows up to three partners set in their own type, each with the reason, ready to add. It only ever names fonts from the catalogue we host, and it uses your credits, which the dialog says before you ask.

**Invoices pick the customer, and take real lines.** In Corpo › Company, New invoice has a table of lines (item, quantity, unit price and tax per line, with a running total) instead of a first line plus a box of text, and a Customer choice from Corpo › Customers that fills in who is billed, their tax number and address. A new customer, or changed details, is saved back to Customers once the invoice is issued (or kept to that invoice only, if you choose). A customer company in Customers now holds those billing details.

**"Updated just now" means it.** Support, Tasks, Releases and the Community pages said "Updated just now" at the bottom whatever had happened, including after a load that failed. The line now says what really happened: Couldn't load (with Retry), Couldn't refresh (keeping what was already shown, and when it last worked), or Updated, only after a load that worked. A failed Support queue, Deploys, Features or Notes list now says it failed instead of showing an empty list, and staff stay on their own view when a check fails instead of being shown the customer's.

**Reply to a chat right on the canvas.** A chat on the canvas used to show its thread and send you to Chat to answer. Now press Reply under the thread and the chat opens in the node itself: the same chat as in Chat, with the same models, tools and project context, and the answer streams in place. Move the node, zoom or keep working on the canvas and what you've typed stays. Done closes it again.

**Agents can work on a canvas the way people do.** Through XENO MCP, an agent can now put image and video nodes on a canvas (with their prompt, and the files or running generation that fill them), change a node's prompt, and change what a connection means: between two tasks that makes a real task link, as it does on screen. Moving, resizing, writing notes and connecting were already there. Everything goes through the same rules as the screen, so an agent can only change a canvas its person may edit.

**Losing access closes the canvas.** Someone removed from a project, or from the workspace it belongs to, or turned from an editor into a viewer, used to stay on the project's open canvas and keep editing until they left. Now their live session is closed as soon as the change is saved, and the canvas reopens as what they can still do: view only, or "not shared with you". People who can still edit are left alone. An agent that loses access closes its person's session too, who simply reopens it.

**The product list says what works.** Assets, Fonts, Stock, CRM, Forms and Scheduling were still marked "Soon" in the workspace although each has run there for weeks. They are now listed as working, and choosing one opens its real page (Studio › Libraries, Corpo › Customers, Forms, Scheduling), including from search and from an old link. The Assets, Fonts and Stock product pages on the site no longer call themselves a documentation scaffold: each says what works today, what is next, and links into the workspace. Support Desk (answering your own customers) and Mail stay marked "Soon": the desk is not built, and XENO Mail's server is offline.

**Every canvas node looks the same way.** Files that aren't pictures or documents, links, groups, verdicts, runs, objectives, divisions and older image cards were still the old boxes. They now follow the new node design: the name sits above the object, a selected node gets a thin drawn line, and every corner has the curved resize handle. Something you can no longer open keeps its place, quieter, so the layout doesn't jump. A project shown on a division's map is a normal card again, with its open tasks and status.

**The project name fits in the header.** On a project page the path gave way to the tabs so early that a project read "Projects / BUNK…". The path now keeps its width and the tabs scroll in what's left. A canvas in a project is shown by its name in the path, not its id.

**Sidebar sections fold, and stay folded.** Every sidebar heading, like Projects and Recents in Chat, shows its arrow and folds or opens on a click. What you fold is remembered for that place, across new chats arriving, opening a chat and coming back later.

**One shelf for GameDev on the PC and online.** XENO GameDev signs in two ways, from its studio on your PC and at gamedev.xenosystem.ai, and Storage used to file each one's games apart, so a game started on the phone never showed up on the PC. Both now reach the same games in your Storage; neither reaches any other app's projects.

## 2026-11-06

**New canvas nodes.** The project canvas fills the page, and you add to it by right-clicking the board, with search and single-key shortcuts. A picture or video is its own node: select it and a panel opens underneath with the prompt, settings and versions, and it generates in place, with connected images feeding a video. Documents are pages you can write on directly, chats show their thread, tasks show their progress, and every node has a person in its corner. Drag a corner to resize: pictures keep their shape, everything else takes any size.

**A reply reads in the order it was written.** An image card, a generated image or a code run used to sit above all of the reply's text, even when the model wrote the text first, so "the brief below" appeared under the card it described. Each one now stays where it happened, while the answer streams and after a reload. Chats from before this keep their image cards under the text; older code runs stay where they were, because nothing recorded where they happened.

**The Generate button stops flickering.** A waiting image card kept switching between "Generate · up to 10 credits" and a grey "Pricing…", because every status check asked for a new price. It now gets one price per request, renews it quietly before it runs out, and only shows "Pricing…" when you change a setting. If a request can't be priced, it says so and stays said, with "Price it again" beside it.

**The project canvas is live.** People on the same canvas see each other, their cursors and each other's changes as they happen, and a card being moved moves on everyone's screen. Two people can work at once: changes to different cards both land, nobody gets a conflict warning, and it's saved once. What changes elsewhere in the project, by a person or an agent, reaches the open canvas within a moment. Adding an existing file or chat to a project's canvas now adds it to the project too.

**Work from the project's canvas.** On a project's canvas, New doc writes a real document into the project's Files, New chat starts a chat in the project, and Image generates into the project after showing you the most it can cost. Each is the same record you'd see anywhere else, not a copy. Select a task card to assign it.

**A project has its own canvas.** Canvas is now a tab in the project, at the project's own address, instead of opening under Tasks. It shows the whole project (objectives, tasks, files, conversations and active runs) and stays complete: what's added to the project appears on the map the next time it's opened. Cards you've moved stay where you put them, and a card you've taken off stays off. Old links land in the right place.

**A wake answers and stops.** An agent named in a channel used to take a task, report, comment and send it for review around its reply, and each step was another paid model call. Now it answers, reads the channel only if it needs to, and its task closes by itself, so a reply no longer lands in your review list. It can still raise a task if the work needs one.

**Tools that use AI run on the website again.** A tool on tools.xenosystem.ai that does not choose a model, such as Motion 2D, failed with "The model `auto` does not exist". It now uses your default model, and the platform default moves from the retired GPT-5.6 Terra to GPT-6.1 Sol.

**A channel stays live.** A new message or reply now appears without reopening the channel. The page could open two connections at once and end up listening on neither, and one that dropped never came back; now there is one, and it reconnects and catches up by itself. A conversation you've read also stops showing as unread straight away.

**A wake has enough budget to answer.** One wake was using about 50 credits on the current model, so the old 10-credit default ran out before the agent could reply. New settings start at 50, and you can set up to 200.

**An agent on a project can talk in that project's channel.** It was listed as a member but refused when it tried to read or answer, unless it also belonged to the whole workspace. It reaches that one channel, and the rest of the workspace stays closed to it.

**A company project can be given to an agent.** Projects made inside a company workspace were missing from the list of projects an agent can join, so no agent could work in one or talk in its channel. They now show up for that workspace's people.

**An older agent can answer in a channel, and a wake never pays for silence.** Agents made before Message existed now reach it. If an agent still can't, because Message is off for it or its connection is paused, it isn't woken and the person who pays is told why.

**Naming an agent in a channel can wake it.** Turn it on from the agent's Settings, for people or for people and other agents. The agent starts a cloud run in that channel and answers there. Whoever answers for the agent pays, up to a budget per wake and a limit per day, and agents can only wake each other three times in a row. It stays off until you turn it on.

## 2026-11-05

**Message shows what happened to what you sent.** One tick means XENO has it, two mean it reached everyone, and two in green mean everyone has read it. In a group, hover to see who, and the count shows while only some have read. If you turn read receipts off, nobody sees you read and you don't see others read. Channels no longer stay marked as new after you've read them.

**@ names someone in a conversation, people and agents alike.** Type @ to pick from who's there. It lands in their inbox, and an agent reads its own inbox with its tools. An agent can name another agent the same way. Naming an agent doesn't start it running.

**The account menu tells the truth about connected accounts.** Connected accounts opens Sign-in & security and no longer shows a made-up count, and Get the apps goes to xenosystem.ai.

## 2026-11-05

**Remote control from a phone.** remote.xenosystem.ai opens XENO Agent on your own PC from any browser, with nothing to install. It has its own address and its own sign-in, which can reach remote control and nothing else on your account.

## 2026-11-04

**A business can change its trading name.** Edit details now has it, and it goes on new invoices and renames the workspace. Invoices already issued keep the old name. Before, no screen could rename a business.

**An invoice a customer can actually use.**

- Print or save any invoice as a PDF, from exactly what was issued, in German for customers in German-speaking countries and English for everyone else. Before, the only copy was UBL XML.
- New invoice asks for the customer’s street and postal code, the date of supply or a period, and always a due date.
- Add your bank account once under Getting paid and it goes on every invoice with the invoice number as the payment reference. A mistyped IBAN is refused. Invoices already issued keep what they said.
- A small business can set its limit and see the year’s invoiced total against it. Only invoices issued here count, and the page says so.
- Germany has its own checks now: over 250 euros an invoice needs the customer’s full address, the date of supply and the seller’s tax number. Up to 250 euros the shorter rules apply.
- Every invoice with money owed now states a due date or payment terms, as the European standard requires.

**One person can run a business on XENO.**

- Corpo › Company now handles a sole proprietor: a Kleingewerbe, a PFA, a sole trader. The page reads as the owner trading under the business name, and says plainly that the owner and the business are the same legal person.
- A small business that charges no VAT states that once, with its own wording, and every invoice carries the note with no tax added. Tax can't be charged by mistake, and the day the exemption ends it's one setting. Invoices already issued keep what they said.
- A tax number now reaches the invoice when it's the only number a seller has, written as a tax number and never as a VAT ID.
- Invoices show the seller's and customer's postal code on screen.

**Found by setting up XENO on XENO.**

- Creating a company now opens Corpo › Company, not a second page for the same thing.
- Company's tabs stay still when you pick one. In a narrow window the page path gives way so the tabs stay usable, on every page with tabs.
- A company with nothing filled in gets an Add a registration button on Invoices, and no longer reads about "this country".

**XENO Company lives in the workspace.**

- Corpo › Company now has Overview, Invoices, Wallet and Activity in its header, in the workspace's own design. People, Agents and Divisions stay on their own pages.
- Issue an invoice from Invoices. Each invoice has its own address, with its lines, totals and UBL download, and a mistake is reversed with a credit note.
- The workspace's company forms no longer assume Romania. A company set up there can invoice with a VAT number or a registration alone.
- /company sends you to the workspace page.

**XENO Company's dashboard has its whole backend.**

- Everything the dashboard calls now works against the platform: found a company, members and invitations, employ agents and set what they may do, activity, the wallet and transactions. It reads the same records the workspace shows, so there is nothing to keep in sync.
- A company can be registered in any country. It states its own legal form, numbers and registered office, and that is enough. Where a register is connected, which today is Romania's, it confirms them.
- A registered company can issue invoices and credit notes in its own currency, with no tax or any rate, checked against the common invoice rules plus a country's own rules where we have them (Romania so far). Meeting local tax law stays the company's job, and the dashboard says so. Only a person who manages the company can. Numbers have no gaps, even when several invoices are issued at once or one is refused.
- An issued invoice can't be changed or deleted by anyone, in the app or the database. A mistake is corrected with a credit note.
- An employed agent's role is checked like everyone else's, and its capabilities are enforced each time it runs.
- XENO sends invoices to no tax authority, and national e-invoicing is no longer planned (owner's decision, 2026-11-04).
- A UK company can now record its own GB VAT number, and Corpo › Company lists every country.

## 2026-11-03

**XENO Creator has its own address, creator.xenosystem.ai, served the way motion.xenosystem.ai is.**

- The site serves whatever release XENO Creator has published into `/srv/xeno-creator-web` on the server, behind the same invitation gate as the rest of the site. Publishing or rolling back Creator needs no site deploy.
- Signing in there opens a XENO session on that address (client `xeno-creator-web`, identity only), and the server recognises the app as `creator` when it checks a licence.

**A release's own page now names itself in the browser tab** ("XENO Canvas 0.43.1 release notes"); it showed only "XENOsystem".

**Major releases of XENO products now come with a release post: clips, pictures and what changed.**

- A product's release page shows a major release's key picture and one line, with a link to the full post; the release's own page shows the whole post, with its clips and screenshots from the real app, above the notes. Quick releases keep their notes only.
- Posts are read from the update server beside the release's installers, so a new post needs no site deploy.
- The release script takes `--kind quick|major` and `--post <folder>`, checks the post before anything is uploaded (every named file present, nothing unnamed, images and video only, a clip needs its poster, at least one picture or clip) and reads every file back from the public address afterwards.

**A cloud run that uses up its budget now says it stopped, not that it failed.**

- The Run dialog promises a run stops when it has used its budget. It did stop, but showed as failed with a raw API error. It now shows as stopped, with a note to run it again with a bigger budget to carry on.

**An agent you talk to at its desk is the same agent that works your tasks.**

- In Places, talking to an agent now gives it its persona (its role, voice and boundaries) as well as its instructions, read from the same record its task runs use. Before, a desk conversation knew only its name and instructions.

**Leaving a chat mid-answer now stops it and releases the credits it reserved.**

- The chat server never noticed when a person closed the tab or lost connection during a streamed answer. The answer kept running, could start another model call, and the credits held for it stayed reserved for up to 30 minutes before being returned. Nothing was overcharged, because unused holds are returned, but the balance looked lower until then. Closing the tab now ends the turn and settles or returns its holds at once.

**Chat can run its turns on the XENO Agent's loop. It is off until switched on.**

- With `CHAT_AGENT_RUNTIME=xeno-agent`, the XENO Agent's loop decides when a streamed chat turn calls the model again. The model, its instructions and every tool stay the platform's, and are billed the same way. `CHAT_AGENT_RUNTIME_USERS` limits it to listed accounts.
- A failed model call is never retried, a turn stops starting new calls once the person leaves, and two calls to the same tool keep their own arguments.
- The chat server now uses XENO Agent SDK 0.10.110 and the web-search client 0.1.5.

**Spawn profile sync keeps only what Spawn names.**

- Your account now stores only the settings and instruction files Spawn syncs (`settings.json`, `CLAUDE.md`, `AGENTS.md`, `config.toml` and similar, plus your own agents, commands, prompts and output styles). Device files an older Spawn uploaded (Claude Code's `.claude.json`, with your email, machine ID and local project paths, and its paste cache) are no longer stored or sent to your other devices, and copies already stored are left out when they are read.
- Environment variables and credential helpers in `settings.json` are not stored.
- An older Spawn keeps syncing: the files it may not send are dropped and named in the reply, not refused.

**A team sold in the Marketplace keeps who each agent is.**

- Publishing a team now includes each agent's persona (its role, voice and boundaries), the way selling one agent always did. Before, a buyer's copy kept only the instructions.
- Each agent in a team is now checked like a single agent: instructions or a persona holding a key or password, or trying to take over whoever runs them, stop the export and name the agent to fix.
- Teams already published are unchanged.

**Leaving stops what you started.**

- Closing a XENO Compute command’s window now stops the command on the machine. Before, it kept running, and costing, after you left.
- Leaving Places no longer leaves you shown in the building, and closed live views stop updating in the background.

**Fixes found by using the platform as a new person would, start to finish.**

- Typing the code from the welcome mail now also confirms your email address. Before, you were active but still "unverified", so the free allowance was refused and Settings said "Not verified".
- The 11 accounts this had already caught are now marked verified.
- A team made in Workspace › Teams can be sold. Its agents used to be left out, so publishing always failed.
- The Seller console loads for sellers. It failed for everyone the moment they registered.
- Buyers can bring a team they got into their workspace. It was always refused, and the dialog now names the terms they accept.
- A listing shows who comes with a team, and a reviewer reads each agent's role, voice and instructions before approving.
- Uploading a font works. Every upload from the browser was refused.
- Adding a provider key says plainly what is wrong. An address XENO won't connect to no longer reads as a bad key.
- Opening a few pages at once no longer shows "could not be loaded" everywhere. Each signed-in person now has their own allowance, under a larger one for everyone sharing a connection.

## 2026-11-02

**Database backups in R2 now have a key we hold, and they've been restored to prove it.**

- The private key for older R2 backups couldn't be found, so new backups use a new key, and a full restore from R2 passed.
- Dumps and base backups in R2 can't be deleted for 30 days, even from the server. Backups expire after 90 days.
- The restore drill is now a script: `scripts/dr-restore-proof.sh`.
- The old key is lost, so R2 backups from before today can't be restored. One dump per day from October 28 on was re-encrypted with the new key and checked by decrypting it from R2.
- The server now keeps 3 local dumps instead of 14, which frees about 20 GB after tonight's backup.
- Recovery to an exact moment is now proven with the new key: a base backup and WAL from R2 stopped at the chosen second, and the credit ledger matched production.
- The restore drill now runs every 4 weeks, and an email goes out if it hasn't passed in 35 days.
- Server monitoring runs on time again. Listing the backups had grown to over 30 minutes, so its 15-minute checks were piling up.
- Support mail, scheduling mail and the internal Research workspace are now marked as off on purpose, so they no longer raise an alert.

## 2026-10-31

**You can sell your agents in the Marketplace.**

- Seller console › Publish an agent: rent it for 30 days at a time, offer a copy, or both, free or for credits. Its role and instructions go on sale. Its memory, credentials and history stay yours.
- Instructions holding a key or password, or trying to take over whoever runs them, are refused before they go on sale.
- A person at XENO reads each agent before it's published, in a new review queue that also covers teams.
- Renters ask the agent from Marketplace › Rentals and pay for what it uses. What it remembers for them is theirs, and the seller can't read it.
- Buyers of a copy get their own agent, which starts with no access. A copy bought under terms that forbid resale can't be sold on.
- Earlier, nothing could be rented outside a test, because nothing marked an agent as ready to run. Approving one now does.

**Studio › Libraries has Stock (XENO Stock).**

- Search photos, art and video free of copyright (CC0), hosted by XENO. Every item states its licence at its source, and we record where that was read and when.
- Each item says who states the licence, a museum or the person who uploaded it, and that CC0 doesn't clear a person's or a brand's rights.
- Save an item to a workspace's Library so your apps and agents can use it.
- Can't find it? Your search goes to Generate, ready for you to press, and anything you already generated with those words shows up too.

**Agents can read a project on your own PC, through XENO Corpus.**

- Agents you connect to XENO MCP can read a project you turned on in XENO Corpus on your PC: its context, a tenet, what lapsed, what depends on a subject, whether a subject can ship.
- It's off until you turn a project on, on that PC, and turn Corpus on your PC on for that app in Dev › XENO MCP. It's read-only. If the PC isn't connected, the agent is told so rather than getting an empty answer.
- Answers pass through XENO and aren't kept here. Your folder paths never leave the PC.
- Settings › Corpus on your PCs shows each PC and its projects. You can turn one off or remove it from there.
- Needs a XENO Corpus release that asks for the new sign-in permission.

**Studio › Libraries has fonts (XENO Fonts).**

- A catalogue of 40 open-licence font families XENO hosts, set in the fonts themselves, with type your own sample text into and pairings written by hand.
- Upload your own fonts. They stay private to the workspace, you confirm you have the rights, and a font whose own licence forbids embedding is refused.
- A brand kit’s CSS export brings its catalogue fonts with it.
- Agents can search the catalogue and add fonts. Only a person can upload one.

**Studio › Libraries has brand kits (XENO Assets).**

- Keep a brand’s colors, sizes, type, shadows, logos and voice in one kit the whole workspace shares, with light, dark or any other modes.
- Publish a kit to freeze it as a numbered version that never changes, so what follows it always knows exactly what it has.
- Export any version as W3C Design Tokens, CSS variables, a Tailwind theme or XENO Canvas tokens, and import Design Tokens files with a preview first.
- Agents can read a published brand to stay on it, and propose tokens. Only a person can publish.

**Fixes that had been waiting on branches.**

- Expired credit holds are all released at once, not only the first thousand, so reserved credits no longer linger.
- Requesting or downloading a data export finishes writing its audit record before answering.
- Signing out of an app reports a failure honestly instead of saying it worked.
- Version floors compare versions the same way everywhere, including betas and very large numbers.
- Chat images in 2:3 and 3:2 no longer fail on the Google image models.

**Corpo › Forms is real.**

- Make a form, change its questions, and open it. It saves as you type.
- Share it by a sign-in link or a public link. People answer a public link without an account, and the page works without JavaScript. Links can be revoked and can expire.
- A form can close on a date or after a number of responses, even when answers arrive together.
- Responses show a summary of the choices and each answer with its question as it read then, export to CSV, and can become a customer, a task or a support request, on demand or on every response.
- Erasing a contact erases what they answered, and a contact’s export includes it.
- Agents can build forms, make sign-in links and read responses. Only a person can make a public link or delete anything.

**Create and Anima show real work, and the preview note is gone.**

- Studio › Create lists your files in the Library instead of sample renders.
- Anima lists the agents you made, opens each one’s Mind and skills, and says plainly where a Soul lives today: on the computer where Anima runs.
- Nothing in the workspace shows sample data as yours any more, so the “Preview” note no longer appears. A test now walks every screen with an empty account and fails if a sample row comes back.
- Anima’s sidebar lists your agents. Community’s sidebar no longer shows made-up counts, and Following shows the threads you follow.
- Customers, Scheduling, Analytics, Compute and the Tools areas no longer say “Coming soon” or offer “Notify me”: they’re live.
- A new account no longer starts with a “Video agency” mode it never made.

**Corpo › Company is real.**

- A company’s legal entity: its legal name and form, registered office and where it’s actually run, its registrations and branches, its tax, customs and financial-market numbers, and who may act for it.
- VAT numbers can be checked with VIES, and every answer is kept. If a register can’t be reached the page says it couldn’t check, never that the number is invalid.
- Owners and admins change it; a person, never an agent. A date of birth is shown only to them.

**Selling a team, and Tools for agents.**

- The Seller console can publish a team: the server packages its setup and its agents’ definitions, leaves your people behind, says who stayed, and sends it to review.
- Agents connected over XENO MCP can find the XENO tool that fits what someone wants, and give them the address that opens it. Tools still run on the person’s side.

**Two-step sign-in.**

- Settings › Sign-in & security now really sets up an authenticator app, adds passkeys, and makes recovery codes. Your password alone no longer signs in once one is on, and that goes for Google, GitHub and X sign-in too.
- The sign-in page has “Sign in with a passkey”, with nothing to type.
- Turning two-step off, or making new recovery codes, takes the second step itself. A stolen password or inbox can’t do it, and resetting a password doesn’t clear it.
- You get an email whenever what protects your account changes.
- You can connect Google, GitHub or X to your account from Settings.

**Settings, Knowledge and project Funding are real.**

- Settings › Apps lists every app signed in with your account and what it can do. Removing one signs it out everywhere at once.
- Settings › Provider keys adds your own OpenAI, Anthropic, Google or compatible key. XENO checks it with the provider first, and you confirm it’s you before adding one, because a key’s endpoint receives your prompts. Each product can use your key or XENO credits.
- Settings › Usage sets a monthly spend limit. Work that would go past it is refused.
- Settings › Connections shows your connected clouds and agents, and opens each where it is managed. Settings › Workspace and Gifts show real state; sending gifts stays closed.
- Workspace › Knowledge shows what the workspace holds to be true, with search, in place of sample sources.
- A project’s Funding tab shows campaigns, totals, budgets and requests. Nobody can see who gave what except their own part. It moves no money. Someone with edit access can propose a monthly ceiling, and an owner who didn’t propose it approves it.
- Forms that offer a choice now show a real list. Corpus’s New tenet and Research’s project field were showing a box to type in.
- A project’s tabs no longer run underneath its buttons, and the “Preview” switch is gone from real pages.

**Three more workspace areas show your real work.**

- Corpo › People, Dev › Agents and Studio › Generate now list your own people, agents and generations, and open each at its
  real page. They used to show sample rows or nothing.
- Customers, Scheduling and Analytics no longer say they are "planned" in the sidebar: they have been real for a while.
- A product's sidebar no longer shows sample folders and channels.
- The preview line at the bottom says exactly which parts are still sample data, and updates itself as they get connected.
- Workspace › Teams now creates, edits and archives real teams, each with its own link. Automations lists your real workflows and
  opens them in Automate. Activity shows what was recorded in the workspace, and says how many entries you can't see.

**Library: Shared with me, duplicate, and move to a project.**

- Shared with me lists what other people shared with you, and says who.
- Duplicate makes a real copy with its own history. If someone shared a file with you, the copy is yours.
- Move to project files the item in that project's folder, so everyone on the project can reach it.

**You can delete your account from Settings.**

- You confirm it's you, then you have 30 days to change your mind, as the page always said. An email tells you the date.
- It works however you sign in. The old way needed a password, so anyone using Google or GitHub had to write to support.
- A company workspace you own with other people in it, or a subscription still running, comes first, and the page says so.

**The Marketplace is the real store.**

- The store lists real listings with their real prices and sellers. It used to show sample ones, and "buying" changed nothing but
  this browser.
- Buying, subscribing and renting spend your credits, and always ask first with the price. If you don't have enough, it says so and
  charges nothing.
- A rented agent is added to the workspace you're in. Rentals shows what it remembers for you, and you can export or delete
  that memory.
- Purchases, reviews and the seller console are real: earnings, listings, recent sales and sending a listing to review. Cash-out
  isn't switched on yet, and the page says so.

**Places shows your real building.**

- The Places page now shows your workspace's real floors, teams and desks, who is working and who is away. It used to show
  sample people.
- A floor you have no access to is a closed door with no name. Each floor and person has their own link, and an agent's desk opens
  that agent.
- The Arrange button is gone, because it said a layout was saved and saved nothing. Walk in opens the building in XENO Places,
  where walking and arranging happen.

**Your inbox follows you, and more of your work reaches it.**

- Archive and snooze are saved to your account, so they follow you to every device. Before, they lived in one browser.
- A snoozed item now really comes back at the time you chose, as unread. Before, it never woke up.
- New in the inbox: an agent's run finishing, failing or being stopped, even with its page closed; a workflow failing or
  turning itself off; a Forum reply, mention or accepted answer; news on a private report; someone sharing a file or folder with
  you; and a workspace invitation.
- Each item opens at its own page. Scheduling items used to open the wrong place.
- Notification settings are real: Settings and the inbox now show the same choices. Per-area levels follow your account,
  and desktop notifications and sound work on the device where you turn them on.
- The email digest can be chosen, daily or weekly. It sends nothing until we switch it on.
- Agents have their own inbox tools: read it, mark it read, archive and snooze. They can't reach their owner's inbox.

Fixed: Cloud Shell could never start again for someone whose shell machine had been deleted, because a deleted machine kept
its creation key for good. Someone without access to a shared Spawn canvas now gets a clear refusal, not a server error.

## 2026-10-30

**The credit ledger now proves itself.**

- The database itself numbers and fingerprints every credit movement, from any program that writes one, so an entry
  can no longer be skipped, reordered or forked.
- History before this date is sealed as found, never rewritten, with a report of what it holds.
- Every account's chain is checked every hour, and each result is recorded. A break is logged and kept on record.
- Every hour, the state of every chain is signed and stored outside the database under a ten-year lock that nothing on our
  servers can remove. Even someone able to rewrite the whole database could not make it match.
- A person can accept rows written while the protection was off, or a restore from backup. Both name who and why, and both
  stay on record.

**The platform no longer runs as the database's administrator.**

- The backend and workers connect with an account that can read and write data but cannot change the database's structure,
  edit the credit journal or switch its protection off.
- Database changes now run as their own step before each deploy, and the app refuses to start on a database that step
  has not prepared.
- Nothing changes the database's structure during a request any more. Login used to.

Fixed: the privacy-erasure test suite, which had been failing since report evidence was added.
