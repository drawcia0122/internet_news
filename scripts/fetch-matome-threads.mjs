import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMatomeThreads } from '../lib/matome-aggregator.mjs';

const DEFAULT_OUTPUT = fileURLToPath(new URL('../data/matome-threads.json', import.meta.url));

export async function refreshMatomeThreads({ outputPath = DEFAULT_OUTPUT, ...options } = {}) {
  let previous = {};
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const payload = await collectMatomeThreads({ previous, ...options });
  // First-run total failure is never a successful empty snapshot.
  if (payload.status === 'unavailable' && !payload.items.length) {
    console.warn('[matome] No usable feed articles; existing snapshot left unchanged.');
    return { payload, written: false };
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
  console.log(`[matome] ${payload.items.length} articles; ${payload.sources.filter((source) => source.status === 'ok').length}/${payload.sources.length} feeds; ${payload.status}`);
  for (const source of payload.sources.filter((item) => item.status === 'error')) console.warn(`[matome] ${source.id}: ${source.error}; retained ${source.retainedCount}`);
  return { payload, written: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await refreshMatomeThreads();
