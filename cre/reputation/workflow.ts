import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type EVMLog,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { z } from 'zod'

export const configSchema = z.object({
  chainSelectorName: z.string().min(1),
  ledgerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  initialScore: z.number().int().min(0).max(10_000),
  delta: z.number().int().positive().max(10_000),
  gasLimit: z.string().regex(/^\d+$/),
})

type Config = z.infer<typeof configSchema>
type EVMClient = InstanceType<typeof cre.capabilities.EVMClient>

type WriteResult = {
  txStatus: TxStatus
  receiverContractExecutionStatus?: EVM_PB.ReceiverContractExecutionStatus
  errorMessage?: string
}

export const assertReportDelivered = (label: string, result: WriteResult): void => {
  if (result.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`${label} transaction failed: ${result.errorMessage || result.txStatus}`)
  }
  if (
    result.receiverContractExecutionStatus !== undefined &&
    result.receiverContractExecutionStatus !== EVM_PB.ReceiverContractExecutionStatus.SUCCESS
  ) {
    throw new Error(
      `${label} receiver execution failed: ${EVM_PB.ReceiverContractExecutionStatus[result.receiverContractExecutionStatus] ?? result.receiverContractExecutionStatus}`,
    )
  }
}

const ledgerAbi = parseAbi([
  'event PositionSettled(bytes32 indexed id, int256 pnlBps)',
  'function getPositionSources(bytes32 id) view returns (bytes32[] kolIds, bool[] echoFlags)',
  'function kolTrust(bytes32 kolId) view returns ((uint256 score, uint256 trades) trust)',
])

const trustUpdateParameters = parseAbiParameters(
  'uint8 reportType, (bytes32 positionId, bytes32[] kolIds, uint256[] scores, uint256[] trades) trustReport',
)

export type TrustUpdate = { score: bigint; trades: bigint }

export const nextTrust = (
  currentScore: bigint,
  currentTrades: bigint,
  pnlBps: bigint,
  isEcho: boolean,
  delta: bigint,
): TrustUpdate => {
  let score = currentScore
  if (pnlBps > 0n) score += delta
  if (pnlBps < 0n) score -= delta
  if (isEcho) score -= delta
  if (score < 0n) score = 0n
  if (score > 10_000n) score = 10_000n
  return { score, trades: currentTrades + 1n }
}

const getEvmClient = (chainSelectorName: string): EVMClient => {
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName, isTestnet: true })
  if (!network) throw new Error(`Network not found: ${chainSelectorName}`)
  return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

const callLedger = (runtime: Runtime<Config>, client: EVMClient, callData: Hex): Hex => {
  const result = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.ledgerAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()
  return bytesToHex(result.data)
}

const readSources = (runtime: Runtime<Config>, client: EVMClient, positionId: Hex) => {
  const result = decodeFunctionResult({
    abi: ledgerAbi,
    functionName: 'getPositionSources',
    data: callLedger(
      runtime,
      client,
      encodeFunctionData({ abi: ledgerAbi, functionName: 'getPositionSources', args: [positionId] }),
    ),
  })
  if (result[0].length !== result[1].length) throw new Error(`Source metadata mismatch for ${positionId}`)
  return { kolIds: result[0], echoFlags: result[1] }
}

const readTrust = (runtime: Runtime<Config>, client: EVMClient, kolId: Hex): TrustUpdate => {
  const trust = decodeFunctionResult({
    abi: ledgerAbi,
    functionName: 'kolTrust',
    data: callLedger(
      runtime,
      client,
      encodeFunctionData({ abi: ledgerAbi, functionName: 'kolTrust', args: [kolId] }),
    ),
  })
  return { score: trust.score, trades: trust.trades }
}

const writeTrust = (
  runtime: Runtime<Config>,
  client: EVMClient,
  positionId: Hex,
  kolIds: readonly Hex[],
  updates: readonly TrustUpdate[],
): void => {
  const callData = encodeAbiParameters(trustUpdateParameters, [
    2,
    {
      positionId,
      kolIds: [...kolIds],
      scores: updates.map((update) => update.score),
      trades: updates.map((update) => update.trades),
    },
  ])
  const report = runtime.report(prepareReportRequest(callData)).result()
  const result = client
    .writeReport(runtime, {
      receiver: runtime.config.ledgerAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()
  assertReportDelivered(`TRUST_UPDATE report for ${positionId}`, result)
  runtime.log(
    `TRUST_UPDATE positionId=${positionId} kols=${kolIds.length} scores=${updates.map((update) => update.score.toString()).join(',')} tx=${bytesToHex(result.txHash || new Uint8Array(32))}`,
  )
}

export const onPositionSettled = (runtime: Runtime<Config>, log: EVMLog): string => {
  const decoded = decodeEventLog({
    abi: ledgerAbi,
    eventName: 'PositionSettled',
    data: bytesToHex(log.data),
    topics: log.topics.map((topic) => bytesToHex(topic)) as [Hex, ...Hex[]],
  })
  const { id: positionId, pnlBps } = decoded.args
  const client = getEvmClient(runtime.config.chainSelectorName)
  const sources = readSources(runtime, client, positionId)
  if (sources.kolIds.length === 0) throw new Error(`No KOL sources stored for ${positionId}`)

  const updates: TrustUpdate[] = []
  for (let i = 0; i < sources.kolIds.length; i += 1) {
    const kolId = sources.kolIds[i]
    const trust = readTrust(runtime, client, kolId)
    const currentScore = trust.trades === 0n ? BigInt(runtime.config.initialScore) : trust.score
    updates.push(nextTrust(currentScore, trust.trades, pnlBps, sources.echoFlags[i], BigInt(runtime.config.delta)))
  }
  writeTrust(runtime, client, positionId, sources.kolIds, updates)

  const outcome = pnlBps > 0n ? 'WIN' : pnlBps < 0n ? 'LOSS' : 'FLAT'
  return JSON.stringify({ positionId, outcome, pnlBps: pnlBps.toString(), updated: sources.kolIds.length })
}

export function initWorkflow(config: Config) {
  const client = getEvmClient(config.chainSelectorName)
  const eventHash = keccak256(toBytes('PositionSettled(bytes32,int256)'))
  return [
    cre.handler(
      client.logTrigger({
        addresses: [hexToBase64(config.ledgerAddress as Hex)],
        topics: [{ values: [hexToBase64(eventHash)] }],
        confidence: 'CONFIDENCE_LEVEL_FINALIZED',
      }),
      onPositionSettled,
    ),
  ]
}