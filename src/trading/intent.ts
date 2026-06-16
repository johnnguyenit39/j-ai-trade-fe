// Intent detection and symbol/timeframe resolution, ported from the Go
// backend (modules/advisor/biz/market/intent.go and symbol_resolver.go).
// Matching is case-insensitive: the text is lowercased and tokenised on
// Unicode word boundaries, exactly like the Go tokenize().

import { Timeframe } from './types'

// Intent is the structured result of parsing a user's message. An empty
// symbol means "no analysis requested".
export interface Intent {
  symbol: string
  timeframe: Timeframe
  explicit: boolean
}

// wantsAnalysis returns true when the intent has enough info to trigger
// the market-data pipeline. We require a resolved symbol; the TF always
// has a default so it is never blocking.
export function wantsAnalysis(i: Intent): boolean {
  return i.symbol !== ''
}

// DefaultSymbol is the pair the bot falls back to when the user doesn't
// name a supported pair.
export const DEFAULT_SYMBOL = 'XAUUSDT'

// SUPPORTED_SYMBOLS is the advisor's trading universe.
export const SUPPORTED_SYMBOLS: string[] = [DEFAULT_SYMBOL, 'BTCUSDT']

// SYMBOL_ALIASES maps normalised tokens onto canonical Binance symbols.
// Built to mirror Go's NewSymbolResolver: every canonical symbol maps to
// itself (lowercased), plus the hand-curated extras whose canonical
// symbol is in SUPPORTED_SYMBOLS.
function buildSymbolAliases(): Record<string, string> {
  const aliases: Record<string, string> = {}
  // 1. Every canonical symbol maps to itself.
  for (const s of SUPPORTED_SYMBOLS) {
    aliases[s.toLowerCase()] = s
  }
  // 2. Hand-curated aliases. Gold is the default product; BTC only when
  // the user names it — no generic "crypto" token.
  const extra: Record<string, string> = {
    xau: 'XAUUSDT',
    gold: 'XAUUSDT',
    vang: 'XAUUSDT', // ASCII-folded "vàng"
    'vàng': 'XAUUSDT',
    btc: 'BTCUSDT',
    bitcoin: 'BTCUSDT',
  }
  for (const [alias, canonical] of Object.entries(extra)) {
    // Skip aliases whose canonical symbol isn't in SUPPORTED_SYMBOLS.
    if (!(canonical.toLowerCase() in aliases)) {
      continue
    }
    aliases[alias] = canonical
  }
  return aliases
}

export const SYMBOL_ALIASES: Record<string, string> = buildSymbolAliases()

// TF_ALIASES recognises common ways users reference timeframes in chat.
// Defaults: "scalp"/"scalping" map to M15 — the bot's primary signal TF.
export const TF_ALIASES: Record<string, Timeframe> = {
  m1: Timeframe.M1,
  '1m': Timeframe.M1,
  m5: Timeframe.M5,
  '5m': Timeframe.M5,
  m15: Timeframe.M15,
  '15m': Timeframe.M15,
  '15': Timeframe.M15,
  scalp: Timeframe.M15,
  scalping: Timeframe.M15,
  h1: Timeframe.H1,
  '1h': Timeframe.H1,
  hourly: Timeframe.H1,
  h4: Timeframe.H4,
  '4h': Timeframe.H4,
  d1: Timeframe.D1,
  '1d': Timeframe.D1,
  daily: Timeframe.D1,
  day: Timeframe.D1,
}

// tokenize lowercases and splits text on any non-letter/digit, keeping
// only runs of Unicode letters/digits. Vietnamese diacritics survive
// because \p{L} covers them.
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const matches = lower.match(/[\p{L}\p{N}]+/gu)
  return matches ?? []
}

// resolveSymbol scans the user's text for any known alias and returns the
// FIRST matching canonical symbol. Returns "" when none is mentioned.
function resolveSymbol(text: string): string {
  for (const tok of tokenize(text)) {
    const sym = SYMBOL_ALIASES[tok]
    if (sym !== undefined) {
      return sym
    }
  }
  return ''
}

// resolveTimeframe extracts the first explicit timeframe mention from the
// user's text. Returns undefined when none is found — callers default to
// M15 (the bot's primary signal TF).
function resolveTimeframe(text: string): Timeframe | undefined {
  for (const tok of tokenize(text)) {
    const tf = TF_ALIASES[tok]
    if (tf !== undefined) {
      return tf
    }
  }
  return undefined
}

// detect runs the symbol+optional-timeframe heuristic on free-form text.
// Every non-empty message resolves to a supported pair: XAUUSDT by
// default, or BTCUSDT when the user explicitly names BTC/bitcoin.
export function detect(text: string): Intent {
  let sym = resolveSymbol(text)
  if (sym === '') {
    sym = DEFAULT_SYMBOL
  }
  const tf = resolveTimeframe(text) ?? Timeframe.M15
  return { symbol: sym, timeframe: tf, explicit: false }
}

// detectWithFallback resolves the symbol from the message; when the user
// didn't name one we keep the chat's pinned lastSymbol. Only when there's
// no pinned symbol either do we fall back to DEFAULT_SYMBOL.
export function detectWithFallback(text: string, lastSymbol: string): Intent {
  let sym = resolveSymbol(text)
  if (sym === '') {
    sym = lastSymbol
  }
  if (sym === '') {
    sym = DEFAULT_SYMBOL
  }
  const tf = resolveTimeframe(text) ?? Timeframe.M15
  return { symbol: sym, timeframe: tf, explicit: false }
}

// parseCommand recognises "/analyze SYMBOL [TF]" (and its alias
// "/signal"). Returns an explicit intent. When the text isn't a command,
// returns a non-explicit empty intent (symbol === '').
export function parseCommand(text: string): Intent {
  const lower = text.toLowerCase().trim()
  if (!lower.startsWith('/analyze') && !lower.startsWith('/signal')) {
    return { symbol: '', timeframe: Timeframe.M15, explicit: false }
  }
  // Drop the leading command token.
  let rest = lower
  for (const prefix of ['/analyze', '/signal']) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length).trim()
      break
    }
  }
  if (rest === '') {
    // Bare /analyze → default XAUUSDT M15 swing-scalp.
    return { symbol: DEFAULT_SYMBOL, timeframe: Timeframe.M15, explicit: true }
  }
  let sym = resolveSymbol(rest)
  if (sym === '') {
    sym = DEFAULT_SYMBOL
  }
  const tf = resolveTimeframe(rest) ?? Timeframe.M15
  return { symbol: sym, timeframe: tf, explicit: true }
}

// resolveIntent mirrors the Go Analyzer.resolveIntent: if parseCommand is
// explicit, return it; otherwise fall through to the heuristic detector
// with the pinned lastSymbol fallback.
export function resolveIntent(text: string, lastSymbol: string): Intent {
  const cmd = parseCommand(text)
  if (cmd.explicit) {
    return cmd
  }
  return detectWithFallback(text, lastSymbol)
}
