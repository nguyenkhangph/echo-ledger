import { describe, expect, test } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { assertReportDelivered, calculatePnlBps, medianPriceE8, settlementReason } from './workflow'

describe('SETTLE calculations', () => {
  test('uses the median consensus price and rejects >1% disagreement', () => {
    expect(medianPriceE8({ coingecko: 100, coinbase: 100.2, binance: 99.9 })).toBe(10_000_000_000n)
    // One source unavailable (0): median of the other two.
    expect(medianPriceE8({ coingecko: 0, coinbase: 100.2, binance: 99.8 })).toBe(10_000_000_000n)
    expect(() => medianPriceE8({ coingecko: 0, coinbase: 0, binance: 99.8 })).toThrow('at least 2')
    expect(() => medianPriceE8({ coingecko: 0, coinbase: 100, binance: 95 })).toThrow('disagree')
    expect(() => medianPriceE8({ coingecko: 100, coinbase: 100.2, binance: 95 })).toThrow(
      'Price sources disagree by more than 1%',
    )
  })

  test('computes side-aware pnl in basis points', () => {
    expect(calculatePnlBps(0, 100n, 110n)).toBe(1_000n)
    expect(calculatePnlBps(0, 100n, 92n)).toBe(-800n)
    expect(calculatePnlBps(1, 100n, 90n)).toBe(1_000n)
    expect(calculatePnlBps(1, 100n, 108n)).toBe(-800n)
  })

  test('settles stop loss before horizon and settles horizon when due', () => {
    expect(settlementReason(1_100n, 1_000n, 24, 0.08, -800n)).toBe('STOP_LOSS')
    expect(settlementReason(87_400n, 1_000n, 24, 0.08, 100n)).toBe('HORIZON')
    expect(settlementReason(2_000n, 1_000n, 24, 0.08, 100n)).toBeNull()
  })
})

describe('report delivery status', () => {
  test('rejects a receiver failure even when the outer transaction succeeded', () => {
    expect(() => assertReportDelivered('SETTLE report', {
      txStatus: TxStatus.SUCCESS,
      receiverContractExecutionStatus: EVM_PB.ReceiverContractExecutionStatus.REVERTED,
    })).toThrow('SETTLE report receiver execution failed: REVERTED')
  })

  test('accepts successful and dry-run write results', () => {
    expect(() => assertReportDelivered('SETTLE report', {
      txStatus: TxStatus.SUCCESS,
      receiverContractExecutionStatus: EVM_PB.ReceiverContractExecutionStatus.SUCCESS,
    })).not.toThrow()
    expect(() => assertReportDelivered('SETTLE report', { txStatus: TxStatus.SUCCESS })).not.toThrow()
  })
})