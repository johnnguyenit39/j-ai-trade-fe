// Connection test using the Firebase WEB SDK exactly as the frontend does:
// init with VITE_FIREBASE_* from .env, write → read → delete a probe doc.
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc, getDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm')) || [])[1] || ''

const app = initializeApp({
  apiKey: get('VITE_FIREBASE_API_KEY'),
  authDomain: get('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: get('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: get('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: get('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: get('VITE_FIREBASE_APP_ID'),
})
const db = getFirestore(app)

const ref = doc(db, 'sessions', '_conntest')
try {
  await setDoc(ref, { ping: 'ok', at: serverTimestamp() })
  const snap = await getDoc(ref)
  console.log('READ BACK:', JSON.stringify(snap.data()))
  await deleteDoc(ref)
  console.log('✅ Firestore write/read/delete OK — rules allow access.')
  process.exit(0)
} catch (e) {
  console.error('❌ FAILED:', e.code || '', e.message)
  process.exit(1)
}
