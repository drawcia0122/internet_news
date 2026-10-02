// This section deliberately stays separate from the factual-news renderers.
import {
  normalizeMatomePreferences, loadMatomePreferences, saveMatomePreferences, resetMatomePreferences,
} from './matome-preferences.js';

export const MATOME_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'game', label: 'ゲーム' }),
  Object.freeze({ id: 'anime', label: 'アニメ' }),
  Object.freeze({ id: 'chat', label: '雑談' }),
  Object.freeze({ id: 'neta', label: 'ネタ' }),
]);
export const MATOME_PAGE_SIZE = 6;
export const MATOME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MATOME_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const CATEGORY_IDS = new Set(MATOME_CATEGORIES.map(({ id }) => id));
const STATUS_IDS = new Set(['ok', 'partial', 'unavailable']);
const PUBLICATION_FORMAT = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plainText(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      /<\s*\/?[a-z][^>]*>/iu.test(value)) return null;
  return value.trim() || null;
}

function timestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

/** Only ordinary public publisher destinations can become clickable links. */
export function safeMatomeUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 ||
      !/^https?:\/\//iu.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname) ||
        /\.(?:localhost|local|internal|invalid|test)$/u.test(hostname)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function publisherHost(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
}

function articleUrl(value) {
  const safe = safeMatomeUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!/^\/archives\/\d+(?:\.html)?\/?$/u.test(url.pathname)) return null;
  url.search = '';
  return url.href;
}

/** Reject malformed envelopes; discard invalid individual sources/articles. */
export function normalizeMatomePayload(payload, now = Date.now()) {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !STATUS_IDS.has(payload.status) ||
      !Array.isArray(payload.sources) || !Array.isArray(payload.items) || !Number.isFinite(now)) return null;
  const generatedAtMs = timestamp(payload.generatedAt);
  const checkedAtMs = timestamp(payload.checkedAt);
  if ((payload.generatedAt !== null && generatedAtMs === null) || checkedAtMs === null ||
      generatedAtMs > now + FUTURE_TOLERANCE_MS || checkedAtMs > now + FUTURE_TOLERANCE_MS) return null;

  const sources = new Map();
  for (const source of payload.sources.slice(0, 100)) {
    if (!isRecord(source) || typeof source.id !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]{0,79}$/iu.test(source.id) || sources.has(source.id) ||
        !['ok', 'error'].includes(source.status)) continue;
    const name = plainText(source.name, 100);
    const siteUrl = safeMatomeUrl(source.siteUrl);
    if (name && siteUrl) sources.set(source.id, { id: source.id, name, siteUrl, status: source.status });
  }

  const items = [];
  const seenIds = new Set();
  const seenUrls = new Set();
  for (const item of payload.items.slice(0, 5000)) {
    if (!isRecord(item) || !Array.isArray(item.categories)) continue;
    const id = plainText(item.id, 200);
    const title = plainText(item.title, 1000);
    const source = sources.get(item.sourceId);
    const url = articleUrl(item.url);
    const publishedAtMs = timestamp(item.publishedAt);
    const categories = [...new Set(item.categories.filter((category) => CATEGORY_IDS.has(category)))];
    if (!id || !title || !source || !url || !categories.length || publishedAtMs === null ||
        publishedAtMs < now - MATOME_MAX_AGE_MS || publishedAtMs > now + FUTURE_TOLERANCE_MS ||
        publisherHost(url) !== publisherHost(source.siteUrl) || seenIds.has(id) || seenUrls.has(url)) continue;
    seenIds.add(id);
    seenUrls.add(url);
    items.push({
      id, title, url, categories, sourceId: source.id, sourceName: source.name,
      sourceUrl: source.siteUrl, publishedAt: new Date(publishedAtMs).toISOString(), publishedAtMs,
    });
  }
  items.sort((a, b) => b.publishedAtMs - a.publishedAtMs || a.id.localeCompare(b.id));
  return { status: payload.status, generatedAtMs, checkedAtMs, sources: [...sources.values()], items };
}

export function formatMatomeTime(value) {
  const millis = typeof value === 'number' ? value : timestamp(value);
  return Number.isFinite(millis) ? `${PUBLICATION_FORMAT.format(millis)} JST` : '';
}

