// Faithful TypeScript port of modules/advisor/biz/market/patterns.go.
// Candlestick pattern detection + deterministic context / trap flags.

import type { Candle } from '../types'

// BarPattern carries the deterministic shape + context + trap signals
// for a single candle.
export interface BarPattern {
  time: number // bar open time (epoch ms, UTC); 0 = unset
  kind: string
  ratio: number

  // Preceding context (deterministic, bar-local)
  priorTrend: string // "UP" | "DOWN" | "FLAT" | ""
  isWindowLow: boolean
  isWindowHigh: boolean
  atSupport: boolean
  atResistance: boolean

  // Trap / false-signal flags (bar-local)
  wickGrabHigh: boolean
  wickGrabLow: boolean
  bbFakeoutUp: boolean
  bbFakeoutDown: boolean
  exhaustion: boolean

  // Pattern invalidation — filled by markInvalidations (post-pass).
  invalidated: boolean

  // Volume context (Phase-3d).
  volMult: number
  volSpike: boolean
}

// LevelContext bundles the current-TF levels needed to classify where a
// bar sits relative to structure.
export interface LevelContext {
  atr: number
  swingHigh: number
  swingLow: number
  bbUpper: number
  bbLower: number
  nearestR: number
  nearestS: number
}

function newBarPattern(): BarPattern {
  return {
    time: 0,
    kind: '',
    ratio: 0,
    priorTrend: '',
    isWindowLow: false,
    isWindowHigh: false,
    atSupport: false,
    atResistance: false,
    wickGrabHigh: false,
    wickGrabLow: false,
    bbFakeoutUp: false,
    bbFakeoutDown: false,
    exhaustion: false,
    invalidated: false,
    volMult: 0,
    volSpike: false,
  }
}

// DetectPattern picks the most meaningful label for bar index `i`,
// checking 3-bar → 2-bar → 1-bar.
export function detectPattern(closed: Candle[], i: number): [string, number] {
  if (i < 0 || i >= closed.length) {
    return ['normal', 0]
  }
  if (i >= 2) {
    const [k, r] = detectThreeBar(closed[i - 2], closed[i - 1], closed[i])
    if (k !== '') return [k, r]
  }
  if (i >= 1) {
    const [k, r] = detectTwoBar(closed[i], closed[i - 1])
    if (k !== '') return [k, r]
  }
  return detectSingleBar(closed[i])
}

function detectSingleBar(b: Candle): [string, number] {
  const rng = b.high - b.low
  if (rng <= 0) {
    return ['normal', 0]
  }
  const body = Math.abs(b.close - b.open)
  const bodyRatio = body / rng
  const upper = b.high - Math.max(b.open, b.close)
  const lower = Math.min(b.open, b.close) - b.low

  // Marubozu: body fills ≥90% of range.
  if (bodyRatio >= 0.9) {
    if (b.close > b.open) return ['marubozu_bull', bodyRatio]
    return ['marubozu_bear', bodyRatio]
  }

  // Doji family: body < 10% range.
  if (bodyRatio < 0.1) {
    if (lower >= 0.6 * rng && upper <= 0.1 * rng) {
      return ['dragonfly_doji', lower / rng]
    }
    if (upper >= 0.6 * rng && lower <= 0.1 * rng) {
      return ['gravestone_doji', upper / rng]
    }
    return ['doji', bodyRatio]
  }

  // Pin bar family: body < 30%, one wick ≥ 2·body, other wick ≤ body.
  if (bodyRatio < 0.3) {
    if (lower >= 2 * body && upper <= body) {
      return ['hammer', lower / rng]
    }
    if (upper >= 2 * body && lower <= body) {
      return ['shooting_star', upper / rng]
    }
    if (lower >= 0.2 * rng && upper >= 0.2 * rng) {
      return ['spinning_top', bodyRatio]
    }
  }

  return ['normal', bodyRatio]
}

