import { resolve } from "node:path";

import { replayPostFixtures } from "../ingest/fixtures";
import { extractPostsToFixtures } from "./extractor";
import { OpenAiCompatibleLlmClient } from "./llm";

const agentDirectory = resolve(import.meta.dir, "../..");
const postsDirectory = resolve(agentDirectory, "../fixtures/posts");
const extractedDirectory = resolve(agentDirectory, "../fixtures/extracted");
const extractionAuditDirectory = resolve(agentDirectory, "../fixtures/extraction-audit");
const extractionCacheDirectory = resolve(agentDirectory, "../fixtures/extraction-cache");

function dateArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf("--date");
  if (index === -1) return undefined;
  const date = args[index + 1];
  if (!date) throw new Error("--date requires YYYY-MM-DD");
  return date;
}

const posts = await replayPostFixtures(postsDirectory, dateArgument(Bun.argv.slice(2)));
const result = await extractPostsToFixtures(
  posts,
  new OpenAiCompatibleLlmClient(),
  extractedDirectory,
  extractionAuditDirectory,
  extractionCacheDirectory,
);
console.log(`Extracted ${result.signals.length} actionable signal(s) from ${posts.length} post(s) (${result.cacheHits} reused from cache)`);
console.log(`Filtered ${result.sponsored.length} sponsored post(s)`);
for (const path of result.written) console.log(`Wrote ${path}`);
for (const path of result.auditWritten) console.log(`Wrote sponsorship audit ${path}`);