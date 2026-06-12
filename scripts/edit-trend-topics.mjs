import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = createInterface({ input, output });
const filePath = new URL("../data/trend-topics.json", import.meta.url);

const current = await readTopics();
console.log(`Current topic count: ${current.items.length}`);

const count = Number(await rl.question("How many topics do you want to write? (0-5): "));
if (Number.isNaN(count) || count < 0 || count > 5) {
  console.error("Please enter a number between 0 and 5.");
  process.exit(1);
}

const items = [];
for (let index = 0; index < count; index += 1) {
  console.log(`\nTopic ${index + 1}`);
  const category = await rl.question("Category (battle/news/goods): ");
  const title = await rl.question("Title: ");
  const summary = await rl.question("Summary: ");
  const postUrl = await rl.question("X post URL: ");
  const time = await rl.question("Time label (e.g. 42分前): ");
  const posts = await rl.question("Post count label (e.g. 3): ");

  items.push({
    id: `manual-${index + 1}-${Date.now()}`,
    category,
    categoryLabel: categoryLabel(category),
    score: 80 - index * 8,
    color: colorFor(category),
    title,
    summary,
    posts,
    time,
    tweets: [
      {
        name: "X投稿",
        handle: "@post",
        text: "X公式埋め込みから投稿内容を読み込みます。",
        url: postUrl,
      },
    ],
  });
}

const next = {
  generatedAt: items.length ? new Date().toISOString() : null,
  items,
};

await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
await rl.close();

console.log(`Saved ${items.length} trend topic(s).`);

async function readTopics() {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return { generatedAt: null, items: [] };
  }
}

function categoryLabel(value) {
  if (value === "battle") return "対戦";
  if (value === "goods") return "グッズ";
  return "ニュース";
}

function colorFor(value) {
  if (value === "battle") return "#d8ff4f";
  if (value === "goods") return "#ffb09d";
  return "#ffd84d";
}
