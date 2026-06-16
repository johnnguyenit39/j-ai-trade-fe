/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_AGENT_TOKEN_KEY: string
  readonly VITE_AI_PROVIDER?: string
  readonly VITE_ADVISOR_ACCOUNT_USDT?: string
  readonly VITE_ADVISOR_RISK_PCT?: string
  // Firebase web config (public-by-design). Persistence is off if unset.
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
