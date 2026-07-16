import { repairThumbnails } from './repair-thumbnails.mjs';

const DEFAULT_REPAIR_TARGETS = [
  'data/news-archive.json',
  'data/home-topics.json',
  'data/trend-topics-browse.json',
];

await runStage('trend', () => import('./fetch-trend-topics.mjs'));
await runStage('events', () => import('./fetch-events.mjs'));
await runStage('adult', () => import('./fetch-adult-trends.mjs'));
await runStage('today-internet', () => import('./build-today-internet.mjs'));
await runStage('thumbnail-repair', () => (
  repairThumbnails(process.env.REPAIR_THUMBNAILS === '1' ? [] : DEFAULT_REPAIR_TARGETS)
));

async function runStage(name, run) {
  console.log(`[refresh] ${name}:start`);
  try {
    await run();
  } catch (error) {
    console.error(`[refresh] ${name}:failed`);
    throw error;
  }
  console.log(`[refresh] ${name}:complete`);
}
