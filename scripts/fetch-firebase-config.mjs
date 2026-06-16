// Uses the service account (server-side only) to fetch the Firebase WEB config
// from the Firebase Management API — the same data `firebase apps:sdkconfig WEB`
// returns. Run: node scripts/fetch-firebase-config.mjs
import { readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'

function readEnvVar(name) {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const m = env.match(new RegExp(`^${name}="?([^"\\n]+)"?`, 'm'))
  if (!m) throw new Error(`${name} not found in .env`)
  return m[1]
}

const sa = JSON.parse(Buffer.from(readEnvVar('SERVICE_ACCOUNT_KEY_BASE_64'), 'base64').toString('utf8'))
const projectId = sa.project_id
console.error(`Project: ${projectId} (client_email: ${sa.client_email})`)

const client = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

async function api(path, init) {
  const { token } = await client.getAccessToken()
  const res = await fetch(`https://firebase.googleapis.com/v1beta1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function main() {
  const list = await api(`/projects/${projectId}/webApps`)
  let app = list.apps?.[0]
  if (!app) {
    console.error('No web app found — creating one…')
    let op = await api(`/projects/${projectId}/webApps`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'j-ai-trade-fe' }),
    })
    // Creating a web app is a long-running operation — poll until done.
    while (!op.done) {
      await new Promise((r) => setTimeout(r, 1500))
      op = await api(`/${op.name}`)
    }
    if (op.error) throw new Error(`create webApp: ${JSON.stringify(op.error)}`)
    app = op.response
  }
  const appId = app.appId
  console.error(`Web app: ${app.displayName ?? '(unnamed)'} appId=${appId}`)

  const cfg = await api(`/projects/${projectId}/webApps/${appId}/config`)
  console.error('\n=== paste into .env ===')
  console.log(`VITE_FIREBASE_API_KEY="${cfg.apiKey}"`)
  console.log(`VITE_FIREBASE_AUTH_DOMAIN="${cfg.authDomain}"`)
  console.log(`VITE_FIREBASE_PROJECT_ID="${cfg.projectId}"`)
  console.log(`VITE_FIREBASE_STORAGE_BUCKET="${cfg.storageBucket ?? ''}"`)
  console.log(`VITE_FIREBASE_MESSAGING_SENDER_ID="${cfg.messagingSenderId ?? ''}"`)
  console.log(`VITE_FIREBASE_APP_ID="${cfg.appId}"`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
