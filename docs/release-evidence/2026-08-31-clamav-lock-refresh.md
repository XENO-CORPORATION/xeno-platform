# ClamAV database lock refresh — 2026-08-31

The production backend build failed closed after the publisher advanced `daily.cvd`. The
candidate was not swapped. The refresh was reproduced with the exact backend base image
`node@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8` and the pinned
Alpine package `clamav=1.4.3-r0`. `freshclam` tested every database and `sigtool --info`
reported `Verification OK` for all three files.

| Database | Version | Signatures | Functionality | Builder | SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| `bytecode.cvd` | 339 | 80 | 90 | `nrandolp` | `6d4aa01f219e988060fc419f495d07f27e0cdf1a2cccc065971da922c76f7ffb` |
| `daily.cvd` | 28108 | 355631 | 90 | `svc.clamav-publisher` | `a32c46bdc47b84932cabcc7687bc8d6624cee7acb0c1990041c771adb07a60b5` |
| `main.cvd` | 63 | 3287027 | 90 | `tomjudge` | `0b2182d229f46981ec8f535382222f7c9dfdd656b250ad47988b910a8d302365` |

Only the changed `daily.cvd` lock was updated. The bytecode and main locks remained identical.
The checksum gate, pinned base image, pinned scanner package, database self-test, and digital
signature verification were retained.
