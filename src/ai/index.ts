import { ACTIVE_PROVIDER } from './config'
import { DeepSeekHandler } from './deepSeekHandler'
import { AIError, AIProvider, type AIHandler } from './types'

export * from './types'
export { PROVIDER_CONFIG, ACTIVE_PROVIDER } from './config'

/**
 * Factory: returns the handler for a given provider. To support a new
 * provider, implement an `AIHandler` and add a case here — the rest of the app
 * stays untouched.
 */
export function getHandler(provider: AIProvider = ACTIVE_PROVIDER): AIHandler {
  switch (provider) {
    case AIProvider.DeepSeek:
      return new DeepSeekHandler()
    case AIProvider.OpenAI:
      // TODO: implement OpenAIHandler (OpenAI-compatible, mirror DeepSeek).
      throw new AIError('OpenAI handler not implemented yet.', provider)
    case AIProvider.Claude:
      // TODO: implement ClaudeHandler (Anthropic Messages API).
      throw new AIError('Claude handler not implemented yet.', provider)
    default:
      throw new AIError(`Unknown provider: ${provider}`, provider)
  }
}
