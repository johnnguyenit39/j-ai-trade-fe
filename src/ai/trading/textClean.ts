// Port of modules/advisor/biz/llm_text_clean.go — the reply cleaners that
// strip the JSON decision fence, Markdown emphasis, and any echoed
// [MARKET_DATA] dump out of the prose shown to the user / persisted to
// history. Regexes and order of operations match the Go source exactly.

// decisionFenceRe — same pattern as decisionParser's, replicated here so
// stripDecisionFence stays self-contained (mirrors the Go file, where
// the var lives in decision_parser.go and is reused). Go:
// regexp.MustCompile("(?s)```json\\s*(\\{.*?\\})\\s*```"). `[\s\S]`
// stands in for `(?s)`; `g` makes ReplaceAll replace every block.
const decisionFenceRe = /```json\s*(\{[\s\S]*?\})\s*```/g;

// stripDecisionFence removes the ```json ... ``` block (and surrounding
// whitespace via the final trim) from the LLM reply so persisted history
// and the user-visible bubble stay clean prose. Port of
// StripDecisionFence.
export function stripDecisionFence(reply: string): string {
  const cleaned = reply.replace(decisionFenceRe, "");
  return cleaned.trim();
}

// singleEmphasis matches *italic* runs that contain no '*' or newline.
// Go: regexp.MustCompile(`\*([^*\n]+)\*`) with ReplaceAllString → `g`.
const singleEmphasis = /\*([^*\n]+)\*/g;

// stripLLMEmphasis removes Markdown-style emphasis markers models often
// emit (**bold**, *italic*, __underline__) so plain Vietnamese text
// shows instead of asterisk noise. Loop-replaces *text* → text until the
// string stabilises (handles nested / overlapping runs). Port of
// StripLLMEmphasis.
export function stripLLMEmphasis(s: string): string {
  s = s.split("**").join("");
  s = s.split("__").join("");
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(singleEmphasis, "$1");
  }
  return s;
}

// marketDataBlockRe matches the fenced [MARKET_DATA]...[/MARKET_DATA]
// region, case-insensitive, dot-matches-newline, non-greedy. Go: `(?is)`
// → `gis`. `[\s\S]` mirrors dotall; non-greedy `*?` preserved.
const marketDataBlockRe = /\[MARKET_DATA\][\s\S]*?\[\/MARKET_DATA\]/gi;

// marketDataStartTagRe catches a stray opening/closing tag on its own
// line. Go: `(?im)^\s*\[/?MARKET_DATA\]\s*$` → `gim`. `\s` matches Go's
// (newline-inclusive) `\s`; `.` is line-bounded in both (Go has no
// `(?s)`, JS has no `s` flag).
const marketDataStartTagRe = /^\s*\[\/?MARKET_DATA\]\s*$/gim;

// marketDataLineRe matches individual "key: value" dump lines the LLM
// copies out of the market blob, anchored at start-of-line. Go: `(?im)`
// → `gim`.
const marketDataLineRe = new RegExp(
  "^\\s*(" +
    "symbol|current_price|tf_alignment|session|prev_day|news|" +
    "regime|adx|stack|lastclose|" +
    "ema\\d+|rsi\\d*|atr|bbwidth|bb|donchian|swing|" +
    "close|nearestr|nearests|mom\\d+|structure|vol|" +
    "rsi_div|ema_cross_bull_\\d*|ema_cross_bear_\\d*|bb_squeeze_releasing|" +
    "[MH]\\d+" +
    ")\\s*:.*$",
  "gim",
);

// recentOrLastBlockRe kills the "Recent <TF> pivots / candles" and
// "Last N <TF> bar patterns" headers plus their trailing payload.
// Go: `(?im)^\s*(recent (m1|m5|m15|h1|h4|d1)|last \d+ (m1|m5|m15|h1|h4|d1) bar patterns).*$`.
const recentOrLastBlockRe =
  /^\s*(recent (m1|m5|m15|h1|h4|d1)|last \d+ (m1|m5|m15|h1|h4|d1) bar patterns).*$/gim;

// pivotOrPatternRowRe matches the single-row outputs beneath those
// headers: pivot rows ("SH 2386.5 14:00 LH") and the "[-k] date time
// kind · r=X ..." pattern rows.
// Go: `(?im)^\s*(\[-?\d+\]|SH|SL)\s.*$`.
const pivotOrPatternRowRe = /^\s*(\[-?\d+\]|SH|SL)\s.*$/gim;

// multipleBlankLinesRe collapses 3+ newlines to 2 after stripping.
// Go: `\n{3,}`.
const multipleBlankLinesRe = /\n{3,}/g;

// stripMarketDataDump removes any chunk of the [MARKET_DATA] context
// block the LLM echoed back into its reply. Safety net for when the
// model disobeys the no-echo instruction. Strategy / ordering matches
// the Go StripMarketDataDump exactly:
//  1. Remove full [MARKET_DATA]...[/MARKET_DATA] blocks.
//  2. Remove stray opening/closing tags on their own line.
//  3. Remove "Recent <TF> ..." / "Last N <TF> bar patterns" headers.
//  4. Remove the pivot / pattern rows underneath.
//  5. Remove "key: value" digest lines.
//  6. Collapse 3+ blank lines to a single blank line.
export function stripMarketDataDump(s: string): string {
  s = s.replace(marketDataBlockRe, "");
  s = s.replace(marketDataStartTagRe, "");
  s = s.replace(recentOrLastBlockRe, "");
  s = s.replace(pivotOrPatternRowRe, "");
  s = s.replace(marketDataLineRe, "");
  s = s.replace(multipleBlankLinesRe, "\n\n");
  return s.trim();
}