function detectTwoBar(curr: Candle, prev: Candle): [string, number] {
  const currRng = curr.high - curr.low
  const prevRng = prev.high - prev.low
  if (currRng <= 0 || prevRng <= 0) {
    return ['', 0]
  }
  const currBody = Math.abs(curr.close - curr.open)
  const prevBody = Math.abs(prev.close - prev.open)
  const currBodyRatio = currBody / currRng
  const currBull = curr.close > curr.open
  const prevBull = prev.close > prev.open

  // Engulfing.
  if (currBodyRatio >= 0.5 && currBody > prevBody) {
    if (currBull && !prevBull && curr.open <= prev.close && curr.close >= prev.open) {
      return ['engulfing_bull', currBodyRatio]
    }
    if (!currBull && prevBull && curr.open >= prev.close && curr.close <= prev.open) {
      return ['engulfing_bear', currBodyRatio]
    }
  }

  const prevMid = (prev.open + prev.close) / 2

  // Piercing line (bullish).
  if (!prevBull && currBull && prevBody >= currBody * 0.5) {
    if (curr.open < prev.close && curr.close > prevMid && curr.close < prev.open) {
      return ['piercing_line', (curr.close - prevMid) / (prevBody + 1e-9)]
    }
  }
  // Dark cloud cover.
  if (prevBull && !currBull && prevBody >= currBody * 0.5) {
    if (curr.open > prev.close && curr.close < prevMid && curr.close > prev.open) {
      return ['dark_cloud_cover', (prevMid - curr.close) / (prevBody + 1e-9)]
    }
  }

  // Tweezer.
  const tolerance = Math.min(currRng, prevRng) * 0.1
  if (Math.abs(curr.low - prev.low) <= tolerance && currBull && !prevBull) {
    return ['tweezer_bottom', 1 - Math.abs(curr.low - prev.low) / (tolerance + 1e-9)]
  }
  if (Math.abs(curr.high - prev.high) <= tolerance && !currBull && prevBull) {
    return ['tweezer_top', 1 - Math.abs(curr.high - prev.high) / (tolerance + 1e-9)]
  }

  // Harami.
  if (prevBody > 2 * currBody && currBody > 0) {
    const prevHi = Math.max(prev.open, prev.close)
    const prevLo = Math.min(prev.open, prev.close)
    const currHi = Math.max(curr.open, curr.close)
    const currLo = Math.min(curr.open, curr.close)
    if (currHi <= prevHi && currLo >= prevLo) {
      if (currBull && !prevBull) {
        return ['harami_bull', prevBody / (currBody + 1e-9)]
      }
      if (!currBull && prevBull) {
        return ['harami_bear', prevBody / (currBody + 1e-9)]
      }
    }
  }

  // Inside bar.
  if (curr.high < prev.high && curr.low > prev.low) {
    return ['inside_bar', currRng / prevRng]
  }
  return ['', 0]
}

function detectThreeBar(c2: Candle, c1: Candle, c0: Candle): [string, number] {
  const r2 = c2.high - c2.low
  const r1 = c1.high - c1.low
  const r0 = c0.high - c0.low
  if (r0 <= 0 || r1 <= 0 || r2 <= 0) {
    return ['', 0]
  }
  const b2 = Math.abs(c2.close - c2.open)
  const b1 = Math.abs(c1.close - c1.open)
  const b0 = Math.abs(c0.close - c0.open)
  const bull = (c: Candle): boolean => c.close > c.open

  // Morning star.
  if (!bull(c2) && b1 < b2 * 0.5 && bull(c0) && b0 >= b2 * 0.5) {
    const c2Mid = (c2.open + c2.close) / 2
    if (c0.close > c2Mid) {
      return ['morning_star', b0 / (b2 + 1e-9)]
    }
  }
  // Evening star.
  if (bull(c2) && b1 < b2 * 0.5 && !bull(c0) && b0 >= b2 * 0.5) {
    const c2Mid = (c2.open + c2.close) / 2
    if (c0.close < c2Mid) {
      return ['evening_star', b0 / (b2 + 1e-9)]
    }
  }

  // Three white soldiers.
  if (
    bull(c2) &&
    bull(c1) &&
    bull(c0) &&
    c1.close > c2.close &&
    c0.close > c1.close &&
    b2 / r2 >= 0.5 &&
    b1 / r1 >= 0.5 &&
    b0 / r0 >= 0.5 &&
    c1.open > c2.open &&
    c1.open < c2.close &&
    c0.open > c1.open &&
    c0.open < c1.close
  ) {
    return ['three_white_soldiers', (b0 + b1 + b2) / (r0 + r1 + r2)]
  }
  // Three black crows.
  if (
    !bull(c2) &&
    !bull(c1) &&
    !bull(c0) &&
    c1.close < c2.close &&
    c0.close < c1.close &&
    b2 / r2 >= 0.5 &&
    b1 / r1 >= 0.5 &&
    b0 / r0 >= 0.5 &&
    c1.open < c2.open &&
    c1.open > c2.close &&
    c0.open < c1.open &&
    c0.open > c1.close
  ) {
    return ['three_black_crows', (b0 + b1 + b2) / (r0 + r1 + r2)]
  }

  return ['', 0]
}

// AnalyzeLastBars runs shape + context + trap detection for the last
// `n` closed bars and marks which patterns were invalidated by later
// bars. Output is oldest-to-newest order.
export function analyzeLastBars(closed: Candle[], n: number, lvl: LevelContext): BarPattern[] {
  if (n <= 0 || closed.length === 0) {
    return []
  }
  let start = closed.length - n
  if (start < 0) start = 0
  const out: BarPattern[] = []
  for (let i = start; i < closed.length; i++) {
    const p = enrichContext(closed, i, lvl)
    const [kind, ratio] = detectPattern(closed, i)
    p.kind = kind
    p.ratio = ratio
    p.time = closed[i].openTime
    const [mult, spike] = fillVolumeContext(closed, i)
    p.volMult = mult
    p.volSpike = spike
    out.push(p)
  }
  markInvalidations(out, closed, start)
  return out
}

