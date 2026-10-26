import { resolve } from "node:path";

import { replayPostFixtures, writePostFixtures } from "./fixtures";
import { ManualFileXClient, XSource } from "./manual-x";
import { TelegramSource } from "./telegram";
import { KolConfigList, type IngestedPost, type PostSource } from "./types";

const agentDirectory = resolve(import.meta.dir, "../..");
const fixturesDirectory = resolve(agentDirectory, "../fixtures/posts");

function dateArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf("--date");
  if (index === -1) return undefined;
  const date = args[index + 1];
  if (!date) throw new Error("--date requires YYYY-MM-DD");
  return date;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--from-fixtures")) {
    const posts = await replayPostFixtures(fixturesDirectory, dateArgument(args));
    console.log(`Replayed ${posts.length} post(s) from ${fixturesDirectory}`);
    return;
  }

  const kols = KolConfigList.parse(await Bun.file(resolve(agentDirectory, "kols.json")).json());
  const sources: PostSource[] = [
    new TelegramSource(),
    new XSource(new ManualFileXClient(resolve(agentDirectory, "manual_posts.json"))),
  ];
  const posts: IngestedPost[] = [];
  for (const source of sources) posts.push(...(await source.collect(kols)));

  const paths = await writePostFixtures(fixturesDirectory, posts);
  console.log(`Ingested ${posts.length} post(s) from ${kols.length} KOL source(s)`);
  for (const path of paths) console.log(`Wrote ${path}`);
}

await main();