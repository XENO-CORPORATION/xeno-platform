# A tool a person makes is a XENO Artifact of kind `tool` — APPROVED (owner, 2026-10-28: "yes do it")

## Context

XENO Tools' **Create my own** (tools.xenosystem.ai) hands what a person typed to XENO Workshop, where the XENO Agent
builds the tool with them. The result must be kept in **My tools**, with versions, and run again later. It is code
written by a person (or an agent for them): untrusted by definition. XENO's own tools are signed packages
(`tool@1`, xeno-tools) that run with the page's privileges; a person's tool must never be signed by XENO or run that way.

## Options

| option | what it is | verdict |
|---|---|---|
| A new "personal tools" store + runtime | tables, storage, versioning, viewer, sharing — built again | **no**: a third store beside Artifacts and tool packages |
| Sign personal tools into the `tool@1` registry | they would run in-process like XENO's own | **refused**: XENO's signature means "XENO made this" (xeno-tools CLAUDE.md §🌐) |
| **XENO Artifacts, `kind = 'tool'`** | the existing owner-owned, revisioned page store (16 MB, content-hashed), shown by the existing viewer | **chosen** |

**What the leaders do:** Claude Artifacts and ChatGPT canvas keep generated apps as versioned documents and run them
on a separate user-content origin (`*.claudeusercontent.com`, `*.oaiusercontent.com`) in a sandboxed frame. Figma
plugins run in an iframe with a narrow message bridge (an earlier realm-based sandbox was escaped). XENO Artifacts
already follow the first: raw files only on `usercontent.<domain>`, which never receives the app's `__Host-` cookies,
under a CSP `sandbox` (opaque origin, `connect-src 'none'`), behind a path-scoped view token
(`routes/artifactViewerRoutes.js`).

## Choice

- `artifacts.kind` gains `'tool'` (the column existed with only `'page'`), and `artifacts.category` (the XENO Tools
  categories: generator, extractor, converter, ai, capture, utility). Additive migration; every existing row stays a page.
- `POST /api/artifacts` takes `kind` and `category`; `POST /api/artifacts/:id/keep-as-tool` turns a page the person
  owns into a tool (Workshop's "Keep it"). `GET /api/artifacts?kind=tool` lists the person's tools (signed in, like
  every artifact read). The view-token reply now also carries the sealed frame address, and `frame-ancestors` lets
  tools.xenosystem.ai frame a raw page (the page stays sealed: opaque origin, no network, token-scoped).
- My tools on XENO Tools lists them; opening one runs it in the sealed frame via a view token. The tool page itself is
  unchanged: same CSP, same origin split.
- A person's tool has no host bridge in v1 (no files, AI or account calls): like an artifact, it is self-contained.
  A message bridge with per-call consent and credits shown first is the next step, decided separately.

## Blast radius

`artifacts` (one constraint widened, one column added), `routes/artifactRoutes.js`, `routes/artifactViewerRoutes.js`
(frame-ancestors), nginx (the tools host's `/mine/<id>`), `src/toolHost/`
(My tools). No change to the viewer's isolation, the `tool@1` registry, signing, or any other consumer of artifacts
(the CLI keeps publishing pages; `kind` defaults to `page`).

## Rollback

The migration only adds: a down step narrows the check back to `'page'` after setting any `'tool'` row to `'page'`
(the files are untouched), and drops `category`. The routes and the My tools tab are removed by reverting the change.

## Revisit when

A person's tool needs files, AI or the account (the bridge); tools are shared or sold (Marketplace review, D1);
or Artifacts change their isolation.

## Proven (2026-10-29)

`src/server/tests/artifact-tools.test.mjs` (13 checks, real Postgres + the real routes); the migration's DOWN section
executed on a test database (2 tools became pages, the column dropped, a tool then refused) and UP re-applied;
`tools-test.mjs` drives My tools and the sealed frame in a browser.
