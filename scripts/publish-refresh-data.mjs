import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Deliberately exclude JavaScript, JSON, workflows and dependency/config files.
// Even root-level JavaScript can be shared with the data generators.
export function isSafeRefreshRebasePath(path) {
  return /^(?:README|CONTEXT|AGENTS)\.md$/.test(path)
    || /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(path)
    || /^(?:index|news|game|topic|trends)\.html$/.test(path)
    || /^(?:styles|matome-section|reader-preferences|refresh-status)\.css$/.test(path);
}

export function publishRefreshData({ cwd = process.cwd(), maxAttempts = 3 } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('Publication attempts must be between 1 and 3.');
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr || result.error || result.stdout}`);
    return args.includes('-z') ? result.stdout : result.stdout.trim();
  };
  let base = git('rev-parse', 'HEAD');
  git('add', '-A', '--', 'data');
  const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  if (staged.some((path) => !path.startsWith('data/'))) {
    throw new Error('Refusing to publish staged files outside data/.');
  }
  if (git('diff', '--name-only')) throw new Error('Refusing to publish with unstaged changes.');
  if (staged.length) git('commit', '-m', 'chore: refresh site data');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    git('fetch', '--no-tags', 'origin', 'refs/heads/main');
    const upstream = git('rev-parse', 'FETCH_HEAD');
    if (upstream !== base) {
      git('merge-base', '--is-ancestor', base, upstream);
      const changed = git('diff', '--no-renames', '--name-only', '-z', base, upstream).split('\0').filter(Boolean);
      const unsafe = changed.filter((path) => !isSafeRefreshRebasePath(path));
      if (unsafe.length) throw new Error(`Upstream may change data generation; a fresh refresh is required: ${unsafe.join(', ')}`);
      // Never resolve generated-data conflicts or replace upstream data.
      git('rebase', upstream);
      base = upstream;
    }
    const result = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd, encoding: 'utf8' });
    if (result.status === 0) return { attempts: attempt, changed: staged.length > 0 };
    if (attempt === maxAttempts) throw new Error(`Publication failed after ${maxAttempts} attempts: ${result.stderr || result.error}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(publishRefreshData()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
