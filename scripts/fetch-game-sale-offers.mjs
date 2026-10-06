import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectGameSaleOffers } from '../lib/game-sale-offers.mjs';

const DEFAULT_OUTPUT = fileURLToPath(new URL('../data/game-sale-offers.json', import.meta.url));
const DEFAULT_INPUT = fileURLToPath(new URL('../data/trend-topics.json', import.meta.url));

export async function refreshGameSaleOffers({ outputPath = DEFAULT_OUTPUT, inputPath = DEFAULT_INPUT, ...options } = {}) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  if (!Array.isArray(input.items)) throw new Error('Game sale enrichment requires the trend article list');
  let previous = {};
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const payload = await collectGameSaleOffers({ topics: input.items, previous, ...options });
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(temporary, outputPath);
  } finally { await rm(temporary, { force: true }); }
  console.log(`[game-sale-offers] ${payload.items.filter((i) => i.discountPercent > 0).length} discounted games; ${payload.status}`);
  for (const source of payload.sources.filter((s) => s.status === 'error')) console.warn(`[game-sale-offers] ${source.url}: ${source.error}`);
  return { payload, written: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await refreshGameSaleOffers();
