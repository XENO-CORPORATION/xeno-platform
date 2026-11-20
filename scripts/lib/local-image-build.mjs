/**
 * Build a release image on the release machine instead of on production (`deploy-platform.mjs --build-here`).
 *
 * Why: every build used to compile on xeno-platform-001 while the site served from it; on 2026-11-18 a build ran the box
 * out of memory and took the site down, and later builds ran there protected only by a memory watcher. The leaders build
 * on a builder and let production only load an immutable image (Heroku/Vercel build fleets; registry-and-digest deploys).
 * With no registry credential on the box, the registry-free form is `docker save` here and `docker load` there, and the
 * box refuses an image whose content id differs from the one built here (`remote-deploy.sh --image-id`).
 *
 * The build reads the SAME files the box would: the `git archive HEAD` tar the deploy already ships, and the compose
 * file's own build section. The compose file requires production variables (`${NAME:?...}`) that live only in the box's
 * `.env`; no build argument uses them, so a throwaway env file satisfies them with a placeholder. Variables a build DOES
 * read are left unset here, exactly as they are on the box (measured 2026-11-20: VITE_ENABLE_SITE_GATE and
 * VITE_SITE_PASSWORD are absent from the box's .env).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Names the compose file REQUIRES (`${NAME:?message}`), so compose refuses to run without them. */
export function requiredComposeVars(composeText) {
  const names = new Set();
  for (const match of String(composeText).matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)) names.add(match[1]);
  return [...names].sort();
}

/** Names the compose file passes into a BUILD (its `build.args` lines), which must never get a placeholder. */
export function buildArgVars(composeText) {
  const names = new Set();
  const lines = String(composeText).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^(\s*)args:\s*$/.exec(lines[i]);
    if (!head) continue;
    const indent = head[1].length;
    // the `args:` block is every following line indented deeper than the key itself (comments included)
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') continue;
      if (line.length - line.trimStart().length <= indent) break;
      for (const match of line.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)) names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** The throwaway env file: a placeholder for each required variable a build does not read. */
export function buildEnvFile(composeText) {
  const used = new Set(buildArgVars(composeText));
  const conflict = requiredComposeVars(composeText).filter((name) => used.has(name));
  if (conflict.length) throw new Error(`a build reads a required production variable (${conflict.join(', ')}); build it on the box`);
  return requiredComposeVars(composeText).map((name) => `${name}=build-here-placeholder`).join('\n') + '\n';
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

/**
 * Build `xeno-platform-<service>` here from the deploy tar and save it. Returns the saved image file and its content id.
 */
export function buildServiceImageHere({ stage, tarName, service, sha }) {
  const src = join(stage, 'src');
  mkdirSync(src, { recursive: true });
  // Relative paths: GNU tar on Windows reads a drive letter as a remote host.
  run('tar', ['-xf', tarName, '-C', 'src'], stage);
  const compose = readFileSync(join(src, 'docker-compose.yml'), 'utf8');
  writeFileSync(join(stage, 'build.env'), buildEnvFile(compose));
  run('docker', ['compose', '--project-name', 'xeno-platform', '--env-file', 'build.env', '--project-directory', 'src', '-f', join('src', 'docker-compose.yml'),
    'build', '--build-arg', `XENO_SOURCE_REVISION=${sha}`, service], stage);
  const image = `xeno-platform-${service}`;
  const imageId = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', `${image}:latest`], { encoding: 'utf8' }).trim();
  run('docker', ['tag', `${image}:latest`, `${image}:${sha}`], stage);
  const imageFile = `image-${service}-${sha}.tar`;
  run('docker', ['save', '-o', imageFile, `${image}:${sha}`], stage);
  return { imageFile, imageId };
}
