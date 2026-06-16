import { PROVIDER_CONFIG, AI_AGENT_TOKEN_KEY } from './config'
import {
  AIError,
  AIProvider,
  type AIHandler,
  type ChatMessage,
  type StreamCallbacks,
} from './types'

/**
 * DeepSeek handler. DeepSeek exposes an OpenAI-compatible `/chat/completions`
 * endpoint, so this implementation also serves as the template for an eventual
 * OpenAI handler.
 */
export class DeepSeekHandler implements AIHandler {
  readonly provider = AIProvider.DeepSeek

  private readonly model: string

  constructor(model?: string) {
    this.model = model ?? PROVIDER_CONFIG[AIProvider.DeepSeek].defaultModel
  }

  async streamChat(
    messages: ChatMessage[],
    cb: StreamCallbacks = {},
  ): Promise<string> {
    if (!AI_AGENT_TOKEN_KEY) {
      throw new AIError(
        'Missing API token. Set VITE_AI_AGENT_TOKEN_KEY in your .env file.',
        this.provider,
      )
    }

    const { baseUrl } = PROVIDER_CONFIG[this.provider]

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_AGENT_TOKEN_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
      }),
      signal: cb.signal,
    })

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new AIError(
        `DeepSeek request failed (${res.status}). ${detail}`.trim(),
        this.provider,
        res.status,
      )
    }

    return this.consumeStream(res.body, cb)
  }

  /** Parses the OpenAI-style SSE stream into accumulated assistant text. */
  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    cb: StreamCallbacks,
  ): Promise<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines; each line may be `data: …`.
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice('data:'.length).trim()
        if (data === '[DONE]') return full

        try {
          const json = JSON.parse(data)
          const token: string | undefined = json.choices?.[0]?.delta?.content
          if (token) {
            full += token
            cb.onToken?.(token)
          }
        } catch {
          // Ignore keep-alive / partial fragments.
        }
      }
    }

    return full
  }
}
