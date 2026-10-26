import { describe, expect, test } from "bun:test";

import { parseTelegramPreview } from "../src/ingest/telegram-parser";

const preview = `
<html><body>
  <div class="tgme_widget_message" data-post="alpha/101">
    <div class="tgme_widget_message_text js-message_text">SOL is <b>breaking out</b>.<br>Volume confirms <img alt="🚀" src="rocket.png"></div>
    <a class="tgme_widget_message_date" href="https://t.me/alpha/101"><time datetime="2026-10-20T11:42:00+00:00"></time></a>
  </div>
  <div class="tgme_widget_message" data-post="alpha/102">
    <div class="tgme_widget_message_forwarded_from"><a href="https://t.me/original/88">Forwarded from Original</a></div>
    <div class="tgme_widget_message_text js-message_text">Forwarded thesis</div>
    <a class="tgme_widget_message_date" href="/alpha/102"><time datetime="2026-10-20T12:00:00Z"></time></a>
  </div>
  <div class="tgme_widget_message" data-post="alpha/103">
    <div class="tgme_widget_message_reply"><a href="https://t.me/other/77">Quoted post</a></div>
    <div class="tgme_widget_message_text js-message_text">Adding independent context</div>
    <a class="tgme_widget_message_date" href="https://t.me/alpha/103"><time datetime="2026-10-20T12:30:00Z"></time></a>
  </div>
</body></html>`;

describe("parseTelegramPreview", () => {
  test("parses text, timestamps, canonical links, forwards, and quotes", async () => {
    expect(await parseTelegramPreview(preview)).toEqual([
      {
        url: "https://t.me/alpha/101",
        postedAt: "2026-10-20T11:42:00.000Z",
        text: "SOL is breaking out.\nVolume confirms 🚀",
        isForward: false,
        isQuote: false,
        referencedUrl: undefined,
      },
      {
        url: "https://t.me/alpha/102",
        postedAt: "2026-10-20T12:00:00.000Z",
        text: "Forwarded thesis",
        isForward: true,
        isQuote: false,
        referencedUrl: "https://t.me/original/88",
      },
      {
        url: "https://t.me/alpha/103",
        postedAt: "2026-10-20T12:30:00.000Z",
        text: "Adding independent context",
        isForward: false,
        isQuote: true,
        referencedUrl: "https://t.me/other/77",
      },
    ]);
  });

  test("drops posts without text or a valid timestamp", async () => {
    const incomplete = `
      <div class="tgme_widget_message" data-post="alpha/1">
        <a class="tgme_widget_message_date" href="/alpha/1"><time datetime="not-a-date"></time></a>
      </div>`;
    expect(await parseTelegramPreview(incomplete)).toEqual([]);
  });
});