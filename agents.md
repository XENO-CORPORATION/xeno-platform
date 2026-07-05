# agents.md — xeno-platform

Agent instructions for the XENO platform repo (xenostudio.ai). Mirrors `CLAUDE.md`.

## Releasing — BEFORE any release, read `release-guide/` in full.

This repo ships a portable `release-guide/` folder. Before cutting ANY release —
a new version (installer or CLI) OR a landing/docs content change — read every file
in `release-guide/` IN ORDER, starting with `release-guide/README.md`. It is the
single source of truth for how a release reaches R2, the Hub, and xenostudio.ai. Do
not improvise release commands; use the verbatim commands there.

Start here: `release-guide/06-release-runbook.md` (the step-by-step) ·
`release-guide/03-release-data.md` (R2 + the publishers) ·
`release-guide/04-build-and-deploy.md` (build + on-box deploy) ·
`release-guide/07-troubleshooting.md`.
