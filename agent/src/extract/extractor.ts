import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import type { IngestedPost } from "../ingest/types";
import type { SignalExtractionClient } from "./llm";
import { ExtractedSignal, type ExtractedSignal as ExtractedSignalType } from "./schema";

export interface ExtractionResult {
  signals: ExtractedSignalType[];
  written: string[];
}

function handleFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const handle = parts[0] === "s" ? parts[1] : parts[0];
    return handle ? `@${handle.replace(/^@/, "")}` : null;
  } catch {
    return null;
  }
}

export function detectEchoAttribution(post: IngestedPost): string | null | undefined {
  if (post.echo_of) return handleFromUrl(post.echo_of);
  const marker = post.text.match(/^\s*RT\s+@([A-Za-z0-9_]+)/i)
    ?? post.text.match(/\b(?:as|quoting|via|per)\s+@([A-Za-z0-9_]+)\s+(?:said|says|noted|argued|:)/i);
  if (marker?.[1]) return `@${marker[1]}`;
  if (post.is_forward || post.is_quote) return null;
  return undefined;
}

export function applyEchoEvidence(post: IngestedPost, signal: ExtractedSignalType): ExtractedSignalType {
  const attribution = detectEchoAttribution(post);
  if (attribution === undefined) return signal;
  return ExtractedSignal.parse({
    ...signal,
    is_echo: true,
    echo_of: attribution ?? signal.echo_of,
  });
}

async function readSignals(path: string): Promise<ExtractedSignalType[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
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

async function writeDatedSignals(
  directory: string,
  datedSignals: ReadonlyMap<string, readonly ExtractedSignalType[]>,
): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const [date, incoming] of [...datedSignals].sort(([left], [right]) => left.localeCompare(right))) {
    const path = join(directory, `${date}.jsonl`);
    const merged = new Map((await readSignals(path)).map((signal) => [signal.post_id, signal]));
    for (const signal of incoming) merged.set(signal.post_id, ExtractedSignal.parse(signal));
    const records = [...merged.values()].sort((left, right) => left.post_id.localeCompare(right.post_id));
    const temporaryPath = `${path}.tmp`;
    await Bun.write(temporaryPath, `${records.map((signal) => JSON.stringify(signal)).join("\n")}\n`);
    await rename(temporaryPath, path);
    written.push(path);
  }
  return written;
}

export async function extractPostsToFixtures(
  posts: readonly IngestedPost[],
  client: SignalExtractionClient,
  directory: string,
): Promise<ExtractionResult> {
  const signals: ExtractedSignalType[] = [];
  const byDate = new Map<string, ExtractedSignalType[]>();
  for (const post of posts) {
    const extracted = ExtractedSignal.parse({ ...(await client.extract(post)), post_id: post.id });
    if (!extracted.has_signal) continue;
    const signal = applyEchoEvidence(post, extracted);
    signals.push(signal);
    const date = post.posted_at.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), signal]);
  }
  return { signals, written: await writeDatedSignals(directory, byDate) };
}