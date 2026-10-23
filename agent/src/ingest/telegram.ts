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

  async collect(kols: readonly KolConfig[]): Promise<IngestedPost[]> {
    const posts: IngestedPost[] = [];
    for (const kol of kols.filter((item) => item.platform === this.platform)) {
      const html = await fetchTextWithRetry(previewUrl(kol), {
        fetcher: this.fetcher,
        limiter: this.limiter,
      });
      const parsed = await parseTelegramPreview(html);
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