import { z } from "zod";

import { postId, type IngestedPost, type KolConfig, type PostSource } from "./types";

export const ManualXPost = z
  .object({
    kol_id: z.string().min(1),
    url: z.string().url(),
    text: z.string().trim().min(1),
    posted_at: z.string().datetime({ offset: true }),
    is_quote: z.boolean().default(false),
    echo_of: z.string().url().optional(),
  })
  .strict();

export const ManualXPostList = z.array(ManualXPost);
export type ManualXPost = z.infer<typeof ManualXPost>;

/** Interface implemented by the manual file today and an X API adapter later. */
export interface XPostClient {
  getPosts(kols: readonly KolConfig[]): Promise<readonly ManualXPost[]>;
}

export class ManualFileXClient implements XPostClient {
  constructor(private readonly path: string) {}

  async getPosts(): Promise<readonly ManualXPost[]> {
    return ManualXPostList.parse(await Bun.file(this.path).json());
  }
}

export class XSource implements PostSource {
  readonly platform = "x" as const;

  constructor(private readonly client: XPostClient) {}

  async collect(kols: readonly KolConfig[]): Promise<IngestedPost[]> {
    const xKols = new Map(kols.filter((kol) => kol.platform === this.platform).map((kol) => [kol.id, kol]));
    const inputs = await this.client.getPosts([...xKols.values()]);

    return inputs.map((input) => {
      const kol = xKols.get(input.kol_id);
      if (!kol) throw new Error(`Manual X post references unknown X KOL: ${input.kol_id}`);
      const host = new URL(input.url).hostname;
      if (host !== "x.com" && host !== "www.x.com" && host !== "twitter.com" && host !== "www.twitter.com") {
        throw new Error(`Manual X post must use an x.com or twitter.com URL: ${input.url}`);
      }

      return {
        id: postId(this.platform, input.url),
        kol_id: kol.id,
        handle: kol.handle,
        platform: this.platform,
        url: input.url,
        posted_at: new Date(input.posted_at).toISOString(),
        text: input.text,
        trust: kol.trust,
        is_forward: false,
        is_quote: input.is_quote || input.echo_of !== undefined,
        ...(input.echo_of ? { echo_of: input.echo_of } : {}),
      };
    });
  }
}