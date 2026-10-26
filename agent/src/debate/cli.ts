import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { OpenAiCompatibleLlmClient } from "../extract/llm";
import { runDebatePipeline } from "./pipeline";

const agentDirectory = resolve(import.meta.dir, "../..");
const candidatesDirectory = resolve(agentDirectory, "../fixtures/candidates");

function dateArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf("--date");
  if (index === -1) return undefined;
  const date = args[index + 1];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date requires YYYY-MM-DD");
  return date;
}

async function latestCandidateDate(): Promise<string> {
  let names: string[];
  try {
    names = await readdir(candidatesDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No candidate fixtures found");
    throw error;
  }
  const dates = names.filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  const latest = dates.at(-1)?.replace(/\.jsonl$/, "");
  if (!latest) throw new Error("No candidate fixtures found");
  return latest;
}

const date = dateArgument(Bun.argv.slice(2)) ?? await latestCandidateDate();
const result = await runDebatePipeline({
  candidatesDirectory,
  extractedDirectory: resolve(agentDirectory, "../fixtures/extracted"),
  postsDirectory: resolve(agentDirectory, "../fixtures/posts"),
  draftsDirectory: resolve(agentDirectory, "../fixtures/drafts"),
  date,
  client: new OpenAiCompatibleLlmClient(),
});
console.log(`Debate: wrote ${result.drafts.length} draft(s), skipped ${result.skipped} of ${result.attempted} passed candidate(s)`);
console.log(`Wrote ${result.outputPath}`);