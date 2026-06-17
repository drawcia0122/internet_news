(function attachHomeDataUtils(global) {
  function createStorageArrayCache({ storage, key, normalize }) {
    function save(items) {
      try {
        storage.setItem(key, JSON.stringify(items ?? []));
      } catch {}
    }

    function load() {
      try {
        const cached = JSON.parse(storage.getItem(key) ?? '[]');
        return Array.isArray(cached) ? cached.map((item) => normalize(item)) : [];
      } catch {
        return [];
      }
    }

    return { save, load };
  }

  async function fetchJsonWithCache({ cacheKey, endpoints, onFetchMetric } = {}) {
    for (const endpoint of endpoints) {
      try {
        const fetchStartedAt = performance.now();
        const response = await fetch(endpoint, { cache: 'default' });
        if (!response.ok) continue;
        const payload = await response.json();
        onFetchMetric?.({
          cacheKey,
          source: endpoint,
          durationMs: performance.now() - fetchStartedAt,
          bytes: JSON.stringify(payload).length,
        });
        return payload;
      } catch {
        continue;
      }
    }
    throw new Error('JSON unavailable');
  }

  global.HomeDataUtils = {
    createStorageArrayCache,
    fetchJsonWithCache,
  };
})(window);
