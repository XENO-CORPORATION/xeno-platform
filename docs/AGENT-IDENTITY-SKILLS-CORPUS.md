# Agent identity, the skills library and Corpus access — decision record

**Status:** APPROVED by the owner, 2026-10-24: *"yes right? this is the most important thing … also here comes the full
access to corpus … how would we handle the library for skills … global … so that users can create their own skills,
publish them … xeno truly will be the all in one place for ai and humans."*

## 1. The problem

An agent on the platform today has one block of instructions, a model and tool choice, the XENO services it may call,
its projects and its division. A person cannot say *who it is* (persona, voice, limits), *how it reports* (output
style), *what it knows how to do* (skills) or *what it should know* (knowledge). A hand-off therefore behaves however
the CLI it runs in happens to behave, and the same agent acts differently in Claude Code, Codex, Spawn and the cloud.

## 2. What already exists (measured 2026-10-24 — never build a second one)

| Piece | Where | State |
|---|---|---|
| Agent version content `{instructions, skills:[{id,version,hash}], requestedCapabilities, secretReferences, runtime}` | `workforceAgentRevision.js`, XENO-WORKFORCE-01 **OWN-03** (locked) | Built. `skills` has a slot and **nothing to point at**. |
| A persona format: front-matter (`name`, `role`, model, tools) + markdown sections (`# Voice`, …), composed into the system prompt | `@xenosystem/anima-mind` 0.0.15 on npm (`composePersonaPrompt`) | Built, published. |
| The skill format every agent CLI reads: a folder with `SKILL.md` (name + description front-matter, body loaded on demand) plus files | Claude Code / Codex / agy / XENO CLI; our canon `.agents/skills/<name>/` + `scripts/sync-skills.mjs` | Built. |
| Spawn owns the agent ENVIRONMENT on a person's computer, including skills — additive, never overwriting what they authored | `xeno-spawn/SPEC.md` §10.2i (owner 2026-10-05) | Specified; environment pinning partly built. |
| Corpus: an agent reads a scope's verified truth, assesses it, and PROPOSES changes a person ratifies | `xenoCorpus.js`, `corpusMcp.js` (category `corpus` in XENO MCP) | Built. |
| Corpus doctrine loads only a name + trigger until it fires (D51–D55) — the same mechanism Skills use | `XENO CORPUS - SPEC.md` | Specified. |
| Marketplace: one catalog, content-typed listings, entitlements, commerce on the credits ledger | `/api/marketplace`, kinds `app-native … mind, swarm, team` | Built. **No `skill` kind.** |
| Instruction versions and how each worked out | agent page Settings (#937) | Built. |

## 3. How the leaders do it, and where they broke

- **Anthropic Agent Skills** — a folder with `SKILL.md`; only name + description are always loaded, the body on demand
  (a project with 8 skills costs ~500 tokens instead of ~70,000). Open format, read by several CLIs. *Broke:* activation
  is model-decided and fires about half the time; skills are files on one machine with no versioning or provenance.
- **OpenAI GPTs / GPT Store** — instructions + knowledge files + actions, published to a store. *Broke:* no versions a
  buyer can pin, prompt-injection through knowledge and actions, store quality left to search.
- **GitHub Copilot custom agents (`.agent.md`) / Cursor rules (`.mdc`)** — persona and rules as files in the repo,
  scoped by glob. *Broke:* per-tool formats; the same agent is redefined for every tool.
- **npm / VS Code Marketplace** — immutable versions, content hashes, publishers, review tiers. *Broke:* typosquatting
  and malicious updates when a version could run code with no sandbox and no pinning.

The standard they converge on: an identity separate from its runtime; small always-on context with the rest loaded on
demand; immutable, hashed versions that a consumer pins; one package format across tools; publishing behind provenance
and review; untrusted content never gets host authority.

## 4. The decisions

**D1 — An agent's identity is a Mind, stored in its version.** The agent version content gains one additive key,
`persona`, holding Anima's Mind body (identity fields + `# Voice`, `# Style`, `# Boundaries`, `# Output` sections). It is
composed with `@xenosystem/anima-mind`'s own `composePersonaPrompt`, never a copy. An agent can be exported as a
`mind.xeno` and a Mind imported as an agent. Every change is a new version, as instructions already are.

**D2 — A skill is the open Agent Skills format. No new format.** A skill version is a `SKILL.md` folder, packed, with an
immutable SHA-256 content hash. Ids are stable (`skl_<32 hex>`), versions SemVer and immutable. That is exactly the
`{id, version, hash}` the agent version already pins.

**D3 — One skills library on the platform.** Scopes: the person's own, a workspace's (members use it), and the
Marketplace. A person or workspace creates skills from text or uploads a folder. Agents *propose* skills (a draft);
a person publishes them. Publishing to everyone is a Marketplace listing of a new, additive **`kind: 'skill'`**.
Install = an entitlement plus a pinned version in the person's library. The existing review, entitlement and credits
machinery is reused.

**D4 — The brief is composed once, on the server, and is the same everywhere it runs.** At hand-off and at every
session start XENO composes: persona → output style → the skill INDEX (name + description only) → project and area
instructions → the task. A skill body is fetched when the agent decides to use it (`skills_get` over XENO MCP), the
pattern that makes many skills cheap. Delivery:
- **XENO MCP** (Claude Code, Codex, XENO CLI, any MCP client): `agents_whoami` returns the brief; `skills_list` / `skills_get`.
- **Spawn**: writes the pinned skills into that agent's profile ADDITIVELY, never touching skills the person authored.
- **Cloud runs**: the runner mounts the pinned skills read-only in the run's sandbox.

**D5 — Corpus is the agent's knowledge.** On its Identity tab a person attaches the Corpus scopes it consults (an
org's doctrine, a project's facts). It reads and assesses them, and only proposes changes; a person ratifies.
This is the existing Corpus contract, not a new permission.

