import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import type { IngestedPost } from "../ingest/types";
import type { SignalExtractionClient } from "./llm";
import { ExtractedSignal, type ExtractedSignal as ExtractedSignalType } from "./schema";

export interface ExtractionResult {
  signals: ExtractedSignalType[];
  sponsored: ExtractedSignalType[];
  written: string[];
  auditWritten: string[];
}

const explicitSponsorship = /(?:#ad\b|#sponsored\b|\bpaid\s+partnership\b|\bin\s+collaboration\s+with\b|quảng\s+cáo|đối\s+tác\s+trả\s+phí)/iu;
const promotionalCta = /(?:\bjoin\s+now\b|\blimited\s+time\b|\buse\s+(?:my\s+)?(?:code|link)\b)/iu;
const commercialIncentive = /(?:\b(?:referral|affiliate|promo)\b|\bcode\s+[A-Z0-9_-]{3,}\b|https?:\/\/\S+)/iu;
const bullishPush = /(?:\$[A-Za-z][A-Za-z0-9]{1,9}\b|\b[A-Z]{2,10}\b).*(?:\b(?:buy|bullish|moon|gem|pump|breakout)\b|\b\d+x\b)|(?:\b(?:buy|bullish|moon|gem|pump|breakout)\b|\b\d+x\b).*(?:\$[A-Za-z][A-Za-z0-9]{1,9}\b|\b[A-Z]{2,10}\b)/u;

export function sponsorshipEvidence(text: string): string | null {
  const disclosure = text.match(explicitSponsorship)?.[0];
  if (disclosure) return `Explicit sponsorship disclosure: ${disclosure}`;
  if (promotionalCta.test(text) && commercialIncentive.test(text) && bullishPush.test(text)) {
    return "Bullish token promotion combines a commercial incentive with a promotional call to action";
  }
  return null;
}

export function applySponsorshipEvidence(post: IngestedPost, signal: ExtractedSignalType): ExtractedSignalType {
  const evidence = sponsorshipEvidence(post.text);
  if (!evidence) return signal;
  return ExtractedSignal.parse({
    ...signal,
    has_signal: false,
    is_sponsored: true,
    sponsorship_reason: evidence,
  });
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
  processedPostIds: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const [date, incoming] of [...datedSignals].sort(([left], [right]) => left.localeCompare(right))) {
    const path = join(directory, `${date}.jsonl`);
    if (incoming.length === 0 && !(await Bun.file(path).exists())) continue;
    const merged = new Map((await readSignals(path)).map((signal) => [signal.post_id, signal]));
    for (const postId of processedPostIds.get(date) ?? []) merged.delete(postId);
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
  auditDirectory = join(directory, "..", "extraction-audit"),
): Promise<ExtractionResult> {
  const signals: ExtractedSignalType[] = [];
  const sponsored: ExtractedSignalType[] = [];
  const byDate = new Map<string, ExtractedSignalType[]>();
  const sponsoredByDate = new Map<string, ExtractedSignalType[]>();
  const processedPostIds = new Map<string, Set<string>>();
  for (const post of posts) {
    const date = post.posted_at.slice(0, 10);
    processedPostIds.set(date, new Set([...(processedPostIds.get(date) ?? []), post.id]));
    if (!byDate.has(date)) byDate.set(date, []);
    if (!sponsoredByDate.has(date)) sponsoredByDate.set(date, []);
    const parsed = ExtractedSignal.parse({ ...(await client.extract(post)), post_id: post.id });
    const extracted = applySponsorshipEvidence(post, parsed);
    if (extracted.is_sponsored) {
      sponsored.push(extracted);
      sponsoredByDate.set(date, [...(sponsoredByDate.get(date) ?? []), extracted]);
    }
    if (!extracted.has_signal) continue;
    const signal = applyEchoEvidence(post, extracted);
    signals.push(signal);
    byDate.set(date, [...(byDate.get(date) ?? []), signal]);
  }
  return {
    signals,
    sponsored,
    written: await writeDatedSignals(directory, byDate, processedPostIds),
    auditWritten: await writeDatedSignals(auditDirectory, sponsoredByDate, processedPostIds),
  };
}