// Faithful TypeScript port of modules/advisor/biz/market/regime_verdict.go.
// Multi-TF regime voting (H4 → H1 → M15) and overall-verdict synthesis.

import { Timeframe } from '../types'
import type { TFSummary } from './digest'
import { f0 } from './format'

// RegimeVerdict is the multi-TF market regime assessment.
export interface RegimeVerdict {
  h4Vote: TFVote
  h1Vote: TFVote
  m15Vote: TFVote
  overall: string
  mode: string
}

// TFVote is one timeframe's contribution to the overall verdict. TF is
// empty string when the timeframe was not summarised.
export interface TFVote {
  tf: Timeframe | ''
  label: string
  reason: string
}

// Vote label constants.
const voteTrendUp = 'TREND_UP'
const voteTrendDown = 'TREND_DOWN'
const voteTrendUpFading = 'TREND_UP_FADING'
const voteTrendDownFading = 'TREND_DOWN_FADING'
const voteConsolidBull = 'CONSOLIDATING_BULL'
const voteConsolidBear = 'CONSOLIDATING_BEAR'
const voteRange = 'RANGE'
const voteChoppy = 'CHOPPY'

function emptyVote(): TFVote {
  return { tf: '', label: '', reason: '' }
}

// voteForTF derives a single-TF label from its TFSummary and the parent
// (next-higher) TF's raw regime string.
function voteForTF(sum: TFSummary, parentRegime: string): TFVote {
  const v: TFVote = { tf: sum.timeframe, label: '', reason: '' }
  const adx = sum.adx14

  switch (sum.regime) {
    case 'TREND_UP':
      v.label = voteTrendUp
      v.reason = `ADX ${f0(adx)}${slopeArrow(sum.adxSlope)}, stack bullish, structure intact`
      break

    case 'TREND_DOWN':
      v.label = voteTrendDown
      v.reason = `ADX ${f0(adx)}${slopeArrow(sum.adxSlope)}, stack bearish, structure intact`
      break

    case 'TREND_UP_FADING':
      if (parentRegime === 'TREND_UP' && sum.priceCompressing) {
        v.label = voteConsolidBull
        v.reason = `range nén trong H4 uptrend, ADX ${f0(adx)}↓ — bull flag, chờ breakout lên`
      } else {
        v.label = voteTrendUpFading
        v.reason = `ADX ${f0(adx)}↓ trend đang tắt dần${compressionHint(sum.priceCompressing)}`
      }
      break

    case 'TREND_DOWN_FADING':
      if (parentRegime === 'TREND_DOWN' && sum.priceCompressing) {
        v.label = voteConsolidBear
        v.reason = `range nén trong H4 downtrend, ADX ${f0(adx)}↓ — bear flag, chờ breakout xuống`
      } else {
        v.label = voteTrendDownFading
        v.reason = `ADX ${f0(adx)}↓ trend đang tắt dần${compressionHint(sum.priceCompressing)}`
      }
      break

    case 'RANGE':
      switch (parentRegime) {
        case 'TREND_UP':
          v.label = voteConsolidBull
          v.reason = `sideway trong H4 uptrend — KHÔNG trade biên, chờ breakout tiếp trend H4`
          break
        case 'TREND_DOWN':
          v.label = voteConsolidBear
          v.reason = `sideway trong H4 downtrend — KHÔNG trade biên, chờ breakdown tiếp trend H4`
          break
        default:
          v.label = voteRange
          v.reason = `ADX ${f0(adx)}, bounce genuine giữa levels`
          break
      }
      break

    case 'CHOPPY':
      v.label = voteChoppy
      v.reason = `ADX ${f0(adx)} choppy — SL bị quét dễ, tránh vào lệnh`
      break

    default:
      v.label = voteRange
      v.reason = 'không xác định'
      break
  }

  return v
}

