import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { type EvidenceClient } from "./evidence";
import { loadRecentSignalGroups } from "./group";
import { ConvergenceCandidate, type ConvergenceCandidate as ConvergenceCandidateType } from "./schema";
import { scoreConvergence } from "./score";

export interface ConvergencePipelineOptions {
  extractedDirectory: string;
  postsDirectory: string;
  candidatesDirectory: string;
  outputDate: string;
  windowEnd: Date;
  windowHours: number;
  evidenceClient: EvidenceClient;
}

export interface ConvergencePipelineResult {
  candidates: ConvergenceCandidateType[];
  outputPath: string;
  passed: number;
  notPassed: number;
}

export async function addMarketEvidence(
  candidates: readonly ConvergenceCandidateType[],
  evidenceClient: EvidenceClient,
): Promise<ConvergenceCandidateType[]> {
  const enriched: ConvergenceCandidateType[] = [];
  for (const candidate of candidates) {
    if (!candidate.convergence.passed) {
      enriched.push(candidate);
      continue;
    }
    try {
      enriched.push(ConvergenceCandidate.parse({
        ...candidate,
        evidence: await evidenceClient.fetch(candidate.token),
      }));
    } catch {
      enriched.push(ConvergenceCandidate.parse({ ...candidate, evidence: null }));
    }
  }
  return enriched;
}

export async function runConvergencePipeline({
  extractedDirectory,
  postsDirectory,
  candidatesDirectory,
  outputDate,
  windowEnd,
  windowHours,
  evidenceClient,
}: ConvergencePipelineOptions): Promise<ConvergencePipelineResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(outputDate)) throw new Error(`Invalid output date: ${outputDate}`);
  const groups = await loadRecentSignalGroups({ extractedDirectory, postsDirectory, windowEnd, windowHours });
  const scored = [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([token, sources]) => scoreConvergence(token, sources, windowHours));
  const candidates = await addMarketEvidence(scored, evidenceClient);

  await mkdir(candidatesDirectory, { recursive: true });
  const outputPath = join(candidatesDirectory, `${outputDate}.jsonl`);
  const temporaryPath = `${outputPath}.tmp`;
  await Bun.write(temporaryPath, candidates.length === 0
    ? ""
    : `${candidates.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`);
  await rename(temporaryPath, outputPath);

  const passed = candidates.filter((candidate) => candidate.convergence.passed).length;
  return { candidates, outputPath, passed, notPassed: candidates.length - passed };
}