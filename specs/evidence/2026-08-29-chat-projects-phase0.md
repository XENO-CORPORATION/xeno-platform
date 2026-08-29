# Chat projects Phase 0 baseline

| Field | Value |
|---|---|
| Captured | 2026-08-29 |
| Commit | `576dee4ed91642f41b089839c145fd6994fbd86d` |
| Branch | `codex/overview-taskbar-edge-divider` |
| Host | `DESKTOP-9LJ2CLU` |
| Node | `v24.13.1` |
| npm | `11.8.0` |

## TypeScript baseline

Command: `npm run typecheck`

- exit code: `2`;
- TypeScript diagnostic lines: `413`;
- captured output lines: `1645`;
- SHA-256 of UTF-8 command output: `89F5156074DEADE66328B2C6B9EDC8B27B5754F98221BA9F8F884F2230EC2162`.

The first failures are outside the Chat project implementation and include
`landing-v3/UseCasesSection.tsx` prop incompatibilities plus legacy image-model
`ImageGenerationResponse.imageUrl` and `REPLICATE_API` errors. This baseline is
not a waiver: changed/new Chat files must add zero diagnostics, and the complete
repository typecheck must be green before Phase 6 release qualification.

## Locked Phase 0 contracts

- recurrence engine: server-direct `rrule` `2.8.1`, lockfile integrity
  `sha512-hM3dHSBMeaJ0Ktp7W38BJZ7O1zOgaFEsn41PDk+yHoEtfLV+PoJt9E9xAlZiWgf/iqEqionN0ebHFZIDAp+iGw==`;
- recurrence timezone conversion: platform-owned `Intl.DateTimeFormat` adapter
  with explicit RFC 5545 spring-gap and fall-overlap tests;
- semantic retrieval: disabled until the checked-in embedding contract and
  qualified pgvector image exist; lexical retrieval is the mandatory path;
- asset extraction: quarantined until the mandatory scanner adapter reports a
  clean result; a missing scanner never becomes a successful scan;
- connectors/plugins: empty production catalog until a checked-in definition
  and entitlement contract is qualified;
- scheduled provider ambiguity: no automatic re-dispatch after an
  unreconcilable accepted/unknown gateway outcome.
