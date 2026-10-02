// Optional UI integration check. Start npm run dev, then run this file with Node.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseURL = process.env.MATOME_TEST_BASE_URL || 'http://127.0.0.1:8000';
const screenshotDir = process.env.MATOME_TEST_SCREENSHOTS || '/tmp/matome-preferences-checks';
const key = 'internet-news-matome-preferences-v1';
const now = Date.now();
const sources = [
  { id: 'first', name: '取得元A', siteUrl: 'https://first.example.com/', status: 'ok' },
  { id: 'second', name: '取得元B', siteUrl: 'https://second.example.com/', status: 'ok' },
];
const fixture = {
  schemaVersion: 1, generatedAt: new Date(now).toISOString(), checkedAt: new Date(now).toISOString(), status: 'ok',
  sources: [...sources, { id: 'unsafe', name: '<img src=x onerror=alert(1)>', siteUrl: 'https://bad.example.com/', status: 'ok' }],
  items: Array.from({ length: 16 }, (_, index) => ({
    id: `browser-${index}`, title: `まとめのテスト記事 ${index + 1}`, sourceId: sources[index % 2].id,
    url: `${sources[index % 2].siteUrl}archives/${index + 1}.html`,
    categories: index < 14 ? ['game', ...(index < 4 ? ['anime'] : [])] : ['chat', 'neta'],
    publishedAt: new Date(now - (index + 1) * 1000).toISOString(),
  })),
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir(screenshotDir, { recursive: true });
async function prepare(context) {
  let offline = false;
  await context.route('**/data/matome-threads.json', (route) => offline
    ? route.abort('failed') : route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#matome-preferences-save')?.disabled === false);
  return { page, errors, setOffline(value) { offline = value; } };
}
try {
  for (const [name, viewport] of [['desktop', { width: 1365, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport });
    const { page, errors, setOffline } = await prepare(context);
    const count = () => page.locator('#matome-list > li').count();
    const order = () => page.locator('[data-matome-category]').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.matomeCategory));
    assert.equal(await count(), 6);
    assert.equal(await page.locator('#matome-preferences').getAttribute('open'), null);
    await page.locator('#matome-preferences > summary').click();
    assert.equal(await page.locator('[data-matome-hide-source]').count(), 2, 'only validated source metadata supplies settings');
    await page.evaluate(() => localStorage.setItem('unrelated-reader-key', 'untouched'));
    const move = page.locator('[data-matome-move="neta:-1"]');
    await move.focus();
    for (let i = 0; i < 3; i += 1) await move.press('Enter');
    assert.equal(await move.evaluate((node) => node === document.activeElement), true, 'reorder retains keyboard focus at boundary');
    assert.deepEqual(await order(), ['game', 'anime', 'chat', 'neta'], 'draft order stays unapplied');
    const checkbox = page.locator('[data-matome-hide-source="first"]');
    await checkbox.check();
    await checkbox.focus();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/data/matome-threads.json')),
      page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
    ]);
    assert.equal(await checkbox.isChecked(), true);
    assert.equal(await checkbox.evaluate((node) => node === document.activeElement), true, 'refresh retains settings focus');
    await page.locator('#matome-preferences-save').click();
    assert.equal(await page.locator('#matome-preferences-save').evaluate((node) => node === document.activeElement), true);
    assert.deepEqual(await order(), ['neta', 'game', 'anime', 'chat']);
    assert.equal(await page.locator('#matome-tab-game').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#matome-tab-game [data-matome-count]').textContent(), '7');
    assert.equal(await count(), 6);
    await page.locator('#matome-more').click();
    assert.equal(await count(), 7);
    assert.equal(await page.locator('#matome-more').isHidden(), true);
    setOffline(true);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => document.querySelector('#matome-threads').dataset.matomeStatus === 'network-error');
    assert.equal(await count(), 7);
    assert.deepEqual(await order(), ['neta', 'game', 'anime', 'chat']);
    setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#matome-preferences-save')?.disabled === false);
    assert.deepEqual(await order(), ['neta', 'game', 'anime', 'chat']);
    assert.equal(await page.locator('#matome-tab-neta').getAttribute('aria-selected'), 'true');
    await page.locator('#matome-tab-neta').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#matome-tab-game').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('End');
    assert.equal(await page.locator('#matome-tab-chat').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#matome-tab-neta').evaluate((node) => node === document.activeElement), true);
    await page.locator('#matome-preferences > summary').click();
    await page.locator('[data-matome-hide-source="second"]').check();
    await page.locator('#matome-preferences-save').click();
    assert.equal(await count(), 0);
    assert.equal(await page.locator('#matome-more').isHidden(), true);
    assert.match(await page.locator('#matome-empty').textContent(), /表示設定/);
    for (let i = 0; i < 2; i += 1) await page.locator('#matome-preferences-reset').click();
    assert.equal(await count(), 6);
    assert.deepEqual(await order(), ['game', 'anime', 'chat', 'neta']);
    assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('unrelated-reader-key')), 'untouched');
    assert.equal(await page.locator('#matome-preferences-reset').evaluate((node) => node === document.activeElement), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, `unexpected ${name} horizontal overflow: ${overflow}px`);
    await page.locator('#matome-threads').screenshot({ path: `${screenshotDir}/${name}.png` });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${name}: reorder, draft/save, focus, hidden counts/pagination, outage, reload, keyboard, repeated reset and overflow passed`);
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); },
  }));
  const { page, errors } = await prepare(context);
  await page.locator('#matome-preferences > summary').click();
  for (const id of ['first', 'second']) await page.locator(`[data-matome-hide-source="${id}"]`).check();
  await page.locator('#matome-preferences-save').click();
  assert.equal(await page.locator('#matome-list > li').count(), 0);
  assert.match(await page.locator('#matome-preferences-status').textContent(), /保存できませんでした/);
  await page.locator('#matome-preferences-reset').click();
  assert.equal(await page.locator('#matome-list > li').count(), 6);
  assert.match(await page.locator('#matome-preferences-status').textContent(), /削除できませんでした/);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('blocked storage: readable section, session filtering, reset and honest failure messages passed');
} finally {
  await browser.close();
}
