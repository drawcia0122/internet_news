import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublisherHtml } from '../lib/publisher-html.mjs';
import { repairItemThumbnail } from '../scripts/repair-thumbnails.mjs';

const title = '「名ばかりFDE」を見抜けるか？ 依頼検討時に確認したい10項目';
const jpeg = 'https://image.example.org/article-123.jpg';
const shiftJis = Buffer.from('817596bc82ce82a982e8464445817682f08ca994b282af82e982a981482088cb978a8c9f93a28e9e82c98a6d944682b582bd82a231308d8096da', 'hex');
const eucJp = Buffer.from('a1d6ccbea4d0a4aba4ea464445a1d7a4f2b8abc8b4a4b1a4eba4aba1a920b0cdcdeab8a1c6a4bbfea4cbb3cec7a7a4b7a4bfa4a43130b9e0ccdc', 'hex');

function publisherResponse(text, meta = '', contentType = 'text/html') {
  return new Response(Buffer.concat([
    Buffer.from('<head>' + meta + '<meta property="og:title" content="'),
    text,
    Buffer.from('"><meta property="og:image" content="' + jpeg + '"></head>'),
  ]), { headers: { 'content-type': contentType } });
}

test('recovers a genuine article image when Shift_JIS is declared only in HTML', async () => {
  const response = publisherResponse(shiftJis, '<meta http-equiv="content-type" content="text/html;charset=shift_jis">');
  const item = { title, sourceUrl: 'https://example.org/article/123' };
  const html = await readPublisherHtml(response);
  assert.ok(html.includes(title));
  assert.equal(await repairItemThumbnail(item, { fetchHtml: async () => html }), jpeg);
  assert.equal(await repairItemThumbnail({ ...item, title: 'まったく違う手芸の話' }, { fetchHtml: async () => html }), null);
});

test('decodes an EUC-JP response header and retains normal UTF-8 behavior', async () => {
  assert.ok((await readPublisherHtml(publisherResponse(eucJp, '', 'text/html; charset=EUC-JP'))).includes(title));
  assert.ok((await readPublisherHtml(publisherResponse(Buffer.from(title), '<meta charset="UTF-8">'))).includes(title));
});
