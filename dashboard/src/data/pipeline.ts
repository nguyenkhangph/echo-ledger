import type { ReasoningCard } from "@echo/shared/card";
import watchlistJson from "../../../agent/kols.json";

/**
 * Agent output read straight from the repository's fixtures/ folders at build time
 * (the agent writes them every cycle). Nothing here is sample data: when a folder is
 * empty the screens say so.
 */
const postFiles = import.meta.glob("../../../fixtures/posts/*.jsonl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const extractedFiles = import.meta.glob("../../../fixtures/extracted/*.jsonl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const candidateFiles = import.meta.glob("../../../fixtures/candidates/*.jsonl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const draftFiles = import.meta.glob("../../../fixtures/drafts/*.jsonl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 3_600_000;

export type WatchlistEntry = { id: string; handle: string; platform: "telegram" | "x"; url: string; trust: number };

type Post = {
  id: string;
  kol_id: string;
  handle: string;
  platform: "telegram" | "x";
  url: string;
  posted_at: string;
  text: string;
  is_forward: boolean;
  is_quote: boolean;
  echo_of?: string;
};

type Signal = {
  post_id: string;
  has_signal: boolean;
  is_sponsored?: boolean;
  token: string | null;
  sentiment: "bullish" | "bearish" | "neutral";
  conviction: number;
  is_echo: boolean;
  echo_of: string | null;
  reasoning_summary: string;
};

export type Candidate = {
  token: string;
  window_h: number;
  sources: Array<{ post_id: string; handle: string; sentiment: string; conviction: number; is_echo: boolean; echo_of: string | null }>;
  convergence: { independent_count: number; echo_count: number; agreeing_independent_count: number; score: number; threshold: number; passed: boolean };
};

export type SignalPost = Post & { signal: Signal };

function parseJsonl<T>(files: Record<string, string>): Array<{ date: string; rows: T[] }> {
  return Object.entries(files)
    .map(([path, raw]) => ({
      date: path.split("/").at(-1)!.replace(/\.jsonl$/, ""),
      rows: raw
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as T];
          } catch {
            return [];
          }
        }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Telegram previews keep HTML entities such as &#33; in post text. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export const watchlist = watchlistJson as WatchlistEntry[];
const watchedIds = new Set(watchlist.map((entry) => entry.id));

// Only sources still on the watchlist: posts from removed sources stay in fixtures/ for the audit trail but are not shown.
const posts = parseJsonl<Post>(postFiles).flatMap((file) => file.rows).filter((post) => watchedIds.has(post.kol_id));
const signals = new Map(parseJsonl<Signal>(extractedFiles).flatMap((file) => file.rows).map((signal) => [signal.post_id, signal]));

/** The newest post the agent has seen; the 24 h window is measured back from here, not from the viewer's clock. */
export const snapshotTime = posts.length ? new Date(Math.max(...posts.map((post) => Date.parse(post.posted_at)))) : null;

const windowPosts = snapshotTime ? posts.filter((post) => snapshotTime.getTime() - Date.parse(post.posted_at) <= WINDOW_MS) : [];

/** Actionable calls in the window, newest first. */
export const signalPosts: SignalPost[] = windowPosts
  .flatMap((post) => {
    const signal = signals.get(post.id);
    return signal?.has_signal && signal.token ? [{ ...post, signal }] : [];
  })
  .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));

export const latestPosts: Post[] = [...windowPosts].sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));

const candidateDays = parseJsonl<Candidate>(candidateFiles).filter((file) => file.rows.length);
/** Convergence output from the agent's most recent cycle that produced candidates. */
export const candidates: Candidate[] = (candidateDays.at(-1)?.rows ?? []).sort((a, b) => b.convergence.score - a.convergence.score);
export const candidatesDate = candidateDays.at(-1)?.date ?? null;

/** Every post the watchlist produced, by id, so a graph node can show what was actually said. */
export const postById = new Map(posts.map((post) => [post.id, post]));

export type Narrative = Candidate & { date: string };

/**
 * Every convergence candidate from every agent cycle, newest first. The agent re-evaluates a growing story each
 * cycle, so identical narratives (same sources, same flags) are listed once, at their latest date.
 */
const seenNarratives = new Set<string>();
export const narratives: Narrative[] = [...candidateDays]
  .reverse()
  .flatMap((day) => [...day.rows].sort((a, b) => b.convergence.score - a.convergence.score).map((row) => ({ ...row, date: day.date })))
  .filter((row) => {
    const key = `${row.token}|${row.sources.map((source) => `${source.handle}:${source.sentiment}:${source.is_echo}`).sort().join(",")}`;
    if (seenNarratives.has(key)) return false;
    seenNarratives.add(key);
    return true;
  });

/** Reasoning cards drafted by the debate stage (only tokens that passed convergence get one). */
export const draftCards: ReasoningCard[] = parseJsonl<ReasoningCard>(draftFiles)
  .flatMap((file) => file.rows)
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

export const pipelineStats = {
  sources: watchlist.length,
  postsInWindow: windowPosts.length,
  signalsInWindow: signalPosts.length,
  echoesInWindow: signalPosts.filter((post) => post.signal.is_echo).length,
  /** Every post the extractor flagged as repeating another source, across all fixtures. */
  echoesTotal: [...signals.values()].filter((signal) => signal.has_signal && signal.is_echo).length,
  sponsoredInWindow: windowPosts.filter((post) => signals.get(post.id)?.is_sponsored).length,
};

export type WatchlistRow = WatchlistEntry & {
  postsInWindow: number;
  lastPostAt: string | null;
  lastSignal: { token: string; sentiment: string; isEcho: boolean } | null;
};

export const watchlistRows: WatchlistRow[] = watchlist
  .map((entry) => {
    const own = posts.filter((post) => post.kol_id === entry.id).sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
    const lastSignalPost = own.find((post) => signals.get(post.id)?.has_signal && signals.get(post.id)?.token);
    const lastSignal = lastSignalPost ? signals.get(lastSignalPost.id)! : null;
    return {
      ...entry,
      postsInWindow: own.filter((post) => windowPosts.includes(post)).length,
      lastPostAt: own[0]?.posted_at ?? null,
      lastSignal: lastSignal ? { token: lastSignal.token!, sentiment: lastSignal.sentiment, isEcho: lastSignal.is_echo } : null,
    };
  })
  .sort((a, b) => b.postsInWindow - a.postsInWindow || (b.lastPostAt ?? "").localeCompare(a.lastPostAt ?? ""));

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Public posts by one source that called `token` in the `hours` before `beforeIso`, newest first, from the agent's
 * ingest log. These are links to the original posts, so they can be checked without trusting the ledger or us.
 */
export function sourcePostsFor(handle: string, token: string, beforeIso: string, hours = WINDOW_HOURS) {
  const end = Date.parse(beforeIso);
  const start = end - hours * 3_600_000;
  const want = handle.replace(/^@/, "").toLowerCase();
  return posts
    .filter((post) => post.handle.replace(/^@/, "").toLowerCase() === want)
    .filter((post) => {
      const at = Date.parse(post.posted_at);
      return at <= end && at >= start;
    })
    .flatMap((post) => {
      const signal = signals.get(post.id);
      return signal?.has_signal && signal.token?.toUpperCase() === token.toUpperCase() ? [{ ...post, signal }] : [];
    })
    .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
}
