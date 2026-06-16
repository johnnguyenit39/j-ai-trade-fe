// Provider-agnostic chat types. Add a new provider by extending the enum and
// registering a handler in `src/ai/index.ts` — no UI changes required.

export enum AIProvider {
  DeepSeek = 'deepseek',
  OpenAI = 'openai',
  Claude = 'claude',
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface StreamCallbacks {
  /** Called for each incremental token/chunk as it streams in. */
  onToken?: (token: string) => void
  /** Abort an in-flight request. */
  signal?: AbortSignal
}

/**
 * Every provider implements this interface. The UI only ever talks to an
 * `AIHandler`, so swapping providers is purely a matter of the factory in
 * `index.ts` returning a different implementation.
 */
export interface AIHandler {
  readonly provider: AIProvider
  /** Streams the assistant reply, resolving with the full text once complete. */
  streamChat(messages: ChatMessage[], cb?: StreamCallbacks): Promise<string>
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly provider: AIProvider,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AIError'
  }
}
