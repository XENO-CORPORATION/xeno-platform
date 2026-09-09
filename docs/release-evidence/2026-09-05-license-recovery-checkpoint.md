# Dependency license recovery checkpoint

The refreshed notices inventory contains 957 package records: 948 text-collected,
two first-party records and seven unresolved texts. Final distribution notices
are not packaged while the inventory is incomplete.

## Resolved

`boolbase@1.0.0`: integrity-verified npm archive's complete runtime (`index.js`)
matches the publisher's license-addition commit
`be0bcd8a4e917a0a5895e95b523fbbed05a64871` byte for byte. Original ISC text,
copyright, URL and hashes are recorded in `compliance/recovered-package-licenses.json`.
The collector now includes that text. Identity/pin/text mutation tests fail closed.

## Remaining

- `dingbat-to-unicode@1.0.1`: no published gitHead; inspected repository is a
  JS/Python monorepo, but the inspected tree contains no license file.
- `eastasianwidth@0.2.0`: published commit exists but has no license. Later
  MIT-LICENSE.txt was added in 2024; runtime source differs from installed 0.2.0.
- `guid-typescript@1.0.9`: published gitHead tree returns 404.
- `highlightjs-vue@1.0.0`: archive CC0 declaration conflicts with current upstream
  BSD-3-Clause text; no license was substituted to conceal the conflict.
- `react-remove-scroll-bar@2.3.8`: published gitHead tree returns 404; discovered
  tags stop at 2.3.7. Applicability of another version's text is not established.
- `split-ca@1.0.1`: pinned source has no license text; README explicitly credits
  copied third-party sample code, so author metadata alone is insufficient.
- `tr46@0.0.3`: MIT text recovered at publisher commit
  `3a6f29721e7063b9ffd421e461a54beae6170001`, with matching index.js. However the
  archive's generated `lib/mappingTable.json` is absent from that source tree.
  Recovery evidence retains this gap; collector does not silently clear it.

The missing texts require further upstream applicability/source work or qualified
dependency replacements. No license policy, determination, trust store, feature,
dependency version or production deployment was changed. This checkpoint is not
a new full release verdict. The focused evidence tests passed (16 tests).
