import { spawnSync } from 'node:child_process';

// No CLI override: only commits contained in the reviewed main history may ship.
// Refresh origin/main during release preparation; never substitute a topic branch.
export function assertMainContained(cwd, run = spawnSync) {
  const invoke = (args) => run('git', args, { cwd, encoding: 'utf8' });
  const main = invoke(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
  if (main.status !== 0) throw new Error('Cannot resolve origin/main; refresh the canonical remote before deploying.');
  const head = invoke(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (head.status !== 0) throw new Error('Cannot resolve the release commit; refusing deployment.');
  const ancestor = invoke(['merge-base', '--is-ancestor', head.stdout.trim(), main.stdout.trim()]);
  if (ancestor.status === 1) throw new Error('HEAD is not contained in origin/main. Review and merge the candidate before deploying.');
  if (ancestor.status !== 0) throw new Error('Cannot verify main ancestry; refusing deployment.');
  return { head: head.stdout.trim(), main: main.stdout.trim() };
}

export function readDirtyPaths(cwd, paths, run = spawnSync) {
  const result = run('git', ['status', '--porcelain', '--', ...paths], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot verify worktree cleanliness; refusing deployment.');
  return (result.stdout || '').trim();
}
