// Run with a local static server: node tests/reader-preferences-browser.mjs http://127.0.0.1:8000
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseUrl = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
async function pageFor(options = {}, init) {
  const context = await browser.newContext(options);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // Rendering tests need local JSON/assets only; don't fetch external publisher images.
  await page.route('**/*', (route) => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#reader-preferences summary').click();
  return { context, page };
}
const titles = (page) => page.locator('#personal-news-list .priority-card h3').allTextContents();
try {
  const { context, page } = await pageFor();
  const initial = await titles(page);
  assert.ok(initial.length > 0, 'loaded default cards');
  const list = page.locator('#personal-news-list');
  const save = page.locator('#reader-preferences').getByRole('button', { name: '設定を保存', exact: true });
  const reset = page.getByRole('button', { name: '設定をリセット', exact: true });
  const enabled = page.locator('[name="reader-enabled"]');
  const keyword = page.locator('[name="reader-keywords"]');
  const message = page.locator('[data-reader-status]');
  const normalNews = await page.locator('#trend-list').textContent();
  await keyword.fill('zz-no-matching-news-987654321');
  await save.click();
  assert.deepEqual(await titles(page), initial, 'saving unchecked opt-in leaves default untouched');
  await enabled.check();
  await save.click();
  assert.ok((await list.textContent()).includes('条件に合うマイニュースはありません'));
  assert.ok((await page.locator('#personal-news-status').textContent()).includes('0/0件'));
  assert.equal(await page.locator('#personal-news-load-more').isVisible(), false);
  assert.equal(await page.locator('#trend-list').textContent(), normalNews, 'personal filter does not filter normal news');
  await save.click();
  assert.ok((await message.textContent()).includes('保存しました'));
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok((await list.textContent()).includes('条件に合うマイニュースはありません'));
  await page.locator('#reader-preferences summary').click();
  await reset.click();
  assert.deepEqual(await titles(page), initial);
  await reset.click();
  assert.deepEqual(await titles(page), initial, 'reset is repeatable');
  if (await page.locator('#personal-news-load-more').isVisible()) {
    await page.locator('#personal-news-load-more').click();
    assert.ok((await titles(page)).length > initial.length);
    await save.click();
    assert.deepEqual(await titles(page), initial, 'saving resets pagination');
  }
  await enabled.check();
  await keyword.fill('');
  for (const input of await page.locator('[name="reader-source"]').all()) await input.check();
  await save.click();
  assert.equal((await titles(page)).length, 0, 'source exclusions update filtered count');
  await reset.click();
  assert.deepEqual(await titles(page), initial);
  await keyword.fill('<img src=x onerror="window.injected=1">');
  await enabled.check();
  await save.click();
  assert.equal(await page.evaluate(() => window.injected), undefined, 'keywords remain text');
  assert.equal(await page.locator('#reader-preferences img').count(), 0);
  await keyword.fill('a'.repeat(81));
  await save.click();
  assert.ok((await message.textContent()).includes('80文字以内'));
  assert.equal(await keyword.evaluate((node) => node === document.activeElement), true);
  await reset.click();
  await page.locator('#reader-preferences summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#reader-preferences').getAttribute('open'), null);
  await page.keyboard.press('Enter');
  assert.notEqual(await page.locator('#reader-preferences').getAttribute('open'), null);
  await context.close();

  const corrupt = await pageFor({}, () => localStorage.setItem('internet-news-reader-preferences-v1', '{broken'));
  assert.ok((await corrupt.page.locator('[data-reader-status]').textContent()).includes('読み込めません'));
  assert.equal(await corrupt.page.locator('[name="reader-enabled"]').isChecked(), false);
  await corrupt.context.close();

  const denied = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true }, () => {
    for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  assert.ok((await titles(denied.page)).length > 0, 'storage getter denial does not stop app');
  await denied.page.locator('[name="reader-enabled"]').check();
  await denied.page.locator('[name="reader-keywords"]').fill('zz-no-matching-news-987654321');
  await denied.page.locator('#reader-preferences').getByRole('button', { name: '設定を保存', exact: true }).click();
  assert.ok((await denied.page.locator('[data-reader-status]').textContent()).includes('保存できません'));
  assert.ok((await denied.page.locator('#personal-news-list').textContent()).includes('条件に合うマイニュースはありません'));
  await denied.page.getByRole('button', { name: '設定をリセット', exact: true }).click();
  assert.ok((await denied.page.locator('[data-reader-status]').textContent()).includes('削除できず'));
  assert.ok((await titles(denied.page)).length > 0);
  assert.ok(await denied.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile has no page overflow');
  await denied.page.locator('#reader-preferences').screenshot({ path: '/tmp/reader-preferences-mobile.png' });
  await denied.context.close();

  const quota = await pageFor({}, () => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await quota.page.locator('[name="reader-enabled"]').check();
  await quota.page.locator('[name="reader-keywords"]').fill('zz-no-matching-news-987654321');
  await quota.page.locator('#reader-preferences').getByRole('button', { name: '設定を保存', exact: true }).click();
  assert.ok((await quota.page.locator('[data-reader-status]').textContent()).includes('保存できません'));
  assert.ok((await quota.page.locator('#personal-news-list').textContent()).includes('条件に合うマイニュースはありません'));
  await quota.context.close();
  assert.deepEqual(errors, [], 'no uncaught JavaScript errors');
  console.log('Reader preferences browser checks passed: opt-in, persistence, repeated save/reset, pagination, sources, keyboard, safe text, corrupt/quota/denied storage, mobile');
} finally { await browser.close(); }
