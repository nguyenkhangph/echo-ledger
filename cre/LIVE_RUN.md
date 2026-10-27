# Echo Ledger 24-hour local CRE runbook

This runbook operates the agent and CRE workflows locally against Ethereum Sepolia. It does not deploy a workflow to a CRE DON. Run all commands in Windows PowerShell 5.1.

## Safety boundary

> **STOP — EXPLICIT APPROVAL REQUIRED**
>
> Do not start any command containing `--broadcast` until the operator has explicitly approved the first real Sepolia write. `--broadcast` is a setting for the whole `cre workflow simulate` process. For the record HTTP listener, every POST handled by a listener started with `--broadcast` can submit a real transaction if that workflow execution reaches `writeReport`.

All positions are PRACTICE positions. Never use a mainnet target, real order API, or exchange key.

## What runs continuously

| Component | Trigger in this repository | Local 24-hour operation |
| --- | --- | --- |
| `record` | HTTP | One persistent `--listen` process on `http://localhost:2000` |
| `settle` | Cron (`*/30 * * * * *`) | Repeated one-shot simulations driven by an external PowerShell loop |
| `reputation` | Finalized `PositionSettled` EVM log, **not cron** | One persistent EVM log `--listen` process |
| Agent A1–A5 | CLI batch stages | Repeated PowerShell loop; submission POSTs to the record listener |

CRE simulation does not schedule cron triggers. A cron trigger executes immediately once per `cre workflow simulate` invocation, and CLI v1.39.0 reports that `--listen` is not supported for cron. The settlement loop below is therefore an operator-managed local scheduler. Its 30-second sleep starts after each run finishes, so it does not promise exact wall-clock `*/30` execution.

## Broadcast semantics and report behavior

- Without `--broadcast`, `writeReport` prepares a transaction but does not send it; the simulator reports a zero transaction hash.
- With `--broadcast`, every workflow execution in that simulator process that reaches `writeReport` attempts a real transaction on the configured chain.
- `record` calls `writeReport` for `APPROVE`, `CONSTRAIN`, and `REJECT`. All three use OPEN report type `0` and are intended to create an onchain audit record. The contract adds only non-REJECT reports with a non-`NONE` side to `openPositionIds`.
- `settle` calls `writeReport` with SETTLE report type `1` only when a position reaches its horizon or stop loss. A `HOLD` check performs no write.
- `reputation` calls `writeReport` with TRUST_UPDATE report type `2` for each matching finalized settlement event it processes.

Current CRE documentation is inconsistent about the simulation MockForwarder's receiver behavior: the general simulation guide describes `--broadcast` as enabling real testnet state changes, while the current onchain-write overview says simulation uses a MockForwarder that records the report without calling the consumer's `onReport()`. The staging EchoLedger and CRE CLI v1.39.0 both use Sepolia simulation forwarder `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, but the first approved broadcast must still prove that the ledger state changes before the 24-hour clock starts.

## 1. Preflight — no broadcasts

Open **Terminal 1**:

```powershell
Set-Location 'D:\Projects\echo-ledger'
cre version
cre whoami
bun test
bun run typecheck
```

Confirm CRE CLI v1.39.0 or the version required by the current docs. Confirm the test and typecheck commands pass.

Check the simulator forwarder and the immutable staging-ledger forwarder without sending a transaction:

```powershell
Set-Location 'D:\Projects\echo-ledger\cre'
cre workflow supported-chains --output json

Set-Location 'D:\Projects\echo-ledger'
cast call 0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0 'forwarder()(address)' --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

For `ethereum-testnet-sepolia`, `mockAddress` and `forwarder()` must both be:

```text
0x15fC6ae953E024d975e77382eEeC56A9101f9F88
```

Also confirm, without printing it, that `D:\Projects\echo-ledger\cre\.env` contains a funded Sepolia-only `CRE_ETH_PRIVATE_KEY`. Never print or commit that file or key.

## 2. Configure the agent

In `D:\Projects\echo-ledger\agent\.env`, set:

```dotenv
CRE_RECORD_URL=http://localhost:2000/trigger
```

Keep the existing LLM settings required by A2/A4. Do not print the file.

## 3. Dry-run listener smoke test — no broadcast

Open **Terminal 2** and start the record listener without `--broadcast`:

```powershell
Set-Location 'D:\Projects\echo-ledger\cre'
cre workflow simulate record --listen --target staging-settings
```

From another terminal, run the agent submission only when a current draft is ready:

```powershell
Set-Location 'D:\Projects\echo-ledger\agent'
bun run submit --date YYYY-MM-DD
```

Confirm Terminal 2 logs validation, prices, the Sepolia read, the risk decision, and a zero transaction hash. Stop the dry-run listener with `Ctrl+C` after the smoke test. A successful HTTP response is recorded by the agent replay guard, so use a disposable fixture/date for smoke testing rather than a live signal intended for later broadcast.

## 4. First real-write gate

> **STOP HERE UNTIL THE OPERATOR EXPLICITLY APPROVES THE FIRST `--broadcast` RUN.**

After approval, start the record listener in **Terminal 2**:

```powershell
Set-Location 'D:\Projects\echo-ledger\cre'
cre workflow simulate record --listen --target staging-settings --broadcast
```

Submit exactly one approved, known fixture through `http://localhost:2000/trigger`. Before beginning the live clock, require all of the following:

