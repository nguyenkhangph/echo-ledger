import { describe, expect, test } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { assertReportDelivered, positionSources, riskGate, type PriceSnapshot } from './workflow'
import payload from './payload.example.json'

const approveLongCard = payload.card

const prices: PriceSnapshot = {
  coingecko: 180,
  coinbase: 180.5,
  binance: 179.5,
  marketCapUsd: 80_000_000_000,
}

describe('riskGate', () => {
  test('approves a card inside every deterministic limit', () => {
    expect(riskGate(approveLongCard, prices, 0)).toEqual({
      attestation: 0,
      sizeBps: 400n,
      side: 0,
      reasonCode: 0n,
      reason: 'approved',
    })
  })

  test('constrains requested size to max_position_pct', () => {
    const card = { ...approveLongCard, decision: { side: 'long' as const, size_pct: 0.08 } }
    expect(riskGate(card, prices, 0)).toMatchObject({
      attestation: 1,
      sizeBps: 500n,
      reasonCode: 1006n,
    })
  })

  test('rejects negative lead time, discordant prices, low market cap, and max_open', () => {
    expect(
      riskGate({ ...approveLongCard, evidence: { ...approveLongCard.evidence, lead_min: -1 } }, prices, 0).reasonCode,
    ).toBe(1001n)
    expect(riskGate(approveLongCard, { ...prices, binance: 170 }, 0).reasonCode).toBe(1002n)
    expect(riskGate(approveLongCard, { ...prices, marketCapUsd: 1_000 }, 0).reasonCode).toBe(1003n)
    expect(riskGate(approveLongCard, prices, approveLongCard.risk_rules.max_open).reasonCode).toBe(1004n)
  })
})

describe('positionSources', () => {
  test('hashes unique KOL names and preserves echo status', () => {
    const sources = positionSources(approveLongCard)
    expect(sources.kolIds).toHaveLength(2)
    expect(sources.echoFlags).toEqual([false, false])
  })

  test('deduplicates a KOL and marks it echo if any occurrence is echoed', () => {
    const duplicate = {
      ...approveLongCard,
      sources: [
        ...approveLongCard.sources,
        { ...approveLongCard.sources[0], echo_of: 'https://x.com/source/status/1' },
      ],
    }
    const sources = positionSources(duplicate)
    expect(sources.kolIds).toHaveLength(2)
    expect(sources.echoFlags).toEqual([true, false])
  })
})

describe('report delivery status', () => {
  test('rejects a receiver failure even when the outer transaction succeeded', () => {
    expect(() => assertReportDelivered('OPEN report', {
      txStatus: TxStatus.SUCCESS,
      receiverContractExecutionStatus: EVM_PB.ReceiverContractExecutionStatus.REVERTED,
    })).toThrow('OPEN report receiver execution failed: REVERTED')
  })

  test('accepts successful and dry-run write results', () => {
    expect(() => assertReportDelivered('OPEN report', {
      txStatus: TxStatus.SUCCESS,
      receiverContractExecutionStatus: EVM_PB.ReceiverContractExecutionStatus.SUCCESS,
    })).not.toThrow()
    expect(() => assertReportDelivered('OPEN report', { txStatus: TxStatus.SUCCESS })).not.toThrow()
  })
})