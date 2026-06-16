// Faithful TypeScript port of modules/advisor/biz/market/market_clock.go.
// Next-candle-close boundaries (UTC-aligned, Binance style) and human
// formatting. Times are epoch milliseconds (UTC).

import { Timeframe } from '../types'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

// NextClose returns the epoch-ms timestamp of the next candle close for
// the given timeframe assuming Binance's UTC-aligned boundaries. Returns
// 0 (zero time) for unknown/unsupported timeframes.
export function nextClose(tf: Timeframe, now: number): number {
  const d = new Date(now)
  switch (tf) {
    case Timeframe.H1: {
      // Truncate to the hour boundary, then add an hour.
      const floor = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        0,
        0,
        0,
      )
      return floor + HOUR_MS
    }
    case Timeframe.H4: {
      const hour = d.getUTCHours()
      const h = hour - (hour % 4)
      const floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0, 0, 0)
      return floor + 4 * HOUR_MS
    }
    case Timeframe.D1: {
      const floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
      return floor + 24 * HOUR_MS
    }
    default:
      return 0
  }
}

// FormatNextClose renders a single line like "H1=15:00 UTC (in 23m)".
// Returns "" for unsupported timeframes.
export function formatNextClose(tf: Timeframe, now: number): string {
  const next = nextClose(tf, now)
  if (next === 0) {
    return ''
  }
  const delta = roundToMinute(next - now)
  const d = new Date(next)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${tf}=${hh}:${mm} UTC (in ${formatDuration(delta)})`
}

// roundToMinute mirrors Go's time.Duration.Round(time.Minute): rounds to
// the nearest minute, half rounds away from zero. Input/output in ms.
function roundToMinute(ms: number): number {
  const r = ms % MINUTE_MS
  if (r === 0) return ms
  if (ms >= 0) {
    if (r + r < MINUTE_MS) return ms - r
    return ms - r + MINUTE_MS
  }
  // negative
  if (-(r + r) < MINUTE_MS) return ms - r
  return ms - r - MINUTE_MS
}

// formatDuration produces compact strings: "23m", "1h23m", "9h".
// `d` is a duration in milliseconds.
function formatDuration(d: number): string {
  if (d <= 0) {
    return 'now'
  }
  const h = Math.trunc(d / HOUR_MS)
  const m = Math.trunc(d / MINUTE_MS) % 60
  if (h === 0) {
    return `${m}m`
  }
  if (m === 0) {
    return `${h}h`
  }
  return `${h}h${m}m`
}
