import { repairThumbnails } from './repair-thumbnails.mjs';
import { runGuardedRefresh } from '../lib/refresh-health.mjs';

const DEFAULT_REPAIR_TARGETS = [
  'data/news-archive.json',
  'data/home-topics.json',
  'data/trend-topics-browse.json',
];

// Keep dependent stages sequential, including thumbnail consumer synchronization.
await runGuardedRefresh([
  { name: 'trend', run: () => import('./fetch-trend-topics.mjs') },
  { name: 'events', run: () => import('./fetch-events.mjs') },
  { name: 'adult', run: () => import('./fetch-adult-trends.mjs') },
  { name: 'today-internet', run: () => import('./build-today-internet.mjs') },
  { name: 'thumbnail-repair', run: () => repairThumbnails(process.env.REPAIR_THUMBNAILS === '1' ? [] : DEFAULT_REPAIR_TARGETS) },
  { name: 'matome', run: async () => (await import('./fetch-matome-threads.mjs')).refreshMatomeThreads() },
]);
