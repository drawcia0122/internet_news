(function attachReaderPreferences(global) {
  const STORAGE_KEY = 'internet-news-reader-preferences-v1';
  const MAX_KEYWORDS = 20;
  const MAX_KEYWORD_LENGTH = 80;
  const CATEGORIES = Object.freeze([
    { id: 'pokemon', label: 'ポケモン' }, { id: 'games', label: 'ゲーム' },
    { id: 'anime', label: 'アニメ' }, { id: 'manga', label: '漫画' },
    { id: 'net-culture', label: 'ネット文化' }, { id: 'deals', label: 'セール' },
    { id: 'events', label: 'イベント' }, { id: 'tech', label: 'テック' },
    { id: 'entertainment', label: 'エンタメ' }, { id: 'sports', label: 'スポーツ' },
    { id: 'business', label: '経済' }, { id: 'politics', label: '政治' },
    { id: 'world', label: '国際' },
  ].map(Object.freeze));
  const categoryIds = new Set(CATEGORIES.map(({ id }) => id));
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fold = (text) => typeof text === 'string' ? text.normalize('NFKC').toLowerCase().trim() : '';
  const cleanList = (value, valid, limit) => Array.isArray(value)
    ? [...new Set(value.slice(0, 500).filter(valid))].slice(0, limit) : [];
  const validSourceId = (value) => typeof value === 'string' &&
    /^(?:id:[a-z0-9][a-z0-9_-]{0,79}|host:(?:[a-z0-9-]+\.)+[a-z]{2,63})$/u.test(value);

  function normalizeKeywords(value) {
    return cleanList(Array.isArray(value) ? value.map(fold) : [],
      (word) => word.length > 0 && word.length <= MAX_KEYWORD_LENGTH && !/[\u0000-\u001f\u007f]/u.test(word), MAX_KEYWORDS);
  }

  function normalizePreferences(value) {
    const data = isRecord(value) && value.version === 1 ? value : {};
    return {
      version: 1, enabled: data.enabled === true,
      categories: cleanList(data.categories, (id) => categoryIds.has(id), CATEGORIES.length),
      keywords: normalizeKeywords(data.keywords), excludedKeywords: normalizeKeywords(data.excludedKeywords),
      excludedSources: cleanList(data.excludedSources, validSourceId, 200),
    };
  }

  function getStorage(storageName = 'localStorage', windowRef = global) {
    try { return windowRef[storageName] ?? null; } catch { return null; }
  }

  function createPreferenceStore(storage = getStorage()) {
    function load() {
      try {
        if (!storage) throw new Error('Storage unavailable');
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return { preferences: normalizePreferences(null), warning: '' };
        if (typeof raw !== 'string' || raw.length > 100000) throw new Error('Invalid preferences');
        const value = JSON.parse(raw);
        if (!isRecord(value) || value.version !== 1) throw new Error('Unknown preferences');
        return { preferences: normalizePreferences(value), warning: '' };
      } catch {
        return { preferences: normalizePreferences(null), warning: '保存済みの設定を読み込めませんでした。標準の表示を使っています。' };
      }
    }
    function save(value) {
      const preferences = normalizePreferences(value);
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
        return { preferences, saved: true };
      } catch { return { preferences, saved: false }; }
    }
    function reset() {
      const preferences = normalizePreferences(null);
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.removeItem(STORAGE_KEY);
        return { preferences, saved: true };
      } catch { return { preferences, saved: false }; }
    }
    return { load, save, reset };
  }

  function sourceKey(signal) {
    const id = typeof signal?.sourceId === 'string' ? signal.sourceId.toLowerCase() : '';
    if (validSourceId(`id:${id}`)) return `id:${id}`;
    try {
      const url = new URL(signal?.canonicalUrl || signal?.url || signal?.sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      const key = `host:${url.hostname.toLowerCase().replace(/^www\./u, '')}`;
      return validSourceId(key) ? key : null;
    } catch { return null; }
  }

  function topicSources(topic) {
    const signals = Array.isArray(topic?.sourceSignals) ? topic.sourceSignals : [];
    return signals.length ? signals : [topic];
  }

  function collectSources(topics) {
    const sources = new Map();
    for (const topic of Array.isArray(topics) ? topics : []) {
      for (const signal of topicSources(topic)) {
        const id = sourceKey(signal);
        if (!id || sources.has(id)) continue;
        const label = typeof signal?.sourceName === 'string' ? signal.sourceName : signal?.source;
        sources.set(id, { id, label: typeof label === 'string' && label.trim() ? label.slice(0, 100) : id.replace(/^(id|host):/u, '') });
      }
    }
    return [...sources.values()].sort((left, right) => left.label.localeCompare(right.label, 'ja') || left.id.localeCompare(right.id));
  }

  function articleText(topic) {
    return fold([topic?.title, topic?.summary, topic?.briefSummary, topic?.description, topic?.whatHappened]
      .filter((value) => typeof value === 'string').join(' '));
  }

  function matchesCategory(topic, id) {
    if (id === 'pokemon') return global.ArticleCategoryQuality?.hasPokemonBrandSignal(topic) ?? false;
    const ids = [topic?.category, ...(Array.isArray(topic?.categories) ? topic.categories : [])];
    if (id === 'games') return ids.includes('games') || ids.includes('game-features');
    if (id === 'net-culture') return ids.includes('net-culture') || ids.includes('sns');
    if (id === 'deals') return /セール|割引|無料配布|キャンペーン|クーポン/u.test(articleText(topic));
    if (id === 'events') return ids.includes('events') || /イベント|展示会|ポップアップ|コラボカフェ|謎解き/u.test(articleText(topic));
    return ids.includes(id);
  }

  function hasInterests(preferences) { return Boolean(preferences.categories.length || preferences.keywords.length); }
  function isActive(preferences) {
    return preferences.enabled && Boolean(hasInterests(preferences) || preferences.excludedKeywords.length || preferences.excludedSources.length);
  }
  function matchesTopic(topic, preferences) {
    if (!isActive(preferences)) return true;
    const text = articleText(topic);
    if (preferences.excludedKeywords.some((word) => text.includes(word))) return false;
    if (topicSources(topic).some((signal) => preferences.excludedSources.includes(sourceKey(signal)))) return false;
    return !hasInterests(preferences) || preferences.categories.some((id) => matchesCategory(topic, id)) ||
      preferences.keywords.some((word) => text.includes(word));
  }

  function parseKeywordInput(value) {
    const words = value.split(/[,、\n\r]+/u).map(fold).filter(Boolean);
    if (words.length > MAX_KEYWORDS || words.some((word) => word.length > MAX_KEYWORD_LENGTH || /[\u0000-\u001f\u007f]/u.test(word))) return null;
    return normalizeKeywords(words);
  }

  function initializeReaderPreferences(root, { documentRef = global.document, store = createPreferenceStore(), onChange = () => {} } = {}) {
    if (!root || !documentRef) return null;
    const { preferences: loaded, warning } = store.load();
    let preferences = loaded;
    let sources = [];
    const form = root.querySelector('form');
    const enabled = root.querySelector('[name="reader-enabled"]');
    const categoryList = root.querySelector('[data-reader-categories]');
    const wanted = root.querySelector('[name="reader-keywords"]');
    const excluded = root.querySelector('[name="reader-excluded-keywords"]');
    const sourceList = root.querySelector('[data-reader-sources]');
    const status = root.querySelector('[data-reader-status]');
    const resetButton = root.querySelector('[data-reader-reset]');
    if (!form || !enabled || !categoryList || !wanted || !excluded || !sourceList || !status || !resetButton) return null;
    const checkboxes = new Map();
    function checkbox(labelText, value, name) {
      const label = documentRef.createElement('label');
      label.className = 'reader-check';
      const input = documentRef.createElement('input');
      input.type = 'checkbox'; input.name = name; input.value = value;
      const text = documentRef.createElement('span'); text.textContent = labelText;
      label.append(input, text);
      return { label, input };
    }
    for (const { id, label } of CATEGORIES) {
      const entry = checkbox(label, id, 'reader-category');
      checkboxes.set(id, entry.input); categoryList.append(entry.label);
    }
    function renderSources(selected = [...sourceList.querySelectorAll('input:checked')].map((input) => input.value)) {
      const knownIds = new Set(sources.map(({ id }) => id));
      const entries = [...sources, ...selected.filter((id) => !knownIds.has(id)).map((id) => ({ id, label: `${id.replace(/^(id|host):/u, '')}（現在の記事なし）` }))];
      const focusId = sourceList.contains(documentRef.activeElement) ? documentRef.activeElement.value : null;
      const nodes = entries.map(({ id, label }) => {
        const entry = checkbox(`${label}を非表示`, id, 'reader-source');
        entry.input.checked = selected.includes(id); return entry.label;
      });
      if (!nodes.length) {
        const empty = documentRef.createElement('p'); empty.textContent = '記事を読み込むと取得元を選べます。'; nodes.push(empty);
      }
      sourceList.replaceChildren(...nodes);
      if (focusId) [...sourceList.querySelectorAll('input')].find((input) => input.value === focusId)?.focus({ preventScroll: true });
    }
    function fillForm() {
      enabled.checked = preferences.enabled;
      for (const [id, input] of checkboxes) input.checked = preferences.categories.includes(id);
      wanted.value = preferences.keywords.join('\n'); excluded.value = preferences.excludedKeywords.join('\n');
      renderSources(preferences.excludedSources);
    }
    function submit(event) {
      event.preventDefault();
      const keywords = parseKeywordInput(wanted.value);
      const excludedKeywords = parseKeywordInput(excluded.value);
      if (!keywords || !excludedKeywords) {
        status.textContent = 'キーワードは各欄20個まで、1個80文字以内で入力してください。';
        (!keywords ? wanted : excluded).focus(); return;
      }
      const result = store.save({ version: 1, enabled: enabled.checked,
        categories: [...checkboxes].filter(([, input]) => input.checked).map(([id]) => id), keywords, excludedKeywords,
        excludedSources: [...sourceList.querySelectorAll('input:checked')].map((input) => input.value) });
      preferences = result.preferences;
      status.textContent = result.saved
        ? (isActive(preferences) ? 'このブラウザーに保存しました。マイニュースだけに適用しています。' : 'このブラウザーに保存しました。標準の表示を使っています。')
        : '保存できませんでした。このページを開いている間だけ設定を適用します。再読み込みすると元に戻ることがあります。';
      onChange(preferences);
    }
    function reset() {
      const result = store.reset(); preferences = result.preferences; fillForm();
      status.textContent = result.saved ? 'マイニュースの設定をリセットし、標準の表示に戻しました。'
        : 'このページでは標準の表示に戻しました。保存済みの設定を削除できず、再読み込みすると戻ることがあります。';
      onChange(preferences);
    }
    fillForm(); status.textContent = warning;
    form.addEventListener('submit', submit); resetButton.addEventListener('click', reset);
    root.hidden = false;
    return {
      getPreferences: () => preferences,
      updateSources(topics) {
        const next = collectSources(topics);
        if (JSON.stringify(next) !== JSON.stringify(sources)) { sources = next; renderSources(); }
      },
      destroy() { form.removeEventListener('submit', submit); resetButton.removeEventListener('click', reset); },
    };
  }

  global.ReaderPreferences = { STORAGE_KEY, CATEGORIES, normalizePreferences, createPreferenceStore, getStorage,
    sourceKey, collectSources, hasInterests, isActive, matchesTopic, parseKeywordInput, initializeReaderPreferences };
})(typeof window === 'undefined' ? globalThis : window);
