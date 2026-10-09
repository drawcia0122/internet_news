import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { publishRefreshData, isSafeRefreshRebasePath } from '../scripts/publish-refresh-data.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'refresh-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git'), local = join(root, 'local'), other = join(root, 'other');
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'clone', remote, local);
  for (const cwd of [local]) { git(cwd, 'config', 'user.name', 'Test'); git(cwd, 'config', 'user.email', 'test@example.invalid'); }
  const write = (cwd, path, content) => { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), content); };
  write(local, 'data/news.json', '{"old":true}\n'); write(local, 'styles.css', 'old {}\n');
  git(local, 'add', '.'); git(local, 'commit', '-m', 'base'); git(local, 'push', 'origin', 'main');
  git(root, 'clone', remote, other); git(other, 'config', 'user.name', 'Test'); git(other, 'config', 'user.email', 'test@example.invalid');
  const advance = (path, content) => { write(other, path, content); git(other, 'add', '.'); git(other, 'commit', '-m', 'concurrent change'); git(other, 'push', 'origin', 'main'); };
  const hook = (content) => { const p = join(local, '.git/hooks/pre-push'); writeFileSync(p, '#!/bin/sh\n'+content); chmodSync(p, 0o755); };
  return { root, remote, local, other, git, write, advance, hook };
}

