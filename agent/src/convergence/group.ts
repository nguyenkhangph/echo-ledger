import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { ExtractedSignal, type ExtractedSignal as ExtractedSignalType } from "../extract/schema";
import { replayPostFixtures } from "../ingest/fixtures";
import type { CandidateSource } from "./schema";

export interface GroupedSignal extends CandidateSource {
  posted_at: string;
}

export interface LoadSignalGroupsOptions {
  extractedDirectory: string;
  postsDirectory: string;
  windowEnd: Date;
  windowHours: number;
}

async function extractedFileNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readExtractedFile(path: string): Promise<ExtractedSignalType[]> {
  return (await Bun.file(path).text())
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return ExtractedSignal.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid extracted fixture ${path}:${index + 1}`, { cause: error });
      }
    });
}

export async function loadRecentSignalGroups({
  extractedDirectory,
  postsDirectory,
  windowEnd,
  windowHours,
}: LoadSignalGroupsOptions): Promise<Map<string, GroupedSignal[]>> {
  if (!Number.isFinite(windowHours) || windowHours <= 0) throw new Error("windowHours must be positive");
  if (Number.isNaN(windowEnd.getTime())) throw new Error("windowEnd must be a valid date");

  const endMs = windowEnd.getTime();
  const startMs = endMs - windowHours * 60 * 60 * 1_000;
  const posts = await replayPostFixtures(postsDirectory);
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const groups = new Map<string, GroupedSignal[]>();

  for (const name of await extractedFileNames(extractedDirectory)) {
    for (const signal of await readExtractedFile(join(extractedDirectory, name))) {
      if (!signal.has_signal || signal.token === null) continue;
      const post = postsById.get(signal.post_id);
      if (!post) throw new Error(`Extracted signal ${signal.post_id} has no matching source post`);
      const postedMs = Date.parse(post.posted_at);
      if (postedMs < startMs || postedMs >= endMs) continue;

      const token = signal.token.toUpperCase();
      const grouped: GroupedSignal = {
        post_id: signal.post_id,
        handle: post.handle,
        sentiment: signal.sentiment,
        conviction: signal.conviction,
        is_echo: signal.is_echo,
        echo_of: signal.echo_of,
        reasoning_summary: signal.reasoning_summary,
        posted_at: post.posted_at,
      };
      groups.set(token, [...(groups.get(token) ?? []), grouped]);
    }
  }

  for (const signals of groups.values()) {
    signals.sort((left, right) => left.posted_at.localeCompare(right.posted_at) || left.post_id.localeCompare(right.post_id));
  }
  return groups;
}