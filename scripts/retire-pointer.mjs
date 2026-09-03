#!/usr/bin/env node
/**
 * retire-pointer.mjs — retire ONE moving pointer on R2, with a snapshot, through the gated publisher.
 *
 *   node scripts/retire-pointer.mjs apps/3d/version.json            # dry run (default)
 *   node scripts/retire-pointer.mjs apps/3d/version.json --confirm  # snapshot, then delete
 *
 * Why it exists: on 2026-09-03 the modeler formerly published as `3d` became XENO Form, and the
 * name `3d` moved to the web generation interface, which has no R2 feed. Leaving a 0.1.0 scaffold
 * manifest under apps/3d/ would have advertised a desktop installer for a web product. Installers
 * under `v<version>/` are never touched — only the pointer goes, and only after a server-side copy
 * into `_snapshots/` (R2 has no object versioning; ABSOLUTE RULE 2b).
 */
import { R2Publisher } from './lib/r2-upload.mjs';

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith('--'));
const confirm = args.includes('--confirm');
if (!key) { console.error('usage: node scripts/retire-pointer.mjs <key> [--confirm]'); process.exit(2); }

const pub = new R2Publisher({ remote: 'r2:xeno-hub-releases', dryRun: !confirm });
const snap = await pub.retirePointer(key, { label: `retire ${key}` });
console.log(confirm ? `retired ${key}${snap ? ` (snapshot: ${snap})` : ''}` : `[dry-run] would retire ${key} after snapshotting it. Add --confirm.`);
