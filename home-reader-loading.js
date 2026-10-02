(function attachHomeReaderLoading(global) {
  // One page request at a time for both normal news and opt-in personal news.
  function createSharedArchivePager({ getCursor, fetchPage, applyPage, onUpdate = () => {} }) {
    let generation = 0;
    let inFlight = null;
    let seen = new Set();
    let failed = false;
    function reset() { generation += 1; seen = new Set(); failed = false; }
    function loadNext() {
      if (inFlight) return inFlight;
      const page = getCursor();
      if (page === null) return Promise.resolve({ status: 'exhausted' });
      if (!Number.isSafeInteger(page) || page < 2 || page > 10000 || seen.has(page) || seen.size >= 1000) {
        failed = true;
        return Promise.resolve({ status: 'error', retryable: false });
      }
      const current = generation;
      const request = Promise.resolve().then(() => fetchPage(page)).then((payload) => {
        if (current !== generation) return { status: 'stale' };
        if (!payload || !Array.isArray(payload.items)) throw new Error('Invalid archive page');
        applyPage(payload);
        seen.add(page);
        failed = false;
        onUpdate();
        return { status: 'loaded' };
      }).catch(() => {
        if (current !== generation) return { status: 'stale' };
        failed = true;
        return { status: 'error', retryable: true };
      });
      const pending = request.finally(() => { if (inFlight === pending) inFlight = null; });
      inFlight = pending;
      return pending;
    }
    return { loadNext, reset, getState: () => ({ failed }) };
  }

  function createReaderNewsLoader({ isEnabled, isReady, getCount, hasMore, loadNext, onState = () => {}, limit = 10 }) {
    let generation = 0;
    let running = null;
    let state = { phase: 'idle', retryable: false };
    function setState(phase, retryable = false) {
      if (state.phase === phase && state.retryable === retryable) return;
      state = { phase, retryable }; onState(state);
    }
    function restart() {
      generation += 1; running = null; setState('idle');
    }
    function ensure() {
      if (!isEnabled()) { if (state.phase !== 'idle' || running) restart(); return Promise.resolve(); }
      if (!isReady()) { setState('loading'); return Promise.resolve(); }
      if (getCount() >= limit || !hasMore()) { setState('complete'); return Promise.resolve(); }
      if (running) return running;
      if (state.phase === 'error') return Promise.resolve();
      const current = generation;
      setState('loading');
      const request = Promise.resolve().then(async () => {
        while (current === generation && isEnabled() && isReady() && getCount() < limit && hasMore()) {
          let result;
          try { result = await loadNext(); } catch { result = { status: 'error', retryable: true }; }
          if (current !== generation || !isEnabled()) return;
          if (result.status === 'error') { setState('error', result.retryable === true); return; }
          if (result.status === 'exhausted') break;
          // A snapshot refresh may invalidate a shared request; check readiness again.
        }
        if (current === generation) setState(isEnabled() && isReady() ? 'complete' : 'idle');
      });
      const pending = request.finally(() => { if (running === pending) running = null; });
      running = pending;
      return pending;
    }
    function retry() { restart(); return ensure(); }
    return { ensure, restart, retry, getState: () => ({ ...state }) };
  }
  global.HomeReaderLoading = { createSharedArchivePager, createReaderNewsLoader };
})(typeof window === 'undefined' ? globalThis : window);
