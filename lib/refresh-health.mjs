import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isEventInCollectionWindow, japanToday } from './event-source-utils.mjs';
import { sanitizeThumbnailUrl } from './thumbnail-utils.mjs';
import { restoreArchivedThumbnails } from '../scripts/repair-thumbnails.mjs';

// A half-hour schedule can be delayed. Warn only after six missed intervals.
export const HEALTH_THRESHOLDS = Object.freeze({
  staleHours: 3,
  comparisonMaxAgeHours: 24,
  minimumCount: 20,
  countDropFraction: 0.5,
  catastrophicDropFraction: 0.9,
  imageCoverageDrop: 0.25,
});

const TREND_FILES = [
  'trend-topics.json', 'trend-topics-archive.json', 'trend-topics-browse.json',
  'news-archive.json', 'home-news.json', 'home-topics.json', 'daily-brief.json', 'adult-news.json',
];
export const REFRESH_STAGE_FILES = Object.freeze({
  trend: TREND_FILES,
  events: ['events.json'],
  adult: ['adult-trends.json', 'adult-trends-archive.json', 'adult-features.json', 'adult-rank-history.json'],
  'today-internet': ['today-internet.json', 'today-internet-debug.json', 'today-internet-history.json',
    'topic-external-signal-cache.json', 'topic-external-signal-cache-top.json'],
  'thumbnail-repair': TREND_FILES,
  matome: ['matome-threads.json'],
});
const AUXILIARY_FILES = new Set([
  'adult-rank-history.json', 'today-internet-debug.json', 'today-internet-history.json',
  'topic-external-signal-cache.json', 'topic-external-signal-cache-top.json',
]);
const OPTIONAL_FILES = new Set(['topic-external-signal-cache.json', 'topic-external-signal-cache-top.json']);
const ARRAY_FILES = new Set(['adult-trends.json', 'adult-trends-archive.json', 'adult-features.json']);
const HOME_PAGE = /^home-news-page-\d+\.json$/;
const HOUR = 60 * 60 * 1000;

function timestamp(value) {
  const time = typeof value === 'string' && value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}
function imagePresent(item) {
  return Boolean(sanitizeThumbnailUrl(item?.thumbnailUrl) || sanitizeThumbnailUrl(item?.thumbnail));
}
function issue(code, file, message, severity = 'warning') {
  return { code, file, severity, message };
}
function parse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
function itemsFor(file, payload) {
  if (file === 'today-internet.json') return payload?.selectedTopic ? [payload.selectedTopic] : [];
  return ARRAY_FILES.has(file) ? payload : payload?.items;
}
function dataTime(file, payload, items) {
  if (!ARRAY_FILES.has(file)) return payload?.generatedAt ?? null;
  const values = items.map((item) => item.fetchedAt ?? item.updatedAt).filter((value) => timestamp(value) !== null);
  return values.sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null;
}
function eligibleItems(file, items, now) {
  if (file === 'events.json') return items.filter((item) => isEventInCollectionWindow(item, { today: japanToday(now) }));
  return items;
}

