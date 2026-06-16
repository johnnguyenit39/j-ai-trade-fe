// Conversation memory: a compact running summary the LLM rewrites after each
// turn. Lets the bot keep long-term context (user's risk appetite, positions
// being watched, recent decisions, instructions) even though we only send the
// last few messages in the prompt.

import type { AIHandler, ChatMessage } from '../types'

const MEMORY_SYSTEM_PROMPT = `Bạn là BỘ NHỚ của một trợ lý trading XAUUSDT. Nhiệm vụ: viết lại bản ghi nhớ ngắn gọn dựa trên bản cũ + lượt chat mới nhất.

Giữ lại (nếu có):
- Bối cảnh user: phong cách giao dịch, khẩu vị rủi ro, vốn, ràng buộc.
- Lệnh/đang theo dõi: setup đang chờ, lệnh đã vào (entry/SL/TP), mức giá quan trọng user quan tâm.
- Quyết định & lý do gần đây; điều user dặn hoặc sửa.
- Trạng thái tâm lý / mục tiêu nếu user có nhắc.

Bỏ: chi tiết vụn, số liệu thị trường nhất thời (giá/ATR/indicator), lời chào.
Tối đa ~150 từ, gạch đầu dòng súc tích. Trả về CHỈ nội dung memory mới, không lời dẫn, không giải thích.`

/**
 * Asks the LLM to fold the latest exchange into the running memory.
 * Returns the new memory text; on any failure returns the old memory unchanged.
 */
export async function updateMemory(
  handler: AIHandler,
  oldMemory: string,
  userText: string,
  assistantReply: string,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: MEMORY_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `MEMORY CŨ:\n${oldMemory || '(chưa có)'}\n\n` +
        `LƯỢT CHAT MỚI:\nUser: ${userText}\nAssistant: ${assistantReply}\n\n` +
        `MEMORY MỚI:`,
    },
  ]
  try {
    const next = await handler.streamChat(messages, { signal })
    const trimmed = next.trim()
    return trimmed || oldMemory
  } catch {
    return oldMemory
  }
}
