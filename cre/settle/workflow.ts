import {
  ConsensusAggregationByFields,
  bigintToProtoBigInt,
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  median,
  prepareReportRequest,
  protoBigIntToBigint,
  type CronPayload,
  type HTTPSendRequester,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { z } from 'zod'

export const configSchema = z.object({
  schedule: z.string().min(1),
  chainSelectorName: z.string().min(1),
  ledgerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deploymentBlock: z.string().regex(/^\d+$/),
  horizonHours: z.number().positive(),
  stopLossPct: z.number().min(0).max(1),
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
  'function openPositionIds() view returns (bytes32[])',
  'function getPosition(bytes32 id) view returns ((bool exists, bool settled, string token, uint8 side, uint256 sizeBps, uint256 entryPriceE8, bytes32 cardHash, uint8 attestation, uint256 reasonCode, uint256 exitPriceE8, int256 pnlBps, uint256 settledAt) position)',
  'event PositionOpened(bytes32 indexed id, string token, bytes32 indexed cardHash)',
])

const settleReportParameters = parseAbiParameters(
  'uint8 reportType, (bytes32 positionId, uint256 exitPriceE8, int256 pnlBps, uint256 settledAt) settleReport',
)

export type Position = {
  id: Hex
  token: string
  side: number
  entryPriceE8: bigint
}

export type PriceSnapshot = {
  coingecko: number
  coinbase: number
  binance: number
}

const priceSnapshotSchema = z.object({
  coingecko: z.number().positive(),
  coinbase: z.number().positive(),
  binance: z.number().positive(),
})

const tokenMap: Record<string, { gecko: string; coinbase: string; binance: string }> = {
  BTC: { gecko: 'bitcoin', coinbase: 'BTC-USD', binance: 'BTCUSDT' },
  ETH: { gecko: 'ethereum', coinbase: 'ETH-USD', binance: 'ETHUSDT' },
  SOL: { gecko: 'solana', coinbase: 'SOL-USD', binance: 'SOLUSDT' },
}

const parseJson = (body: Uint8Array): any => JSON.parse(new TextDecoder().decode(body))

const fetchPrices = (requester: HTTPSendRequester, token: string): PriceSnapshot => {
  const symbols = tokenMap[token.toUpperCase()]
  if (!symbols) throw new Error(`Unsupported token: ${token}`)

  const geckoResponse = requester
    .sendRequest({
      method: 'GET',
      url: `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.gecko}&vs_currencies=usd`,
    })
    .result()
  const coinbaseResponse = requester
    .sendRequest({ method: 'GET', url: `https://api.coinbase.com/v2/prices/${symbols.coinbase}/spot` })
    .result()
  const binanceResponse = requester
    .sendRequest({ method: 'GET', url: `https://api.binance.com/api/v3/ticker/price?symbol=${symbols.binance}` })
    .result()

  if (geckoResponse.statusCode !== 200 || coinbaseResponse.statusCode !== 200 || binanceResponse.statusCode !== 200) {
    throw new Error(`One or more ${token} price APIs returned a non-200 response`)
  }

  const gecko = parseJson(geckoResponse.body)
  const coinbase = parseJson(coinbaseResponse.body)
  const binance = parseJson(binanceResponse.body)
  return priceSnapshotSchema.parse({
    coingecko: Number(gecko[symbols.gecko]?.usd),
    coinbase: Number(coinbase.data?.amount),
    binance: Number(binance.price),
  })
}

const getEvmClient = (runtime: Runtime<Config>): EVMClient => {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.chainSelectorName}`)
  return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

const callLedger = (runtime: Runtime<Config>, client: EVMClient, callData: Hex): Hex => {
  const reply = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.ledgerAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()
  return bytesToHex(reply.data)
}

const readOpenPositions = (runtime: Runtime<Config>, client: EVMClient): Position[] => {
  const ids = decodeFunctionResult({
    abi: ledgerAbi,
    functionName: 'openPositionIds',
    data: callLedger(runtime, client, encodeFunctionData({ abi: ledgerAbi, functionName: 'openPositionIds' })),
  })

  return ids.map((id) => {
    const position = decodeFunctionResult({
      abi: ledgerAbi,
      functionName: 'getPosition',
      data: callLedger(
        runtime,
        client,
        encodeFunctionData({ abi: ledgerAbi, functionName: 'getPosition', args: [id] }),
      ),
    })
    if (!position.exists || position.settled) throw new Error(`Open position index is inconsistent for ${id}`)
    return { id, token: position.token, side: position.side, entryPriceE8: position.entryPriceE8 }
  })
}

const readOpenedAt = (runtime: Runtime<Config>, client: EVMClient, positionId: Hex): bigint => {
  const topics = encodeEventTopics({ abi: ledgerAbi, eventName: 'PositionOpened', args: { id: positionId } })
  const reply = client
    .filterLogs(runtime, {
      filterQuery: {
        fromBlock: bigintToProtoBigInt(runtime.config.deploymentBlock),
        toBlock: LAST_FINALIZED_BLOCK_NUMBER,
        addresses: [hexToBase64(runtime.config.ledgerAddress as Hex)],
        topics: topics.map((topic) => ({ topic: topic ? [hexToBase64(topic as Hex)] : [] })),
      },
    })
    .result()
  const log = reply.logs.find((candidate) => candidate.topics.length > 1 && bytesToHex(candidate.topics[1]) === positionId)
  if (!log?.blockNumber) throw new Error(`PositionOpened log not found for ${positionId}`)
  const header = client
    .headerByNumber(runtime, { blockNumber: bigintToProtoBigInt(protoBigIntToBigint(log.blockNumber)) })
    .result().header
  if (!header) throw new Error(`Opening block header not found for ${positionId}`)
  return header.timestamp
}

export const medianPriceE8 = (snapshot: PriceSnapshot): bigint => {
  const prices = [snapshot.coingecko, snapshot.coinbase, snapshot.binance].sort((a, b) => a - b)
  const medianPrice = prices[1]
  const maxDeviation = Math.max(...prices.map((price) => Math.abs(price - medianPrice) / medianPrice))
  if (maxDeviation > 0.01) throw new Error('Price sources disagree by more than 1%')
  return BigInt(Math.round(medianPrice * 1e8))
}

export const calculatePnlBps = (side: number, entryPriceE8: bigint, exitPriceE8: bigint): bigint => {
  if (entryPriceE8 <= 0n) throw new Error('Entry price must be positive')
  const longPnl = ((exitPriceE8 - entryPriceE8) * 10_000n) / entryPriceE8
  if (side === 0) return longPnl
  if (side === 1) return -longPnl
  throw new Error(`Cannot settle Side.NONE (${side})`)
}

export const settlementReason = (
  nowSeconds: bigint,
  openedAt: bigint,
  horizonHours: number,
  stopLossPct: number,
  pnlBps: bigint,
): 'HORIZON' | 'STOP_LOSS' | null => {
  const stopLossBps = BigInt(Math.round(stopLossPct * 10_000))
  if (pnlBps <= -stopLossBps) return 'STOP_LOSS'
  const horizonSeconds = BigInt(Math.round(horizonHours * 3_600))
  if (nowSeconds >= openedAt + horizonSeconds) return 'HORIZON'
  return null
}

const writeSettlement = (
  runtime: Runtime<Config>,
  client: EVMClient,
  position: Position,
  exitPriceE8: bigint,
  pnlBps: bigint,
  settledAt: bigint,
  reason: string,
): void => {
  const callData = encodeAbiParameters(settleReportParameters, [
    1,
    { positionId: position.id, exitPriceE8, pnlBps, settledAt },
  ])
  const report = runtime.report(prepareReportRequest(callData)).result()
  const result = client
    .writeReport(runtime, {
      receiver: runtime.config.ledgerAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()
  assertReportDelivered(`SETTLE report for ${position.id}`, result)
  runtime.log(
    `SETTLE id=${position.id} token=${position.token} reason=${reason} exitPriceE8=${exitPriceE8.toString()} pnlBps=${pnlBps.toString()} tx=${bytesToHex(result.txHash || new Uint8Array(32))}`,
  )
}

export const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
  const nowSeconds = BigInt(Math.floor(runtime.now().getTime() / 1_000))
  const client = getEvmClient(runtime)
  const positions = readOpenPositions(runtime, client)
  runtime.log(`EchoLedger open positions=${positions.length}`)
  if (positions.length === 0) return JSON.stringify({ checked: 0, settled: 0 })

  const httpClient = new cre.capabilities.HTTPClient()
  const priceByToken: Record<string, bigint> = {}
  let settled = 0
  for (const position of positions) {
    if (!priceByToken[position.token]) {
      const snapshot = httpClient
        .sendRequest(
          runtime,
          fetchPrices,
          ConsensusAggregationByFields<PriceSnapshot>({
            coingecko: median,
            coinbase: median,
            binance: median,
          }),
        )(position.token)
        .result()
      priceByToken[position.token] = medianPriceE8(snapshot)
      runtime.log(
        `Prices token=${position.token} coingecko=${snapshot.coingecko} coinbase=${snapshot.coinbase} binance=${snapshot.binance}`,
      )
    }

    const exitPriceE8 = priceByToken[position.token]
    const pnlBps = calculatePnlBps(position.side, position.entryPriceE8, exitPriceE8)
    const openedAt = readOpenedAt(runtime, client, position.id)
    const reason = settlementReason(
      nowSeconds,
      openedAt,
      runtime.config.horizonHours,
      runtime.config.stopLossPct,
      pnlBps,
    )
    if (!reason) {
      runtime.log(`HOLD id=${position.id} token=${position.token} pnlBps=${pnlBps.toString()}`)
      continue
    }
    writeSettlement(runtime, client, position, exitPriceE8, pnlBps, nowSeconds, reason)
    settled += 1
  }
  return JSON.stringify({ checked: positions.length, settled })
}

export function initWorkflow(config: Config) {
  return [
    cre.handler(
      new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }),
      onCronTrigger,
    ),
  ]
}