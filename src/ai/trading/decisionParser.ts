// Port of modules/advisor/biz/decision_parser.go — the JSON-decision
// extraction / validation / normalisation layer. Only the parsing-side
// logic is ported here (DecisionPayload, ExtractDecision, valid,
// normalise); the trade-card formatting / risk-sizing helpers live in
// the Go file but are out of scope for this module.

// DecisionPayload is the shape of the JSON block the LLM emits when it
// decides to open a trade.
//
// Numeric fields MUST be JSON numbers (not strings) — the system prompt
// explicitly tells the LLM this. The wire JSON uses snake_case for
// stop_loss / take_profit; we map those into camelCase here.
export interface DecisionPayload {
  action: string;
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  // Lot is position size in base-asset units.
  lot: number;
  // Confidence is the LLM's self-rated conviction: "low" | "med" | "high".
  // Missing/unrecognised → normalised to "med".
  confidence?: string;
  // Invalidation is a one-line natural-language condition that, when
  // observed, means the setup is dead.
  invalidation?: string;
}

// decisionFenceRe matches a ```json ... ``` fenced block with any amount
// of whitespace inside. `[\s\S]` stands in for Go's `(?s)` dotall flag so
// `.`-equivalent matches newlines; the non-greedy `*?` is preserved. We
// deliberately anchor on ```json (lowercase) only, matching the Go
// regexp.MustCompile("(?s)```json\\s*(\\{.*?\\})\\s*```").
const decisionFenceRe = /```json\s*(\{[\s\S]*?\})\s*```/;

// extractDecision scans an LLM reply for the ```json {...} ``` fenced
// decision block defined in SYSTEM_PROMPT. Returns the parsed payload
// when found and structurally valid; null when the reply contains no
// block (the normal "explain only, don't trade" path) or when the
// payload fails validation.
//
// Non-fatal by design: a malformed block returns null rather than
// throwing — the caller logs and moves on.
export function extractDecision(reply: string): DecisionPayload | null {
  const match = decisionFenceRe.exec(reply);
  if (!match || match.length < 2) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const p = mapPayload(raw);
  if (p === null) {
    return null;
  }
  if (!isValidDecision(p)) {
    return null;
  }
  normalise(p);
  return p;
}

// mapPayload maps the snake_case JSON object into a DecisionPayload.
// Mirrors Go's json.Unmarshal into the struct tags: unknown / missing
// fields default to the zero value (empty string / 0), matching Go so
// that valid() then rejects them consistently. Non-number numerics
// (e.g. JSON strings) become NaN-equivalent zero — but since the prompt
// pins numeric JSON and Go's float64 unmarshal would error on a string,
// we reject any field whose JSON type isn't number/undefined.
function mapPayload(raw: unknown): DecisionPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;

  // Go's encoding/json errors out (→ ExtractDecision returns nil) if a
  // numeric struct field receives a non-number JSON value. Replicate:
  // any present-but-wrong-typed field aborts the parse.
  if (!okString(o.action) || !okString(o.symbol)) {
    return null;
  }
  if (
    !okNumber(o.entry) ||
    !okNumber(o.stop_loss) ||
    !okNumber(o.take_profit) ||
    !okNumber(o.lot)
  ) {
    return null;
  }
  if (!okOptString(o.confidence) || !okOptString(o.invalidation)) {
    return null;
  }

  return {
    action: (o.action as string | undefined) ?? "",
    symbol: (o.symbol as string | undefined) ?? "",
    entry: (o.entry as number | undefined) ?? 0,
    stopLoss: (o.stop_loss as number | undefined) ?? 0,
    takeProfit: (o.take_profit as number | undefined) ?? 0,
    lot: (o.lot as number | undefined) ?? 0,
    confidence: (o.confidence as string | undefined) ?? "",
    invalidation: (o.invalidation as string | undefined) ?? "",
  };
}

function okString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

function okOptString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

function okNumber(v: unknown): boolean {
  return v === undefined || (typeof v === "number" && !Number.isNaN(v));
}

// isValidDecision enforces the prompt contract: non-empty symbol, a
// recognised action (BUY/SELL, case-insensitive after trim), and three
// positive prices plus a positive lot. We do NOT check price ORDERING —
// that's a business rule worth logging but not worth refusing to persist
// over. Direct port of Go's (DecisionPayload).valid().
export function isValidDecision(p: DecisionPayload): boolean {
  if (p.symbol === "") {
    return false;
  }
  const act = (p.action ?? "").trim().toUpperCase();
  if (act !== "BUY" && act !== "SELL") {
    return false;
  }
  if (p.entry <= 0 || p.stopLoss <= 0 || p.takeProfit <= 0 || p.lot <= 0) {
    return false;
  }
  return true;
}

// normalise canonicalises the free-form parts of the payload (upper-case
// symbol+action, whitespace stripped). Confidence accepts
// low/med/medium/high (case-insensitive), folds "medium" → "med", and
// falls back to "med" on anything unrecognised. Runs AFTER
// isValidDecision so we don't mutate a payload we're about to reject.
// Direct port of Go's (*DecisionPayload).normalise().
function normalise(p: DecisionPayload): void {
  p.symbol = p.symbol.trim().toUpperCase();
  p.action = p.action.trim().toUpperCase();
  switch ((p.confidence ?? "").trim().toLowerCase()) {
    case "high":
      p.confidence = "high";
      break;
    case "low":
      p.confidence = "low";
      break;
    default:
      p.confidence = "med";
      break;
  }
  p.invalidation = (p.invalidation ?? "").trim();
}
