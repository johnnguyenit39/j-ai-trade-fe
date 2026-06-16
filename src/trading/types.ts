// Core trading domain types, ported from the Go backend
// (common/base_candle_model.go, trading/models/timeframe.go).

export enum Timeframe {
  M1 = 'M1',
  M5 = 'M5',
  M15 = 'M15',
  H1 = 'H1',
  H4 = 'H4',
  D1 = 'D1',
  W1 = 'W1',
}

/** Binance kline interval string for a timeframe. */
export function binanceInterval(tf: Timeframe): string {
  switch (tf) {
    case Timeframe.M1:
      return '1m'
    case Timeframe.M5:
      return '5m'
    case Timeframe.M15:
      return '15m'
    case Timeframe.H1:
      return '1h'
    case Timeframe.H4:
      return '4h'
    case Timeframe.D1:
      return '1d'
    case Timeframe.W1:
      return '1w'
    default:
      return ''
  }
}

/** Mirrors common.BaseCandle. Times are epoch milliseconds (UTC). */
export interface Candle {
  symbol: string
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

/** Mirrors trading/models.MarketData. */
export interface MarketData {
  symbol: string
  candles: Partial<Record<Timeframe, Candle[]>>
}
