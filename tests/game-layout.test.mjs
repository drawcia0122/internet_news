import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../game.html', import.meta.url), 'utf8');

// These narrow source contracts protect the known cascade regressions. Actual
// element bounds at 295px, 393px, and 1180px still need a browser layout check.
function rules(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => Object.fromEntries(
      match[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')
        .filter((declaration) => declaration.includes(':'))
        .map((declaration) => declaration.split(':').map((part) => part.trim())),
    ));
}

test('game hero has one explicit track and does not inherit the homepage title grid area', () => {
  assert.equal(rules('.game-home-page')[0]['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(rules('.game-home-hero')[0]['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(rules('.game-home-hero h1')[0]['grid-area'], 'auto');
  assert.equal(rules('.game-home-hero h1')[0]['max-width'], 'none');
  assert.equal(rules('.game-home-hero > *')[0]['min-width'], '0');
  // Keep the intentional homepage placement unchanged.
  assert.equal(rules('h1')[0]['grid-area'], 'title');
});

test('game thumbnails cannot widen the compact card image track', () => {
  const thumbnail = rules('.game-home-card .game-card-thumb')[0];
  assert.equal(thumbnail.width, '100%');
  assert.equal(thumbnail['min-width'], '0');
  assert.equal(thumbnail['align-self'], 'start');
  const compact = rules('.game-compact-card .game-card-thumb');
  assert.equal(compact[0]['min-height'], '0');
  assert.equal(compact[0]['aspect-ratio'], '4 / 3');
  assert.equal(compact.at(-1)['aspect-ratio'], '16 / 9', 'mobile stacked thumbnails stay landscape');
  assert.equal(rules('.game-home-card-body')[0]['min-width'], '0');
});

test('game links remain touch-sized and source metadata can wrap inside its card', () => {
  for (const selector of ['.game-home-page .game-card-link', '.game-home-page .article-title-link', '.game-home-page .topic-back-link']) {
    assert.ok(parseFloat(rules(selector)[0]['min-height']) >= 44, selector);
  }
  const action = rules('.game-home-page .game-card-link')[0];
  assert.equal(action['max-width'], '100%');
  assert.ok(action.border, 'article actions are visibly delineated');
  assert.equal(rules('.game-home-card .game-card-top')[0]['flex-wrap'], 'wrap');
  assert.equal(rules('.game-home-card .game-card-meta')[0]['white-space'], 'normal');
  assert.equal(rules('.game-news-row-main')[0]['min-width'], '0');
});

test('game backup news tracks fit narrow containers without changing the search result column', () => {
  const newsTracks = rules('.game-news-list')
    .map((rule) => rule['grid-template-columns']).filter(Boolean);
  assert.deepEqual(newsTracks, ['repeat(auto-fit, minmax(min(260px, 100%), 1fr))']);
  assert.equal(rules('.game-search-section .game-news-list')[0]['grid-template-columns'], 'minmax(0, 1fr)');
  assert.match(html, /href="\.\/styles\.css\?v=57"/);
});

test('game page reuses the nonblocking refresh notice for all its source datasets', () => {
  assert.match(html, /href="\.\/refresh-status\.css\?v=1"/);
  assert.match(html, /src="\.\/refresh-status\.js\?v=1"/);
  const notices = html.match(/<p\b[^>]*id="data-refresh-health"[^>]*>/g) || [];
  assert.equal(notices.length, 1);
  assert.match(notices[0], /data-refresh-datasets="trend-topics\.json,home-news\.json,events\.json,game-sale-offers\.json"/);
  assert.match(notices[0], /role="status"/);
  assert.match(notices[0], /aria-live="polite"/);
  assert.match(notices[0], /\bhidden\b/);
  assert.ok(html.indexOf('id="data-refresh-health"') < html.indexOf('class="topic-hero game-home-hero"'));
});