test('safe allowlist excludes all possible generator and unknown inputs', () => {
  for (const p of ['README.md', 'docs/ai/CURRENT_STATE.md', 'index.html', 'styles.css']) assert.ok(isSafeRefreshRebasePath(p));
  for (const p of ['lib/x.mjs', 'scripts/x.mjs', 'config/rss-feeds.mjs', 'data/news.json', 'package.json', 'package-lock.json', '.github/workflows/refresh-news.yml', 'news-summary-integrity.js', 'app.js', 'docs/x.json', 'unknown.css', ' styles.css']) assert.equal(isSafeRefreshRebasePath(p), false, p);
});
test('publishes tracked changes, new files and deletions only inside data', (t) => {
  const f = fixture(t); rmSync(join(f.local, 'data/news.json')); f.write(f.local, 'data/new.json', '{}\n');
  assert.deepEqual(publishRefreshData({cwd:f.local}), {attempts:1, changed:true});
  assert.equal(f.git(f.remote, 'show', 'main:data/new.json'), '{}');
  assert.equal(f.git(f.local, 'status', '--porcelain'), '');
});
test('retains simultaneous static edits and refreshed data', (t) => {
  const f = fixture(t); f.write(f.local, 'data/news.json', '{"fresh":true}\n'); f.advance('styles.css', 'new {}\n');
  publishRefreshData({cwd:f.local});
  assert.equal(f.git(f.remote, 'show', 'main:styles.css'), 'new {}');
  assert.equal(f.git(f.remote, 'show', 'main:data/news.json'), '{"fresh":true}');
  assert.equal(readFileSync(join(f.local, 'styles.css'), 'utf8'), 'new {}\n');
});
for (const path of ['scripts/generator.mjs', 'lib/generator.mjs', 'config/feed.json', 'package.json', 'news-summary-integrity.js', '.github/workflows/refresh-news.yml', 'data/news.json']) {
  test(`rejects upstream ${path} instead of publishing stale data`, (t) => {
    const f = fixture(t); f.write(f.local, 'data/news.json', '{"stale":true}\n'); f.advance(path, 'upstream\n');
    const before = f.git(f.remote, 'rev-parse', 'main');
    assert.throws(() => publishRefreshData({cwd:f.local}), /fresh refresh is required/);
    assert.equal(f.git(f.remote, 'rev-parse', 'main'), before);
  });
}
test('retries a real push race without force and keeps newer static changes', (t) => {
  const f = fixture(t); f.write(f.local, 'data/news.json', '{"fresh":true}\n');
  f.hook(`rm "$0"\nprintf 'new {}\\n' > '${f.other}/styles.css'\ngit -C '${f.other}' add styles.css\ngit -C '${f.other}' commit -m racing\ngit -C '${f.other}' push origin main\n`);
  assert.deepEqual(publishRefreshData({cwd:f.local}), {attempts:2, changed:true});
  assert.equal(f.git(f.remote, 'show', 'main:styles.css'), 'new {}');
});
test('stops after three rejected pushes', (t) => {
  const f = fixture(t); f.write(f.local, 'data/news.json', '{}\n'); f.hook(`echo attempt >> '${f.root}/attempts'\nexit 1\n`);
  assert.throws(() => publishRefreshData({cwd:f.local}), /after 3 attempts/);
  assert.equal(readFileSync(join(f.root, 'attempts'), 'utf8').trim().split('\n').length, 3);
});
test('no-data-change run still updates safe static checkout before deploy', (t) => {
  const f = fixture(t); f.advance('styles.css', 'new {}\n');
  assert.deepEqual(publishRefreshData({cwd:f.local}), {attempts:1, changed:false});
  assert.equal(readFileSync(join(f.local, 'styles.css'), 'utf8'), 'new {}\n');
});
test('refuses unrelated staged files', (t) => {
  const f = fixture(t); f.write(f.local, 'styles.css', 'bad {}\n'); f.git(f.local, 'add', 'styles.css');
  assert.throws(() => publishRefreshData({cwd:f.local}), /outside data/);
});
test('workflow serializes refresh without canceling and deploy follows safe publication', () => {
  const yaml = readFileSync(new URL('../.github/workflows/refresh-news.yml', import.meta.url), 'utf8');
  assert.match(yaml, /concurrency:\n  group: github-pages\n  cancel-in-progress: false\n  queue: max/);
  assert.match(yaml, /ref: main\n          fetch-depth: 0/);
  assert.ok(yaml.indexOf('node scripts/publish-refresh-data.mjs') < yaml.indexOf('name: Setup Pages'));
  assert.doesNotMatch(yaml, /--force|continue-on-error/);
});
test('unsafe generator update during rejected-push retry fails closed', (t) => {
  const f = fixture(t); f.write(f.local, 'data/news.json', '{"stale":true}\n');
  f.hook(`rm "$0"\nmkdir -p '${f.other}/scripts'\nprintf 'new generator\\n' > '${f.other}/scripts/generator.mjs'\ngit -C '${f.other}' add scripts/generator.mjs\ngit -C '${f.other}' commit -m racing\ngit -C '${f.other}' push origin main\n`);
  assert.throws(() => publishRefreshData({cwd:f.local}), /fresh refresh is required/);
  assert.equal(f.git(f.remote, 'show', 'main:data/news.json'), '{"old":true}');
});
test('two consecutive safe races succeed on final bounded attempt', (t) => {
  const f = fixture(t); f.write(f.local, 'data/news.json', '{"fresh":true}\n');
  f.hook(`n=0\n[ ! -f '${f.root}/count' ] || n=$(cat '${f.root}/count')\nn=$((n+1))\necho "$n" > '${f.root}/count'\n[ "$n" -le 2 ] || exit 0\nprintf 'update %s {}\\n' "$n" > '${f.other}/styles.css'\ngit -C '${f.other}' add styles.css\ngit -C '${f.other}' commit -m racing\ngit -C '${f.other}' push origin main\n`);
  assert.deepEqual(publishRefreshData({cwd:f.local}), {attempts:3, changed:true});
  assert.equal(f.git(f.remote, 'show', 'main:styles.css'), 'update 2 {}');
});
test('rejects rewritten upstream history', (t) => {
  const f = fixture(t); f.write(f.local, 'data/news.json', '{"stale":true}\n');
  f.git(f.other, 'checkout', '--orphan', 'replacement'); f.write(f.other, 'styles.css', 'rewrite {}\n');
  f.git(f.other, 'add', '.'); f.git(f.other, 'commit', '-m', 'rewritten history');
  f.git(f.other, 'push', '--force', 'origin', 'HEAD:main');
  const before = f.git(f.remote, 'rev-parse', 'main');
  assert.throws(() => publishRefreshData({cwd:f.local}), /merge-base failed/);
  assert.equal(f.git(f.remote, 'rev-parse', 'main'), before);
});

test('both publishers share a non-canceling queue and checkout current main', () => {
  for (const filename of ['refresh-news.yml', 'deploy-pages.yml']) {
    const yaml = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8');
    assert.match(yaml, /concurrency:\n  group: github-pages\n  cancel-in-progress: false\n  queue: max/);
    assert.match(yaml, /uses: actions\/checkout@v4\n        with:\n          ref: main/);
  }
});
