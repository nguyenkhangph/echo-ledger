import {
  ConsensusAggregationByFields,
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  median,
  prepareReportRequest,
  type HTTPPayload,
  type HTTPSendRequester,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import {
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

// Keep this validator synchronized with ../../shared/src/card.ts. CRE compiles each
// workflow as an isolated package, so imports from ../../shared cannot resolve
// shared's zod/viem dependencies in the workflow build.
const probability = z.number().min(0).max(1)
const httpUrl = z.string().regex(/^https?:\/\/[^\s]+$/)
const ReasoningCard = z
  .object({
    card_id: z.string().min(1),
    created_at: z.string().datetime({ offset: true }),
    token: z.string().min(1),
    window_h: z.number().positive(),
    sources: z.array(
      z
        .object({
          kol: z.string().min(1),
          platform: z.enum(['telegram', 'x', 'discord']),
          url: httpUrl,
          posted_at: z.string().datetime({ offset: true }),
          quote: z.string(),
          extract: z
            .object({
              sentiment: z.enum(['bull', 'bear', 'neutral']),
              conviction: probability,
              urgency: probability,
            })
            .strict(),
          indep: z.union([z.literal(0.3), z.literal(0.5), z.literal(1.0)]),
          echo_of: httpUrl.optional(),
        })
        .strict(),
    ),
    convergence: z
      .object({
        score: z.number().min(-1).max(1),
        independent_kols: z.number().int().nonnegative(),
        echo_dropped: z.number().int().nonnegative(),
        threshold: z.number().min(-1).max(1),
      })
      .strict(),
    evidence: z
      .object({
        lead_min: z.number(),
        px_change_before_pct: z.number(),
        vol_ratio: z.number().nonnegative(),
        price_sources: z.array(z.string().min(1)),
      })
      .strict(),
    debate: z
      .object({
        bull: z.string(),
        bear: z.string(),
        verdict: z.enum(['APPROVE', 'REJECT', 'HOLD']),
        confidence: probability,
        models: z.array(z.string().min(1)),
      })
      .strict(),
    risk_rules: z
      .object({
        max_position_pct: probability,
        max_open: z.number().int().nonnegative(),
        stop_loss_pct: probability,
        min_mcap_usd: z.number().nonnegative(),
        horizon_h: z.number().positive(),
      })
      .strict(),
    models: z
      .object({
        extract_model: z.string().min(1),
        judge_model: z.string().min(1),
        prompt_hashes: z.record(z.string()),
      })
      .strict(),
    decision: z
      .object({
        side: z.enum(['long', 'short', 'none']),
        size_pct: probability,
      })
      .strict(),
  })
  .strict()

const canonicalJson = (value: unknown): string => {
  const encoded = JSON.stringify(value, (_key, current: unknown) => {
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      const object = current as Record<string, unknown>
      return Object.keys(object)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = object[key]
          return sorted
        }, {})
    }
    return current
  })
  if (encoded === undefined) throw new TypeError('Card is not JSON-serializable')
  return encoded
}

