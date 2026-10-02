# Article metadata must remain scoped to article identity

- Status: active
- Created: 2026-08-20
- Last verified: 2026-09-14
- Source task: PR #14; C-003

## Lesson

title、summary、description、thumbnail、URL、sourceは同じ記事identityに属する必要がある。metadata fetch結果を配列index、直前の成功値、topic内の無条件なbest resultで別記事へ転用しない。URL / canonical URLを正規化したkeyが一致するarticleまたはsourceSignalにだけmetadataを適用する。

生成側を第一防御とし、archive merge・dedupe後もidentityを保つ。表示側では、title/contextと整合しないsummaryと、identityが異なる複数記事に完全一致するsummaryを非表示にする。整合を証明できない要約は、別記事の文章を表示するより空にする。

取得先のno-result、HTTP error、access restriction、bot challenge等の画面文言もarticle summaryではない。error画面が検索対象titleを本文へ含むとtitle alignmentだけでは通過するため、`isInvalidArticleSummary()`で文全体が既知のerror shellかを先に判定し、生成・archive/cache normalization・表示の全経路で同じ判定を使う。記事本文内でerror文言を引用する正常summaryまで除外しない。

## Root cause pattern

複数candidate URLから取得したmetadataを単一のbest valueとして保持し、sourceSignalへ記事key確認なしで反映すると、並び替えや取得失敗を境に別記事のsummaryが混入する。cacheも同じidentity条件が必要。

## Evidence

- `news-summary-integrity.js`: `canonicalArticleUrl()`、identity keys、title alignment、collection sanitization
- `scripts/fetch-trend-topics.mjs`: `registerFetchedMetadata()`、`findFetchedMetadata()`、`sanitizeFetchedMetadata()`、archive merge / dedupe
- `shared-topic-utils.js`: client normalization前のsummary sanitization
- `tests/news-summary-integrity.test.mjs`: identity 6件とinvalid-summary経路を含む16 regression cases
- Commit `14a40dc7`; PR #14; merge `4ba96d72`

## Reverification

最低限、無関係な重複summary、前記事からの継承、canonical URL一致、不一致URL拒否、並び替え、dedupe、正常summary維持を確認する。単純な主要語一致だけで正常summaryを大量に落とさない。

## Aggregator primary-story provenance (2026-10-02)

- A Yahoo pickup's first/highest-scoring outbound article can be an access-ranking recommendation. `6597306` points to Sportsnavi volleyball, but the old URL scan selected a judo article containing the same country names. Shared words such as 日本 / 中国 are not evidence of article identity.
- Resolve Yahoo nested content only from `topicsDetail` when its pickup ID, URL and title match the requested page. Other nested links require one unambiguous same-headline anchor. Never rank arbitrary script URLs or sidebar links as candidate articles. Reject a known different page title even when the description shares keywords.
- Aggregator wrappers may use a short, valid page-level description (the verified volleyball synopsis is 28 characters). Keep descriptions from 20 characters; do not replace missing text with generic main/sidebar paragraphs. Exclude script and blockquote paragraphs from publisher narrative extraction.
- Decode escaped HTML and remove complete/truncated tags before summary truncation; enforce plain text in stored normalization and shared integrity sanitation. Known persisted errors require narrowly source/title/signature-matched repair, not a guessed replacement summary.
- `scripts/repair-summary-snapshots.mjs` migrates retained summary text without altering identity, counts, category, thumbnail, ordering or timestamps. `refresh-data.mjs` runs it before health-guard fallback capture, so a failed fetch cannot restore the known contaminated snapshot.

Evidence: `tests/article-metadata-identity.test.mjs`; original [volleyball pickup](https://news.yahoo.co.jp/pickup/6597306), [Sportsnavi main story](https://sports.yahoo.co.jp/volley/japan/competitions/5001/game/2620/point), [baseball Expert article](https://news.yahoo.co.jp/expert/articles/32e047893c67efce237c3eb2b84fbacbeb2d2b77).

## Retained synopsis during an empty refresh (2026-10-02)

The first real refresh of the source-identity fix (`37036321588`, generated `35882f4`) proved HTML cleanup and volleyball identity, but fresh RSS with an empty summary overwrote the previously repaired baseball commentary in `mergeArchiveItems`. Summary sanitation cannot recover text after an unconditional object spread discards it. Retain validated previous text only when both the primary article URL and full normalized headline are unchanged; an ID, search link, or grouped secondary source alone is insufficient. Apply the same rule to matching source signals. Fresh valid text still takes priority, and title changes prevent fallback. `tests/news-summary-retention.test.mjs` covers the observed repair → normalization → merge → archive → home-consumer path, plus negative identity cases.
