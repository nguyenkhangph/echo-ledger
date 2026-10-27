# Echo Ledger CRE workflows

Three Chainlink CRE workflows (TypeScript, CRE CLI v1.39.0) that write Echo Ledger decisions to the `EchoLedger` contract on Ethereum Sepolia through `writeReport` → `onReport`.

| Workflow | Trigger | Report | What it does |
| --- | --- | --- | --- |
| [`record/`](record/) | HTTP | OPEN (type 0) | Recomputes the card hash, fetches prices, applies the risk gate and records APPROVE / CONSTRAIN / REJECT. |
| [`settle/`](settle/) | Cron | SETTLE (type 1) | Prices every open position from CoinGecko, Coinbase and Binance (median) and settles at the 24 h horizon or an 8 % stop loss. |
| [`reputation/`](reputation/) | EVM log, finalized `PositionSettled` | TRUST_UPDATE (type 2) | Updates the trust score of each source of the settled position; echo sources take an extra penalty. |

Each workflow checks both the transaction status and `receiverContractExecutionStatus`, so a report that the forwarder accepted but the ledger rejected (for example, out of gas) fails the run instead of being logged as a success. Gas limits in `config.*.json` (record 5 M, settle 750 k, reputation 9.5 M) are set above the worst cases measured by the Foundry tests in `../contracts/test/EchoLedger.t.sol`.

## Running

```bash
cd record && bun install && bun test      # same for settle/ and reputation/
cre workflow simulate record --target staging-settings --http-payload ./payload.example.json   # dry run, no transaction
```

Adding `--broadcast` sends real Sepolia transactions. The continuous operating procedure (persistent `record` and `reputation` listeners, a `settle` loop, and the agent loop) is in [`LIVE_RUN.md`](LIVE_RUN.md).

These workflows run in the CRE simulator rather than on a deployed DON; see the root [README](../README.md#why-local-simulation-and-not-a-deployed-don) for why.
