import { fetchTextWithRetry, RateLimiter, type Fetcher } from "./http";
import { parseTelegramPreview } from "./telegram-parser";
import { postId, type IngestedPost, type KolConfig, type PostSource } from "./types";

export interface TelegramSourceOptions {
  fetcher?: Fetcher;
  limiter?: RateLimiter;
}

function previewUrl(kol: KolConfig): string {
  const configured = new URL(kol.url);
  if (configured.hostname !== "t.me" && configured.hostname !== "www.t.me") {
    throw new Error(`Telegram KOL ${kol.id} must use a t.me URL`);
  }

  const parts = configured.pathname.split("/").filter(Boolean);
  const channel = parts[0] === "s" ? parts[1] : parts[0];
  if (!channel || !/^[A-Za-z0-9_]+$/.test(channel)) {
    throw new Error(`Cannot determine public Telegram channel for ${kol.id}`);
  }
  return `https://t.me/s/${channel}`;
}

export class TelegramSource implements PostSource {
  readonly platform = "telegram" as const;
  private readonly fetcher?: Fetcher;
  private readonly limiter: RateLimiter;

  constructor(options: TelegramSourceOptions = {}) {
    this.fetcher = options.fetcher;
    this.limiter = options.limiter ?? new RateLimiter();
  }

  /** Sources skipped during the most recent collect() call. */
  failures: Array<{ kolId: string; reason: string }> = [];

  async collect(kols: readonly KolConfig[]): Promise<IngestedPost[]> {
    this.failures = [];
    const posts: IngestedPost[] = [];
    for (const kol of kols.filter((item) => item.platform === this.platform)) {
      // One unreachable or renamed channel must not abort the whole ingest: the live-run
      // loop stops on a failed stage, so a single bad source would end data collection.
      let parsed: Awaited<ReturnType<typeof parseTelegramPreview>>;
      try {
        const html = await fetchTextWithRetry(previewUrl(kol), {
          fetcher: this.fetcher,
          limiter: this.limiter,
        });
        parsed = await parseTelegramPreview(html);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.failures.push({ kolId: kol.id, reason });
        console.warn(`[ingest] skipped Telegram source ${kol.id}: ${reason}`);
        continue;
      }
      posts.push(
        ...parsed.map((post) => ({
          id: postId(this.platform, post.url),
          kol_id: kol.id,
          handle: kol.handle,
          platform: this.platform,
          url: post.url,
          posted_at: post.postedAt,
          text: post.text,
          trust: kol.trust,
          is_forward: post.isForward,
          is_quote: post.isQuote,
          ...(post.referencedUrl ? { echo_of: post.referencedUrl } : {}),
        })),
      );
    }
    return posts;
  }
}