function enrichContext(closed: Candle[], i: number, lvl: LevelContext): BarPattern {
  const p = newBarPattern()
  if (i < 0 || i >= closed.length) {
    return p
  }
  const b = closed[i]

  // PriorTrend: OLS slope on 5 prior closes.
  if (i >= 5 && lvl.atr > 0) {
    const slope = olsSlope(closed.slice(i - 5, i))
    const thr = 0.1 * lvl.atr
    if (slope < -thr) p.priorTrend = 'DOWN'
    else if (slope > thr) p.priorTrend = 'UP'
    else p.priorTrend = 'FLAT'
  }

  // Window low/high over 10 prior bars (exclude bar i itself).
  if (i >= 10) {
    let minLow = Infinity
    let maxHigh = -Infinity
    for (let j = i - 10; j < i; j++) {
      const c = closed[j]
      if (c.low < minLow) minLow = c.low
      if (c.high > maxHigh) maxHigh = c.high
    }
    p.isWindowLow = b.low <= minLow
    p.isWindowHigh = b.high >= maxHigh
  }

  // At support/resistance: 0.3·ATR tolerance.
  if (lvl.atr > 0) {
    if (lvl.nearestS > 0 && Math.abs(b.low - lvl.nearestS) <= 0.3 * lvl.atr) {
      p.atSupport = true
    }
    if (lvl.nearestR > 0 && Math.abs(b.high - lvl.nearestR) <= 0.3 * lvl.atr) {
      p.atResistance = true
    }
  }

  // Wick grab.
  if (lvl.swingHigh > 0 && b.high > lvl.swingHigh && b.close < lvl.swingHigh) {
    p.wickGrabHigh = true
  }
  if (lvl.swingLow > 0 && b.low < lvl.swingLow && b.close > lvl.swingLow) {
    p.wickGrabLow = true
  }

  // BB fakeout.
  if (lvl.bbUpper > 0 && b.high > lvl.bbUpper && b.close < lvl.bbUpper) {
    p.bbFakeoutUp = true
  }
  if (lvl.bbLower > 0 && b.low < lvl.bbLower && b.close > lvl.bbLower) {
    p.bbFakeoutDown = true
  }

  // Exhaustion: body > 2·ATR.
  if (lvl.atr > 0) {
    const body = Math.abs(b.close - b.open)
    if (body > 2 * lvl.atr) {
      p.exhaustion = true
    }
  }
  return p
}

function markInvalidations(patterns: BarPattern[], closed: Candle[], start: number): void {
  for (let k = 0; k < patterns.length - 1; k++) {
    const p = patterns[k]
    const barIdx = start + k
    if (barIdx < 0 || barIdx >= closed.length) {
      continue
    }
    const patternBar = closed[barIdx]
    for (let j = barIdx + 1; j < closed.length; j++) {
      const next = closed[j]
      switch (p.kind) {
        case 'hammer':
        case 'piercing_line':
        case 'engulfing_bull':
        case 'dragonfly_doji':
        case 'tweezer_bottom':
        case 'harami_bull':
        case 'morning_star':
          if (next.close < patternBar.low) {
            p.invalidated = true
          }
          break
        case 'shooting_star':
        case 'dark_cloud_cover':
        case 'engulfing_bear':
        case 'gravestone_doji':
        case 'tweezer_top':
        case 'harami_bear':
        case 'evening_star':
          if (next.close > patternBar.high) {
            p.invalidated = true
          }
          break
        case 'three_white_soldiers':
          if (barIdx >= 2 && next.close < closed[barIdx - 2].open) {
            p.invalidated = true
          }
          break
        case 'three_black_crows':
          if (barIdx >= 2 && next.close > closed[barIdx - 2].open) {
            p.invalidated = true
          }
          break
      }
      if (p.invalidated) {
        break
      }
    }
  }
}

// olsSlope returns the simple-linear-regression slope of Close prices
// with index-as-x.
function olsSlope(bars: Candle[]): number {
  const n = bars.length
  if (n < 2) {
    return 0
  }
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0
  for (let i = 0; i < bars.length; i++) {
    const x = i
    const y = bars[i].close
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }
  const nf = n
  const denom = nf * sumX2 - sumX * sumX
  if (denom === 0) {
    return 0
  }
  return (nf * sumXY - sumX * sumY) / denom
}

// fillVolumeContext attaches per-bar volume multiplier vs SMA20 of prior
// closed volumes (EXCLUSIVE of the bar itself). ≥2× = spike.
function fillVolumeContext(closed: Candle[], barIdx: number): [number, boolean] {
  const window = 20
  if (barIdx < window || barIdx >= closed.length) {
    return [0, false]
  }
  let sum = 0.0
  for (let i = barIdx - window; i < barIdx; i++) {
    sum += closed[i].volume
  }
  const avg = sum / window
  if (avg <= 0) {
    return [0, false]
  }
  const mult = closed[barIdx].volume / avg
  const spike = mult >= 2.0
  return [mult, spike]
}
