// Faithful TypeScript port of modules/advisor/biz/market/structure.go.
// BOS detection/retest, failed breakout, and fair-value-gap detection.

import type { Candle } from '../types'
import type { Pivot } from './pivots'

// BOSRetest captures a recent break-of-structure on this TF.
export interface BOSRetest {
  direction: string // "up" | "down" | ""
  level: number
  barsSinceBreak: number
  state: string // "pending" | "retesting" | "confirmed"
  breakVolMult: number
}

// FailedBreakout captures a "close-through then close-back" event.
export interface FailedBreakout {
  direction: string // "failed_up" | "failed_down" | ""
  level: number
  age: number
}

// DetectBOSRetest scans pivots newest-first and returns the freshest
// BOS within the last maxAge closed bars. retestTol = 0.3·ATR.
export function detectBOSRetest(
  closed: Candle[],
  pivots: Pivot[],
  atr: number,
  maxAge: number,
): BOSRetest {
  const empty: BOSRetest = {
    direction: '',
    level: 0,
    barsSinceBreak: 0,
    state: '',
    breakVolMult: 0,
  }
  if (atr <= 0 || closed.length < 3 || pivots.length === 0) {
    return empty
  }
  const retestTol = 0.3
  const tol = retestTol * atr
  const n = closed.length
  let minBarIdx = n - maxAge
  if (minBarIdx < 0) minBarIdx = 0

  // Index closed bars by open time (epoch ms) — mirrors the Go timeIdx
  // keyed by UnixNano; pivots carry the same time value as their bar.
  const timeIdx = new Map<number, number>()
  for (let i = 0; i < closed.length; i++) {
    timeIdx.set(closed[i].openTime, i)
  }

  let best: BOSRetest = empty
  let bestAge = -1

  for (let k = pivots.length - 1; k >= 0; k--) {
    const p = pivots[k]
    const pivotIdx = timeIdx.get(p.time)
    if (pivotIdx === undefined || pivotIdx >= n - 1) {
      continue
    }
    let breakIdx = -1
    for (let j = pivotIdx + 1; j < n; j++) {
      if (p.type === 'SH' && closed[j].close > p.price) {
        breakIdx = j
        break
      }
      if (p.type === 'SL' && closed[j].close < p.price) {
        breakIdx = j
        break
      }
    }
    if (breakIdx < 0 || breakIdx < minBarIdx) {
      continue
    }
    const age = n - 1 - breakIdx
    if (bestAge >= 0 && age >= bestAge) {
      continue
    }

    let touched = false
    let confirmed = false
    for (let j = breakIdx + 1; j < n; j++) {
      const bar = closed[j]
      if (p.type === 'SH') {
        if (bar.low <= p.price + tol) touched = true
        if (touched && bar.close > p.price) confirmed = true
      } else {
        if (bar.high >= p.price - tol) touched = true
        if (touched && bar.close < p.price) confirmed = true
      }
    }
    if (!touched) {
      const last = closed[n - 1]
      if (p.type === 'SH' && last.low <= p.price + tol) touched = true
      if (p.type === 'SL' && last.high >= p.price - tol) touched = true
    }

    let state = 'pending'
    if (confirmed) state = 'confirmed'
    else if (touched) state = 'retesting'

    let dir = 'up'
    if (p.type === 'SL') dir = 'down'

    let breakVolMult = 0.0
    if (breakIdx > 0 && closed[breakIdx].volume > 0) {
      let start = breakIdx - 20
      if (start < 0) start = 0
      let sumVol = 0
      for (let i = start; i < breakIdx; i++) {
        sumVol += closed[i].volume
      }
      const count = breakIdx - start
      if (count > 0 && sumVol > 0) {
        breakVolMult = closed[breakIdx].volume / (sumVol / count)
      }
    }
    best = {
      direction: dir,
      level: p.price,
      barsSinceBreak: age,
      state,
      breakVolMult,
    }
    bestAge = age
    if (age === 0) break
  }
  return best
}

