import { readImageTagAttributes } from './thumbnail-utils.mjs';

function findCharset(value = '') {
  return value.match(/\bcharset\s*=\s*["']?([\w-]+)/i)?.[1] || '';
}

export async function readPublisherHtml(response) {
  // Fetch's text() always reads as UTF-8. Some publishers still declare
  // Japanese legacy encoding only in their HTML metadata.
  if (typeof response.arrayBuffer !== 'function') return response.text();
  const bytes = new Uint8Array(await response.arrayBuffer());
  let charset = findCharset(response.headers?.get('content-type') || '');
  if (!charset) {
    // The encoding declaration itself is ASCII. Only inspect the beginning.
    const prefix = new TextDecoder().decode(bytes.subarray(0, 8192));
    for (const tag of prefix.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = readImageTagAttributes(tag[0]);
      charset = attrs.charset || (attrs['http-equiv']?.toLowerCase() === 'content-type' ? findCharset(attrs.content) : '');
      if (charset) break;
    }
  }
  if (/^(?:shift[-_]jis|sjis|windows-31j|ms_kanji|euc[-_]jp|x-euc-jp)$/i.test(charset)) {
    try { return new TextDecoder(charset.replace(/^euc_jp$/i, 'euc-jp')).decode(bytes); } catch { /* Preserve UTF-8 fallback. */ }
  }
  return new TextDecoder().decode(bytes);
}
