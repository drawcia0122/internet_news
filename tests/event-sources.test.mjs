import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  extractParcoArtItems, extractParcoCafeItems, parseExplicitEventRange,
  selectMiraikanEntries, buildMiraikanItem, collectSourcesWithFallback,
  balanceEventsBySource, isPureSalesCampaign, japanToday, isEventInCollectionWindow,
} from "../lib/event-source-utils.mjs";

const fixture = (name) => readFile(new URL(`./fixtures/events/${name}`, import.meta.url), "utf8");

test("PARCO ART extracts official dates, named venue, absolute image, and event-specific tags", async () => {
  const items = extractParcoArtItems(await fixture("parco-art.html"));
  assert.equal(items.length, 4); // Unknown 'その他' venue is excluded.
  const pond = items.find((item) => item.title === "P.O.N.D. 2026");
  assert.equal(pond.startDate, "2026-10-02");
  assert.equal(pond.endDate, "2026-10-19");
  assert.equal(pond.location, "東京都渋谷区");
  assert.equal(pond.officialUrl, "https://art.parco.jp/museumtokyo/detail/?id=2021");
  assert.ok(pond.thumbnailUrl.startsWith("https://art.parco.jp/"));
  assert.deepEqual(pond.tags, ["exhibition", "tokyo"]);
  assert.ok(items.find((item) => item.title.startsWith("SONIC")).tags.includes("game"));
  const popup = items.find((item) => item.title.includes("呪術廻戦"));
  assert.equal(popup.category, "ポップアップ");
  assert.equal(popup.location, "静岡県静岡市");
  assert.ok(popup.tags.includes("anime"));
  assert.ok(!popup.tags.includes("pokemon"));
  assert.equal(items.find((item) => item.title.startsWith("パンダ")).endDate, "2027-01-31");
});

test("PARCO adapters fail closed on blocked pages, malformed dates, and external detail links", async () => {
  assert.throws(() => extractParcoArtItems("<h1>Access denied</h1>"), /markup/);
  assert.throws(() => extractParcoCafeItems("<h1>Site unavailable</h1>"), /markup/);
  const html = await fixture("parco-art.html");
  assert.equal(extractParcoArtItems(html.replaceAll('href="/', 'href="https://unrelated.example/')).length, 0);
  const datesBroken = html.replaceAll(/202[67]\/\d{2}\/\d{2}/g, "開催予定");
  assert.equal(extractParcoArtItems(datesBroken).length, 0);
  const genericTokyo = html.replace("PARCO MUSEUM TOKYO</span>", "UNKNOWN TOKYO VENUE</span>");
  assert.equal(extractParcoArtItems(genericTokyo)[0].location, "東京都");
});

test("explicit ranges validate calendar dates and never guess a missing start year", () => {
  assert.deepEqual(parseExplicitEventRange("2026.12.18(金) - 1.3(日)"), { startDate: "2026-12-18", endDate: "2027-01-03" });
  assert.deepEqual(parseExplicitEventRange("2026年10月2日（金）～2026年11月9日（月）"), { startDate: "2026-10-02", endDate: "2026-11-09" });
  for (const text of ["10/2～11/9", "2026.2.29 - 3.1", "2026.10.31 - 10.1", "2026.10.2 開催予定", "2023.11.16(木)グランドオープン～開催中"]) {
    assert.equal(parseExplicitEventRange(text), null, text);
  }
});

test("PARCO CAFE uses the card period and venue header, excluding permanent restaurants", async () => {
  const items = extractParcoCafeItems(await fixture("parco-cafe.html"));
  assert.equal(items.length, 1);
  assert.equal(items[0].startDate, "2026-09-18");
  assert.equal(items[0].endDate, "2026-11-03");
  assert.match(items[0].venue, /渋谷PARCO 6F/);
  assert.ok(!items[0].venue.includes("-->"));
  assert.equal(items[0].location, "東京都渋谷区");
  assert.ok(items[0].tags.includes("collab-cafe"));
  assert.ok(items[0].detailUrl.startsWith("https://cafe.parco.jp/event/"));
});

test("Miraikan excludes online, expired, external-partner, and excessively future entries", async () => {
  const payload = JSON.parse(await fixture("miraikan.json"));
  assert.deepEqual(selectMiraikanEntries(payload, "2026-10-02").map((item) => item.id), [4743, 4754]);
  assert.equal(selectMiraikanEntries(payload, "2027-01-01").length, 0);
  assert.equal(selectMiraikanEntries(payload, "2026-01-01").length, 0);
  assert.throws(() => selectMiraikanEntries({ results: [] }), /array/);
  assert.throws(() => selectMiraikanEntries([{ changed: "schema" }]), /shape changed/);
});

