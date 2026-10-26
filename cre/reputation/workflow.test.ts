import { describe, expect, test } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { assertReportDelivered, nextTrust } from './workflow'

describe('nextTrust', () => {
  test('rewards winning independent sources', () => {
    expect(nextTrust(5_000n, 2n, 600n, false, 250n)).toEqual({ score: 5_250n, trades: 3n })
  })

  test('penalizes losing sources and adds an echo penalty', () => {
    expect(nextTrust(5_000n, 2n, -600n, false, 250n)).toEqual({ score: 4_750n, trades: 3n })
    expect(nextTrust(5_000n, 2n, -600n, true, 250n)).toEqual({ score: 4_500n, trades: 3n })
  })

  test('applies echo penalty to a winning source', () => {
    expect(nextTrust(5_000n, 0n, 600n, true, 250n)).toEqual({ score: 5_000n, trades: 1n })
  })

  test('clamps scores to 0..10000', () => {
    expect(nextTrust(9_900n, 1n, 100n, false, 250n).score).toBe(10_000n)
    expect(nextTrust(100n, 1n, -100n, true, 250n).score).toBe(0n)
  })
})

describe('report delivery status', () => {
  test('rejects a receiver failure even when the outer transaction succeeded', () => {
    expect(() => assertReportDelivered('TRUST_UPDATE report', {
      txStatus: TxStatus.SUCCESS,
      receiverContractExecutionStatus: EVM_PB.ReceiverContractExecutionStatus.REVERTED,
    })).toThrow('TRUST_UPDATE report receiver execution failed: REVERTED')
  })

  test('accepts successful and dry-run write results', () => {
    expect(() => assertReportDelivered('TRUST_UPDATE report', {
      txStatus: TxStatus.SUCCESS,
      receiverContractExecutionStatus: EVM_PB.ReceiverContractExecutionStatus.SUCCESS,
    })).not.toThrow()
    expect(() => assertReportDelivered('TRUST_UPDATE report', { txStatus: TxStatus.SUCCESS })).not.toThrow()
  })
})