/** Revalidate on every render, including a failed refresh, so old cards expire. */
export function getMatomeViewModel(payload, {
  category, visibleCount = MATOME_PAGE_SIZE, now = Date.now(), networkError = false, preferences,
} = {}) {
  const data = normalizeMatomePayload(payload, now);
  const effective = normalizeMatomePreferences(preferences, data?.sources.map(({ id }) => id));
  const selectedCategory = CATEGORY_IDS.has(category) ? category : effective.categoryOrder[0];
  const hiddenSources = new Set(effective.hiddenSourceIds);
  const visibleItems = (data?.items ?? []).filter((item) => !hiddenSources.has(item.sourceId));
  const counts = Object.fromEntries(MATOME_CATEGORIES.map(({ id }) => [id, 0]));
  for (const item of visibleItems) {
    for (const id of item.categories) counts[id] += 1;
  }
  const matching = visibleItems.filter((item) => item.categories.includes(selectedCategory));
  const limit = Number.isSafeInteger(visibleCount) && visibleCount >= MATOME_PAGE_SIZE
    ? Math.min(visibleCount, 5000) : MATOME_PAGE_SIZE;
  const items = matching.slice(0, limit);
  let status = 'ok';
  let statusText = '過去7日以内の新着記事を表示しています';
  if (!data) {
    status = 'unavailable';
    statusText = 'まとめ記事を取得できませんでした。時間をおいて再読み込みしてください';
  } else if (networkError) {
    status = 'network-error';
    statusText = '最新データを取得できませんでした。前回取得分を表示しています';
  } else if (data.status === 'unavailable') {
    status = 'unavailable';
    statusText = data.items.length
      ? '取得元に接続できないため、前回取得分を表示しています'
      : '現在、まとめ記事を取得できません。時間をおいて再読み込みしてください';
  } else if (data.generatedAtMs === null || now - data.generatedAtMs > MATOME_STALE_AFTER_MS) {
    status = 'stale';
    statusText = '更新が遅れています。取得済みの過去7日以内の記事を表示しています';
  } else if (data.status === 'partial') {
    status = 'partial';
    statusText = '一部の取得元は更新できていません。取得済みの記事を表示しています';
  } else if (!data.items.length) {
    status = 'empty';
    statusText = '現在、過去7日以内のまとめ記事はありません';
  } else if (!visibleItems.length) {
    status = 'filtered-empty';
    statusText = '現在の表示設定に合う記事はありません。「表示設定」で取得元を見直せます';
  }
  const filteredEmpty = hiddenSources.size > 0 && matching.length === 0;
  return {
    category: selectedCategory, counts, items, total: matching.length,
    moreCount: Math.min(MATOME_PAGE_SIZE, matching.length - items.length),
    nextExpiryAt: data?.items.length ? data.items.at(-1).publishedAtMs + MATOME_MAX_AGE_MS + 1 : null,
    status, statusText,
    updatedText: data?.generatedAtMs != null ? `最終取得 ${formatMatomeTime(data.generatedAtMs)}` : '',
    emptyTitle: status === 'unavailable' ? 'まとめ記事を準備できませんでした'
      : filteredEmpty ? 'この設定で表示できる新着はありません' : 'このカテゴリの新着はまだありません',
    emptyMessage: filteredEmpty
      ? '非表示にした取得元の記事は表示されません。「表示設定」で見直せます。ほかのタブもご覧ください。'
      : '取得できた過去7日以内の記事があると、ここに表示されます。ほかのタブもご覧ください。',
  };
}

export function getNextMatomeCategory(current, key, categoryOrder) {
  const order = normalizeMatomePreferences({ version: 1, categoryOrder }).categoryOrder;
  const index = Math.max(0, order.indexOf(current));
  if (key === 'Home') return order[0];
  if (key === 'End') return order.at(-1);
  if (key === 'ArrowRight') return order[(index + 1) % order.length];
  if (key === 'ArrowLeft') return order[(index + order.length - 1) % order.length];
  return null;
}

