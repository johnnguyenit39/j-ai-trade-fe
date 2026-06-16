// User-facing trade card — faithful port of FormatAdvisorReplyForUser and its
// helpers from decision_parser.go. Entry/SL/TP come entirely from the LLM; the
// only thing we own is lot sizing (risk-based) and PnL/R:R display.

import type { DecisionPayload } from './decisionParser'
import { stripDecisionFence, stripLLMEmphasis, stripMarketDataDump } from './textClean'

export interface FreshnessContext {
  currentPrice: number
  atrM15: number
  generatedAt: number // epoch ms
}

export function freshnessHasData(f: FreshnessContext): boolean {
  return f.atrM15 > 0 && f.currentPrice > 0
}

// Risk-sizing defaults (Go used ADVISOR_ACCOUNT_USDT / ADVISOR_RISK_PCT env).
const DEFAULT_ACCOUNT_USDT = 1000.0
const DEFAULT_RISK_PCT = 0.5

function envFloat(raw: string | undefined, def: number): number {
  if (!raw || !raw.trim()) return def
  const v = parseFloat(raw.trim())
  return Number.isNaN(v) ? def : v
}

const accountUSDT = envFloat(import.meta.env.VITE_ADVISOR_ACCOUNT_USDT, DEFAULT_ACCOUNT_USDT)
const riskPct = envFloat(import.meta.env.VITE_ADVISOR_RISK_PCT, DEFAULT_RISK_PCT)

/** Go %+.2f — always sign-prefixed, two decimals. */
function signed2(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2)
}

function contractSizePerLot(symbol: string): number {
  switch (symbol.trim().toUpperCase()) {
    case 'XAUUSD':
    case 'XAUUSDT':
      return 100 // gold CFD: 1 lot = 100 oz
    case 'BTCUSDT':
      return 1
    default:
      return 1
  }
}

function estimatedPnLUSDT(
  symbol: string,
  action: string,
  entry: number,
  exit: number,
  lot: number,
): number {
  if (lot <= 0 || entry <= 0 || exit <= 0) return 0
  let priceDiff: number
  switch (action.trim().toUpperCase()) {
    case 'BUY':
      priceDiff = exit - entry
      break
    case 'SELL':
      priceDiff = entry - exit
      break
    default:
      return 0
  }
  return priceDiff * lot * contractSizePerLot(symbol)
}

function sizeLotForRisk(
  symbol: string,
  entry: number,
  stopLoss: number,
  account: number,
  pct: number,
): number {
  if (entry <= 0 || stopLoss <= 0 || entry === stopLoss) return 0
  const delta = Math.abs(entry - stopLoss)
  const cs = contractSizePerLot(symbol)
  if (cs <= 0) return 0
  const riskUSDT = (account * pct) / 100.0
  return riskUSDT / (delta * cs)
}

function riskRewardRatio(tpPnL: number, slPnL: number): number {
  const r = Math.abs(slPnL)
  const w = Math.abs(tpPnL)
  if (r === 0) return 0
  return w / r
}

function formatMoney(x: number): string {
  if (x === Math.trunc(x)) return String(Math.trunc(x))
  return x.toFixed(2)
}

function formatAdvisorPrice(p: number): string {
  const ap = Math.abs(p)
  if (ap >= 1000) return p.toFixed(2)
  if (ap >= 1) return p.toFixed(4)
  return p.toFixed(6)
}

function formatAdvisorLot(lot: number): string {
  if (lot <= 0) return '(chưa có)'
  let s = lot.toFixed(8)
  s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '' ? '0' : s
}

function confidenceBadge(c: string): string {
  switch (c) {
    case 'high':
      return '🟢'
    case 'low':
      return '🔴'
    default:
      return '🟡'
  }
}

function formatFreshnessBlock(f: FreshnessContext): string {
  const half = 0.2 * f.atrM15
  const skip = 0.5 * f.atrM15
  const d = new Date(f.generatedAt)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const stamp = `${hh}:${mm} UTC`
  let b = ''
  b += '\n⏱ Tín hiệu chốt: ' + stamp
  b += ` · giá tại đó ${formatAdvisorPrice(f.currentPrice)} (ATR M15 ≈ ${formatAdvisorPrice(f.atrM15)})\n`
  b += `• Slippage OK: entry ±${formatAdvisorPrice(half)}\n`
  b += `• Skip nếu giá hiện đã trôi >${formatAdvisorPrice(skip)} khỏi entry — kèo cũ, chờ setup mới\n`
  return b
}

/** Turns the raw LLM reply into prose + an explicit trade card. */
export function formatAdvisorReplyForUser(
  rawReply: string,
  d: DecisionPayload,
  fresh: FreshnessContext,
): string {
  const riskSizingOn = accountUSDT > 0 && riskPct > 0
  if (riskSizingOn) {
    const sized = sizeLotForRisk(d.symbol, d.entry, d.stopLoss, accountUSDT, riskPct)
    if (sized > 0) d.lot = sized
  }

  let prose = stripLLMEmphasis(stripMarketDataDump(stripDecisionFence(rawReply))).trim()
  if (prose === '') prose = 'Tín hiệu vào lệnh.'

  const tpPnL = estimatedPnLUSDT(d.symbol, d.action, d.entry, d.takeProfit, d.lot)
  const slPnL = estimatedPnLUSDT(d.symbol, d.action, d.entry, d.stopLoss, d.lot)

  let b = prose
  b += `\n\n📋 Lệnh gợi ý ${confidenceBadge(d.confidence ?? 'med')}\n`
  b += `• Symbol: ${d.symbol}\n`
  b += `• Lệnh: ${d.action}\n`
  b += `• Entry: ${formatAdvisorPrice(d.entry)}\n`
  b += `• SL: ${formatAdvisorPrice(d.stopLoss)}\n`
  b += `• TP: ${formatAdvisorPrice(d.takeProfit)}\n`
  b += `• Khối lượng (base): ${formatAdvisorLot(d.lot)}\n`
  if (d.invalidation) b += `• Hủy nếu: ${d.invalidation}\n`

  if (freshnessHasData(fresh)) b += formatFreshnessBlock(fresh)

  if (riskSizingOn) {
    const slPct = (slPnL / accountUSDT) * 100.0
    const tpPct = (tpPnL / accountUSDT) * 100.0
    b += `\n💰 Vốn $${formatMoney(accountUSDT)}\n`
    b += `• SL: ${signed2(slPnL)} USDT (${signed2(slPct)}%)\n`
    b += `• TP: ${signed2(tpPnL)} USDT (${signed2(tpPct)}%)\n`
    const rr = riskRewardRatio(tpPnL, slPnL)
    if (rr > 0) b += `• R:R ${rr.toFixed(2)}\n`
  } else {
    b += '\n💰 Ước tính PnL (USDT, linear, theo khối lượng trên)\n'
    b += `• Nếu chạm TP: ${signed2(tpPnL)} USDT\n`
    b += `• Nếu chạm SL: ${signed2(slPnL)} USDT\n`
  }

  return b.trim()
}
