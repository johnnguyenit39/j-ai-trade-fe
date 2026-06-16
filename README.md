# j-ai-trade-fe

A minimal chat web app (React + Vite + TypeScript). The bot replies through a
pluggable AI provider layer. DeepSeek is implemented first; the design lets you
swap providers (OpenAI, Claude, …) by changing one enum value.

## Setup

```bash
npm install
cp .env.example .env   # then fill in VITE_AI_AGENT_TOKEN_KEY
npm run dev            # http://localhost:5173
```

## Environment

| Variable                   | Description                                   |
| -------------------------- | --------------------------------------------- |
| `VITE_AI_AGENT_TOKEN_KEY`  | API token for the active provider (DeepSeek). |
| `VITE_AI_PROVIDER`         | `deepseek` \| `openai` \| `claude`.           |

> Vite only exposes `VITE_`-prefixed vars to the browser.

## Switching providers

Set `VITE_AI_PROVIDER` (or call `getHandler(AIProvider.X)` directly). The
provider layer lives in [`src/ai/`](src/ai/):

- [`types.ts`](src/ai/types.ts) — `AIProvider` enum, `AIHandler` interface.
- [`config.ts`](src/ai/config.ts) — per-provider base URL / default model.
- [`deepSeekHandler.ts`](src/ai/deepSeekHandler.ts) — DeepSeek (OpenAI-compatible, streaming).
- [`index.ts`](src/ai/index.ts) — `getHandler(provider)` factory.

To add a provider: implement `AIHandler` and add a `case` in `getHandler`.

## Trading advisor (ported from the Go backend)

The bot is an **XAUUSDT scalping advisor**. On each message it:

1. Resolves intent + symbol ([src/trading/intent.ts](src/trading/intent.ts)) — default `XAUUSDT`, `BTCUSDT` when you name BTC; `vàng`/`gold`→XAUUSDT.
2. Fetches the 6-TF candle bundle (M1/M5/M15/H1/H4/D1 × 200 bars) from Binance Futures ([src/market/binanceClient.ts](src/market/binanceClient.ts), via the `/api/binance` proxy).
3. Computes indicators ([src/trading/indicators.ts](src/trading/indicators.ts)) + structure/pivots/patterns/regime ([src/trading/analysis/](src/trading/analysis/)) and renders a `[MARKET_DATA]` digest.
4. Sends the verbatim trader system prompt + history + digest to the LLM ([src/ai/trading/](src/ai/trading/)).
5. Parses any fenced `json` trade decision and renders a trade card with risk-sized lot + PnL/R:R.

Orchestration lives in [src/trading/advisor.ts](src/trading/advisor.ts) (`maybeEnrich`) and is wired into the chat in [src/hooks/useChat.ts](src/hooks/useChat.ts). All logic runs client-side; in production move the Binance + LLM calls behind a backend proxy.

Smoke-test the digest against live data: `npx tsx scripts/smoke.mts`.

## Persistence (Firestore)

Chat history + pinned symbol + trade decisions persist to Firestore when
configured; otherwise the app runs in-memory. Single-user, single-thread, no
auth (prototype).

- Init: [src/firebase.ts](src/firebase.ts) — reads `VITE_FIREBASE_*` web config.
- Store: [src/store/sessionStore.ts](src/store/sessionStore.ts) — load/append messages, `lastSymbol`, `saveDecision`.
- Layout: `sessions/default/messages/*`, `sessions/default/decisions/*`, `lastSymbol` on `sessions/default`.
- The market digest is **never persisted** (stale) — only cleaned reply text, matching the Go backend.

**Enable it:** paste the web config (Firebase Console → Project settings → Your
apps → Web app) into `.env`, enable Firestore in the console, and deploy rules:
`firebase deploy --only firestore:rules`. Rules in [firestore.rules](firestore.rules) are
**open (no auth)** — lock down (require auth, scope by uid) before going public.

## ⚠️ Security note

`VITE_*` values are **baked into the client bundle** and visible to anyone who
loads the site. For production, route AI calls through a backend proxy that
holds the key server-side instead of shipping it to the browser.

## Deploy

CI builds with `npm run build` (output → `dist/`) and deploys to Firebase
Hosting. Add `VITE_AI_AGENT_TOKEN_KEY` as a GitHub Actions secret.
