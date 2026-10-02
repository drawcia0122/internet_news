// Local display choices only; never used by the collector or factual-news sections.
export const MATOME_PREFERENCES_KEY = 'internet-news-matome-preferences-v1';
export const MATOME_PREFERENCES_VERSION = 1;
export const MATOME_DEFAULT_CATEGORY_ORDER = Object.freeze(['game', 'anime', 'chat', 'neta']);
const CATEGORY_IDS = new Set(MATOME_DEFAULT_CATEGORY_ORDER);
const SOURCE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/iu;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Only IDs from the current, validated payload may hide sources. */
export function normalizeMatomePreferences(value, sourceIds = []) {
  const valid = isRecord(value) && value.version === MATOME_PREFERENCES_VERSION;
  const order = valid && Array.isArray(value.categoryOrder) ? value.categoryOrder : [];
  const categoryOrder = [...new Set(order.slice(0, 100).filter((id) => CATEGORY_IDS.has(id)))];
  for (const id of MATOME_DEFAULT_CATEGORY_ORDER) {
    if (!categoryOrder.includes(id)) categoryOrder.push(id);
  }
  const allowedSources = new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .slice(0, 100).filter((id) => typeof id === 'string' && SOURCE_ID.test(id)));
  const hidden = valid && Array.isArray(value.hiddenSourceIds) ? value.hiddenSourceIds : [];
  const hiddenSourceIds = [...new Set(hidden.slice(0, 100).filter((id) => allowedSources.has(id)))];
  return { version: MATOME_PREFERENCES_VERSION, categoryOrder, hiddenSourceIds };
}

/** Storage access may throw even while retrieving the browser's storage object. */
export function loadMatomePreferences(sourceIds = [], windowRef = globalThis.window) {
  let text;
  try {
    text = windowRef.localStorage.getItem(MATOME_PREFERENCES_KEY);
  } catch {
    return { preferences: normalizeMatomePreferences(null), raw: null, status: 'unavailable' };
  }
  if (text === null) return { preferences: normalizeMatomePreferences(null), raw: null, status: 'missing' };
  try {
    if (typeof text !== 'string' || text.length > 20000) throw new Error('Invalid preferences');
    const raw = JSON.parse(text);
    if (!isRecord(raw) || raw.version !== MATOME_PREFERENCES_VERSION) throw new Error('Unknown preferences');
    return { preferences: normalizeMatomePreferences(raw, sourceIds), raw, status: 'loaded' };
  } catch {
    return { preferences: normalizeMatomePreferences(null), raw: null, status: 'invalid' };
  }
}

export function saveMatomePreferences(value, sourceIds = [], windowRef = globalThis.window) {
  const preferences = normalizeMatomePreferences(value, sourceIds);
  try {
    windowRef.localStorage.setItem(MATOME_PREFERENCES_KEY, JSON.stringify(preferences));
    return { preferences, saved: true };
  } catch {
    return { preferences, saved: false };
  }
}

export function resetMatomePreferences(windowRef = globalThis.window) {
  const preferences = normalizeMatomePreferences(null);
  try {
    windowRef.localStorage.removeItem(MATOME_PREFERENCES_KEY);
    return { preferences, saved: true };
  } catch {
    return { preferences, saved: false };
  }
}