export function initializeMatomeSection(root, {
  fetchImpl = globalThis.fetch?.bind(globalThis), documentRef = globalThis.document,
  windowRef = globalThis.window, now = Date.now,
} = {}) {
  if (!root || !documentRef || !windowRef || !fetchImpl) return null;
  const tabs = [...root.querySelectorAll('[data-matome-category]')];
  const panel = root.querySelector('#matome-panel');
  const list = root.querySelector('#matome-list');
  const status = root.querySelector('#matome-status');
  const updated = root.querySelector('#matome-updated');
  const empty = root.querySelector('#matome-empty');
  const more = root.querySelector('#matome-more');
  if (tabs.length !== 4 || !panel || !list || !status || !updated || !empty || !more) return null;

  const loaded = loadMatomePreferences([], windowRef);
  let pendingPreferences = loaded.raw;
  let preferences = loaded.preferences;
  let draft = normalizeMatomePreferences(preferences);
  let sources = [];
  let sourcesLoaded = false;
  let payload = null;
  let category = preferences.categoryOrder[0];
  const limits = Object.fromEntries(MATOME_CATEGORIES.map(({ id }) => [id, MATOME_PAGE_SIZE]));
  let networkError = false;
  let inFlight = null;
  let disposed = false;
  let expiryTimer = null;

  function element(tag, className, text) {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const settings = element('details', 'matome-preferences');
  settings.id = 'matome-preferences';
  const summary = element('summary', '', 'スレまとめの表示設定');
  const scope = element('p', 'matome-preferences-note',
    'スレまとめだけの設定です。このブラウザに保存され、ほかの端末や一般ニュースには反映されません。');
  const ordering = element('fieldset', 'matome-preferences-group');
  ordering.append(element('legend', '', 'カテゴリの順番'));
  const orderList = element('ol', 'matome-preferences-order');
  ordering.append(orderList);
  const visibility = element('fieldset', 'matome-preferences-group');
  visibility.append(element('legend', '', '非表示にする取得元'));
  const sourceList = element('div', 'matome-preferences-sources');
  const sourceHint = element('p', 'matome-preferences-note', '取得元を読み込んでいます');
  visibility.append(sourceList, sourceHint);
  const actions = element('div', 'matome-preferences-actions');
  const save = element('button', 'outline-button', '設定を保存');
  save.type = 'button';
  save.id = 'matome-preferences-save';
  const reset = element('button', 'outline-button', '初期状態に戻す');
  reset.type = 'button';
  reset.id = 'matome-preferences-reset';
  actions.append(save, reset);
  const settingsStatus = element('p', 'matome-preferences-note');
  settingsStatus.id = 'matome-preferences-status';
  settingsStatus.setAttribute('role', 'status');
  settingsStatus.setAttribute('aria-live', 'polite');
  settingsStatus.textContent = loaded.status === 'unavailable'
    ? '保存機能を利用できません。変更はこのページを開いている間だけ反映できます。'
    : loaded.status === 'invalid' ? '保存済みの設定を読み取れないため、初期設定で表示します。' : '';
  settings.append(summary, scope, ordering, visibility, actions, settingsStatus);
  const tabList = root.querySelector('[role="tablist"]');
  if (tabList?.parentNode) tabList.parentNode.insertBefore(settings, tabList);
  else root.append(settings);

  const categoryRows = new Map();
  for (const { id, label } of MATOME_CATEGORIES) {
    const row = element('li', 'matome-preferences-category');
    row.dataset.matomeOrder = id;
    const name = element('span', '', label);
    const up = element('button', '', '↑ 上へ');
    const down = element('button', '', '↓ 下へ');
    for (const [button, direction, word] of [[up, -1, '上'], [down, 1, '下']]) {
      button.type = 'button';
      button.dataset.matomeMove = `${id}:${direction}`;
      button.setAttribute('aria-label', `${label}を${word}へ移動`);
      button.addEventListener('click', () => {
        if (disposed) return;
        const from = draft.categoryOrder.indexOf(id);
        const to = from + direction;
        if (to < 0 || to >= draft.categoryOrder.length) return;
        [draft.categoryOrder[from], draft.categoryOrder[to]] = [draft.categoryOrder[to], draft.categoryOrder[from]];
        renderSettings();
        settingsStatus.textContent = `${label}を${to + 1}番目に移動しました。「設定を保存」で反映します。`;
      });
    }
    row.append(name, up, down);
    categoryRows.set(id, { row, up, down });
  }
  const sourceRows = new Map();

  function renderSettings() {
    const focused = settings.contains(documentRef.activeElement) ? documentRef.activeElement : null;
    orderList.replaceChildren(...draft.categoryOrder.map((id, index) => {
      const { row, up, down } = categoryRows.get(id);
      // Keep boundary buttons focusable so moving a row never loses keyboard focus.
      up.setAttribute('aria-disabled', String(index === 0));
      down.setAttribute('aria-disabled', String(index === draft.categoryOrder.length - 1));
      return row;
    }));
    const nodes = sources.map(({ id, name }) => {
      if (!sourceRows.has(id)) {
        const label = element('label', 'matome-preferences-source');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.matomeHideSource = id;
        const text = element('span');
        label.append(checkbox, text);
        checkbox.addEventListener('change', () => {
          if (disposed) return;
          const hidden = new Set(draft.hiddenSourceIds);
          if (checkbox.checked) hidden.add(id);
          else hidden.delete(id);
          draft.hiddenSourceIds = [...hidden];
          settingsStatus.textContent = '変更はまだ反映されていません。「設定を保存」で反映します。';
        });
        sourceRows.set(id, { label, checkbox, text });
      }
      const entry = sourceRows.get(id);
      entry.checkbox.checked = draft.hiddenSourceIds.includes(id);
      entry.text.textContent = `${name}を非表示`;
      return entry.label;
    });
    sourceList.replaceChildren(...nodes);
    sourceHint.hidden = sources.length > 0;
    sourceHint.textContent = sourcesLoaded ? '設定できる取得元がありません' : '取得元を読み込むと設定を保存できます';
    save.disabled = !sourcesLoaded;
    if (focused && settings.contains(focused)) focused.focus({ preventScroll: true });
    else if (focused) summary.focus({ preventScroll: true });
  }

  function reorderTabs() {
    const focused = documentRef.activeElement;
    for (const tab of tabs) {
      const active = tab.dataset.matomeCategory === category;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `matome-tab-${category}`);
    if (tabList) {
      tabList.append(...preferences.categoryOrder.map((id) => tabs.find((tab) => tab.dataset.matomeCategory === id)));
      if (tabs.includes(focused)) focused.focus({ preventScroll: true });
    }
  }

  function applyPreferences(next, resetCategory = false) {
    preferences = next;
    pendingPreferences = null;
    draft = normalizeMatomePreferences(next, sources.map(({ id }) => id));
    for (const id of CATEGORY_IDS) limits[id] = MATOME_PAGE_SIZE;
    if (resetCategory) category = preferences.categoryOrder[0];
    reorderTabs();
    renderSettings();
    render();
  }

  function saveSettings() {
    if (disposed || !sourcesLoaded) return;
    const result = saveMatomePreferences(draft, sources.map(({ id }) => id), windowRef);
    applyPreferences(result.preferences);
    settingsStatus.textContent = result.saved ? 'スレまとめの設定をこのブラウザに保存しました。'
      : '保存できませんでした。変更はこのページを開いている間だけ反映しています。再読み込みすると元の設定に戻る場合があります。';
  }
  function resetSettings() {
    if (disposed) return;
    const result = resetMatomePreferences(windowRef);
    applyPreferences(result.preferences, true);
    settingsStatus.textContent = result.saved ? 'スレまとめの設定を初期状態に戻しました。'
      : '保存済み設定を削除できませんでした。このページでは初期状態に戻しましたが、再読み込みすると以前の設定に戻る場合があります。';
  }
  save.addEventListener('click', saveSettings);
  reset.addEventListener('click', resetSettings);
  renderSettings();
  reorderTabs();

  function articleLink(item, className, text) {
    const link = element('a', className, text);
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.dataset.matomeItem = item.id;
    link.dataset.matomeLink = className;
    return link;
  }

  function render() {
    const model = getMatomeViewModel(payload, {
      category, visibleCount: limits[category], now: now(), networkError, preferences,
    });
    windowRef.clearTimeout(expiryTimer);
    if (model.nextExpiryAt !== null) {
      expiryTimer = windowRef.setTimeout(() => { if (!disposed) render(); }, Math.max(1, model.nextExpiryAt - now()));
    }
    const focused = list.contains(documentRef.activeElement) ? documentRef.activeElement : null;
    const moreWasFocused = documentRef.activeElement === more;
    const focusId = focused?.dataset.matomeItem;
    const focusKind = focused?.dataset.matomeLink;
    for (const tab of tabs) {
      const id = tab.dataset.matomeCategory;
      const active = id === model.category;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const label = MATOME_CATEGORIES.find((entry) => entry.id === id)?.label ?? '';
      tab.setAttribute('aria-label', `${label} ${model.counts[id] ?? 0}件`);
      const count = tab.querySelector('[data-matome-count]');
      if (count) count.textContent = String(model.counts[id] ?? 0);
    }
    panel.setAttribute('aria-labelledby', `matome-tab-${model.category}`);
    status.textContent = model.statusText;
    root.dataset.matomeStatus = model.status;
    updated.textContent = model.updatedText;
    updated.hidden = !model.updatedText;
    const cards = model.items.map((item) => {
      const card = element('li', 'matome-card');
      const heading = element('h3', 'matome-card-title');
      heading.append(articleLink(item, 'matome-title-link', item.title));
      const meta = element('div', 'matome-card-meta');
      meta.append(element('span', 'matome-source', item.sourceName));
      const time = element('time', 'matome-date', formatMatomeTime(item.publishedAt));
      time.dateTime = item.publishedAt;
      meta.append(time);
      const link = articleLink(item, 'matome-original-link', '元記事を読む ↗');
      link.setAttribute('aria-label', `元記事を読む: ${item.title}（${item.sourceName}、新しいタブ）`);
      meta.append(link);
      card.append(heading, meta);
      return card;
    });
    list.replaceChildren(...cards);
    list.hidden = !cards.length;
    empty.hidden = Boolean(cards.length);
    if (!cards.length) empty.replaceChildren(
      element('strong', '', model.emptyTitle), element('p', '', model.emptyMessage),
    );
    more.hidden = model.moreCount === 0;
    more.textContent = model.moreCount ? `さらに${model.moreCount}件見る ↓` : 'すべて表示しました';
    more.setAttribute('aria-expanded', String(limits[category] > MATOME_PAGE_SIZE));
    if (focused) {
      const replacement = [...list.querySelectorAll('a')].find((link) =>
        link.dataset.matomeItem === focusId && link.dataset.matomeLink === focusKind);
      (replacement ?? panel).focus({ preventScroll: true });
    } else if (moreWasFocused && more.hidden) {
      panel.focus({ preventScroll: true });
    }
    return model;
  }

  function selectCategory(next, focus = false) {
    if (!CATEGORY_IDS.has(next)) return;
    category = next;
    render();
    if (focus) tabs.find((tab) => tab.dataset.matomeCategory === next)?.focus();
  }

  const tabListeners = tabs.map((tab) => {
    const click = () => selectCategory(tab.dataset.matomeCategory);
    const keydown = (event) => {
      const next = getNextMatomeCategory(tab.dataset.matomeCategory, event.key, preferences.categoryOrder);
      if (next) {
        event.preventDefault();
        selectCategory(next, true);
      }
    };
    tab.addEventListener('click', click);
    tab.addEventListener('keydown', keydown);
    return { tab, click, keydown };
  });

  function showMore() {
    const previousLength = list.children.length;
    limits[category] += MATOME_PAGE_SIZE;
    render();
    // Keep keyboard users with the newly revealed content, even when the button disappears.
    list.children[previousLength]?.querySelector('a')?.focus({ preventScroll: true });
  }
  more.addEventListener('click', showMore);

  function refresh() {
    if (disposed) return Promise.resolve();
    if (inFlight) return inFlight;
    const controller = new AbortController();
    const timeout = windowRef.setTimeout(() => controller.abort(), 15000);
    inFlight = Promise.resolve().then(async () => {
      try {
        const response = await fetchImpl('./data/matome-threads.json', { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error('Matome data unavailable');
        const next = await response.json();
        const validated = normalizeMatomePayload(next, now());
        if (!validated) throw new Error('Invalid matome data');
        if (!disposed) {
          payload = next;
          sources = validated.sources;
          const sourceIds = sources.map(({ id }) => id);
          preferences = normalizeMatomePreferences(pendingPreferences ?? preferences, sourceIds);
          draft = normalizeMatomePreferences({ ...draft,
            hiddenSourceIds: sourcesLoaded ? draft.hiddenSourceIds : preferences.hiddenSourceIds,
          }, sourceIds);
          pendingPreferences = null;
          sourcesLoaded = true;
          renderSettings();
          networkError = false;
        }
      } catch {
        if (!disposed) networkError = true;
      } finally {
        windowRef.clearTimeout(timeout);
        inFlight = null;
        if (!disposed) render();
      }
    });
    return inFlight;
  }

  const onVisibility = () => { if (documentRef.visibilityState === 'visible') void refresh(); };
  documentRef.addEventListener('visibilitychange', onVisibility);
  const interval = windowRef.setInterval(() => {
    if (documentRef.visibilityState === 'visible') void refresh();
  }, REFRESH_INTERVAL_MS);
  void refresh();
  return {
    refresh,
    destroy() {
      disposed = true;
      windowRef.clearInterval(interval);
      windowRef.clearTimeout(expiryTimer);
      documentRef.removeEventListener('visibilitychange', onVisibility);
      more.removeEventListener('click', showMore);
      save.removeEventListener('click', saveSettings);
      reset.removeEventListener('click', resetSettings);
      settings.remove?.();
      for (const { tab, click, keydown } of tabListeners) {
        tab.removeEventListener('click', click);
        tab.removeEventListener('keydown', keydown);
      }
    },
  };
}

if (typeof document !== 'undefined') {
  initializeMatomeSection(document.querySelector('#matome-threads'));
}
