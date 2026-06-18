import './fetch-trend-topics.mjs';
import './fetch-events.mjs';
import './fetch-adult-trends.mjs';
import { repairThumbnails } from './repair-thumbnails.mjs';

if (process.env.REPAIR_THUMBNAILS === '1') {
  await repairThumbnails();
}
