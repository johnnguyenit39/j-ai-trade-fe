// Faithful TypeScript port of modules/advisor/biz/market/pivots.go.
// Pivot detection, HH/LH/HL/LL/EH/EL labeling, double top/bottom, and
// horizontal range detection. All math mirrors the Go implementation
// exactly. Candle times are epoch milliseconds (UTC).

import type { Candle } from '../types'

// Pivot is a confirmed swing high (SH) or swing low (SL) with an
// HH/HL/LH/LL label relative to the previous same-type pivot in the
// scanned window. Empty Label = first-of-type seen.
export interface Pivot {
  time: number // bar open time (epoch ms, UTC)
  price: number
  type: string // "SH" | "SL"
  label: string // "HH" | "LH" | "HL" | "LL" | "EH" | "EL" | ""
}

// RecentPivots scans `candles` chronologically and returns up to
// `limit` most-recent confirmed pivots, each tagged with an HH/HL/LH/LL
// label relative to the prior same-type pivot.
export function recentPivots(candles: Candle[], leftRight: number, limit: number): Pivot[] {
  const n = candles.length
  if (n < leftRight * 2 + 1 || limit <= 0) {
    return []
  }
  const all: Pivot[] = []
  for (let i = leftRight; i < n - leftRight; i++) {
    if (isPivotHigh(candles, i, leftRight)) {
      all.push({ time: candles[i].openTime, price: candles[i].high, type: 'SH', label: '' })
    }
    if (isPivotLow(candles, i, leftRight)) {
      all.push({ time: candles[i].openTime, price: candles[i].low, type: 'SL', label: '' })
    }
  }
  let lastSH: Pivot | null = null
  let lastSL: Pivot | null = null
  for (let k = 0; k < all.length; k++) {
    const p = all[k]
    switch (p.type) {
      case 'SH':
        if (lastSH !== null) {
          if (p.price > lastSH.price) p.label = 'HH'
          else if (p.price < lastSH.price) p.label = 'LH'
          else p.label = 'EH'
        }
        lastSH = p
        break
      case 'SL':
        if (lastSL !== null) {
          if (p.price > lastSL.price) p.label = 'HL'
          else if (p.price < lastSL.price) p.label = 'LL'
          else p.label = 'EL'
        }
        lastSL = p
        break
    }
  }
  if (all.length <= limit) {
    return all
  }
  return all.slice(all.length - limit)
}

export function isPivotHigh(candles: Candle[], i: number, k: number): boolean {
  const h = candles[i].high
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue
    if (candles[j].high >= h) return false
  }
  return true
}

export function isPivotLow(candles: Candle[], i: number, k: number): boolean {
  const l = candles[i].low
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue
    if (candles[j].low <= l) return false
  }
  return true
}

// DoubleStructure flags a double top / double bottom.
export interface DoubleStructure {
  kind: string // "double_top" | "double_bottom" | ""
  level: number
}

// DetectDoubleTopBottom checks the last two same-type pivots only.
// tolerance is ATR fraction (0.3 = ±0.3 ATR means "same price level").
export function detectDoubleTopBottom(
  pivots: Pivot[],
  atr: number,
  tolerance: number,
): DoubleStructure {
  if (pivots.length < 3 || atr <= 0) {
    return { kind: '', level: 0 }
  }
  const shIdx: number[] = []
  const slIdx: number[] = []
  for (let i = 0; i < pivots.length; i++) {
    switch (pivots[i].type) {
      case 'SH':
        shIdx.push(i)
        break
      case 'SL':
        slIdx.push(i)
        break
    }
  }
  if (shIdx.length >= 2) {
    const a = shIdx[shIdx.length - 2]
    const b = shIdx[shIdx.length - 1]
    if (Math.abs(pivots[a].price - pivots[b].price) <= tolerance * atr) {
      for (const si of slIdx) {
        if (si > a && si < b) {
          return { kind: 'double_top', level: (pivots[a].price + pivots[b].price) / 2 }
        }
      }
    }
  }
  if (slIdx.length >= 2) {
    const a = slIdx[slIdx.length - 2]
    const b = slIdx[slIdx.length - 1]
    if (Math.abs(pivots[a].price - pivots[b].price) <= tolerance * atr) {
      for (const si of shIdx) {
        if (si > a && si < b) {
          return { kind: 'double_bottom', level: (pivots[a].price + pivots[b].price) / 2 }
        }
      }
    }
  }
  return { kind: '', level: 0 }
}

// RangeStructure describes a horizontal trading range detected over a
// rolling window.
export interface RangeStructure {
  isRange: boolean
  top: number
  bottom: number
  topTouches: number
  botTouches: number
  widthATR: number
  age: number
}

// DetectRange runs a minimal rectangle test over the last `window`
// closed bars: count touches near the window's high and low (±0.3 ATR),
// and declare a range only if both sides reach minTouches=3 and the
// total width stays under 4·ATR.
export function detectRange(candles: Candle[], atr: number, window: number): RangeStructure {
  const touchTol = 0.3
  const minTouches = 3
  const widthMax = 4.0
  if (candles.length < window || atr <= 0) {
    return { isRange: false, top: 0, bottom: 0, topTouches: 0, botTouches: 0, widthATR: 0, age: 0 }
  }
  const slice = candles.slice(candles.length - window)
  let top = slice[0].high
  let bot = slice[0].low
  for (const c of slice) {
    if (c.high > top) top = c.high
    if (c.low < bot) bot = c.low
  }
  const width = (top - bot) / atr
  const rs: RangeStructure = {
    isRange: false,
    top,
    bottom: bot,
    topTouches: 0,
    botTouches: 0,
    widthATR: width,
    age: 0,
  }
  if (width > widthMax) {
    return rs
  }
  const tol = touchTol * atr
  for (const c of slice) {
    if (c.high >= top - tol) rs.topTouches++
    if (c.low <= bot + tol) rs.botTouches++
  }
  if (rs.topTouches >= minTouches && rs.botTouches >= minTouches) {
    rs.isRange = true
  }
  for (let j = slice.length - 1; j >= 0; j--) {
    const c = slice[j]
    if (c.high <= top + tol && c.low >= bot - tol) {
      rs.age++
    } else {
      break
    }
  }
  return rs
}