// ComputeRegimeVerdict synthesises per-TF summaries into an overall
// verdict.
export function computeRegimeVerdict(summaries: TFSummary[]): RegimeVerdict {
  const byTF = new Map<Timeframe, TFSummary>()
  for (const s of summaries) {
    byTF.set(s.timeframe, s)
  }

  const verd: RegimeVerdict = {
    h4Vote: emptyVote(),
    h1Vote: emptyVote(),
    m15Vote: emptyVote(),
    overall: '',
    mode: '',
  }

  // H4 — no parent needed at this scale
  const h4 = byTF.get(Timeframe.H4)
  if (h4) {
    verd.h4Vote = voteForTF(h4, '')
  }

  // H1 — parent is H4 raw regime
  let h4Regime = ''
  if (h4) {
    h4Regime = h4.regime
  }
  const h1 = byTF.get(Timeframe.H1)
  if (h1) {
    verd.h1Vote = voteForTF(h1, h4Regime)
  }

  // M15 — parent is H1 raw regime
  let h1Regime = ''
  if (h1) {
    h1Regime = h1.regime
  }
  const m15 = byTF.get(Timeframe.M15)
  if (m15) {
    verd.m15Vote = voteForTF(m15, h1Regime)
  }

  const [overall, mode] = deriveOverall(verd.h4Vote.label, verd.h1Vote.label, verd.m15Vote.label)
  verd.overall = overall
  verd.mode = mode
  return verd
}

// deriveOverall maps the (H4, H1, M15) vote triple to an overall verdict
// and recommended mode.
function deriveOverall(h4: string, h1: string, m15: string): [string, string] {
  // Both bias TFs trending the same direction
  if (h4 === voteTrendUp && h1 === voteTrendUp) {
    if (m15 === voteTrendUp) {
      return ['STRONG_UPTREND', 'trend_follow_buy']
    }
    return ['UPTREND', 'trend_follow_buy']
  }
  if (h4 === voteTrendDown && h1 === voteTrendDown) {
    if (m15 === voteTrendDown) {
      return ['STRONG_DOWNTREND', 'trend_follow_sell']
    }
    return ['DOWNTREND', 'trend_follow_sell']
  }

  // H4 trending, H1 consolidating inside trend = bull/bear flag
  if (h4 === voteTrendUp && h1 === voteConsolidBull) {
    return ['RANGING_IN_UPTREND', 'consolidation_watch_buy']
  }
  if (h4 === voteTrendDown && h1 === voteConsolidBear) {
    return ['RANGING_IN_DOWNTREND', 'consolidation_watch_sell']
  }

  // H4 trending, H1 fading = trend still alive but losing steam
  if (h4 === voteTrendUp && h1 === voteTrendUpFading) {
    return ['UPTREND_WEAKENING', 'caution_buy']
  }
  if (h4 === voteTrendDown && h1 === voteTrendDownFading) {
    return ['DOWNTREND_WEAKENING', 'caution_sell']
  }

  // H4 trending, H1 fully ranging/choppy (not in-trend consolidation)
  if (h4 === voteTrendUp && (h1 === voteRange || h1 === voteChoppy)) {
    return ['RANGING_IN_UPTREND', 'consolidation_watch_buy']
  }
  if (h4 === voteTrendDown && (h1 === voteRange || h1 === voteChoppy)) {
    return ['RANGING_IN_DOWNTREND', 'consolidation_watch_sell']
  }

  // H4 itself fading — phase transition in progress
  if (h4 === voteTrendUpFading || h4 === voteConsolidBull) {
    if (h1 === voteTrendUp) {
      return ['UPTREND_WEAKENING', 'caution_buy']
    }
    return ['TRANSITIONING', 'standby']
  }
  if (h4 === voteTrendDownFading || h4 === voteConsolidBear) {
    if (h1 === voteTrendDown) {
      return ['DOWNTREND_WEAKENING', 'caution_sell']
    }
    return ['TRANSITIONING', 'standby']
  }

  // Both bias TFs in range / choppy
  if (isRangeOrChoppy(h4) && isRangeOrChoppy(h1)) {
    if (h4 === voteChoppy && h1 === voteChoppy) {
      return ['CHOPPY', 'standby']
    }
    return ['RANGING', 'range_trade']
  }

  // Opposing signals = trend reversal in progress
  if (isBullish(h4) && isBearish(h1)) {
    return ['TRANSITIONING', 'standby']
  }
  if (isBearish(h4) && isBullish(h1)) {
    return ['TRANSITIONING', 'standby']
  }

  return ['TRANSITIONING', 'standby']
}

