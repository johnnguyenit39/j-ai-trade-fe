// Market-enrichment orchestration — faithful port of Analyzer.MaybeEnrich
// (modules/advisor/biz/market/analyzer.go). Decides whether a user message
// wants analysis, fetches the 6-TF candle bundle, builds the snapshot, and
// renders the prompt-ready [MARKET_DATA] digest.
//
// Like the Go version, ANY runtime failure (fetch error, insufficient candles)
// returns null so the caller falls back gracefully to the chat-only flow.

import { fetchMarketData } from '../market/binanceClient'
import { buildSnapshot, renderDigest } from './analysis/digest'
import { resolveIntent, wantsAnalysis } from './intent'
import { Timeframe } from './types'

// Candles fetched per timeframe. 200 bars is enough warm-up for every
// indicator (ADX14 ~28, EMA200 degrades gracefully when short).
export const CANDLE_BUDGET = 200

export interface EnrichmentResult {
  digest: string
  ack: string
  symbol: string
  currentPrice: number
  atrM15: number
  generatedAt: number
}

/**
 * Runs the market pipeline for the given user text when it wants analysis.
 * Returns null when no analysis is wanted or on any non-fatal failure.
 */
export async function maybeEnrich(
  text: string,
  lastSymbol: string,
  signal?: AbortSignal,
): Promise<EnrichmentResult | null> {
  const intent = resolveIntent(text, lastSymbol)
  if (!wantsAnalysis(intent)) return null

  // Full 6-TF bundle: M1 microstructure, M5 timing trigger, M15 signal,
  // H1/H4 bias, D1 macro. Uniform budget so every TF has warm-up.
  const required: Partial<Record<Timeframe, number>> = {
    [Timeframe.M1]: CANDLE_BUDGET,
    [Timeframe.M5]: CANDLE_BUDGET,
    [Timeframe.M15]: CANDLE_BUDGET,
    [Timeframe.H1]: CANDLE_BUDGET,
    [Timeframe.H4]: CANDLE_BUDGET,
    [Timeframe.D1]: CANDLE_BUDGET,
  }

  try {
    const market = await fetchMarketData(intent.symbol, required, signal)
    const snap = buildSnapshot(market, intent.timeframe, Date.now())

    // Only ack on explicit /analyze; free-form chat fetches silently.
    const ack = intent.explicit ? `Đang kiểm tra ${intent.symbol}...` : ''
    const m15 = snap.summaries.find((s) => s.timeframe === Timeframe.M15)

    return {
      digest: renderDigest(snap),
      ack,
      symbol: intent.symbol,
      currentPrice: snap.currentPrice,
      atrM15: m15 ? m15.atr : 0,
      generatedAt: snap.generatedAt,
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    console.warn('advisor: market enrichment failed; falling back to chat-only', err)
    return null
  }
}
