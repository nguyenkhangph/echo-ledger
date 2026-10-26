import { describe, expect, test } from "bun:test";

import { RateLimiter, type Fetcher } from "../src/ingest/http";
import { TelegramSource } from "../src/ingest/telegram";
import type { KolConfig } from "../src/ingest/types";

const preview = `
<div class="tgme_widget_message" data-post="alive/1">
  <div class="tgme_widget_message_text js-message_text">$HYPE is losing support.</div>
  <a class="tgme_widget_message_date" href="https://t.me/alive/1"><time datetime="2026-10-27T01:00:00Z"></time></a>
</div>`;

const kol = (id: string, channel: string): KolConfig => ({
  id,
  handle: channel,
  platform: "telegram",
  url: `https://t.me/${channel}`,
  trust: 0.5,
});

describe("TelegramSource", () => {
  test("skips a failing channel and still returns posts from the others", async () => {
    const fetcher: Fetcher = async (input) =>
      String(input).endsWith("/missing") ? new Response("gone", { status: 404 }) : new Response(preview, { status: 200 });
    const source = new TelegramSource({ fetcher, limiter: { wait: async () => {} } as RateLimiter });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const posts = await source.collect([kol("missing-source", "missing"), kol("alive-source", "alive")]);
      expect(posts.map((post) => post.kol_id)).toEqual(["alive-source"]);
      expect(source.failures).toEqual([{ kolId: "missing-source", reason: "HTTP 404 fetching https://t.me/s/missing" }]);
    } finally {
      console.warn = originalWarn;
    }
  });
});
