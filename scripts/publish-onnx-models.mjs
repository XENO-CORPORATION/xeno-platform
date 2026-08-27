#!/usr/bin/env node
/**
 * publish-onnx-models.mjs — publish ONNX task-model weights to R2.
 *
 * WHY THIS EXISTS
 * ---------------
 * `models/manifest.json` has advertised ~33 ONNX task models since March 2026 and
 * **not one of them has ever been uploaded**. Measured 2026-08-27:
 *
 *     rclone ls r2:xeno-hub-releases/models
 *       -> local-chat/*.gguf (7 language models), local-model-catalog.json, manifest.json
 *       -> ZERO .onnx objects
 *
 * So every consumer that resolves a task model gets a 404: xeno-rt's
 * `/v1/images/upscale`, xeno-pixel's background removal, and xeno-motion's
 * Transcribe / Separate Stems. It is very likely why xeno-pixel ships the
 * AGPL-licensed `@imgly/background-removal` as a "runtime fallback" — the
 * XENO model it would otherwise use has never resolved.
 *
 * It also produced a genuinely nasty artefact. On this workstation,
 * `~/.xeno/models/upscale/real_esrgan_x4.onnx` is **15 bytes** and contains the
 * literal text `Entry not found` — an HTTP 404 body written to the model path
 * and treated as a successful download. A downloader that does not verify what
 * it received turns "the model was never published" into "the ONNX parser is
 * broken", which is a much harder bug to find. That is why `sha256` is
 * mandatory here and why this script refuses to publish an entry without one.
 *
 * SAFETY (ABSOLUTE RULE §2b — this writes to a shared production store)
 * --------------------------------------------------------------------
 *  - DRY RUN BY DEFAULT. `--confirm` is required to write anything.
 *  - Every write goes through `R2Publisher`, the one gated choke point. There
 *    is no unscanned path to rclone, by construction.
 *  - Model keys are IMMUTABLE — the choke point's own guard covers `models/`
 *    because a model filename carries no version, so the name IS the identity.
 *    Re-uploading different bytes under one name silently changes what every
 *    client resolves, and R2 has no object versioning. To change weights,
 *    publish a NEW filename.
 *  - The manifest is MERGED, never replaced. Replacing it wholesale is exactly
 *    the 2026-07-26 `seed-releases.mjs` incident, which destroyed the release
 *    history of four shipping products. The live manifest is fetched, the new
 *    entries are merged into it, and existing entries are left untouched.
 *  - `putPointer` snapshots the outgoing manifest to `_snapshots/` first.
 *
 * USAGE
 *   node scripts/publish-onnx-models.mjs --dir <local-dir>            # dry run
 *   node scripts/publish-onnx-models.mjs --dir <local-dir> --confirm  # write
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { R2Publisher, GateError } from './lib/r2-upload.mjs';

const BUCKET = 'xeno-hub-releases';
const MANIFEST_KEY = 'models/manifest.json';
const MANIFEST_URL = 'https://updates.xenostudio.ai/models/manifest.json';

/**
 * What to publish.
 *
 * Whisper is TWO ONNX graphs plus a tokenizer, not one file. The manifest's
 * pre-existing `whisper-base` entry names a single `whisper-base.onnx` of
 * 74,000,000 bytes — an architecturally impossible artifact, and a size that is
 * a round number like every other size in that file. That entry was written
 * without reference to a real export. These three are real, and their sizes and
 * hashes are computed from the bytes being uploaded.
 *
 * Keys are FLAT because `xeno-lib`'s model-manager resolves
 * `join(modelDir, info.file)` and creates no parent directories.
 */
const MODELS = [
  {
    id: 'whisper-base-encoder',
    local: 'encoder_model.onnx',
    file: 'whisper-base-encoder.onnx',
    features: ['transcription'],
    apps: ['xeno-motion', 'xeno-sound'],
    description: 'Whisper base encoder (ONNX, fp32) — 80x3000 log-mel to 1500x512 hidden states',
  },
  {
    id: 'whisper-base-decoder',
    local: 'decoder_model_merged.onnx',
    file: 'whisper-base-decoder.onnx',
    features: ['transcription'],
    apps: ['xeno-motion', 'xeno-sound'],
    description: 'Whisper base decoder, KV-cache merged (ONNX, fp32) — 51865-token vocabulary',
  },
  {
    id: 'whisper-base-tokenizer',
    local: 'tokenizer.json',
    file: 'whisper-base-tokenizer.json',
    features: ['transcription'],
    apps: ['xeno-motion', 'xeno-sound'],
    description: 'Whisper base byte-level BPE tokenizer (HuggingFace tokenizers format)',
  },
];

