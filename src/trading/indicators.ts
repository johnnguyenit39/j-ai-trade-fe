// Minimal, dependency-free technical indicators — faithful port of
// trading/indicators/indicators.go. All functions operate on CLOSED candles;
// callers should pass closedCandles(candles) when the last bar is still forming
// (anti-repaint).

import type { Candle } from './types'

/** Extracts close prices. */
export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close)
}

/** Simple moving average at the end of the series. */
export function sma(values: number[], period: number): number {
  if (values.length < period || period <= 0) return 0
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

/** Exponential moving average for the last value, seeded with the SMA. */
export function ema(values: number[], period: number): number {
  if (values.length < period || period <= 0) return 0
  const k = 2.0 / (period + 1)
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  let e = seed / period
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}

/** Wilder RSI for the last value. Returns 100 when avgLoss is 0. */
export function rsi(values: number[], period: number): number {
  if (values.length < period + 1) return 0
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1]
    if (diff > 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    const g = diff > 0 ? diff : 0
    const l = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Wilder ATR (absolute) for the last value. */
export function atr(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    let tr = h - l
    const v1 = Math.abs(h - pc)
    if (v1 > tr) tr = v1
    const v2 = Math.abs(l - pc)
    if (v2 > tr) tr = v2
    trs.push(tr)
  }
  if (trs.length < period) return 0
  let sum = 0
  for (let i = 0; i < period; i++) sum += trs[i]
  let a = sum / period
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period
  return a
}

/** Wilder ADX (trend strength 0-100) for the last value. */
export function adx(candles: Candle[], period: number): number {
  const n = candles.length
  if (n < period * 2 + 1) return 0
  const plusDM = new Array<number>(n).fill(0)
  const minusDM = new Array<number>(n).fill(0)
  const tr = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high
    const downMove = candles[i - 1].low - candles[i].low
    if (upMove > downMove && upMove > 0) plusDM[i] = upMove
    if (downMove > upMove && downMove > 0) minusDM[i] = downMove
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    let trv = h - l
    const v1 = Math.abs(h - pc)
    if (v1 > trv) trv = v1
    const v2 = Math.abs(l - pc)
    if (v2 > trv) trv = v2
    tr[i] = trv
  }

  // Wilder smoothing (running sum form, matching the Go impl exactly).
  const smooth = (src: number[]): number[] => {
    const s = new Array<number>(n).fill(0)
    if (n < period + 1) return s
    let sum = 0
    for (let i = 1; i <= period; i++) sum += src[i]
    s[period] = sum
    for (let i = period + 1; i < n; i++) s[i] = s[i - 1] - s[i - 1] / period + src[i]
    return s
  }
  const sTR = smooth(tr)
  const sPlus = smooth(plusDM)
  const sMinus = smooth(minusDM)

  const dx = new Array<number>(n).fill(0)
  for (let i = period; i < n; i++) {
    if (sTR[i] === 0) continue
    const plusDI = (100 * sPlus[i]) / sTR[i]
    const minusDI = (100 * sMinus[i]) / sTR[i]
    const denom = plusDI + minusDI
    if (denom === 0) continue
    dx[i] = (100 * Math.abs(plusDI - minusDI)) / denom
  }

  if (n < period * 2) return 0
  let sum = 0
  for (let i = period; i < period * 2; i++) sum += dx[i]
  let a = sum / period
  for (let i = period * 2; i < n; i++) a = (a * (period - 1) + dx[i]) / period
  return a
}

/** Highest high and lowest low over the last `period` candles. */
export function donchianChannel(
  candles: Candle[],
  period: number,
): { high: number; low: number } {
  if (candles.length < period) return { high: 0, low: 0 }
  let high = candles[candles.length - period].high
  let low = candles[candles.length - period].low
  for (let i = candles.length - period; i < candles.length; i++) {
    if (candles[i].high > high) high = candles[i].high
    if (candles[i].low < low) low = candles[i].low
  }
  return { high, low }
}

/** Bollinger Bands with SMA middle. */
export function bollingerBands(
  values: number[],
  period: number,
  mult: number,
): { upper: number; middle: number; lower: number } {
  if (values.length < period) return { upper: 0, middle: 0, lower: 0 }
  const middle = sma(values, period)
  let variance = 0
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - middle
    variance += d * d
  }
  const sd = Math.sqrt(variance / period)
  return { upper: middle + mult * sd, middle, lower: middle - mult * sd }
}

/** Most recent confirmed swing high and swing low prices. */
export function swingHighLow(
  candles: Candle[],
  leftRight: number,
): { swingHigh: number; swingLow: number } {
  const n = candles.length
  if (n < leftRight * 2 + 1) return { swingHigh: 0, swingLow: 0 }
  let swingHigh = 0
  let swingLow = 0
  for (let i = n - leftRight - 1; i >= leftRight; i--) {
    if (swingHigh === 0 && isSwingHigh(candles, i, leftRight)) swingHigh = candles[i].high
    if (swingLow === 0 && isSwingLow(candles, i, leftRight)) swingLow = candles[i].low
    if (swingHigh !== 0 && swingLow !== 0) return { swingHigh, swingLow }
  }
  return { swingHigh, swingLow }
}

export function isSwingHigh(candles: Candle[], i: number, k: number): boolean {
  const h = candles[i].high
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue
    if (candles[j].high >= h) return false
  }
  return true
}

export function isSwingLow(candles: Candle[], i: number, k: number): boolean {
  const l = candles[i].low
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue
    if (candles[j].low <= l) return false
  }
  return true
}

/** Candles excluding the last (possibly forming) bar — anti-repaint helper. */
export function closedCandles(candles: Candle[]): Candle[] {
  if (candles.length < 2) return []
  return candles.slice(0, candles.length - 1)
}
