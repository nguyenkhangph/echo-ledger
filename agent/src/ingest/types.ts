import { z } from "zod";

export const Platform = z.enum(["telegram", "x"]);

export const KolConfig = z
  .object({
    id: z.string().min(1),
    handle: z.string().min(1),
    platform: Platform,
    url: z.string().url(),
    trust: z.number().min(0).max(1).default(0.5),
  })
  .strict();

export const KolConfigList = z
  .array(KolConfig)
  .max(20, "At most 20 KOL sources may be configured")
  .superRefine((kols, context) => {
    const ids = new Set<string>();
    for (const [index, kol] of kols.entries()) {
      if (ids.has(kol.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate KOL id: ${kol.id}`,
          path: [index, "id"],
        });
      }
      ids.add(kol.id);
    }
  });

export const IngestedPost = z
  .object({
    id: z.string().min(1),
    kol_id: z.string().min(1),
    handle: z.string().min(1),
    platform: Platform,
    url: z.string().url(),
    posted_at: z.string().datetime({ offset: true }),
    text: z.string().min(1),
    trust: z.number().min(0).max(1),
    is_forward: z.boolean(),
    is_quote: z.boolean(),
    echo_of: z.string().url().optional(),
  })
  .strict();

export type Platform = z.infer<typeof Platform>;
export type KolConfig = z.infer<typeof KolConfig>;
export type IngestedPost = z.infer<typeof IngestedPost>;

export interface PostSource {
  readonly platform: Platform;
  collect(kols: readonly KolConfig[]): Promise<IngestedPost[]>;
}

export function postId(platform: Platform, url: string): string {
  return `${platform}:${new URL(url).pathname.replace(/^\//, "")}`;
}