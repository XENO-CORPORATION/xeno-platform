# XENO Platform — Changelog

Newest first. The record of each deploy is XENO Index's release record (`/workspace/releases`); this file is the
plain-words account of what changed. It starts here; earlier history is in `git log` and that record.

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
