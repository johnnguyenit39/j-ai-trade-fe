// Message assembly (port of prompt_builder.go BuildMessagesWithMarket) and the
// one-time welcome greeting (port of greeter.go WelcomeMessage).

import type { ChatMessage } from '../types'
import { SYSTEM_PROMPT } from './systemPrompt'

/**
 * Composes the DeepSeek-shaped message array, optionally prepending the
 * [MARKET_DATA] blob as an extra user turn RIGHT BEFORE the user's question.
 * The blob is a user turn (not system) so the constant system prompt stays
 * cache-friendly and stale data never leaks into persisted history.
 */
export function buildMessagesWithMarket(
  history: ChatMessage[],
  userMessage: string,
  marketBlob: string,
  memory = '',
): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  // Long-term memory as a leading user turn (kept out of system so the system
  // prompt stays cache-friendly; memory changes every turn).
  if (memory.trim() !== '') {
    msgs.push({ role: 'user', content: `[MEMORY]\n${memory.trim()}\n[/MEMORY]` })
  }
  msgs.push(...history)
  if (marketBlob !== '') msgs.push({ role: 'user', content: marketBlob })
  msgs.push({ role: 'user', content: userMessage })
  return msgs
}

export const WELCOME_MESSAGE = `Chào bạn 👋 Mình là advisor bot — trợ lý swing-scalp, mặc định vàng (XAUUSDT), khung tín hiệu M15 (holding 1–4h), H1/H4/D1 làm bias.

Mình có thể:
• Chat tự nhiên về trading, chiến lược, risk, tâm lý.
• Phân tích kỹ thuật realtime — cứ hỏi "vàng giờ buy hay sell?" / "XAU thế nào?" là backend tự fetch nến M5/M15/H1/H4/D1 từ Binance, tính EMA/RSI/ATR/regime + pattern + BOS/FVG, mình đọc toàn bộ rồi tự quyết định vào lệnh hay chờ. Khi vào lệnh sẽ kèm entry/SL/TP cụ thể.
• Muốn khung khác? Gõ "/analyze M5" / "/analyze H1" / "/analyze H4" — chuyển sang timing nhanh hoặc swing/position analysis.
• Hỏi đích danh BTC (btc, bitcoin, BTCUSDT) thì phân tích BTCUSDT; câu chung chung vẫn là vàng.

Mặc định XAUUSDT; thêm BTCUSDT khi bạn nhắc rõ BTC. Timeframe: M15 (default), M5, H1, H4, D1.
Lệnh: /analyze, /reset (xoá ngữ cảnh), /help.

(Hi! Default XAUUSDT; say BTC/bitcoin explicitly for BTCUSDT. M15 swing-scalp with H1/H4/D1 context.)`
