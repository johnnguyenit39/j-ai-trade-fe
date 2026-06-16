// Binance USDT-M Futures public REST client (no API key required for klines).
// Ported from brokers/binance/* and trading/marketdata/fetcher.go.
//
// In dev, calls route through the Vite proxy (/api/binance) to avoid CORS;
// in prod they hit fapi.binance.com directly (replace with a backend proxy
// when CORS becomes a problem in production).

import { binanceInterval, type Candle, type MarketData, type Timeframe } from '../trading/types'

const BASE_URL = import.meta.env.DEV ? '/api/binance' : 'https://fapi.binance.com'

/** Mirrors utils.ConvertPair — Binance symbols carry no slash. */
export function convertPair(pair: string): string {
  return pair.replace(/\//g, '')
}

// A raw kline row: [openTime, open, high, low, close, volume, closeTime, ...].
type RawKline = [number, string, string, string, string, string, number, ...unknown[]]

/** Fetches klines for one symbol/interval and parses them into Candles. */
export async function fetchCandles(
  symbol: string,
  interval: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const url = `${BASE_URL}/fapi/v1/klines?symbol=${convertPair(symbol)}&interval=${interval}&limit=${limit}`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`Binance klines ${symbol} ${interval}: HTTP ${res.status}`)
  }
  const raw = (await res.json()) as RawKline[]
  return raw.map((r) => ({
    symbol,
    openTime: r[0],
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
    closeTime: r[6],
  }))
}

/**
 * Fetches the requested candle counts per timeframe. Like the Go fetcher we
 * request `minCount + 20` so warm-up-heavy indicators (ADX-28, EMA-200) have a
 * cushion against off-by-one boundaries.
 */
export async function fetchMarketData(
  symbol: string,
  required: Partial<Record<Timeframe, number>>,
  signal?: AbortSignal,
): Promise<MarketData> {
  const entries = Object.entries(required) as [Timeframe, number][]
  const results = await Promise.all(
    entries.map(async ([tf, minCount]) => {
      const candles = await fetchCandles(symbol, binanceInterval(tf), minCount + 20, signal)
      return [tf, candles] as const
    }),
  )
  const candles: MarketData['candles'] = {}
  for (const [tf, c] of results) candles[tf] = c
  return { symbol, candles }
}
