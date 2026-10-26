import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { ReasoningCard, type ReasoningCard as ReasoningCardType } from "../../../shared/src/card";

import { ConvergenceCandidate, type ConvergenceCandidate as ConvergenceCandidateType } from "../convergence/schema";
import { ExtractedSignal, type ExtractedSignal as ExtractedSignalType } from "../extract/schema";
import type { StructuredCompletionClient } from "../extract/llm";
import { replayPostFixtures } from "../ingest/fixtures";
import { assembleDraftCard, type DraftSourceContext } from "./card-draft";
import { runDebate } from "./debate";
import type { DebatePromptContext, DebateSourceContext } from "./prompts";

export interface DebatePipelineOptions {
  candidatesDirectory: string;
  extractedDirectory: string;
  postsDirectory: string;
  draftsDirectory: string;
  date: string;
  client: StructuredCompletionClient;
  extractModel?: string;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}

export interface DebatePipelineResult {
  drafts: ReasoningCardType[];
  outputPath: string;
  attempted: number;
  skipped: number;
}

async function readJsonl<T>(path: string, parse: (value: unknown) => T, label: string): Promise<T[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid ${label} ${path}:${index + 1}`, { cause: error });
      }
    });
}

async function allExtractedSignals(directory: string): Promise<Map<string, ExtractedSignalType>> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const signals = new Map<string, ExtractedSignalType>();
  for (const name of names.filter((item) => item.endsWith(".jsonl")).sort()) {
    for (const signal of await readJsonl(join(directory, name), (value) => ExtractedSignal.parse(value), "extracted fixture")) {
      signals.set(signal.post_id, signal);
    }
  }
  return signals;
}

function contextsForCandidate(
  candidate: ConvergenceCandidateType,
  sourceContexts: ReadonlyMap<string, DraftSourceContext>,
): DebatePromptContext {
  const sources: DebateSourceContext[] = candidate.sources.map((source) => {
    const context = sourceContexts.get(source.post_id);
    if (!context) throw new Error(`Missing A1/A2 source context for ${source.post_id}`);
    return {
      ...source,
      timeframe: context.signal.timeframe,
    };
  });
  return { candidate, sources };
}

export async function runDebatePipeline({
  candidatesDirectory,
  extractedDirectory,
  postsDirectory,
  draftsDirectory,
  date,
  client,
  extractModel = "unknown",
  now = () => new Date(),
  logger = console,
}: DebatePipelineOptions): Promise<DebatePipelineResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid debate date: ${date}`);
  const allCandidates = await readJsonl(
    join(candidatesDirectory, `${date}.jsonl`),
    (value) => ConvergenceCandidate.parse(value),
    "candidate fixture",
  );
  const candidates = allCandidates.filter((candidate) => candidate.convergence.passed);
  const posts = await replayPostFixtures(postsDirectory);
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const signalsById = await allExtractedSignals(extractedDirectory);
  const sourceContexts = new Map<string, DraftSourceContext>();
  for (const [postId, signal] of signalsById) {
    const post = postsById.get(postId);
    if (post) sourceContexts.set(postId, { post, signal });
  }

  const drafts: ReasoningCardType[] = [];
  for (const candidate of candidates) {
    try {
      const debate = await runDebate(contextsForCandidate(candidate, sourceContexts), client);
      drafts.push(assembleDraftCard({
        candidate,
        debate,
        sourceContexts,
        debateModel: client.model,
        extractModel,
        createdAt: now(),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Skipping debate candidate ${candidate.token}: ${message}`);
    }
  }

  await mkdir(draftsDirectory, { recursive: true });
  const outputPath = join(draftsDirectory, `${date}.jsonl`);
  const temporaryPath = `${outputPath}.tmp`;
  await Bun.write(temporaryPath, drafts.length === 0
    ? ""
    : `${drafts.map((draft) => JSON.stringify(ReasoningCard.parse(draft))).join("\n")}\n`);
  await rename(temporaryPath, outputPath);
  return { drafts, outputPath, attempted: candidates.length, skipped: candidates.length - drafts.length };
}