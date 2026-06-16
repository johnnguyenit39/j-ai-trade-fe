// Live smoke test: fetch real XAUUSDT klines, build the snapshot, render the
// [MARKET_DATA] digest, and exercise intent + decision parsing.
// Run: npx tsx scripts/smoke.mts
import { buildSnapshot, renderDigest } from '../src/trading/analysis/digest'
import { resolveIntent, wantsAnalysis } from '../src/trading/intent'
import { Timeframe, binanceInterval, type Candle, type MarketData } from '../src/trading/types'
import { extractDecision } from '../src/ai/trading/decisionParser'

const TFS = [Timeframe.M1, Timeframe.M5, Timeframe.M15, Timeframe.H1, Timeframe.H4, Timeframe.D1]

async function fetchTF(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${binanceInterval(tf)}&limit=220`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${tf}: HTTP ${res.status}`)
  const raw = (await res.json()) as [number, string, string, string, string, string, number][]
  return raw.map((r) => ({
    symbol,
    openTime: r[0],
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
    closeTime: r[6],
  }))
}

async function main() {
  // 1) intent
  for (const t of ['vàng giờ buy hay sell?', '/analyze btc H1', 'hello there']) {
    const i = resolveIntent(t, '')
    console.log(`intent("${t}") => symbol=${i.symbol} tf=${i.timeframe} explicit=${i.explicit} wants=${wantsAnalysis(i)}`)
  }
  console.log('---')

  // 2) live digest
  const symbol = 'XAUUSDT'
  const candles: MarketData['candles'] = {}
  for (const tf of TFS) candles[tf] = await fetchTF(symbol, tf)
  const market: MarketData = { symbol, candles }
  const snap = buildSnapshot(market, Timeframe.M15, Date.now())
  const digest = renderDigest(snap)
  console.log(digest)
  console.log('---')
  console.log(`currentPrice=${snap.currentPrice} summaries=${snap.summaries.length} digestChars=${digest.length}`)

  // 3) decision parser sanity
  const sample = 'Setup ngon.\n```json\n{"action":"buy","symbol":"xauusdt","entry":4315.2,"stop_loss":4308,"take_profit":4330,"lot":0.1,"confidence":"medium"}\n```'
  console.log('decision =>', extractDecision(sample))
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e)
  process.exit(1)
})
