// Firestore persistence for the single-user, single-thread chat.
// Mirrors the Go backend's Redis session (rolling history + lastSymbol) and
// Postgres agent_decisions, collapsed into one fixed Firestore session.
//
// Layout (no auth — one fixed session; secure with rules before going public):
//   sessions/{SESSION_ID}                       { lastSymbol, updatedAt }
//   sessions/{SESSION_ID}/messages/{autoId}     { role, content, createdAt }
//   sessions/{SESSION_ID}/decisions/{autoId}    { ...DecisionPayload, createdAt }
//
// All functions no-op (return empty/defaults) when Firebase isn't configured,
// so the app keeps working in-memory.

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { ChatRole } from '../ai'
import type { DecisionPayload } from '../ai/trading/decisionParser'

const SESSION_ID = 'default'

export interface StoredMessage {
  role: ChatRole
  content: string
}

const sessionDoc = () => doc(db!, 'sessions', SESSION_ID)
const messagesCol = () => collection(db!, 'sessions', SESSION_ID, 'messages')
const decisionsCol = () => collection(db!, 'sessions', SESSION_ID, 'decisions')

/** Loads the full rolling history (oldest → newest). */
export async function loadMessages(): Promise<StoredMessage[]> {
  if (!db) return []
  const snap = await getDocs(query(messagesCol(), orderBy('createdAt', 'asc')))
  return snap.docs.map((d) => {
    const data = d.data() as { role: ChatRole; content: string }
    return { role: data.role, content: data.content }
  })
}

/** Appends one turn. We persist only cleaned text (never the market digest). */
export async function appendMessage(role: ChatRole, content: string): Promise<void> {
  if (!db) return
  await addDoc(messagesCol(), { role, content, createdAt: serverTimestamp() })
}

export async function getLastSymbol(): Promise<string> {
  if (!db) return ''
  const snap = await getDoc(sessionDoc())
  return (snap.data()?.lastSymbol as string) ?? ''
}

export async function setLastSymbol(symbol: string): Promise<void> {
  if (!db) return
  await setDoc(sessionDoc(), { lastSymbol: symbol, updatedAt: serverTimestamp() }, { merge: true })
}

/** Persists a parsed trade decision (the agent_decisions equivalent). */
export async function saveDecision(d: DecisionPayload): Promise<void> {
  if (!db) return
  await addDoc(decisionsCol(), {
    symbol: d.symbol,
    action: d.action,
    entry: d.entry,
    stopLoss: d.stopLoss,
    takeProfit: d.takeProfit,
    lot: d.lot,
    confidence: d.confidence ?? 'med',
    invalidation: d.invalidation ?? '',
    createdAt: serverTimestamp(),
  })
}

/** Clears the rolling history and pinned symbol (used by /reset). */
export async function clearSession(): Promise<void> {
  if (!db) return
  const snap = await getDocs(messagesCol())
  const batch = writeBatch(db)
  snap.docs.forEach((d) => batch.delete(d.ref))
  batch.set(sessionDoc(), { lastSymbol: '', updatedAt: serverTimestamp() }, { merge: true })
  await batch.commit()
}