test("Miraikan represents sparse sessions by the next actual date, not a continuous range", async () => {
  const payload = JSON.parse(await fixture("miraikan.json"));
  const entry = payload.find((item) => item.id === 4743);
  const html = await fixture("miraikan-detail.html");
  const first = buildMiraikanItem(entry, html, "2026-10-02");
  assert.equal(first.startDate, "2026-10-18");
  assert.equal(first.endDate, "2026-10-18");
  assert.match(first.description, /11月8日/);
  assert.equal(first.location, "東京都江東区");
  assert.ok(first.tags.includes("reservation-required"));
  const next = buildMiraikanItem(entry, html, "2026-10-19");
  assert.equal(next.startDate, "2026-11-08");
  assert.equal(next.endDate, "2026-11-08");
  assert.equal(buildMiraikanItem(entry, html, "2026-11-09"), null);
  assert.throws(() => buildMiraikanItem({ ...entry, title: "Unrelated title" }, html), /identity/);
  assert.throws(() => buildMiraikanItem(entry, html.replace("開催場所", "New venue field")), /venue markup/);
  assert.equal(buildMiraikanItem(entry, html.replace("日本科学未来館3階 ハブスペース", "未定")), null);
});

test("Miraikan off-site event uses the explicit venue, never the museum footer address", async () => {
  const payload = JSON.parse(await fixture("miraikan.json"));
  const item = buildMiraikanItem(payload.find((entry) => entry.id === 4754), await fixture("miraikan-chichibu.html"), "2026-10-02");
  assert.equal(item.location, "埼玉県秩父市内");
  assert.equal(item.startDate, "2026-11-28");
  assert.equal(item.endDate, "2026-11-28");
  assert.ok(!item.tags.includes("tokyo"));
});

test("partial failures preserve only failed source snapshots without fresh verification timestamps", async () => {
  const previous = [
    { title: "Old A", sourceName: "A", sourceCheckedAt: "old" },
    { title: "Old B", sourceName: "B", sourceCheckedAt: "old" },
  ];
  const result = await collectSourcesWithFallback([
    { name: "A", collect: async () => [{ title: "New A", sourceName: "A" }] },
    { name: "B", collect: async () => { throw new Error("503"); } },
  ], previous, { checkedAt: "now" });
  assert.deepEqual(result.items.map((item) => item.title), ["New A", "Old B"]);
  assert.equal(result.items[0].sourceCheckedAt, "now");
  assert.equal(result.items[1].sourceCheckedAt, "old");
  assert.equal(result.allFailed, false);
  assert.equal(result.diagnostics[1].preserved, 1);
  const empty = await collectSourcesWithFallback([{ name: "A", collect: async () => [] }], previous);
  assert.equal(empty.allFailed, true);
  assert.equal(empty.items[0].title, "Old A");
  const knownEmpty = await collectSourcesWithFallback([{ name: "A", collect: async () => [], allowEmpty: true }], previous);
  assert.equal(knownEmpty.items.length, 0);
  assert.equal(knownEmpty.allFailed, false);
});

