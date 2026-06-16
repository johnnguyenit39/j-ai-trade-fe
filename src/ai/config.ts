import { AIProvider } from './types'

export interface ProviderConfig {
  /** Base URL of the API. In dev we use a Vite proxy to avoid CORS. */
  baseUrl: string
  /** Default model id used when none is supplied. */
  defaultModel: string
}

// In dev, route DeepSeek through the Vite proxy (see vite.config.ts) so the
// browser never hits CORS. In prod, call the API directly.
const deepSeekBaseUrl = import.meta.env.DEV
  ? '/api/deepseek'
  : 'https://api.deepseek.com'

export const PROVIDER_CONFIG: Record<AIProvider, ProviderConfig> = {
  [AIProvider.DeepSeek]: {
    baseUrl: deepSeekBaseUrl,
    defaultModel: 'deepseek-chat',
  },
  [AIProvider.OpenAI]: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  [AIProvider.Claude]: {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
  },
}

/** The single shared API token, read from the environment. */
export const AI_AGENT_TOKEN_KEY: string =
  import.meta.env.VITE_AI_AGENT_TOKEN_KEY ?? ''

/** Which provider the app currently uses. Change here (or via env) to swap. */
export const ACTIVE_PROVIDER: AIProvider =
  (import.meta.env.VITE_AI_PROVIDER as AIProvider) || AIProvider.DeepSeek