1. CRE logs a nonzero transaction hash.
2. The transaction succeeds on Sepolia.
3. The staging EchoLedger emits `PositionOpened`.
4. `getPosition(positionId)` returns `exists=true`.
5. For APPROVE/CONSTRAIN with a non-`NONE` side, `openPositionIds()` contains the position ID.

If the transaction only records a report in the MockForwarder and does not mutate EchoLedger, stop. Do not begin the 24-hour run until the simulator/forwarder behavior is resolved.

Keep Terminal 2 running after this gate passes. Every valid agent submission will trigger a fresh record simulation. Because this listener includes `--broadcast`, APPROVE, CONSTRAIN, and REJECT executions that reach `writeReport` all attempt Sepolia OPEN-report transactions.

## 5. Start the reputation listener

Open **Terminal 3** after broadcast approval and before starting settlement runs:

```powershell
Set-Location 'D:\Projects\echo-ledger\cre'
cre workflow simulate reputation --listen --target staging-settings --broadcast
```

This is an EVM log listener for finalized `PositionSettled(bytes32,int256)` events from the staging ledger. It is not a cron workflow. Leave it running through the full window and long enough after the last settlement transaction for that event to become finalized and for the trust-update transaction to complete.

## 6. Start the settlement scheduler

Open **Terminal 4** after broadcast approval. This loop runs one immediate cron simulation, waits 30 seconds after completion, and repeats until 24 hours have elapsed:

```powershell
Set-Location 'D:\Projects\echo-ledger\cre'
$EndAt = (Get-Date).AddHours(24)
while ((Get-Date) -lt $EndAt) {
    cre workflow simulate settle --non-interactive --trigger-index 0 --target staging-settings --broadcast
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Settlement simulation failed at $(Get-Date -Format o); stopping the scheduler."
        break
    }
    Start-Sleep -Seconds 30
}
```

Each invocation checks current open positions. It writes only settlements whose 24-hour horizon or 8% stop loss has been reached; otherwise it logs `HOLD` and sends no transaction.

## 7. Run the agent A1–A5 cycle

Open **Terminal 5**. The repository does not contain a long-running agent scheduler, so use this PowerShell loop. The example cadence is 15 minutes; set `$CycleMinutes` before startup if the operator chooses another cadence.

```powershell
Set-Location 'D:\Projects\echo-ledger\agent'
$EndAt = (Get-Date).AddHours(24)
$CycleMinutes = 15
while ((Get-Date) -lt $EndAt) {
    $Date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')

    bun run ingest
    if ($LASTEXITCODE -ne 0) { Write-Error 'A1 ingest failed; stopping the agent loop.'; break }

    bun run extract --date $Date
    if ($LASTEXITCODE -ne 0) { Write-Error 'A2 extract failed; stopping the agent loop.'; break }

    bun run converge --window 24
    if ($LASTEXITCODE -ne 0) { Write-Error 'A3 convergence failed; stopping the agent loop.'; break }

    bun run debate --date $Date
    if ($LASTEXITCODE -ne 0) { Write-Error 'A4 debate failed; stopping the agent loop.'; break }

    bun run submit --date $Date
    if ($LASTEXITCODE -ne 0) { Write-Error 'A5 submission failed; stopping the agent loop.'; break }

    Start-Sleep -Seconds ($CycleMinutes * 60)
}
```

The A5 replay ledger prevents a successfully accepted underlying signal from being submitted again. Inspect each cycle's output rather than assuming every candidate produced a transaction.

## 8. Monitor during the run

- **Terminal 2 / record:** require one risk decision and a nonzero transaction hash for every accepted agent POST. Investigate HTTP errors, hash failures, API disagreement, and transaction failures immediately.
- **Terminal 3 / reputation:** watch for finalized settlement events followed by `TRUST_UPDATE` and a nonzero transaction hash.
- **Terminal 4 / settle:** distinguish normal `HOLD`/zero-settlement results from errors. For actual settlements, require a nonzero transaction hash.
- **Terminal 5 / agent:** inspect per-stage counts and `fixtures/submitted/<date>.jsonl`; do not bypass failed stages.
- Monitor the Sepolia account balance without exposing its private key. Top up only with faucet Sepolia ETH.

If any process exits unexpectedly, record the time and error before restarting it. Do not add `--broadcast` to an unreviewed command.

## 9. Stop and close out

At the end of the agent/settlement 24-hour windows:

1. Stop Terminal 5 if it has not exited.
2. Stop Terminal 4 if it has not exited.
3. Leave Terminal 3 running until the last settlement is finalized and its trust update succeeds, then press `Ctrl+C`.
4. Press `Ctrl+C` in Terminal 2.
5. Set `CRE_RECORD_URL` blank again if subsequent agent runs should be dry-run only.
6. Archive logs and fixture outputs, and reconcile OPEN, SETTLE, and TRUST_UPDATE transactions against staging EchoLedger state.

## Official CRE references

- [Simulating Workflows](https://docs.chain.link/cre/guides/operations/simulating-workflows)
- [Testing HTTP Triggers in Simulation](https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/testing-in-simulation)
- [Cron Trigger — TypeScript](https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts)
- [EVM Log Trigger — TypeScript](https://docs.chain.link/cre/guides/workflow/using-triggers/evm-log-trigger-ts)
- [Onchain Write Overview — TypeScript](https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-ts)
- [Forwarder Directory — TypeScript](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts)