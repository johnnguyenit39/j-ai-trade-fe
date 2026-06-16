// Faithful TypeScript port of modules/advisor/biz/market/digest.go.
// Builds a PairSnapshot from multi-TF candles and renders the
// [MARKET_DATA]...[/MARKET_DATA] prompt blob. All formulas, thresholds,
// window constants, and output strings mirror the Go source exactly.

import { Timeframe } from '../types'
import type { Candle, MarketData } from '../types'
import {
  closes as indCloses,
  closedCandles,
  ema,
  rsi,
  atr as indATR,
  adx as indADX,
  donchianChannel,
  bollingerBands,
  swingHighLow,
} from '../indicators'
import { f0, f1, f2, f4 } from './format'
import {
  recentPivots,
  detectDoubleTopBottom,
  detectRange,
  type Pivot,
} from './pivots'
import {
  detectBOSRetest,
  detectFailedBreakout,
  detectRecentFVG,
} from './structure'
import {
  analyzeLastBars,
  type BarPattern,
  type LevelContext,
} from './patterns'
import {
  computeRegimeVerdict,
  renderRegimeVerdict,
  type RegimeVerdict,
} from './regime'
import { formatNextClose } from './marketClock'

// RawCandleBars is the number of entry-TF raw OHLCV rows emitted.
export const RawCandleBars = 5
// RawCandleBarsM1 is the number of M1 raw OHLCV rows emitted.
export const RawCandleBarsM1 = 15

// Pivot window sizes per TF.
export const PivotLimitEntry = 6
export const PivotLimitM5 = 5
export const PivotLimitH1 = 4
export const RangeScanWindow = 30

export const BOSScanWindow = 15
export const FVGScanWindow = 25

export const PatternLookback = 3
export const PatternLookbackH1 = 2
export const PatternLookbackM5 = 2
export const PatternLookbackH4 = 2

// TFSummary is the per-timeframe digest of the market right now.
export interface TFSummary {
  timeframe: Timeframe
  regime: string
  adx14: number
  close: number
  ema20: number
  ema50: number
  ema200: number
  rsi14: number
  atr: number
  atrPct: number
  bbUpper: number
  bbMid: number
  bbLower: number
  donchHigh: number
  donchLow: number
  swingHigh: number
  swingLow: number
  candles: number

  // Range-context extras.
  bbWidthPct: number
  bbWidthPctile: number
  pricePct100: number
  hasPricePct: boolean
  nearestResist: number
  nearestSupport: number
  distResistATR: number
  distSupportATR: number

  // Structural flags.
  doubleTop: number
  doubleBottom: number
  rangeTop: number
  rangeBottom: number
  rangeWidth: number
  inRange: boolean

  // Structure / imbalance flags.
  bosDir: string
  bosLevel: number
  bosAge: number
  bosState: string
  bosBreakVol: number

  fvgDir: string
  fvgTop: number
  fvgBottom: number
  fvgAge: number
  fvgState: string

  fbDir: string
  fbLevel: number
  fbAge: number

  rangeAge: number
  asymmetricRange: string

  // Enrichments.
  emaStack: string
  atEMA20: boolean
  atEMA50: boolean
  atEMA200: boolean
  atrPercentile: number
  momentumDelta5: number
  rsiDivergence: string
  bbSqueezeReleasing: boolean
  emaCrossover: string

  // Regime transition signals.
  adxSlope: number
  priceCompressing: boolean

  // Round-level flags.
  nearestResistIsRound: boolean
  nearestSupportIsRound: boolean
}

// RawCandle is a single OHLCV row rendered into the digest.
export interface RawCandle {
  time: number // bar open time (epoch ms, UTC)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// PairSnapshot is the complete cooked view of a symbol the LLM sees.
export interface PairSnapshot {
  symbol: string
  entryTf: Timeframe
  generatedAt: number // epoch ms (UTC)
  currentPrice: number
  summaries: TFSummary[]
  rawBars: RawCandle[]
  rawBarsM1: RawCandle[]
  patterns: Map<Timeframe, BarPattern[]>
  pivots: Map<Timeframe, Pivot[]>

  tfAlignment: string
  intrabarMove: number
  pdh: number
  pdl: number
  session: string

  newsWindow?: string

  regimeVerdict: RegimeVerdict
}

function newTFSummary(tf: Timeframe): TFSummary {
  return {
    timeframe: tf,
    regime: '',
    adx14: 0,
    close: 0,
    ema20: 0,
    ema50: 0,
    ema200: 0,
    rsi14: 0,
    atr: 0,
    atrPct: 0,
    bbUpper: 0,
    bbMid: 0,
    bbLower: 0,
    donchHigh: 0,
    donchLow: 0,
    swingHigh: 0,
    swingLow: 0,
    candles: 0,
    bbWidthPct: 0,
    bbWidthPctile: 0,
    pricePct100: 0,
    hasPricePct: false,
    nearestResist: 0,
    nearestSupport: 0,
    distResistATR: 0,
    distSupportATR: 0,
    doubleTop: 0,
    doubleBottom: 0,
    rangeTop: 0,
    rangeBottom: 0,
    rangeWidth: 0,
    inRange: false,
    bosDir: '',
    bosLevel: 0,
    bosAge: 0,
    bosState: '',
    bosBreakVol: 0,
    fvgDir: '',
    fvgTop: 0,
    fvgBottom: 0,
    fvgAge: 0,
    fvgState: '',
    fbDir: '',
    fbLevel: 0,
    fbAge: 0,
    rangeAge: 0,
    asymmetricRange: '',
    emaStack: '',
    atEMA20: false,
    atEMA50: false,
    atEMA200: false,
    atrPercentile: 0,
    momentumDelta5: 0,
    rsiDivergence: '',
    bbSqueezeReleasing: false,
    emaCrossover: '',
    adxSlope: 0,
    priceCompressing: false,
    nearestResistIsRound: false,
    nearestSupportIsRound: false,
  }
}

function marketGet(market: MarketData, tf: Timeframe): Candle[] {
  return market.candles[tf] ?? []
}

// buildSnapshot produces a PairSnapshot from fetched multi-TF candles.
// Throws an Error if the entry TF has no candles.
export function buildSnapshot(
  market: MarketData,
  entryTf: Timeframe,
  now: number,
): PairSnapshot {
  const entryCandles = marketGet(market, entryTf)
  if (entryCandles.length === 0) {
    throw new Error(`no candles for entry timeframe "${entryTf}"`)
  }
  const currentPrice = entryCandles[entryCandles.length - 1].close

  const snap: PairSnapshot = {
    symbol: market.symbol,
    entryTf,
    generatedAt: now,
    currentPrice,
    summaries: [],
    rawBars: [],
    rawBarsM1: [],
    patterns: new Map<Timeframe, BarPattern[]>(),
    pivots: new Map<Timeframe, Pivot[]>(),
    tfAlignment: '',
    intrabarMove: 0,
    pdh: 0,
    pdl: 0,
    session: computeSession(now),
    regimeVerdict: {
      h4Vote: { tf: '', label: '', reason: '' },
      h1Vote: { tf: '', label: '', reason: '' },
      m15Vote: { tf: '', label: '', reason: '' },
      overall: '',
      mode: '',
    },
  }

  const d1 = marketGet(market, Timeframe.D1)
  if (d1.length > 0) {
    const [pdh, pdl] = computePDHPDL(d1)
    snap.pdh = pdh
    snap.pdl = pdl
  }

  // Per-TF summaries, entry TF first.
  for (const tf of summaryOrder(entryTf)) {
    const candles = marketGet(market, tf)
    if (candles.length === 0) {
      continue
    }
    snap.summaries.push(summariseTF(candles, tf))
  }
  snap.tfAlignment = computeTFAlignment(snap.summaries)
  if (snap.summaries.length > 0) {
    snap.intrabarMove = computeIntrabarMove(currentPrice, snap.summaries[0])
  }

  snap.regimeVerdict = computeRegimeVerdict(snap.summaries)

  // Raw OHLCV window for the entry TF only.
  const closedEntry = closedCandles(entryCandles)
  if (closedEntry.length > 0) {
    let start = closedEntry.length - RawCandleBars
    if (start < 0) start = 0
    for (const c of closedEntry.slice(start)) {
      snap.rawBars.push({
        time: c.openTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })
    }
  }

  // M1 raw bars for entry-timing context.
  if (entryTf !== Timeframe.M1) {
    const m1Candles = marketGet(market, Timeframe.M1)
    const closedM1 = closedCandles(m1Candles)
    if (closedM1.length > 0) {
      let start = closedM1.length - RawCandleBarsM1
      if (start < 0) start = 0
      for (const c of closedM1.slice(start)) {
        snap.rawBarsM1.push({
          time: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })
      }
    }
  }

  // Pivot sequences + structural flags per TF.
  for (let i = 0; i < snap.summaries.length; i++) {
    const sum = snap.summaries[i]
    const tf = sum.timeframe
    let limit = 0
    if (tf === entryTf) {
      limit = PivotLimitEntry
    } else if (tf === Timeframe.M5) {
      // (tf === entryTf already handled above)
      limit = PivotLimitM5
    } else if (tf === Timeframe.H1) {
      limit = PivotLimitH1
    } else {
      continue
    }
    const candles = marketGet(market, tf)
    if (candles.length === 0) {
      continue
    }
    const closed = closedCandles(candles)
    const pivots = recentPivots(closed, 3, limit)
    if (pivots.length > 0) {
      snap.pivots.set(tf, pivots)
    }
    if (sum.atr > 0) {
      const ds = detectDoubleTopBottom(pivots, sum.atr, 0.3)
      if (ds.kind !== '') {
        if (ds.kind === 'double_top') sum.doubleTop = ds.level
        else if (ds.kind === 'double_bottom') sum.doubleBottom = ds.level
      }
      const rs = detectRange(closed, sum.atr, RangeScanWindow)
      if (rs.top > 0) {
        sum.rangeTop = rs.top
        sum.rangeBottom = rs.bottom
        sum.rangeWidth = rs.widthATR
        sum.inRange = rs.isRange
        sum.rangeAge = rs.age
      }
      const bos = detectBOSRetest(closed, pivots, sum.atr, BOSScanWindow)
      if (bos.direction !== '') {
        sum.bosDir = bos.direction
        sum.bosLevel = bos.level
        sum.bosAge = bos.barsSinceBreak
        sum.bosState = bos.state
        sum.bosBreakVol = bos.breakVolMult
      }
      const fb = detectFailedBreakout(closed, pivots, BOSScanWindow)
      if (fb.direction !== '') {
        sum.fbDir = fb.direction
        sum.fbLevel = fb.level
        sum.fbAge = fb.age
      }
    }
    // FVG detection: entry TF + M5 + H4.
    if (tf === entryTf || tf === Timeframe.M5 || tf === Timeframe.H4) {
      const fvg = detectRecentFVG(closed, FVGScanWindow)
      if (fvg.direction !== '') {
        sum.fvgDir = fvg.direction
        sum.fvgTop = fvg.top
        sum.fvgBottom = fvg.bottom
        sum.fvgAge = fvg.age
        sum.fvgState = fvg.state
      }
    }
  }

  // Candle patterns per TF.
  const entryPats = analyzeTFPatterns(market, entryTf, snap.summaries, PatternLookback)
  if (entryPats.length > 0) {
    snap.patterns.set(entryTf, entryPats)
  }
  if (entryTf !== Timeframe.H1) {
    const h1Pats = analyzeTFPatterns(market, Timeframe.H1, snap.summaries, PatternLookbackH1)
    if (h1Pats.length > 0) {
      snap.patterns.set(Timeframe.H1, h1Pats)
    }
  }
  if (entryTf !== Timeframe.M5) {
    const m5Pats = analyzeTFPatterns(market, Timeframe.M5, snap.summaries, PatternLookbackM5)
    if (m5Pats.length > 0) {
      snap.patterns.set(Timeframe.M5, m5Pats)
    }
  }
  if (entryTf !== Timeframe.H4) {
    const h4Pats = analyzeTFPatterns(market, Timeframe.H4, snap.summaries, PatternLookbackH4)
    if (h4Pats.length > 0) {
      snap.patterns.set(Timeframe.H4, h4Pats)
    }
  }

  // AsymmetricRange.
  const sumByTF = new Map<Timeframe, TFSummary>()
  for (let i = 0; i < snap.summaries.length; i++) {
    sumByTF.set(snap.summaries[i].timeframe, snap.summaries[i])
  }
  const entrySum = sumByTF.get(entryTf)
  if (entrySum && entrySum.inRange) {
    let assigned = false
    const h4 = sumByTF.get(Timeframe.H4)
    if (h4) {
      if (h4.regime === 'TREND_UP') {
        entrySum.asymmetricRange = 'buy_side'
        assigned = true
      } else if (h4.regime === 'TREND_DOWN') {
        entrySum.asymmetricRange = 'sell_side'
        assigned = true
      }
    }
    if (!assigned) {
      const h1 = sumByTF.get(Timeframe.H1)
      if (h1) {
        if (h1.regime === 'TREND_UP') entrySum.asymmetricRange = 'buy_side'
        else if (h1.regime === 'TREND_DOWN') entrySum.asymmetricRange = 'sell_side'
      }
    }
  }

  return snap
}

// analyzeTFPatterns runs pattern detection on a given TF using that TF's
// own indicator levels.
function analyzeTFPatterns(
  market: MarketData,
  tf: Timeframe,
  summaries: TFSummary[],
  lookback: number,
): BarPattern[] {
  const candles = marketGet(market, tf)
  if (candles.length === 0) {
    return []
  }
  let sum: TFSummary | null = null
  for (let i = 0; i < summaries.length; i++) {
    if (summaries[i].timeframe === tf) {
      sum = summaries[i]
      break
    }
  }
  if (sum === null) {
    return []
  }
  const closed = closedCandles(candles)
  if (closed.length === 0) {
    return []
  }
  const lvl: LevelContext = {
    atr: sum.atr,
    swingHigh: sum.swingHigh,
    swingLow: sum.swingLow,
    bbUpper: sum.bbUpper,
    bbLower: sum.bbLower,
    nearestR: sum.nearestResist,
    nearestS: sum.nearestSupport,
  }
  return analyzeLastBars(closed, lookback, lvl)
}

// summaryOrder returns the canonical ordering for per-TF blocks.
function summaryOrder(entryTf: Timeframe): Timeframe[] {
  const all: Timeframe[] = [
    Timeframe.M1,
    Timeframe.M5,
    Timeframe.M15,
    Timeframe.H1,
    Timeframe.H4,
    Timeframe.D1,
  ]
  let startIdx = -1
  for (let i = 0; i < all.length; i++) {
    if (all[i] === entryTf) {
      startIdx = i
      break
    }
  }
  if (startIdx < 0) {
    return all
  }
  const out: Timeframe[] = []
  out.push(all[startIdx])
  for (let i = 0; i < all.length; i++) {
    if (i === startIdx) continue
    out.push(all[i])
  }
  return out
}

// summariseTF computes every indicator the digest reports, on CLOSED
// candles.
function summariseTF(candles: Candle[], tf: Timeframe): TFSummary {
  const closed = closedCandles(candles)
  if (closed.length === 0) {
    return newTFSummary(tf)
  }
  const closeVals = indCloses(closed)
  const last = closed[closed.length - 1].close

  const sum = newTFSummary(tf)
  sum.close = last
  sum.candles = closed.length
  sum.adx14 = indADX(closed, 14)
  sum.rsi14 = rsi(closeVals, 14)
  sum.ema20 = ema(closeVals, 20)
  sum.ema50 = ema(closeVals, 50)
  if (closeVals.length >= 200) {
    sum.ema200 = ema(closeVals, 200)
  }
  sum.atr = indATR(closed, 14)
  if (last > 0 && sum.atr > 0) {
    sum.atrPct = (sum.atr / last) * 100
  }
  if (closeVals.length >= 20) {
    const bb = bollingerBands(closeVals, 20, 2.0)
    sum.bbUpper = bb.upper
    sum.bbMid = bb.middle
    sum.bbLower = bb.lower
    const dc = donchianChannel(closed, 20)
    sum.donchHigh = dc.high
    sum.donchLow = dc.low
  }
  const sw = swingHighLow(closed, 3)
  sum.swingHigh = sw.swingHigh
  sum.swingLow = sw.swingLow

  // ADX slope over last 5 bars.
  if (closed.length >= 20) {
    const pastADX = indADX(closed.slice(0, closed.length - 5), 14)
    sum.adxSlope = (sum.adx14 - pastADX) / 5
  }

  // Price compression.
  if (closed.length >= 10 && sum.atr > 0) {
    const window = closed.slice(closed.length - 10)
    let maxH = window[0].high
    let minL = window[0].low
    for (let i = 1; i < window.length; i++) {
      const c = window[i]
      if (c.high > maxH) maxH = c.high
      if (c.low < minL) minL = c.low
    }
    sum.priceCompressing = maxH - minL < 1.5 * sum.atr
  }

  sum.regime = simpleRegime(sum.adx14, sum.ema20, sum.ema50, sum.adxSlope, sum.priceCompressing)

  fillRangeContext(sum, closeVals)
  fillEMAContext(sum)
  fillATRPercentile(sum, closed)
  fillMomentumDelta5(sum, closed)
  fillRSIDivergence(sum, closed)
  fillBBSqueezeReleasing(sum, closeVals)
  fillEMACrossover(sum, closed)
  return sum
}

function fillRangeContext(sum: TFSummary, closeVals: number[]): void {
  const n = closeVals.length
  if (n === 0) {
    return
  }
  const last = closeVals[n - 1]

  if (sum.bbMid > 0) {
    sum.bbWidthPct = ((sum.bbUpper - sum.bbLower) / sum.bbMid) * 100
    const bbHist = 50
    if (n >= bbHist + 20) {
      const widths: number[] = []
      for (let i = n - bbHist; i <= n; i++) {
        const bb = bollingerBands(closeVals.slice(0, i), 20, 2.0)
        if (bb.middle > 0) {
          widths.push(((bb.upper - bb.lower) / bb.middle) * 100)
        }
      }
      if (widths.length > 1) {
        const curr = widths[widths.length - 1]
        let below = 0
        for (const w of widths.slice(0, widths.length - 1)) {
          if (w < curr) below++
        }
        sum.bbWidthPctile = (below / (widths.length - 1)) * 100
      }
    }
  }

  const priceHist = 100
  if (n >= priceHist) {
    const window = closeVals.slice(n - priceHist)
    let below = 0
    for (const v of window.slice(0, window.length - 1)) {
      if (v < last) below++
    }
    sum.pricePct100 = (below / (window.length - 1)) * 100
    sum.hasPricePct = true
  }

  if (sum.atr > 0) {
    const step = roundStep(last)
    const levels: number[] = [
      sum.bbUpper,
      sum.bbLower,
      sum.donchHigh,
      sum.donchLow,
      sum.swingHigh,
      sum.swingLow,
    ]
    if (step > 0) {
      let above = Math.ceil(last / step) * step
      if (above <= last) above += step
      let belowLvl = Math.floor(last / step) * step
      if (belowLvl >= last) belowLvl -= step
      levels.push(above)
      if (belowLvl > 0) {
        levels.push(belowLvl)
      }
    }
    for (const lv of levels) {
      if (lv <= 0) continue
      if (lv > last) {
        if (sum.nearestResist === 0 || lv < sum.nearestResist) {
          sum.nearestResist = lv
        }
      } else if (lv < last) {
        if (sum.nearestSupport === 0 || lv > sum.nearestSupport) {
          sum.nearestSupport = lv
        }
      }
    }
    if (sum.nearestResist > 0) {
      sum.distResistATR = (sum.nearestResist - last) / sum.atr
      sum.nearestResistIsRound = step > 0 && isRoundLevel(sum.nearestResist, step)
    }
    if (sum.nearestSupport > 0) {
      sum.distSupportATR = (last - sum.nearestSupport) / sum.atr
      sum.nearestSupportIsRound = step > 0 && isRoundLevel(sum.nearestSupport, step)
    }
  }
}

// simpleRegime labels the current market mode.
function simpleRegime(
  adx: number,
  ema20: number,
  ema50: number,
  adxSlope: number,
  compressing: boolean,
): string {
  if (adx < 20) {
    return 'RANGE'
  }
  if (adx < 25) {
    return 'CHOPPY'
  }
  if (ema20 > ema50) {
    if (adxSlope < -1.0 || compressing) {
      return 'TREND_UP_FADING'
    }
    return 'TREND_UP'
  }
  if (ema20 < ema50) {
    if (adxSlope < -1.0 || compressing) {
      return 'TREND_DOWN_FADING'
    }
    return 'TREND_DOWN'
  }
  return 'TREND'
}

// ---- Phase-3d per-TF enrichments (port of enrichment.go) ----

function fillEMAContext(sum: TFSummary): void {
  const c = sum.close
  const e20 = sum.ema20
  const e50 = sum.ema50
  const e200 = sum.ema200
  if (e200 > 0 && c > e20 && e20 > e50 && e50 > e200) {
    sum.emaStack = 'bullish_full'
  } else if (c > e20 && e20 > e50) {
    sum.emaStack = 'bullish_partial'
  } else if (c > e20 && e20 <= e50) {
    sum.emaStack = 'bullish_weak'
  } else if (e200 > 0 && c < e20 && e20 < e50 && e50 < e200) {
    sum.emaStack = 'bearish_full'
  } else if (c < e20 && e20 < e50) {
    sum.emaStack = 'bearish_partial'
  } else if (c < e20 && e20 >= e50) {
    sum.emaStack = 'bearish_weak'
  } else {
    sum.emaStack = 'choppy'
  }

  if (sum.atr > 0) {
    const tol = 0.3 * sum.atr
    if (e20 > 0 && Math.abs(c - e20) <= tol) sum.atEMA20 = true
    if (e50 > 0 && Math.abs(c - e50) <= tol) sum.atEMA50 = true
    if (e200 > 0 && Math.abs(c - e200) <= tol) sum.atEMA200 = true
  }
}

function fillATRPercentile(sum: TFSummary, closed: Candle[]): void {
  const window = 50
  const n = closed.length
  if (n < window + 14 || sum.atr <= 0) {
    sum.atrPercentile = -1
    return
  }
  const curr = sum.atr
  let below = 0
  let total = 0
  for (let i = n - window; i < n; i++) {
    const hist = indATR(closed.slice(0, i + 1), 14)
    if (hist <= 0) continue
    if (hist < curr) below++
    total++
  }
  if (total <= 1) {
    sum.atrPercentile = -1
    return
  }
  sum.atrPercentile = (below / total) * 100
}

function fillMomentumDelta5(sum: TFSummary, closed: Candle[]): void {
  const n = closed.length
  if (n < 6 || sum.atr <= 0) {
    return
  }
  const prev = closed[n - 6].close
  const curr = closed[n - 1].close
  sum.momentumDelta5 = (curr - prev) / sum.atr
}

function fillRSIDivergence(sum: TFSummary, closed: Candle[]): void {
  const window = 20
  const k = 3
  const n = closed.length
  if (n < window || n < 2 * k + 1) {
    return
  }
  const start = n - window
  const highs: number[] = []
  const lows: number[] = []
  for (let i = start + k; i < n - k; i++) {
    if (isPivotHighLocal(closed, i, k)) highs.push(i)
    if (isPivotLowLocal(closed, i, k)) lows.push(i)
  }
  const closeVals = indCloses(closed)
  if (highs.length >= 2) {
    const a = highs[highs.length - 2]
    const b = highs[highs.length - 1]
    const ra = rsi(closeVals.slice(0, a + 1), 14)
    const rb = rsi(closeVals.slice(0, b + 1), 14)
    if (closed[b].high > closed[a].high && rb < ra && ra > 0 && rb > 0) {
      sum.rsiDivergence = 'bearish'
      return
    }
  }
  if (lows.length >= 2) {
    const a = lows[lows.length - 2]
    const b = lows[lows.length - 1]
    const ra = rsi(closeVals.slice(0, a + 1), 14)
    const rb = rsi(closeVals.slice(0, b + 1), 14)
    if (closed[b].low < closed[a].low && rb > ra && ra > 0 && rb > 0) {
      sum.rsiDivergence = 'bullish'
    }
  }
}

// Local pivot helpers — identical to indicators isSwingHigh/Low and
// pivots isPivotHigh/Low; kept local to mirror enrichment.go's use.
function isPivotHighLocal(candles: Candle[], i: number, k: number): boolean {
  const h = candles[i].high
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue
    if (candles[j].high >= h) return false
  }
  return true
}

function isPivotLowLocal(candles: Candle[], i: number, k: number): boolean {
  const l = candles[i].low
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue
    if (candles[j].low <= l) return false
  }
  return true
}

function fillBBSqueezeReleasing(sum: TFSummary, closeVals: number[]): void {
  const n = closeVals.length
  if (n < 72 || sum.bbMid <= 0) {
    return
  }
  const curr = bollingerBands(closeVals, 20, 2.0)
  if (curr.middle <= 0) {
    return
  }
  const currW = ((curr.upper - curr.lower) / curr.middle) * 100
  const prev = bollingerBands(closeVals.slice(0, n - 3), 20, 2.0)
  if (prev.middle <= 0) {
    return
  }
  const prevW = ((prev.upper - prev.lower) / prev.middle) * 100
  let tightlyCompressed = false
  for (let i = n - 10; i < n - 1; i++) {
    if (i - 20 < 0) continue
    const bb = bollingerBands(closeVals.slice(0, i + 1), 20, 2.0)
    if (bb.middle <= 0) continue
    const histW = ((bb.upper - bb.lower) / bb.middle) * 100
    let refs = 0
    let below = 0
    for (let j = i - 50; j < i; j++) {
      if (j - 20 < 0) continue
      const bb2 = bollingerBands(closeVals.slice(0, j + 1), 20, 2.0)
      if (bb2.middle <= 0) continue
      const w2 = ((bb2.upper - bb2.lower) / bb2.middle) * 100
      refs++
      if (w2 < histW) below++
    }
    if (refs > 0) {
      const pct = (below / refs) * 100
      if (pct < 25) {
        tightlyCompressed = true
        break
      }
    }
  }
  if (tightlyCompressed && currW > prevW * 1.15) {
    sum.bbSqueezeReleasing = true
  }
}

function fillEMACrossover(sum: TFSummary, closed: Candle[]): void {
  const closeVals = indCloses(closed)
  const n = closeVals.length
  if (n < 60) {
    return
  }
  const series: { e20: number; e50: number }[] = []
  for (let i = n - 11; i < n; i++) {
    series.push({
      e20: ema(closeVals.slice(0, i + 1), 20),
      e50: ema(closeVals.slice(0, i + 1), 50),
    })
  }
  for (let i = series.length - 1; i >= 1; i--) {
    const prev = series[i - 1]
    const curr = series[i]
    if (prev.e20 <= 0 || curr.e20 <= 0) continue
    const prevSign = copysign(1, prev.e20 - prev.e50)
    const currSign = copysign(1, curr.e20 - curr.e50)
    if (prevSign !== currSign) {
      const bars = series.length - 1 - i
      if (currSign > 0) {
        sum.emaCrossover = `bull_${bars}ago`
      } else {
        sum.emaCrossover = `bear_${bars}ago`
      }
      return
    }
  }
}

// copysign mirrors Go's math.Copysign(1, x): returns +1 for x >= 0
// (including +0) and -1 for x < 0 (including -0).
function copysign(mag: number, sign: number): number {
  const isNeg = sign < 0 || Object.is(sign, -0)
  return isNeg ? -Math.abs(mag) : Math.abs(mag)
}

// ---- Snapshot-level enrichments ----

function computeTFAlignment(summaries: TFSummary[]): string {
  let bull = 0
  let bear = 0
  let mixed = 0
  const mixedTFs: string[] = []
  for (const s of summaries) {
    if (s.regime === 'TREND_UP') {
      bull++
    } else if (s.regime === 'TREND_DOWN') {
      bear++
    } else {
      mixed++
      mixedTFs.push(s.timeframe)
    }
  }
  const total = bull + bear + mixed
  if (total === 0) {
    return ''
  }
  if (bull === total) {
    return `${bull}/${total} bullish`
  }
  if (bear === total) {
    return `${bear}/${total} bearish`
  }
  if (bull > bear && bull + mixed === total) {
    return `${bull}/${total} bullish (${mixedTFs.join('/')} choppy)`
  }
  if (bear > bull && bear + mixed === total) {
    return `${bear}/${total} bearish (${mixedTFs.join('/')} choppy)`
  }
  return `mixed (${bull} up / ${bear} down / ${mixed} choppy)`
}

function computeSession(t: number): string {
  const h = new Date(t).getUTCHours()
  if (h >= 0 && h < 7) return 'ASIA'
  if (h >= 7 && h < 13) return 'LONDON'
  if (h >= 13 && h < 17) return 'LONDON_NY_OVERLAP'
  if (h >= 17 && h < 21) return 'NY'
  return 'LATE_NY'
}

function computePDHPDL(d1Candles: Candle[]): [number, number] {
  const closed = closedCandles(d1Candles)
  if (closed.length === 0) {
    return [0, 0]
  }
  const last = closed[closed.length - 1]
  return [last.high, last.low]
}

function computeIntrabarMove(currentPrice: number, entrySummary: TFSummary): number {
  if (currentPrice <= 0 || entrySummary.close <= 0 || entrySummary.atr <= 0) {
    return 0
  }
  return (currentPrice - entrySummary.close) / entrySummary.atr
}

// ---- round-level helpers ----

function roundStep(price: number): number {
  if (price >= 10000) return 500
  if (price >= 1000) return 50
  if (price >= 100) return 10
  return 1
}

function isRoundLevel(price: number, step: number): boolean {
  if (step <= 0) {
    return false
  }
  const rem = goMod(price, step)
  return rem < step * 0.01 || rem > step * 0.99
}

// goMod mirrors Go's math.Mod: result has the same sign as the dividend.
// JS's % already behaves this way for finite operands.
function goMod(x: number, y: number): number {
  return x % y
}

// ===================== RENDER =====================

// renderDigest formats the snapshot as the [MARKET_DATA] blob.
export function renderDigest(snap: PairSnapshot): string {
  // (Go takes a nil-able pointer; in TS the value is always present.)
  const b: string[] = []
  b.push(
    `[MARKET_DATA] ${snap.symbol} · generated ${formatYMDHM(snap.generatedAt)} UTC · entry_tf=${snap.entryTf}\n`,
  )
  b.push(
    'Digest guide (đọc toàn bộ blob theo nhãn; hệ thống không lặp chi tiết từng trường ở system prompt):\n',
  )
  b.push(
    '- Current price = giá live. LastClose/close trong từng block TF = nến ĐÃ đóng. Không gộp hai số này.\n',
  )
  b.push(
    '- entry_tf: khung chọn lệnh; bias H1+H4, xác nhận M5, timing M1/M5. TF: entry trước, macro sau.\n',
  )
  b.push(
    '- stack / structure / BOS (pending|retesting|confirmed) / FVG (open|filling) / nearestR|nearestS / ATR p%/50: backend đã tính — ưu tiên nhãn; không bịa pattern từ bảng OHLCV.\n',
  )
  b.push(
    '- bos vol=Xx [weak_break]: break candle volume so với avg. < 0.8x = break yếu, fake-out cao.\n',
  )
  b.push(
    '- in_range age=Nb [buy_side|sell_side]: số nến range liên tục; buy_side = chỉ BUY đáy range (H4 uptrend); sell_side = chỉ SELL đỉnh range.\n',
  )
  b.push(
    '- failed_breakout_failed_up/down: close vượt level rồi close trở lại — signal đảo chiều mạnh hơn wick_grab.\n',
  )
  b.push('- H4 pattern block = CONTEXT không phải entry trigger; exhaustion/wick_grab H4 đè M15 bias.\n')
  b.push(
    '- Pattern line: r>=0.6 tốt; TRAP (wick_grab, bb_fakeout, exhaustion) thắng tên nến cùng bar; _INVALIDATED = không tồn tại; vol>=2x ưu tiên hơn.\n',
  )
  b.push('- Dòng "News:" = lịch macro. [active]/[pre] đè ATR/vol — đừng dùng "nến căng" thay rule news.\n\n')

  if (snap.currentPrice > 0) {
    b.push(`Current price (live, ${snap.entryTf}): ${f4(snap.currentPrice)}`)
    if (snap.intrabarMove !== 0) {
      let sign = '+'
      if (snap.intrabarMove < 0) sign = ''
      b.push(` (intrabar ${sign}${f2(snap.intrabarMove)} ATR vs LastClose)`)
    }
    b.push('\n')
  }
  if (snap.tfAlignment !== '') {
    b.push(`TF alignment: ${snap.tfAlignment}\n`)
  }
  if (snap.session !== '') {
    b.push(`Session: ${snap.session} UTC\n`)
  }
  if (snap.newsWindow !== undefined && snap.newsWindow !== '') {
    b.push(`News: ${snap.newsWindow}\n`)
  }
  if (snap.pdh > 0 && snap.pdl > 0) {
    b.push(`Prev day: H=${f4(snap.pdh)} L=${f4(snap.pdl)}\n`)
  }

  const clocks: string[] = []
  for (const s of snap.summaries) {
    const line = formatNextClose(s.timeframe, snap.generatedAt)
    if (line !== '') clocks.push(line)
  }
  if (clocks.length > 0) {
    b.push(`Next closes: ${clocks.join(', ')}\n\n`)
  } else {
    b.push('\n')
  }

  renderRegimeVerdict(b, snap.regimeVerdict)

  for (const s of snap.summaries) {
    writeTFBlock(b, s)
  }

  if (snap.rawBars.length > 0) {
    writeRawBars(b, snap.entryTf, snap.rawBars)
  }
  if (snap.rawBarsM1.length > 0) {
    writeRawBars(b, Timeframe.M1, snap.rawBarsM1)
  }

  for (const sum of snap.summaries) {
    const pats = snap.patterns.get(sum.timeframe)
    if (pats && pats.length > 0) {
      writePatterns(b, sum.timeframe, pats)
    }
  }

  const footer = buildFooter(snap)
  if (footer !== '') {
    b.push(`\n${footer}\n`)
  }
  b.push('[/MARKET_DATA]')
  return b.join('')
}

function writeTFBlock(b: string[], s: TFSummary): void {
  let adxDir = ''
  if (s.adxSlope > 1.0) {
    adxDir = '↑'
  } else if (s.adxSlope < -1.0) {
    adxDir = '↓'
  }
  b.push(`${s.timeframe} (regime: ${s.regime}, ADX ${f0(s.adx14)}${adxDir}`)
  if (s.priceCompressing) {
    b.push(', price_compressing')
  }
  if (s.emaStack !== '') {
    b.push(`, stack: ${s.emaStack}`)
  }
  b.push(')\n')

  b.push(`  LastClose ${f4(s.close)}`)
  if (s.ema20 > 0) {
    b.push(`  EMA20 ${f4(s.ema20)}`)
    if (s.atEMA20) b.push(' [at]')
  }
  if (s.ema50 > 0) {
    b.push(`  EMA50 ${f4(s.ema50)}`)
    if (s.atEMA50) b.push(' [at]')
  }
  if (s.ema200 > 0) {
    b.push(`  EMA200 ${f4(s.ema200)}`)
    if (s.atEMA200) b.push(' [at]')
  }
  b.push('\n')

  b.push(`  RSI14 ${f1(s.rsi14)}`)
  if (s.atr > 0) {
    if (s.atrPercentile >= 0) {
      b.push(`  ATR ${f4(s.atr)} (${f2(s.atrPct)}%, p${f0(s.atrPercentile)}/50)`)
    } else {
      b.push(`  ATR ${f4(s.atr)} (${f2(s.atrPct)}%)`)
    }
  }
  if (s.bbMid > 0) {
    b.push(`  BB ${f4(s.bbLower)}..${f4(s.bbMid)}..${f4(s.bbUpper)}`)
  }
  b.push('\n')
  if (s.swingHigh > 0 || s.swingLow > 0 || s.donchHigh > 0) {
    const parts: string[] = []
    if (s.swingHigh > 0) parts.push('swingH ' + f4(s.swingHigh))
    if (s.swingLow > 0) parts.push('swingL ' + f4(s.swingLow))
    if (s.donchHigh > 0) parts.push(`donch20 ${f4(s.donchHigh)}/${f4(s.donchLow)}`)
    b.push(`  ${parts.join(' · ')}\n`)
  }

  const ctx: string[] = []
  if (s.nearestResist > 0 && s.distResistATR > 0) {
    ctx.push(`nearestR ${f4(s.nearestResist)} (+${f2(s.distResistATR)} ATR)`)
  }
  if (s.nearestSupport > 0 && s.distSupportATR > 0) {
    ctx.push(`nearestS ${f4(s.nearestSupport)} (-${f2(s.distSupportATR)} ATR)`)
  }
  if (ctx.length > 0) {
    b.push(`  ${ctx.join(' · ')}\n`)
  }

  const structBits: string[] = []
  if (s.inRange) {
    let rangeLabel = `in_range ${f4(s.rangeBottom)}..${f4(s.rangeTop)} (w=${f2(s.rangeWidth)} ATR, age=${s.rangeAge}b)`
    if (s.asymmetricRange !== '') {
      rangeLabel += ' [' + s.asymmetricRange + ']'
    }
    structBits.push(rangeLabel)
  }
  if (s.doubleTop > 0) {
    structBits.push(`double_top @ ${f4(s.doubleTop)}`)
  }
  if (s.doubleBottom > 0) {
    structBits.push(`double_bottom @ ${f4(s.doubleBottom)}`)
  }
  if (s.bosDir !== '') {
    let bosLine = `bos_${s.bosDir} @ ${f4(s.bosLevel)} [${s.bosState}, ${s.bosAge}b ago]`
    if (s.bosBreakVol > 0) {
      bosLine += ` vol=${f2(s.bosBreakVol)}x`
      if (s.bosBreakVol < 0.8) {
        bosLine += ' [weak_break]'
      }
    }
    structBits.push(bosLine)
  }
  if (s.fvgDir !== '') {
    structBits.push(
      `fvg_${s.fvgDir} ${f4(s.fvgBottom)}..${f4(s.fvgTop)} [${s.fvgState}, ${s.fvgAge}b ago]`,
    )
  }
  if (s.fbDir !== '') {
    structBits.push(`failed_breakout_${s.fbDir} @ ${f4(s.fbLevel)} [${s.fbAge}b ago]`)
  }
  if (structBits.length > 0) {
    b.push(`  structure: ${structBits.join(' · ')}\n`)
  }

  const dyn: string[] = []
  if (s.momentumDelta5 !== 0) {
    let sign = '+'
    if (s.momentumDelta5 < 0) sign = ''
    dyn.push(`mom5 ${sign}${f2(s.momentumDelta5)} ATR`)
  }
  if (s.rsiDivergence !== '') {
    dyn.push('rsi_div=' + s.rsiDivergence)
  }
  if (s.bbSqueezeReleasing) {
    dyn.push('bb_squeeze_releasing')
  }
  if (dyn.length > 0) {
    b.push(`  ${dyn.join(' · ')}\n`)
  }

  b.push('\n')
}

function writeRawBars(b: string[], tf: Timeframe, bars: RawCandle[]): void {
  b.push(`Recent ${tf} candles (oldest -> newest, UTC):\n`)
  for (const c of bars) {
    b.push(
      `  ${formatMDHM(c.time)}  O=${f4(c.open)} H=${f4(c.high)} L=${f4(c.low)} C=${f4(c.close)} V=${f2(c.volume)}\n`,
    )
  }
  b.push('\n')
}

function writePatterns(b: string[], tf: Timeframe, pats: BarPattern[]): void {
  if (pats.length === 0) {
    return
  }
  b.push(`Last ${pats.length} ${tf} bar patterns (oldest -> newest):\n`)
  for (let i = 0; i < pats.length; i++) {
    const p = pats[i]
    const parts: string[] = [p.kind]
    if (p.ratio > 0 && p.kind !== 'normal') {
      parts.push(`r=${p.ratio.toFixed(2)}`)
    }
    if (p.priorTrend !== '' && p.priorTrend !== 'FLAT') {
      parts.push('prior=' + p.priorTrend)
    }
    if (p.isWindowLow) parts.push('window_low')
    if (p.isWindowHigh) parts.push('window_high')
    if (p.atSupport) parts.push('at_support')
    if (p.atResistance) parts.push('at_resistance')
    if (p.wickGrabHigh) parts.push('wick_grab_high')
    if (p.wickGrabLow) parts.push('wick_grab_low')
    if (p.bbFakeoutUp) parts.push('bb_fakeout_up')
    if (p.bbFakeoutDown) parts.push('bb_fakeout_down')
    if (p.exhaustion) parts.push('exhaustion')
    if (p.volMult > 0 && p.kind !== 'normal') {
      parts.push(`vol=${f2(p.volMult)}x`)
    }
    if (p.invalidated) parts.push('INVALIDATED')

    const offset = pats.length - 1 - i
    if (p.time !== 0) {
      b.push(`  [-${offset}] ${formatMDHM(p.time)}  ${parts.join(' · ')}\n`)
    } else {
      b.push(`  [-${offset}]  ${parts.join(' · ')}\n`)
    }
  }
  b.push('\n')
}

// buildFooter emits a minimal machine-readable JSON blob. Go marshals a
// map[string]any, which sorts keys alphabetically (entry_tf, price,
// regimes, symbol) and sorts the nested regimes map by TF key. We
// reproduce that exact ordering and Go's shortest-float price encoding.
function buildFooter(snap: PairSnapshot): string {
  const regimeKeys: string[] = []
  const regimes: Record<string, string> = {}
  for (const s of snap.summaries) {
    const key = s.timeframe as string
    if (!(key in regimes)) {
      regimeKeys.push(key)
    }
    regimes[key] = s.regime
  }
  regimeKeys.sort()
  const regimeParts = regimeKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(regimes[k])}`)
  const regimesJSON = `{${regimeParts.join(',')}}`

  // Keys in alphabetical order: entry_tf, price, regimes, symbol.
  const parts = [
    `${JSON.stringify('entry_tf')}:${JSON.stringify(snap.entryTf as string)}`,
    `${JSON.stringify('price')}:${formatJSONNumber(snap.currentPrice)}`,
    `${JSON.stringify('regimes')}:${regimesJSON}`,
    `${JSON.stringify('symbol')}:${JSON.stringify(snap.symbol)}`,
  ]
  return `{${parts.join(',')}}`
}

// formatJSONNumber mirrors Go's encoding/json float64 output: shortest
// representation that round-trips. JSON.stringify of a finite number
// produces the same shortest form.
function formatJSONNumber(v: number): string {
  return JSON.stringify(v)
}

// ---- time formatting helpers (mirror Go layout strings, UTC) ----

// formatYMDHM mirrors Go layout "2006-01-02 15:04".
function formatYMDHM(ms: number): string {
  const d = new Date(ms)
  const y = String(d.getUTCFullYear()).padStart(4, '0')
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da} ${hh}:${mi}`
}

// formatMDHM mirrors Go layout "01-02 15:04".
function formatMDHM(ms: number): string {
  const d = new Date(ms)
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${mo}-${da} ${hh}:${mi}`
}