// DetectFailedBreakout scans the most recent maxAge bars for a "close
// through pivot → close back" sequence using the provided pivot list.
export function detectFailedBreakout(
  closed: Candle[],
  pivots: Pivot[],
  maxAge: number,
): FailedBreakout {
  const n = closed.length
  if (n < 3 || pivots.length === 0) {
    return { direction: '', level: 0, age: 0 }
  }
  let minBarIdx = n - maxAge
  if (minBarIdx < 0) minBarIdx = 0
  let best: FailedBreakout = { direction: '', level: 0, age: 0 }
  let bestAge = -1

  for (let k = pivots.length - 1; k >= 0; k--) {
    const p = pivots[k]
    let breakIdx = -1
    let breakDir = ''
    for (let j = minBarIdx; j < n; j++) {
      if (p.type === 'SH' && closed[j].close > p.price) {
        breakIdx = j
        breakDir = 'failed_up'
        break
      }
      if (p.type === 'SL' && closed[j].close < p.price) {
        breakIdx = j
        breakDir = 'failed_down'
        break
      }
    }
    if (breakIdx < 0) {
      continue
    }
    for (let j = breakIdx + 1; j < n; j++) {
      const failAge = n - 1 - j
      if (breakDir === 'failed_up' && closed[j].close < p.price) {
        if (bestAge < 0 || failAge < bestAge) {
          best = { direction: breakDir, level: p.price, age: failAge }
          bestAge = failAge
        }
        break
      }
      if (breakDir === 'failed_down' && closed[j].close > p.price) {
        if (bestAge < 0 || failAge < bestAge) {
          best = { direction: breakDir, level: p.price, age: failAge }
          bestAge = failAge
        }
        break
      }
    }
  }
  return best
}

// FVG (Fair Value Gap) is a 3-bar imbalance.
export interface FVG {
  direction: string // "bull" | "bear" | ""
  top: number
  bottom: number
  age: number
  state: string // "open" | "filling"
}

// DetectRecentFVG returns the freshest unfilled (or currently filling)
// FVG within the last maxAge bars.
export function detectRecentFVG(closed: Candle[], maxAge: number): FVG {
  const n = closed.length
  if (n < 3 || maxAge < 3) {
    return { direction: '', top: 0, bottom: 0, age: 0, state: '' }
  }
  let minIdx = n - maxAge
  if (minIdx < 2) minIdx = 2

  let best: FVG = { direction: '', top: 0, bottom: 0, age: 0, state: '' }
  let bestAge = -1

  for (let i = n - 1; i >= minIdx; i--) {
    const prev = closed[i - 2]
    const curr = closed[i]
    let dir = ''
    let top = 0
    let bot = 0
    if (curr.low > prev.high) {
      dir = 'bull'
      top = curr.low
      bot = prev.high
    } else if (curr.high < prev.low) {
      dir = 'bear'
      top = prev.low
      bot = curr.high
    } else {
      continue
    }
    let fullyFilled = false
    let filling = false
    for (let j = i + 1; j < n; j++) {
      const bar = closed[j]
      if (dir === 'bull' && bar.low <= bot) {
        fullyFilled = true
        break
      }
      if (dir === 'bear' && bar.high >= top) {
        fullyFilled = true
        break
      }
      if (dir === 'bull' && bar.low < top && bar.low > bot) {
        filling = true
      }
      if (dir === 'bear' && bar.high > bot && bar.high < top) {
        filling = true
      }
    }
    if (fullyFilled) {
      continue
    }
    const last = closed[n - 1]
    if (dir === 'bull' && last.low < top && last.low > bot) {
      filling = true
    }
    if (dir === 'bear' && last.high > bot && last.high < top) {
      filling = true
    }
    const age = n - 1 - i
    let state = 'open'
    if (filling) state = 'filling'
    if (best.direction === '') {
      // first match — accept
    } else if (best.state === 'filling' && state !== 'filling') {
      continue
    } else if (best.state === state && age >= bestAge) {
      continue
    }
    best = { direction: dir, top, bottom: bot, age, state }
    bestAge = age
  }
  return best
}
