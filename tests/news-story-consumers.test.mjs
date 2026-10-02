import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const shared = fs.readFileSync(new URL('../shared-topic-utils.js', import.meta.url), 'utf8');
const news = fs.readFileSync(new URL('../news.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const htmlEscape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const now = Date.now();
const item = (id, extra = {}) => ({ id, title: `独立したニュース第${id}号の重要な発表内容を紹介`, category: 'games', categories: ['games'],
  sourceUrl: `https://media-${id}.example.com/articles/${id}`, sourceName: `媒体${id}`, publishedAt: new Date(now - 3600000).toISOString(), ...extra });
const original = item('a', { title: '任天堂が新作ゲームの追加コンテンツ配信日を正式発表', publishedAt: new Date(now - 23 * 3600000).toISOString() });
const alternative = item('b', { title: `【媒体b】${original.title}した`, category: 'tech', categories: ['tech'], publishedAt: new Date(now - 25 * 3600000).toISOString() });

async function archive(items, splitAt = 20) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', value: '', href: '', listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      querySelectorAll() { return []; },
      insertAdjacentHTML(_position, html) { this.innerHTML += html; },
    });
    return elements.get(selector);
  };
  const context = vm.createContext({ URL, URLSearchParams, Date, console, setTimeout, clearTimeout,
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {}, createElement() { return {
      textContent: '', get innerHTML() { return htmlEscape(this.textContent); },
      set innerHTML(value) { this.value = value; },
    }; } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (callback) => callback(),
    fetch: async (url) => ({ ok: true, json: async () => url.includes('page-2')
      ? { items: items.slice(splitAt), nextPage: 0 }
      : { items: items.slice(0, splitAt), nextPage: items.length > splitAt ? 2 : 0 } }),
  });
  context.window = context;
  vm.runInContext(shared, context);
  vm.runInContext(news, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { context, elements, render: async (script) => { await vm.runInContext(script + '; renderArchive()', context); } };
}

function cardCount(result) {
  return (result.elements.get('#news-archive-list').innerHTML.match(/<article class="trend-card /g) ?? []).length;
}

test('archive groups across downloaded pages before 20-card pagination and reports articles separately', async () => {
  const items = [original, ...Array.from({ length: 21 }, (_, index) => item(index)), alternative];
  const result = await archive(items);
  assert.equal(result.elements.get('#news-count').textContent, '22 話題・23記事');
  assert.equal(cardCount(result), 20);
  assert.match(result.elements.get('#news-archive-actions').innerHTML, /1〜20 \/ 22話題/);
  await result.render('currentPage = 2');
  assert.equal(cardCount(result), 2);
  assert.match(result.elements.get('#news-archive-actions').innerHTML, /21〜22 \/ 22話題/);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /同じニュースの記事 2件（2媒体）/);
});

test('search, category and date filters recover the matching member with its own original link', async () => {
  const result = await archive([original, alternative], 1);
  assert.equal(cardCount(result), 1);
  assert.match(result.elements.get('#news-archive-list').innerHTML, /<details/);
  result.elements.get('#news-query').value = '媒体b';
  await result.render('currentPage = 1');
  assert.equal(cardCount(result), 1);
  assert.equal(result.elements.get('#news-count').textContent, '1 話題');
  assert.ok(result.elements.get('#news-archive-list').innerHTML.includes(alternative.sourceUrl));
  assert.ok(!result.elements.get('#news-archive-list').innerHTML.includes(original.sourceUrl));
  result.elements.get('#news-query').value = '';
  await result.render("activeCategory = 'tech'");
  assert.ok(result.elements.get('#news-archive-list').innerHTML.includes(alternative.sourceUrl));
  assert.doesNotMatch(result.elements.get('#news-archive-list').innerHTML, /<details/);
  await result.render("activeCategory = 'all'; activeRange = '24h'");
  assert.ok(result.elements.get('#news-archive-list').innerHTML.includes(original.sourceUrl));
  assert.ok(!result.elements.get('#news-archive-list').innerHTML.includes(alternative.sourceUrl));
  await result.render("activeRange = 'all'");
  assert.equal(result.elements.get('#news-count').textContent, '1 話題・2記事');
  assert.match(result.elements.get('#news-archive-list').innerHTML, /<details/);
});

test('native details and separate title/footer/source anchors avoid nested interactive cards', async () => {
  const result = await archive([original, alternative]);
  const html = result.elements.get('#news-archive-list').innerHTML;
  assert.match(html, /^<article /);
  assert.match(html, /<details class="news-story-sources"><summary>/);
  assert.match(html, /<h3><a class="article-title-link"/);
  assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<(?:a|details|summary)\b/);
  assert.doesNotMatch(html, /onclick=|tabindex="-1"|role="button"/);
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 4);
});

test('home and archive use the same prepared population and category-before-group semantics', async () => {
  const context = { URL, URLSearchParams, window: {}, archiveTopics: [original, alternative], activeTrendFilter: 'all' };
  vm.createContext(context);
  vm.runInContext(shared, context);
  Object.assign(context, context.window.TopicClientUtils);
  const functions = home.slice(home.indexOf('function getTrendListItems()'), home.indexOf('function updateTrendLoadMoreButtons('));
  vm.runInContext(functions, context);
  assert.equal(vm.runInContext('getFilteredTrendItems().length', context), 1);
  assert.equal(vm.runInContext("getFilteredTrendItems('tech')[0].id", context), alternative.id);
  const newsResult = await archive([original, alternative]);
  assert.equal(vm.runInContext('getFilteredTrendItems()[0].id', context), vm.runInContext('groupNewsStories(dedupedTrendItems)[0].id', newsResult.context));
});
