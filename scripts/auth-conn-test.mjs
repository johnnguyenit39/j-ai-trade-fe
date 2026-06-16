// End-to-end test of the auth + per-user Firestore path, exactly as the
// frontend runs it: sign up → write users/{uid}/messages → read → clean up.
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, deleteUser } from 'firebase/auth'
import { getFirestore, doc, setDoc, getDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm')) || [])[1] || ''

const app = initializeApp({
  apiKey: get('VITE_FIREBASE_API_KEY'),
  authDomain: get('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: get('VITE_FIREBASE_PROJECT_ID'),
  appId: get('VITE_FIREBASE_APP_ID'),
})
const auth = getAuth(app)
const db = getFirestore(app)

const email = `probe_${Date.now()}@test.com`
try {
  const cred = await createUserWithEmailAndPassword(auth, email, 'test123456')
  const uid = cred.user.uid
  console.log('signed up uid:', uid)

  const ref = doc(db, 'users', uid, 'messages', '_probe')
  await setDoc(ref, { role: 'user', content: 'hello', createdAt: serverTimestamp() })
  const snap = await getDoc(ref)
  console.log('READ BACK:', JSON.stringify(snap.data()))

  await deleteDoc(ref)
  await deleteUser(cred.user) // cleanup the throwaway account
  console.log('✅ Auth + per-user write/read OK, cleaned up.')
  process.exit(0)
} catch (e) {
  console.error('❌ FAILED:', e.code || '', e.message)
  process.exit(1)
}
