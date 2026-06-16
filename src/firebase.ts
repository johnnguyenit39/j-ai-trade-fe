// Firebase Web SDK init. Config comes from VITE_FIREBASE_* env vars (the web
// config from Firebase Console → Project settings → Your apps → Web app — this
// is public-by-design, NOT the backend service account).
//
// The app is usable WITHOUT Firebase: when config is absent, `db` is null and
// the store layer no-ops, so chat works in-memory. Fill the env to turn on
// persistence.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId)

let app: FirebaseApp | null = null
let firestore: Firestore | null = null

if (isFirebaseConfigured) {
  app = initializeApp(config)
  firestore = getFirestore(app)
} else {
  console.info('Firebase not configured (VITE_FIREBASE_*) — running in-memory, no persistence.')
}

export const db = firestore