export const configSchema = z.object({
  chainSelectorName: z.string(),
  ledgerAddress: z.string(),
  gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>
export type Card = z.infer<typeof ReasoningCard>

const ledgerAbi = parseAbi([
  'function openPositionIds() view returns (bytes32[])',
  'function getPosition(bytes32 id) view returns (bool exists, bool settled, string token, uint8 side, uint256 sizeBps, uint256 entryPriceE8, bytes32 cardHash, uint8 attestation, uint256 reasonCode, uint256 exitPriceE8, int256 pnlBps, uint256 settledAt)',
])

const openReportParameters = parseAbiParameters(
  'uint8 reportType, (bytes32 positionId, string token, uint8 side, uint256 sizeBps, uint256 entryPriceE8, bytes32 cardHash, uint8 attestation, uint256 reasonCode) openReport',
)

const priceSnapshotSchema = z.object({
  coingecko: z.number().positive(),
  coinbase: z.number().positive(),
  binance: z.number().positive(),
  marketCapUsd: z.number().nonnegative(),
})
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>

const tokenMap: Record<string, { gecko: string; coinbase: string; binance: string }> = {
  BTC: { gecko: 'bitcoin', coinbase: 'BTC-USD', binance: 'BTCUSDT' },
  ETH: { gecko: 'ethereum', coinbase: 'ETH-USD', binance: 'ETHUSDT' },
  SOL: { gecko: 'solana', coinbase: 'SOL-USD', binance: 'SOLUSDT' },
}

const parseJson = (body: Uint8Array): any => JSON.parse(new TextDecoder().decode(body))

const fetchPrices = (requester: HTTPSendRequester, card: Card): PriceSnapshot => {
  const symbols = tokenMap[card.token.toUpperCase()]
  if (!symbols) throw new Error(`Unsupported token: ${card.token}`)

  const geckoResponse = requester
    .sendRequest({
      method: 'GET',
      url: `https://api.coingecko.com/api/v3/coins/${symbols.gecko}?localization=false&tickers=false&market_data=true`,
    })
    .result()
  const coinbaseResponse = requester
    .sendRequest({ method: 'GET', url: `https://api.coinbase.com/v2/prices/${symbols.coinbase}/spot` })
    .result()
  const binanceResponse = requester
    .sendRequest({ method: 'GET', url: `https://api.binance.com/api/v3/ticker/price?symbol=${symbols.binance}` })
    .result()

  if (geckoResponse.statusCode !== 200 || coinbaseResponse.statusCode !== 200 || binanceResponse.statusCode !== 200) {
    throw new Error('One or more price APIs returned a non-200 response')
  }

  const gecko = parseJson(geckoResponse.body)
  const coinbase = parseJson(coinbaseResponse.body)
  const binance = parseJson(binanceResponse.body)
  return priceSnapshotSchema.parse({
    coingecko: Number(gecko.market_data?.current_price?.usd),
    coinbase: Number(coinbase.data?.amount),
    binance: Number(binance.price),
    marketCapUsd: Number(gecko.market_data?.market_cap?.usd),
  })
}

const getEvmClient = (runtime: Runtime<Config>) => {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.chainSelectorName}`)
  return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

const readOpenCount = (runtime: Runtime<Config>, client: ReturnType<typeof getEvmClient>): number => {
  const callData = encodeFunctionData({ abi: ledgerAbi, functionName: 'openPositionIds' })
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
  const ids = decodeFunctionResult({
    abi: ledgerAbi,
    functionName: 'openPositionIds',
    data: bytesToHex(reply.data),
  })
  return ids.length
}

export type Gate = {
  attestation: 0 | 1 | 2
  sizeBps: bigint
  side: 0 | 1 | 2
  reasonCode: bigint
  reason: string
}

export const riskGate = (card: Card, price: PriceSnapshot, openCount: number): Gate => {
  const sourcePrices = [price.coingecko, price.coinbase, price.binance]
  const medianPrice = [...sourcePrices].sort((a, b) => a - b)[1]
  const deviation = Math.max(...sourcePrices.map((value) => Math.abs(value - medianPrice) / medianPrice))
  const requestedBps = Math.round(card.decision.size_pct * 10_000)
  const maxBps = Math.round(card.risk_rules.max_position_pct * 10_000)
  const side = card.decision.side === 'long' ? 0 : card.decision.side === 'short' ? 1 : 2

  if (card.evidence.lead_min < 0) {
    return { attestation: 2, sizeBps: 0n, side: 2, reasonCode: 1001n, reason: 'lead_min_negative' }
  }
  if (deviation > 0.01) {
    return { attestation: 2, sizeBps: 0n, side: 2, reasonCode: 1002n, reason: 'price_sources_disagree_gt_1pct' }
  }
  if (price.marketCapUsd < card.risk_rules.min_mcap_usd) {
    return { attestation: 2, sizeBps: 0n, side: 2, reasonCode: 1003n, reason: 'market_cap_below_minimum' }
  }
  if (openCount >= card.risk_rules.max_open) {
    return { attestation: 2, sizeBps: 0n, side: 2, reasonCode: 1004n, reason: 'max_open_reached' }
  }
  if (card.decision.side === 'none' || requestedBps === 0) {
    return { attestation: 2, sizeBps: 0n, side: 2, reasonCode: 1005n, reason: 'card_decision_is_none' }
  }
  if (requestedBps > maxBps) {
    return {
      attestation: 1,
      sizeBps: BigInt(maxBps),
      side,
      reasonCode: 1006n,
      reason: 'size_constrained_to_max_position_pct',
    }
  }
  return { attestation: 0, sizeBps: BigInt(requestedBps), side, reasonCode: 0n, reason: 'approved' }
}

const writeOpenReport = (
  runtime: Runtime<Config>,
  card: Card,
  suppliedHash: Hex,
  price: PriceSnapshot,
  gate: Gate,
  client: ReturnType<typeof getEvmClient>,
): string => {
  const medianPrice = [price.coingecko, price.coinbase, price.binance].sort((a, b) => a - b)[1]
  const entryPriceE8 = BigInt(Math.round(medianPrice * 1e8))
  const positionId = keccak256(toBytes(`${card.card_id}:${suppliedHash}`))
  const callData = encodeAbiParameters(openReportParameters, [
    0,
    {
      positionId,
      token: card.token,
      side: gate.side,
      sizeBps: gate.sizeBps,
      entryPriceE8,
      cardHash: suppliedHash,
      attestation: gate.attestation,
      reasonCode: gate.reasonCode,
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
  if (result.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`OPEN report failed: ${result.errorMessage || result.txStatus}`)
  }
  const decision = gate.attestation === 0 ? 'APPROVE' : gate.attestation === 1 ? 'CONSTRAIN' : 'REJECT'
  runtime.log(
    `OPEN ${decision} reasonCode=${gate.reasonCode.toString()} reason=${gate.reason} priceE8=${entryPriceE8.toString()} tx=${bytesToHex(result.txHash || new Uint8Array(32))}`,
  )
  return JSON.stringify({ decision, reasonCode: gate.reasonCode.toString(), reason: gate.reason })
}

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const input = JSON.parse(new TextDecoder().decode(payload.input)) as { card?: unknown; cardHash?: unknown }
  const card = ReasoningCard.parse(input.card)
  const expectedHash = keccak256(toBytes(canonicalJson(card)))
  if (typeof input.cardHash !== 'string' || input.cardHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error('cardHash does not match canonical card JSON')
  }

  const prices = new cre.capabilities.HTTPClient()
    .sendRequest(
      runtime,
      fetchPrices,
      ConsensusAggregationByFields<PriceSnapshot>({
        coingecko: median,
        coinbase: median,
        binance: median,
        marketCapUsd: median,
      }),
    )(card)
    .result()
  runtime.log(
    `Prices coingecko=${prices.coingecko} coinbase=${prices.coinbase} binance=${prices.binance} marketCapUsd=${prices.marketCapUsd}`,
  )

  const client = getEvmClient(runtime)
  const openCount = readOpenCount(runtime, client)
  runtime.log(`EchoLedger open positions=${openCount}`)
  return writeOpenReport(runtime, card, input.cardHash as Hex, prices, riskGate(card, prices, openCount), client)
}

export function initWorkflow(_config: Config) {
  return [
    cre.handler(
      new cre.capabilities.HTTPCapability().trigger({ authorizedKeys: [] }),
      onHttpTrigger,
    ),
  ]
}