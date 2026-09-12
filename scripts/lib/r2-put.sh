#!/usr/bin/env sh
# r2_put — the ONE way a DR script puts a file in Cloudflare R2.
#
# 🔴 WHY THIS EXISTS. Every `rclone copy` to R2 in the DR chain failed its first
# attempt with `501 NotImplemented` and succeeded on the retry — 102 failures in
# 97 WAL runs, 100% of uploads, for as long as WAL shipping has existed.
#
# The upload was never the problem. Measured with `--dump headers`, the request
# sequence is:
#
#     HEAD  /<obj>              -> 404   (does it exist?)
#     PUT   /<obj>              -> 200   ✅ THE DATA IS ALREADY SAFELY STORED
#     HEAD  /<obj>?versionId=…  -> 501   ❌ rclone's post-upload read-back
#     (retry) HEAD /<obj>       -> 200
#
# R2 returns a version-id-shaped header on PUT, so rclone concludes the bucket is
# versioned and reads the object back BY VERSION. **R2 has no object versioning**
# — the root CLAUDE.md has said so since the seed-releases incident — so that one
# parameter is unimplemented and the whole transfer is reported as failed.
#
# Two real costs, and the second is the dangerous one:
#   1. Every object is uploaded TWICE. On the 830 MB weekly base backup that is
#      830 MB of wasted egress and a doubled write window.
#   2. 🔴 A healthy run logs ERROR lines. A log where success looks like failure
#      cannot report a real failure — the same "gate that cannot fail
#      distinguishably" shape this estate keeps rediscovering. The one genuine
#      failure in 97 runs was indistinguishable from the 102 fake ones.
#
# `--s3-no-head` suppresses the read-back. That would lose rclone's integrity
# check, so we do NOT simply drop it — we replace it with a STRONGER one:
#
#   - The PUT already carries `Content-Md5`, which R2 validates server-side and
#     rejects with BadDigest on a mismatch. Integrity is enforced by the provider
#     before this function returns.
#   - Then `rclone check --one-way` compares the LOCAL bytes against the hash R2
#     actually stores. That is a real end-to-end verification of the stored
#     object, not rclone trusting its own upload — and unlike the read-back it is
#     ours, so a failure is logged by us in terms we chose.
#
# `--one-way` matters: the destination prefix holds hundreds of unrelated
# objects, and a two-way check would call every one of them a difference.
#
# Verified on xeno-platform-001 2026-09-12, in all four directions:
#   matching bytes in a crowded prefix -> 0 | differing bytes -> 1
#   object absent -> 1                     | 501 gone from the transfer -> yes
#
# Usage:  r2_put <local-file> <remote-dir>   (returns 0 only if STORED and VERIFIED)

r2_put() {
  local src="$1" dest="$2"
  [ -f "$src" ] || { echo "r2_put: no such file: $src" >&2; return 3; }

  rclone copy --s3-no-head "$src" "$dest" || {
    echo "r2_put: upload failed: $(basename "$src") -> $dest" >&2
    return 1
  }

  # The object is stored. Now prove the stored bytes are the bytes we sent.
  rclone check --one-way "$src" "$dest" >/dev/null 2>&1 || {
    echo "r2_put: VERIFY FAILED after upload: $(basename "$src") -> $dest" >&2
    return 2
  }

  return 0
}