// renderRegimeVerdict writes the verdict block into the market blob.
export function renderRegimeVerdict(parts: string[], v: RegimeVerdict): void {
  if (v.overall === '') {
    return
  }
  parts.push('Regime verdict (Go-computed — dùng làm anchor, không override bằng cảm tính):\n')
  const writeVote = (vote: TFVote): void => {
    if (vote.tf === '') {
      return
    }
    // Go: fmt.Fprintf(b, "  %-4s: %-24s — %s\n", vote.TF, vote.Label, vote.Reason)
    parts.push(`  ${padRight(vote.tf, 4)}: ${padRight(vote.label, 24)} — ${vote.reason}\n`)
  }
  writeVote(v.h4Vote)
  writeVote(v.h1Vote)
  writeVote(v.m15Vote)
  parts.push(`  Overall : ${v.overall}\n`)
  parts.push(`  Mode    : ${modeDescription(v.mode)}\n`)
  parts.push('\n')
}

function modeDescription(mode: string): string {
  switch (mode) {
    case 'trend_follow_buy':
      return 'trend_follow_buy → Setup A: chờ pullback BUY theo trend'
    case 'trend_follow_sell':
      return 'trend_follow_sell → Setup A: chờ pullback SELL theo trend'
    case 'consolidation_watch_buy':
      return 'consolidation_watch_buy → KHÔNG trade biên range; chờ breakout lên rồi BUY hoặc BUY tại đáy range gần support H4'
    case 'consolidation_watch_sell':
      return 'consolidation_watch_sell → KHÔNG trade biên range; chờ breakdown xuống rồi SELL hoặc SELL tại đỉnh range gần resist H4'
    case 'range_trade':
      return 'range_trade → Setup B: BUY nearestS / SELL nearestR; SL ngoài biên'
    case 'caution_buy':
      return 'caution_buy → chỉ A+ setup BUY (BOS+FVG confluence), size -30%, TP chặt 1.0–1.2R'
    case 'caution_sell':
      return 'caution_sell → chỉ A+ setup SELL (BOS+FVG confluence), size -30%, TP chặt 1.0–1.2R'
    case 'standby':
      return 'standby → không vào lệnh; regime đang chuyển tiếp, chờ H1+H4 xác nhận hướng mới'
    default:
      return mode
  }
}

// ── helpers ──

function slopeArrow(slope: number): string {
  if (slope > 1.0) return '↑'
  if (slope < -1.0) return '↓'
  return ''
}

function compressionHint(compressing: boolean): string {
  if (compressing) return ', giá đang nén'
  return ''
}

function isRangeOrChoppy(label: string): boolean {
  return (
    label === voteRange ||
    label === voteChoppy ||
    label === voteConsolidBull ||
    label === voteConsolidBear
  )
}

function isBullish(label: string): boolean {
  return label === voteTrendUp || label === voteTrendUpFading || label === voteConsolidBull
}

function isBearish(label: string): boolean {
  return label === voteTrendDown || label === voteTrendDownFading || label === voteConsolidBear
}

// padRight mirrors Go's %-Ns left-justify padding (space-padded to width
// N, no truncation). Width is measured in JS string units (UTF-16 code
// units) — adequate for the ASCII labels used here.
function padRight(s: string, width: number): string {
  if (s.length >= width) return s
  return s + ' '.repeat(width - s.length)
}
