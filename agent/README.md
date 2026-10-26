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

## LLM extraction

Copy `.env.example` to `.env` and configure an OpenAI-compatible base URL, API key, and model. Run `bun run extract` to process all recorded posts, or `bun run extract --date YYYY-MM-DD` for one day. Calls are sequential, rate-limited, and retried with exponential backoff. Valid actionable signals are merged into `../fixtures/extracted/<posted-date>.jsonl`; posts with `has_signal: false` are not written.

The extractor requests JSON mode first and falls back to JSON parsing when the provider does not support it. Every response is validated with the strict `ExtractedSignal` Zod schema, and malformed model output receives one retry. Extraction is off-chain and supports PRACTICE/paper-trading research only.

## Convergence and market evidence

Run `bun run converge` for a rolling 24-hour window ending now, or `bun run converge --date YYYY-MM-DD --window 24` for a UTC date-aligned window. Extracted signals are joined to their source posts by `post_id`, grouped by normalized token, and written to `../fixtures/candidates/<date>.jsonl` whether they pass or fail.

Echoes remain in each candidate for transparency but never contribute to its score. Convergence requires at least two independent signals and a score of at least `0.6`. Sentiment count determines the dominant direction; equal counts are broken by the greater total conviction, then deterministically by `bullish`, `bearish`, `neutral`. Passed candidates request a CoinGecko snapshot with rate limiting and retry. Missing mappings or fetch failures leave `evidence` as `null` without dropping the candidate.