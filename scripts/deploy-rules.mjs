// Deploys firestore.rules to the project via the Firebase Rules API using the
// service account (server-side). Replaces `firebase deploy --only firestore:rules`
// since the local CLI install is broken. Run: node scripts/deploy-rules.mjs
import { readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const sa = JSON.parse(
  Buffer.from(env.match(/^SERVICE_ACCOUNT_KEY_BASE_64="?([^"\n]+)"?/m)[1], 'base64').toString('utf8'),
)
const projectId = sa.project_id
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

const client = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

async function api(url, init) {
  const { token } = await client.getAccessToken()
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${JSON.stringify(body)}`)
  return body
}

const BASE = `https://firebaserules.googleapis.com/v1/projects/${projectId}`

async function main() {
  // 1) Create a ruleset from the source file.
  const ruleset = await api(`${BASE}/rulesets`, {
    method: 'POST',
    body: JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: rulesSource }] },
    }),
  })
  console.error('ruleset:', ruleset.name)

  // 2) Point the cloud.firestore release at it (update if exists, else create).
  const releaseName = `projects/${projectId}/releases/cloud.firestore`
  try {
    await api(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
      method: 'PATCH',
      body: JSON.stringify({ release: { name: releaseName, rulesetName: ruleset.name } }),
    })
    console.log('✅ Updated release cloud.firestore → rules deployed.')
  } catch {
    await api(`${BASE}/releases`, {
      method: 'POST',
      body: JSON.stringify({ name: releaseName, rulesetName: ruleset.name }),
    })
    console.log('✅ Created release cloud.firestore → rules deployed.')
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
