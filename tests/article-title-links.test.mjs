import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

globalThis.window = globalThis;
await import('../shared-topic-utils.js');
await import('../home-render-utils.js');

const { buildArticleTitleLink, buildCardThumbnail } = globalThis.TopicClientUtils;
const { renderTopicClusterCard, renderPriorityCard, renderBriefCard } = globalThis.HomeRenderUtils;
const url = 'https://example.com/articles/specific?edition=one&view=full';
const deps = {
  buildArticleTitleLink, buildCardThumbnail,
  escapeHtml: (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  getPrimarySourceUrl: (item) => item.url,
  getPrimarySourceLabel: () => '記事の媒体',
  categoryDisplayLabel: () => 'ニュース', formatTopicDisplayTime: () => '',
  hotTopicScore: () => 10, buildWhyHotLabel: () => '', buildImportantPoint: () => '',
  shortEventFromTitle: (title) => title, trimMetaText: (text) => text,
  formatBriefTimelineTime: () => '', sanitizeBriefSummaryText: (text) => text,
};
const article = { title: '具体的な記事のタイトル', url };

function assertTitleLink(html, expectedUrl = url) {
  const heading = html.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '';
  assert.match(heading, /^<a class="article-title-link"/);
  assert.ok(heading.includes(`href="${deps.escapeHtml(new URL(expectedUrl).href)}"`));
  assert.match(heading, /target="_blank" rel="noreferrer noopener"/);
  assert.match(heading, />具体的な記事のタイトル<\/a>$/);
  // Native anchors keep Enter, open-in-new-tab, and normal mobile tap behavior.
  assert.doesNotMatch(heading, /onclick=|role="button"|tabindex="-1"/);
  let anchorDepth = 0;
  for (const token of html.matchAll(/<\/?a\b[^>]*>/g)) {
    if (token[0].startsWith('</')) anchorDepth -= 1;
    else anchorDepth += 1;
    assert.ok(anchorDepth === 0 || anchorDepth === 1, 'nested anchors are not allowed');
  }
  assert.equal(anchorDepth, 0);
}

for (const [label, render] of [
  ['topic', () => renderTopicClusterCard(article, {}, deps)],
  ['compact topic', () => renderTopicClusterCard(article, { compact: true }, deps)],
  ['Today Internet', () => renderTopicClusterCard(article, { featured: true }, deps)],
  ['FOR YOU', () => renderPriorityCard(article, 0, {}, deps)],
  ['daily news', () => renderBriefCard({ ...article, primaryLink: { url } }, 0, {}, deps)],
]) {
  test(`${label} title links to the original article and keeps its separate footer link`, () => {
    const html = render();
    assertTitleLink(html);
    assert.match(html, /class="detail-link"/);
  });
}

test('featured title and reference footer select the same representative source', () => {
  const primary = 'https://original.example.com/articles/selected';
  const html = renderTopicClusterCard({ ...article, primarySource: { url: primary, sourceName: '原文' } }, { featured: true }, deps);
  // The existing representative-source selection is the source of truth.
  const footer = html.match(/class="detail-link" href="([^"]+)"/)[1];
  const heading = html.match(/class="article-title-link" href="([^"]+)"/)[1];
  assert.equal(heading, footer);
  assert.equal(heading, primary);
});

test('missing or unsafe source URLs leave readable non-interactive titles', () => {
  for (const value of ['', null, 'javascript:alert(1)', 'data:text/html,hello', '//example.com/article']) {
    assert.equal(buildArticleTitleLink('<記事 & 見出し>', value), '&lt;記事 &amp; 見出し&gt;');
  }
});

test('historical image, PDF and media destinations do not become article title links', () => {
  for (const value of [
    'https://imgu.web.nhk/news/2026/photo.jpg',
    'https://example.com/photo.JPG?size=large',
    'https://example.com/photo%2Epng',
    'https://example.com/document.pdf#page=2',
    'https://example.com/movie.mp4',
    'https://example.com/audio.mp3',
    'https://example.com/images/asset?format=webp',
  ]) {
    assert.equal(buildArticleTitleLink('記事のタイトル', value), '記事のタイトル');
  }
  assert.match(buildArticleTitleLink('画像の記事', 'https://example.com/articles/image-report.html'), /class="article-title-link"/);
});

test('title and URL quoting cannot inject markup or event handlers', () => {
  const html = buildArticleTitleLink('<img src=x onerror=alert(1)>', 'https://example.com/article?value=" onclick="alert(1)');
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|" onclick="/);
});

test('home trends and game article surfaces call the shared native-link renderer', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const game = await readFile(new URL('../game.js', import.meta.url), 'utf8');
  const news = await readFile(new URL('../news.js', import.meta.url), 'utf8');
  assert.match(app, /buildArticleTitleLink\(trend\.title \?\? 'ニュース', sourceUrl\)/);
  assert.equal((game.match(/<h3>\$\{buildArticleTitleLink\(item\.title, item\.url\)\}<\/h3>/g) ?? []).length, 6);
  assert.match(news, /buildArticleTitleLink\(item\.title \?\? 'ニュース', sourceUrl\)/);
  assert.match(news, /return '<article class="' \+ cardClass/); // Disclosures and source links must not nest in anchors.
});

test('title links have a touch-sized target and visible keyboard focus without overlays', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const base = css.match(/\.article-title-link\s*\{([^}]+)\}/)[1];
  assert.match(base, /display:\s*block/);
  assert.match(base, /min-height:\s*44px/);
  assert.doesNotMatch(base, /position:\s*absolute|inset:/);
  assert.match(css, /\.article-title-link:focus-visible\s*\{[^}]*outline:\s*3px solid/);
});
