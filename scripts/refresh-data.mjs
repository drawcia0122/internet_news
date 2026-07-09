import './fetch-trend-topics.mjs';
import './fetch-events.mjs';
import './fetch-adult-trends.mjs';
import './build-today-internet.mjs';
import { repairThumbnails } from './repair-thumbnails.mjs';

const DEFAULT_REPAIR_TARGETS = [
  'data/news-archive.json',
  'data/home-topics.json',
  'data/trend-topics-browse.json',
];

await repairThumbnails(process.env.REPAIR_THUMBNAILS === '1' ? [] : DEFAULT_REPAIR_TARGETS);
