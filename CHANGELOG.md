# XENO Platform — Changelog

Newest first. The record of each deploy is XENO Index's release record (`/workspace/releases`); this file is the
plain-words account of what changed. It starts here; earlier history is in `git log` and that record.

## 2026-10-30

**The credit ledger now proves itself.**

- The database itself numbers and fingerprints every credit movement, from any program that writes one, so an entry
  can no longer be skipped, reordered or forked.
- History before this date is sealed as found, never rewritten, with a report of what it holds.
- Every account's chain is checked every hour, and each result is recorded. A break is logged and kept on record.
