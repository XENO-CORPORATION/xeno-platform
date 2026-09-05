#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corporationRoot = path.resolve(platformRoot, '..', '..', '..');
const libraryManifest = path.join(corporationRoot, 'xeno-lib', 'Cargo.toml');
const editManifest = path.join(corporationRoot, 'xeno-lib', 'xeno-edit', 'Cargo.toml');

try {
  await Promise.all([access(libraryManifest), access(editManifest)]);
} catch {
  console.error('The canonical xeno-lib or xeno-edit manifest is unavailable beside the platform checkout.');
  process.exit(1);
}

function build(manifest) {
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn('cargo', ['build', '--release', '--manifest-path', manifest], {
      cwd: path.dirname(manifest), stdio: 'inherit', windowsHide: true,
    });
    child.once('error', () => rejectBuild(new Error('cargo_start_failed')));
    child.once('exit', code => code === 0 ? resolveBuild() : rejectBuild(new Error('cargo_build_failed')));
  });
}

try {
  await build(libraryManifest);
  await build(editManifest);
} catch {
  console.error('The canonical shared-library build failed.');
  process.exit(1);
}