test("the CLI leaves an existing snapshot byte-for-byte unchanged on total network failure", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "event-source-test-"));
  try {
    await mkdir(join(cwd, "data"));
    const before = JSON.stringify({ generatedAt: "original", items: [{ title: "Existing", sourceName: "PARCO ART" }] }, null, 2) + "\n";
    await writeFile(join(cwd, "data/events.json"), before);
    const preload = "data:text/javascript,globalThis.fetch=async()=>{throw new Error('fixture network unavailable')}";
    const script = fileURLToPath(new URL("../scripts/fetch-events.mjs", import.meta.url));
    execFileSync(process.execPath, ["--import", preload, script], { cwd, stdio: "pipe", env: { ...process.env, TZ: "UTC" } });
    assert.equal(await readFile(join(cwd, "data/events.json"), "utf8"), before);
    await rm(join(cwd, "data/events.json"));
    assert.throws(() => execFileSync(process.execPath, ["--import", preload, script], { cwd, stdio: "pipe" }), /Command failed/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("balanced selection respects global/source caps without losing a small new provider", () => {
  const rows = [];
  for (const source of ["escape", "cafe", "pokemon", "popup", "art"]) {
    for (let i = 0; i < 30; i++) rows.push({ sourceName: source, title: `${source}-${i}` });
  }
  rows.push({ sourceName: "science", title: "science-0" });
  const selected = balanceEventsBySource(rows);
  assert.equal(selected.length, 64);
  assert.ok(selected.some((item) => item.sourceName === "science"));
  const counts = selected.reduce((result, item) => ({ ...result, [item.sourceName]: (result[item.sourceName] || 0) + 1 }), {});
  assert.ok(Object.values(counts).every((count) => count <= 20));
  assert.equal(new Set(selected).size, selected.length);
  assert.deepEqual(balanceEventsBySource(rows, 0), []);
});

test("source-balanced selection prefers explicit Tokyo/Saitama locations within each provider", () => {
  const rows = [
    { sourceName: "art", title: "東京を描く展", location: "大阪府", tags: ["tokyo"] },
    { sourceName: "art", title: "Tokyo art", location: "東京都" },
    { sourceName: "art", title: "Saitama art", location: "埼玉県" },
    { sourceName: "science", title: "Nagoya experience", location: "愛知県" },
  ];
  const selected = balanceEventsBySource(rows, 3, 2);
  assert.deepEqual(selected.map((item) => item.title), ["Tokyo art", "Nagoya experience", "Saitama art"]);
  assert.deepEqual(balanceEventsBySource(rows, 64, 20).map((item) => item.title), ["Tokyo art", "Nagoya experience", "Saitama art", "東京を描く展"]);
  assert.equal(rows[0].title, "東京を描く展");
});

test("the CLI keeps a failed source's last-day item in UTC and JST while removing yesterday", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "event-last-day-test-"));
  try {
    await mkdir(join(cwd, "data"));
    const script = fileURLToPath(new URL("../scripts/fetch-events.mjs", import.meta.url));
    const html = await fixture("parco-art.html");
    const source = "アニメイト Gratte";
    const items = [
      { title: "Ends today", sourceName: source, startDate: "2026-09-01", endDate: "2026-10-02", detailUrl: "https://example.test/today" },
      { title: "Ended yesterday", sourceName: source, startDate: "2026-09-01", endDate: "2026-10-01", detailUrl: "https://example.test/yesterday" },
    ];
    const preload = `const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-10-01T16:00:00Z']))}static now(){return OriginalDate.parse('2026-10-01T16:00:00Z')}};globalThis.fetch=async(url)=>{if(url==='https://art.parco.jp/')return new Response(${JSON.stringify(html)});throw new Error('fixture partial outage')};`;
    for (const TZ of ["UTC", "Asia/Tokyo"]) {
      await writeFile(join(cwd, "data/events.json"), JSON.stringify({ items }));
      execFileSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, script], { cwd, stdio: "pipe", env: { ...process.env, TZ } });
      const result = JSON.parse(await readFile(join(cwd, "data/events.json"), "utf8"));
      assert.ok(result.items.some((item) => item.title === "Ends today"), TZ);
      assert.ok(!result.items.some((item) => item.title === "Ended yesterday"), TZ);
      assert.equal(result.sourceDiagnostics.find((diagnostic) => diagnostic.name === source).preserved, 2);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("Japan calendar-day filtering retains the last day across UTC and JST runners", () => {
  assert.equal(japanToday(new Date("2026-10-01T15:01:00Z")), "2026-10-02");
  assert.equal(japanToday(new Date("2026-10-02T14:59:59Z")), "2026-10-02");
  const options = { today: "2026-10-02" };
  assert.equal(isEventInCollectionWindow({ startDate: "2026-09-01", endDate: "2026-10-02" }, options), true);
  assert.equal(isEventInCollectionWindow({ startDate: "2026-09-01", endDate: "2026-10-01" }, options), false);
  assert.equal(isEventInCollectionWindow({ startDate: "2026-10-02", endDate: "2026-10-02" }, options), true);
  assert.equal(isEventInCollectionWindow({ startDate: "2027-03-01" }, options), false);
  assert.equal(isEventInCollectionWindow({ venue: "オンライン" }, options), false);
});

test("ticket/parking-only promotions are excluded while festivals and collaborations remain", () => {
  for (const title of [
    "【期間限定】年間パス・半年パス特別割引キャンペーン開催！",
    "最大1,800円引き！55歳以上限定！「ジュエルミネーション満喫55(ゴーゴー)パック」販売",
    "遊園地を丸ごと楽しめる駐車場周遊券！", "割引チケット販売",
  ]) assert.equal(isPureSalesCampaign(title), true, title);
  for (const title of ["よみランハロウィン！～Jump in Party 2026～", "ブルーロック×よみうりランド", "リポビタンロケット☆ルナ ダーク・ザ・ライド"]) {
    assert.equal(isPureSalesCampaign(title), false, title);
  }
});
