export const DATA_ENDPOINTS = Object.freeze({
  todayInternet: {
    url: '../data/today-internet.json',
    timeoutMs: 5000,
  },
  dailyBrief: {
    url: '../data/daily-brief.json',
    timeoutMs: 5000,
  },
  trendTopics: {
    url: '../data/trend-topics.json',
    timeoutMs: 8000,
  },
  homeTopics: {
    url: '../data/home-topics.json',
    timeoutMs: 4000,
  },
  homeNews: {
    url: '../data/home-news.json',
    timeoutMs: 4000,
  },
});

const inFlightRequests = new Map();
const successfulResults = new Map();

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateData(source, data) {
  if (!isObject(data)) {
    return { valid: false, empty: false, itemCount: 0 };
  }

  if (source === 'todayInternet') {
    const selectedTopicIsValid = data.selectedTopic === null || isObject(data.selectedTopic);
    const runnerUpsIsValid = Array.isArray(data.runnerUps);

    if (!selectedTopicIsValid || !runnerUpsIsValid) {
      return { valid: false, empty: false, itemCount: 0 };
    }

    const itemCount = (isObject(data.selectedTopic) ? 1 : 0) + data.runnerUps.length;
    return { valid: true, empty: itemCount === 0, itemCount };
  }

  if (!Array.isArray(data.items)) {
    return { valid: false, empty: false, itemCount: 0 };
  }

  return {
    valid: true,
    empty: data.items.length === 0,
    itemCount: data.items.length,
  };
}

function failureResult(source, url, fetchedAt, type, message, status = null) {
  return {
    ok: false,
    source,
    url,
    fetchedAt,
    error: {
      type,
      message,
      status,
    },
  };
}

async function fetchEndpoint(source, endpoint, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const fetchedAt = new Date().toISOString();
  let timedOut = false;
  let callerAborted = false;

  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort(options.signal?.reason);
  };

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, endpoint.timeoutMs);

  try {
    if (typeof fetchImpl !== 'function') {
      return failureResult(source, endpoint.url, fetchedAt, 'network', 'Fetch is unavailable');
    }

    const response = await fetchImpl(endpoint.url, {
      cache: 'no-cache',
      signal: controller.signal,
    });

    if (!response.ok) {
      return failureResult(
        source,
        endpoint.url,
        fetchedAt,
        'http',
        `HTTP ${response.status}`,
        response.status,
      );
    }

    let data;
    try {
      data = JSON.parse(await response.text());
    } catch {
      return failureResult(source, endpoint.url, fetchedAt, 'parse', 'Invalid JSON');
    }

    const validation = validateData(source, data);
    if (!validation.valid) {
      return failureResult(source, endpoint.url, fetchedAt, 'invalid_schema', 'Unexpected data shape');
    }
    if (validation.empty) {
      return failureResult(source, endpoint.url, fetchedAt, 'empty_data', 'No items available');
    }

    return {
      ok: true,
      source,
      url: endpoint.url,
      data,
      fetchedAt,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null,
      itemCount: validation.itemCount,
    };
  } catch (error) {
    if (timedOut) {
      return failureResult(source, endpoint.url, fetchedAt, 'timeout', 'Request timed out');
    }
    if (callerAborted || options.signal?.aborted) {
      return failureResult(source, endpoint.url, fetchedAt, 'aborted', 'Request was aborted');
    }
    if (error instanceof TypeError) {
      return failureResult(source, endpoint.url, fetchedAt, 'network', 'Network request failed');
    }
    return failureResult(source, endpoint.url, fetchedAt, 'unknown', 'Unexpected request failure');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function loadData(source, options = {}) {
  const endpoint = DATA_ENDPOINTS[source];
  if (!endpoint) {
    return Promise.resolve(
      failureResult(source, '', new Date().toISOString(), 'unknown', 'Unknown data source'),
    );
  }

  if (!options.force && successfulResults.has(source)) {
    return Promise.resolve(successfulResults.get(source));
  }

  if (!options.force && inFlightRequests.has(source)) {
    return inFlightRequests.get(source);
  }

  const request = fetchEndpoint(source, endpoint, options)
    .then((result) => {
      if (result.ok) {
        successfulResults.set(source, result);
      }
      return result;
    })
    .finally(() => {
      inFlightRequests.delete(source);
    });

  inFlightRequests.set(source, request);
  return request;
}

export function clearDataLoaderCache() {
  inFlightRequests.clear();
  successfulResults.clear();
}