**D6 — It improves by evidence, never by silent self-edit.** Versions + results per version (built) come first; Anima's
Soul (earned memory and self-taught skills) comes later and lands as proposals a person accepts.

**D7 — Untrusted skills never get authority.** A skill's text is instructions and its scripts are code. Marketplace and
other people's skills: secret-scanned and size-limited on publish, content-hash pinned, never updated under a buyer
without them accepting the new version, and any script runs only inside XENO Box. A skill cannot grant a capability the
agent lacks; its `requestedCapabilities` must be within what the agent may already do.

## 5. Blast radius (what depends on it)

- `workforce_agent_versions.content` gains `persona` (additive; old versions read as no persona).
- New tables: `skills`, `skill_versions`, `agent_skill_pins` (or reuse OWN-03 `skills` in the version content — the pin
  IS the version content, so no separate pin table is needed).
- Marketplace `kind` CHECK gains `'skill'` (additive; the team-packages migration shows the pattern).
- XENO MCP gains `skills_list`, `skills_get`; `agents_whoami` gains `brief`.
- Consumers: xeno-spawn (profile writer), xeno-agents-api runner (mount), xeno-agent-cli (reads MCP; no change needed).

## 6. Rollback

Every schema step is additive with a tested DOWN. Turning skills off is one service flag; agents keep running on
their instructions alone. A Marketplace skill listing can be unlisted without breaking anyone who pinned a version.

## 7. Order of work

1. **Identity** — `persona` + output style on the agent version; an Identity tab; the server-composed brief;
   `agents_whoami` returns it; Mind import/export. *(First, because everything else is delivered through the brief.)*
2. **Skills library** — create / upload / version / pin to an agent; `skills_list` / `skills_get`; skills index in the brief.
3. **Delivery everywhere** — Spawn profile writer (xeno-spawn) and the cloud runner mount (xeno-agents-api), each in its
   own repo.
4. **Publish** — Marketplace `kind: 'skill'`, install, versions, review tier.
5. **Knowledge** — attach Corpus scopes on the Identity tab.

## 8. What would make us revisit

Anthropic or OpenAI changing the Skills format incompatibly (we follow the open format, not fork it); measured
activation of skills from the index falling below what deterministic triggers give (then adopt Corpus D52 `on_tool`
triggers for skills too); a Mind format version bump in xeno-anima.
