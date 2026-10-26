# Agent ingestion

> **Live-run X coverage is manual:** The six real X candidates configured in `kols.json` (`@ali_charts`, `@rektcapital`, `@CryptoMichNL`, `@intocryptoverse`, `@LookOnChain`, and `@aixbt_agent`) have no automated network client. During the live-run window, someone must copy notable posts into `manual_posts.json`; otherwise these accounts contribute no posts to the automated 24-hour pipeline. Telegram sources are the only fully automated ingestion path.

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

## Bull/Bear/Judge debate

Run `bun run debate --date YYYY-MM-DD`, or omit `--date` to use the latest candidate fixture. Only passed convergence candidates are debated. Bull and Bear run in parallel, then Judge receives both arguments plus the raw candidate and A2 timeframe context. Each stage is strictly validated and receives one retry for invalid output. A failed candidate is logged and skipped without stopping the batch. Drafts are written to `../fixtures/drafts/<date>.jsonl` and validated against the shared `ReasoningCard` schema.

The debate and risk status assessment are advisory, off-chain, and PRACTICE-only. They never authorize a position. The draft records configured limits for transparency, but CRE must independently fetch finalized evidence, read current on-chain state, and enforce the authoritative deterministic risk gate. LLM output is never trusted inside CRE.

## Finalize and submit

Run `bun run submit --date YYYY-MM-DD`, or omit `--date` to use the latest draft fixture. Each valid draft receives a final timestamp and deterministic `card-<token>-<verdict>-<sequence>` ID, is validated against the shared schema, and is hashed using the shared canonical Keccak-256 implementation. A replay ledger at `../fixtures/submitted-ledger.json` prevents a successfully sent underlying signal from being submitted again.

When `CRE_RECORD_URL` is unset, submission is safely dry-run only: no HTTP request is attempted and payloads are appended to `../fixtures/dry-run-submissions/<date>.jsonl`. For local CRE operation, set `CRE_RECORD_URL=http://localhost:2000` while `cre workflow simulate record --listen --target staging-settings` is running from `../cre` in a separate terminal. Add `--broadcast` to that CRE listener only after explicit approval for real Sepolia writes; the simulator session, not the agent, controls broadcasting. The agent posts `{ card, cardHash }` and never broadcasts a blockchain transaction directly. Per-item outcomes are written to `../fixtures/submitted/<date>.jsonl`.