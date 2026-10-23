# Agent ingestion

Configure at most 20 sources in `kols.json`:

```json
[
  {
    "id": "research-desk",
    "handle": "research_desk",
    "platform": "telegram",
    "url": "https://t.me/research_desk",
    "trust": 0.5
  },
  {
    "id": "analyst-x",
    "handle": "@analyst",
    "platform": "x",
    "url": "https://x.com/analyst",
    "trust": 0.5
  }
]
```

X has no network client by default. Paste posts into `manual_posts.json`:

```json
[
  {
    "kol_id": "analyst-x",
    "url": "https://x.com/analyst/status/123",
    "text": "Post text copied verbatim",
    "posted_at": "2026-10-20T11:10:00.000Z",
    "is_quote": false
  }
]
```

Run `bun run ingest` from this directory. Telegram public previews are fetched sequentially with at least two seconds between requests and up to three attempts. Posts are merged by platform and URL into `../fixtures/posts/<posted-date>.jsonl`.

Run `bun run ingest --from-fixtures` to validate and replay all recorded posts without network access. Add `--date YYYY-MM-DD` to replay one day. `XPostClient` in `src/ingest/manual-x.ts` is the extension point for a future X API adapter.