export function inspectDataset(file, payload, { now = new Date() } = {}) {
  const items = itemsFor(file, payload);
  const issues = [];
  if (!payload || typeof payload !== 'object' || !Array.isArray(items)
      || items.some((item) => !item || typeof item !== 'object' || !String(item.title ?? '').trim())) {
    issues.push(issue('invalid_dataset', file, `${file}: missing/invalid article list or title`, 'error'));
    return { file, valid: false, generatedAt: null, itemCount: 0, thumbnailCount: 0, thumbnailCoverage: 0, stale: true, issues };
  }
  if (file === 'adult-trends.json' && !items.length) issues.push(issue('empty_collection', file, `${file}: no current items were collected`, 'error'));
  const generatedAt = dataTime(file, payload, items);
  const generatedTime = timestamp(generatedAt);
  // Empty array-shaped feeds have no envelope timestamp. Their attempt is recorded separately.
  if ((generatedTime === null && (!ARRAY_FILES.has(file) || items.length)) || generatedTime > now.getTime() + HOUR) {
    issues.push(issue('invalid_timestamp', file, `${file}: missing, invalid or future generation timestamp`, 'error'));
  }
  const stale = generatedTime !== null && now.getTime() - generatedTime > HEALTH_THRESHOLDS.staleHours * HOUR;
  if (stale) issues.push(issue('stale_data', file, `${file}: last data timestamp ${generatedAt} is more than ${HEALTH_THRESHOLDS.staleHours} hours old`));
  const thumbnailCount = items.filter(imagePresent).length;
  const activeItems = eligibleItems(file, items, now);
  const activeThumbnailCount = activeItems.filter(imagePresent).length;
  const failedSources = (Array.isArray(payload.sourceDiagnostics) ? payload.sourceDiagnostics : Array.isArray(payload.sources) ? payload.sources : [])
    .filter((source) => ['failed', 'error'].includes(source?.status)).length;
  if (failedSources) issues.push(issue('source_failures', file, `${file}: ${failedSources} source(s) failed; source-level fallback may be in use`));
  if (payload.collectionSummary?.failedSources) {
    issues.push(issue('source_failures', file, `${file}: ${payload.collectionSummary.failedSources}/${payload.collectionSummary.totalSources} RSS sources failed`));
  }
  return {
    file, valid: !issues.some((entry) => entry.severity === 'error'), generatedAt,
    itemCount: items.length, thumbnailCount, thumbnailCoverage: items.length ? thumbnailCount / items.length : 0,
    activeItemCount: activeItems.length,
    activeThumbnailCoverage: activeItems.length ? activeThumbnailCount / activeItems.length : 0,
    fetchedCount: Number.isFinite(payload.collectionSummary?.fetchedCount) ? payload.collectionSummary.fetchedCount : null,
    stale, issues,
  };
}

export function compareDatasets(file, previous, current, { now = new Date() } = {}) {
  const before = inspectDataset(file, previous, { now });
  const after = inspectDataset(file, current, { now });
  const issues = [...after.issues];
  if (!before.valid || !after.valid) return { ...after, issues };
  const beforeTime = timestamp(before.generatedAt);
  const afterTime = timestamp(after.generatedAt);
  if (beforeTime !== null && afterTime !== null && afterTime < beforeTime) {
    issues.push(issue('timestamp_regressed', file, `${file}: generation time moved backwards (${before.generatedAt} -> ${after.generatedAt})`, 'error'));
  }
  // Do not freeze a legitimately changed feed when the last baseline is days old.
  const recentBaseline = beforeTime !== null && now.getTime() - beforeTime <= HEALTH_THRESHOLDS.comparisonMaxAgeHours * HOUR;
  if (recentBaseline) {
    for (const [label, oldCount, newCount] of [
      ['item', before.activeItemCount, after.activeItemCount],
      ['fetched', before.fetchedCount, after.fetchedCount],
    ]) {
      if (oldCount === null || newCount === null || oldCount < HEALTH_THRESHOLDS.minimumCount) continue;
      const decline = 1 - newCount / oldCount;
      if (decline >= HEALTH_THRESHOLDS.countDropFraction) {
        issues.push(issue(`${label}_count_drop`, file,
          `${file}: ${label} count fell ${oldCount} -> ${newCount} (${Math.round(decline * 100)}%)`,
          decline >= HEALTH_THRESHOLDS.catastrophicDropFraction ? 'error' : 'warning'));
      }
    }
    // A small optional section can genuinely be empty. Protect empty replacements
    // only when the recent baseline is large enough to be meaningful.
    if (before.activeItemCount >= HEALTH_THRESHOLDS.minimumCount && after.activeItemCount >= HEALTH_THRESHOLDS.minimumCount
        && before.activeThumbnailCoverage - after.activeThumbnailCoverage >= HEALTH_THRESHOLDS.imageCoverageDrop) {
      issues.push(issue('thumbnail_loss', file,
        `${file}: usable thumbnail coverage fell ${Math.round(before.activeThumbnailCoverage * 100)}% -> ${Math.round(after.activeThumbnailCoverage * 100)}%`));
    }
  }
  return { ...after, valid: !issues.some((entry) => entry.severity === 'error'), issues };
}

