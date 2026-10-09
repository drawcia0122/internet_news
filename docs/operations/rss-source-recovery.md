# RSS source recovery, 2026-10-09

## Verified baseline

[Scheduled run 37863774127](https://github.com/drawcia0122/internet_news/actions/runs/37863774127)
completed successfully with 44/51 feeds. Five endpoints returned 404, Comic Natalie
returned 405, and Collabo Cafe returned a non-RSS response. Partial collection and
archive preservation continue to apply; a successful workflow does not mean every
publisher feed is healthy.

## Netorabo restoration

- Old configured URL: `https://nlab.itmedia.co.jp/rss/index.rdf` (404)
- Verified replacement: `https://news.yahoo.co.jp/rss/media/it_nlab/all.xml`
- [Yahoo publisher listing](https://news.yahoo.co.jp/media/it_nlab) identifies ねとらぼ
- Feed channel title: `ねとらぼ - Yahoo!ニュース`; channel link points to that publisher listing
- Check at 2026-10-09 01:29 UTC: HTTP 200, 50 items; newest item timestamp 01:20 UTC
- Existing collector parsed all 50 articles from that captured response

The stable `netorabo` ID, publisher `source`, editorial metadata and priority remain.
`sourceName` explicitly includes Yahoo!ニュース. Articles link to their syndicated
Yahoo pages because this RSS does not supply original publisher article URLs; do
not invent those URLs. Yahoo article `source` tracking is ignored only for 40-character Yahoo article
IDs, preventing RSS/clean URL variants from counting as two sources. Meaningful
queries elsewhere remain intact. Distributor attribution does not grant Netorabo
the Yahoo editorial authority bonus. Archive, summary and thumbnail safeguards
remain unchanged. Yahoo proxy images are still rejected by the
existing thumbnail policy and metadata enrichment remains responsible for approved
image candidates.

Do not substitute `https://rss.itmedia.co.jp/rss/2.0/netlab.xml` just because it
returns HTTP 200: on this check its channel timestamp was current but all 20 article
timestamps were 2025-05-26. Check article dates, not only channel dates.

## Unresolved original sources

| Source | Configured endpoint result | Investigation / restriction |
| --- | --- | --- |
| Famitsu | 404 | Current homepage does not advertise a feed; no verified publisher feed replacement |
| Animate Times | 404 | Current homepage does not advertise a feed; standard `/feed/` also 404 |
| Pokémon official | 404 | Current homepage does not advertise a feed; no verified publisher feed replacement |
| Comic Natalie | 405 | Known `/comic/feed/news` also returns 405; do not bypass publisher restrictions |
| Real Escape Game | 404 | News page advertises `/atom.xml`, but that URL returns a sitemap, not Atom |
| Collabo Cafe | Invalid RSS | `/feed/` returns HTTP 200 with an empty body; homepage request returned 403 |

All six definitions stay present. No alternative hosts, access-control workarounds,
unofficial feed generators, or fabricated success counts were added. The next real
scheduled refresh must verify recovery in GitHub Actions; a local feed check alone
cannot guarantee the same availability there.
