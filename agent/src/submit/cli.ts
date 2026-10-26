import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { CreRecordClient } from "./client";
import { runSubmissionPipeline } from "./pipeline";
import { ReplayGuard } from "./replay-guard";

const agentDirectory = resolve(import.meta.dir, "../..");
const fixturesDirectory = resolve(agentDirectory, "../fixtures");
const draftsDirectory = resolve(fixturesDirectory, "drafts");

function dateArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf("--date");
  if (index === -1) return undefined;
  const date = args[index + 1];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date requires YYYY-MM-DD");
  return date;
}

async function latestDraftDate(): Promise<string> {
  let names: string[];
  try {
    names = await readdir(draftsDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No draft fixtures found");
    throw error;
  }
  const latest = names.filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().at(-1);
  if (!latest) throw new Error("No draft fixtures found");
  return latest.replace(/\.jsonl$/, "");
}

const date = dateArgument(Bun.argv.slice(2)) ?? await latestDraftDate();
const result = await runSubmissionPipeline({
  draftsDirectory,
  submittedDirectory: resolve(fixturesDirectory, "submitted"),
  date,
  client: new CreRecordClient({ dryRunDirectory: resolve(fixturesDirectory, "dry-run-submissions") }),
  replayGuard: new ReplayGuard(resolve(fixturesDirectory, "submitted-ledger.json")),
});
const counts = result.outcomes.reduce<Record<string, number>>((summary, outcome) => {
  summary[outcome.status] = (summary[outcome.status] ?? 0) + 1;
  return summary;
}, {});
console.log(`Submission outcomes: ${JSON.stringify(counts)}`);
console.log(`Wrote ${result.outputPath}`);