async function readSnapshot(directory, name) {
  const filenames = await readdir(directory).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  const selected = new Set(REFRESH_STAGE_FILES[name]);
  if (name === 'trend' || name === 'thumbnail-repair') filenames.filter((file) => HOME_PAGE.test(file)).forEach((file) => selected.add(file));
  const snapshot = new Map();
  for (const file of selected) {
    try { snapshot.set(file, await readFile(join(directory, file), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return snapshot;
}
async function atomicWrite(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  try { await writeFile(temporary, value, 'utf8'); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}
async function preserveArticleImages(directory, snapshot, previous) {
  let restored = 0;
  for (const [file, raw] of snapshot) {
    if (!TREND_FILES.includes(file) && !HOME_PAGE.test(file)) continue;
    const payload = parse(raw);
    const old = parse(previous.get(file));
    if (!Array.isArray(payload?.items) || !Array.isArray(old?.items)) continue;
    const count = restoreArchivedThumbnails(payload.items, old.items);
    if (!count) continue;
    restored += count;
    const updated = `${JSON.stringify(payload, null, 2)}\n`;
    await atomicWrite(join(directory, file), updated);
    snapshot.set(file, updated);
  }
  return restored;
}
async function restoreSnapshot(directory, name, snapshot) {
  const current = await readSnapshot(directory, name);
  for (const file of current.keys()) if (!snapshot.has(file)) await rm(join(directory, file));
  for (const [file, raw] of snapshot) await atomicWrite(join(directory, file), raw);
}

function inspectSnapshot(name, snapshot, previous, now) {
  const datasets = {};
  const issues = [];
  for (const file of new Set([...REFRESH_STAGE_FILES[name], ...snapshot.keys()])) {
    if (!snapshot.has(file) && OPTIONAL_FILES.has(file)) continue;
    const payload = parse(snapshot.get(file));
    if (AUXILIARY_FILES.has(file)) {
      if (!payload || typeof payload !== 'object') issues.push(issue('invalid_json', file, `${file}: missing or invalid generated JSON`, 'error'));
      continue;
    }
    const assessment = compareDatasets(file, parse(previous.get(file)), payload, { now });
    // Pagination tail size naturally changes; compare the primary dataset/archive instead.
    if (HOME_PAGE.test(file)) assessment.issues = assessment.issues.filter((entry) => !['item_count_drop', 'thumbnail_loss'].includes(entry.code));
    datasets[file] = assessment;
    issues.push(...assessment.issues);
  }
  // A removed tail page is fine; a live nextPage link to a missing page is not.
  if (snapshot.has('home-news.json')) {
    const visited = new Set();
    let filename = 'home-news.json';
    while (filename) {
      if (visited.has(filename) || !snapshot.has(filename)) {
        issues.push(issue('broken_pagination', 'home-news.json', `home-news.json: missing or cyclic page ${filename}`, 'error'));
        break;
      }
      visited.add(filename);
      const payload = parse(snapshot.get(filename));
      filename = payload?.hasMore ? `home-news-page-${payload.nextPage}.json` : null;
    }
  }
  return { datasets, issues };
}

function emitIssue(entry, logger) {
  const message = `[refresh:health] ${entry.message}`;
  const level = entry.severity === 'error' ? 'error' : 'warning';
  const escaped = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  logger.warn(`::${level}::${escaped}`);
}

export function formatHealthSummary(report) {
  const lines = ['## Refresh health', '', `Result: **${report.status}** · Checked: ${report.checkedAt}`, '',
    '| Stage | Result |', '| --- | --- |', ...report.stages.map((stage) => `| ${stage.name} | ${stage.status} |`), '',
    '| Dataset | Last data timestamp | Items | Thumbnails | Retained |', '| --- | --- | ---: | ---: | --- |',
    ...Object.entries(report.datasets).filter(([file]) => !HOME_PAGE.test(file)).map(([file, data]) =>
      `| ${file} | ${data.generatedAt ?? 'unknown'} | ${data.itemCount} | ${Math.round(data.thumbnailCoverage * 100)}% | ${data.retained ? 'yes' : 'no'} |`), '',
    ...report.issues.map((entry) => `- ${entry.severity}: ${entry.message.replaceAll('\n', ' ').replaceAll('|', '\\|')}`), '',
    'checkedAt is the attempt time, not a successful fetch time. Retained data keeps its original timestamp.', ''];
  return lines.join('\n');
}

export async function runGuardedRefresh(stages, {
  dataDirectory = 'data', now = () => new Date(), logger = console,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  await mkdir(dataDirectory, { recursive: true });
  const report = { schemaVersion: 1, checkedAt: now().toISOString(), status: 'ok', thresholds: HEALTH_THRESHOLDS, stages: [], datasets: {}, issues: [] };
  let failure;
  try {
    for (const { name, run } of stages) {
      if (!REFRESH_STAGE_FILES[name]) throw new Error(`Unknown refresh stage: ${name}`);
      const before = await readSnapshot(dataDirectory, name);
      const stage = { name, status: 'ok', startedAt: now().toISOString(), completedAt: null };
      report.stages.push(stage);
      logger.log(`[refresh] ${name}:start`);
      try {
        await run();
        const after = await readSnapshot(dataDirectory, name);
        const restoredImages = await preserveArticleImages(dataDirectory, after, before);
        if (restoredImages) report.issues.push(issue('thumbnails_restored', null, `${name}: restored ${restoredImages} usable thumbnail(s) for the exact same article`));
        const checked = inspectSnapshot(name, after, before, now());
        const rejected = checked.issues.some((entry) => entry.severity === 'error');
        if (rejected) {
          await restoreSnapshot(dataDirectory, name, before);
          const baseline = inspectSnapshot(name, before, before, now());
          if (baseline.issues.some((entry) => entry.severity === 'error')) {
            const error = new Error(`${name}: invalid generated data and no complete usable previous snapshot`);
            error.healthIssues = checked.issues;
            throw error;
          }
          stage.status = 'retained';
          report.issues.push(...checked.issues);
          for (const [file, data] of Object.entries(baseline.datasets)) {
            report.datasets[file] = { ...data, retained: true, issues: checked.datasets[file]?.issues ?? data.issues };
          }
        } else {
          const unchanged = name !== 'thumbnail-repair' && [...after].every(([file, raw]) => before.get(file) === raw);
          if (unchanged) stage.status = 'retained';
          report.issues.push(...checked.issues);
          for (const [file, data] of Object.entries(checked.datasets)) {
            report.datasets[file] = { ...data, retained: unchanged || Boolean(report.datasets[file]?.retained) };
          }
        }
        if (stage.status === 'retained') report.issues.push(issue('previous_data_retained', null, `${name}: previous usable data preserved; original timestamps retained`));
        logger.log(`[refresh] ${name}:${stage.status === 'retained' ? 'retained' : 'complete'}`);
      } catch (error) {
        // Restore the complete stage, including deleted pages and new files.
        // A usable prior group permits later stages and publication of diagnostics;
        // uninitialized or already-invalid groups still fail closed.
        await restoreSnapshot(dataDirectory, name, before);
        const baseline = inspectSnapshot(name, before, before, now());
        for (const [file, data] of Object.entries(baseline.datasets)) report.datasets[file] = { ...data, retained: before.has(file) };
        const usable = !baseline.issues.some((entry) => entry.severity === 'error');
        stage.status = usable ? 'retained' : 'failed';
        report.issues.push(...(error.healthIssues ?? []), ...baseline.issues,
          issue('stage_failed', null, `${name}: failed; previous files restored (${String(error.message).slice(0, 300)})`, usable ? 'warning' : 'error'));
        logger.error(`[refresh] ${name}:${stage.status}`);
        if (!usable) throw error;
      } finally {
        stage.completedAt = now().toISOString();
      }
    }
  } catch (error) { failure = error; }
  // Include datasets from stages not reached after a fatal failure, so status
  // consumers can still show their actual data ages.
  for (const name of Object.keys(REFRESH_STAGE_FILES)) {
    const snapshot = await readSnapshot(dataDirectory, name);
    for (const [file, raw] of snapshot) {
      if (AUXILIARY_FILES.has(file) || report.datasets[file]) continue;
      const data = inspectDataset(file, parse(raw), { now: now() });
      report.datasets[file] = { ...data, retained: false };
      report.issues.push(...data.issues);
    }
  }
  report.issues = [...new Map(report.issues.map((entry) => [`${entry.code}:${entry.file}:${entry.message}`, entry])).values()];
  report.status = failure ? 'failed' : report.issues.length ? 'warning' : 'ok';
  report.checkedAt = now().toISOString();
  await atomicWrite(join(dataDirectory, 'refresh-status.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const entry of report.issues) emitIssue(entry, logger);
  if (summaryPath) await appendFile(summaryPath, formatHealthSummary(report), 'utf8');
  logger.log(`[refresh:health] ${report.status}; ${report.issues.length} diagnostic(s); data/refresh-status.json`);
  if (failure) throw failure;
  return report;
}
