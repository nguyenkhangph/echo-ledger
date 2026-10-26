import { resolve } from "node:path";

import { CoinGeckoClient } from "./evidence";
import { runConvergencePipeline } from "./pipeline";

const agentDirectory = resolve(import.meta.dir, "../..");

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parseWindow(value: string | undefined): number {
  if (value === undefined) return 24;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--window must be a positive number of hours");
  return hours;
}

function datedWindowEnd(date: string | undefined, now: Date): { outputDate: string; windowEnd: Date } {
  if (date === undefined) return { outputDate: now.toISOString().slice(0, 10), windowEnd: now };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date requires YYYY-MM-DD");
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return { outputDate: date, windowEnd: new Date(start.getTime() + 24 * 60 * 60 * 1_000) };
}

const args = Bun.argv.slice(2);
const { outputDate, windowEnd } = datedWindowEnd(argument(args, "--date"), new Date());
const windowHours = parseWindow(argument(args, "--window"));
const result = await runConvergencePipeline({
  extractedDirectory: resolve(agentDirectory, "../fixtures/extracted"),
  postsDirectory: resolve(agentDirectory, "../fixtures/posts"),
  candidatesDirectory: resolve(agentDirectory, "../fixtures/candidates"),
  outputDate,
  windowEnd,
  windowHours,
  evidenceClient: new CoinGeckoClient(),
});

console.log(`Convergence: ${result.passed} passed, ${result.notPassed} not passed (${result.candidates.length} token(s))`);
console.log(`Wrote ${result.outputPath}`);