/**
 * Provenance travels WITH the model, in the manifest.
 *
 * A weight file on our CDN under our name is a redistribution, and the licence
 * question is not answerable later by looking at the bytes. Whisper's weights
 * are Apache-2.0 from OpenAI; this is a mechanical ONNX conversion that declares
 * `base_model: openai/whisper-base`, so the conversion inherits it.
 *
 * Verified 2026-08-27:
 *   curl -s https://huggingface.co/api/models/openai/whisper-base | jq .cardData.license
 *     -> "apache-2.0"
 */
const PROVENANCE = {
  license: 'Apache-2.0',
  licenseSource: 'https://huggingface.co/openai/whisper-base',
  source: 'https://huggingface.co/onnx-community/whisper-base',
  baseModel: 'openai/whisper-base',
  addedOn: '2026-08-27',
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function fetchLiveManifest() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new GateError(`could not read the live manifest (HTTP ${res.status})`);
  return res.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes('--confirm');
  const dirIdx = argv.indexOf('--dir');
  if (dirIdx === -1 || !argv[dirIdx + 1]) {
    console.error('usage: publish-onnx-models.mjs --dir <local-dir> [--confirm]');
    process.exit(2);
  }
  const dir = argv[dirIdx + 1];

  console.log(confirm ? '=== PUBLISH (writing) ===' : '=== DRY RUN (nothing will be written) ===');
  console.log(`source dir: ${dir}\n`);

  // 1. Hash and size every artifact from the bytes we are about to upload.
  //    Never from a table, and never from what the manifest already claims.
  const staged = [];
  for (const m of MODELS) {
    const path = join(dir, m.local);
    if (!existsSync(path)) throw new GateError(`missing local artifact: ${path}`);
    const size = statSync(path).size;
    if (size < 1024) {
      // The `Entry not found` case: a 15-byte HTTP error body saved as a model.
      throw new GateError(
        `refusing ${m.local}: ${size} bytes is too small to be a model. ` +
        'A saved 404 body looks exactly like this.',
      );
    }
    const hash = sha256(path);
    staged.push({ ...m, path, size, sha256: hash });
    console.log(`  ${m.file.padEnd(30)} ${String(size).padStart(10)} bytes  sha256=${hash.slice(0, 16)}…`);
  }

  // 2. Merge into the LIVE manifest. Fetched from the CDN, not from a repo copy,
  //    because the repo copy is not what clients read and may be stale.
  const manifest = await fetchLiveManifest();
  const before = Object.keys(manifest.models ?? {}).length;
  console.log(`\nlive manifest: ${before} entries`);

  for (const s of staged) {
    const existing = manifest.models?.[s.id];
    if (existing && existing.sha256 && existing.sha256 !== s.sha256) {
      throw new GateError(
        `manifest entry ${s.id} already names different bytes ` +
        `(${existing.sha256.slice(0, 16)}… vs ${s.sha256.slice(0, 16)}…). ` +
        'Model names are identities: publish a NEW name rather than redefining this one.',
      );
    }
    manifest.models[s.id] = {
      file: s.file,
      size: s.size,
      sha256: s.sha256,
      features: s.features,
      apps: s.apps,
      description: s.description,
      ...PROVENANCE,
    };
  }
  const after = Object.keys(manifest.models).length;
  console.log(`merged      : ${after} entries (+${after - before}), ${before} pre-existing left untouched`);

  const publisher = new R2Publisher({ remote: `r2:${BUCKET}`, dryRun: !confirm });

  // 3. Artifacts first, pointer last. If an upload fails, the manifest still
  //    describes only what is actually resolvable — never the other way round.
  console.log('\n--- artifacts ---');
  for (const s of staged) {
    // requireStructural: false — an .onnx is uncompressed protobuf with raw
    // tensors, so a byte scan genuinely covers it. There is no archive to open,
    // which is the case `requireStructural` exists for.
    await publisher.putArtifact(s.path, `models/${s.file}`, {
      requireStructural: false,
      label: `${s.id} → models/${s.file}`,
    });
  }

  console.log('\n--- pointer ---');
  await publisher.putPointer(
    `${JSON.stringify(manifest, null, 2)}\n`,
    MANIFEST_KEY,
    { label: 'models/manifest.json' },
  );

  console.log(`\n${confirm ? 'PUBLISHED' : 'DRY RUN COMPLETE'} — ${staged.length} artifacts + manifest`);
  if (!confirm) console.log('re-run with --confirm to write.');
}

main().catch((err) => {
  console.error(`\n${err instanceof GateError ? 'REFUSED' : 'FAILED'}: ${err.message}`);
  process.exit(1);
});
