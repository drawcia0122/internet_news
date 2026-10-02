import { readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { repairArticleSummariesInPayload } from '../lib/article-summary-corrections.mjs';

// Deterministic migration of retained snapshots, without fresh fetching or
// reordering. Preserve IDs, categories, thumbnails, publication/refresh times.
export async function repairSummarySnapshots(directory, { logger = console } = {}) {
  let filenames;
  try { filenames = await readdir(directory); }
  catch (error) {
    if (error.code !== 'ENOENT') logger.warn(`[summary:repair] Cannot inspect snapshots: ${error.message}`);
    return 0;
  }
  let changed = 0;
  for (const name of filenames) {
    if (!/^(?:news-archive|trend-topics(?:-archive|-browse)?|home-topics|home-news(?:-page-\d+)?|daily-brief|today-internet)\.json$/.test(name)) continue;
    const path = join(directory, name);
    const temporary = `${path}.summary-repair-${process.pid}.tmp`;
    try {
      const raw = await readFile(path, 'utf8');
      const before = JSON.parse(raw);
      const after = repairArticleSummariesInPayload(before);
      if (JSON.stringify(after) === JSON.stringify(before)) continue;
      await writeFile(temporary, JSON.stringify(after, null, 2) + '\n');
      await rename(temporary, path);
      changed += 1;
    } catch (error) {
      // Let the guarded normal stage regenerate malformed/unavailable data and
      // record its diagnostics. The original snapshot is never partly written.
      logger.warn(`[summary:repair] Skipping ${name}: ${error.message}`);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  return changed;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Repaired ${await repairSummarySnapshots(fileURLToPath(new URL('../data/', import.meta.url)))} summary snapshots.`);
}
