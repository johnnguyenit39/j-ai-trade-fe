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
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import type { ChatRole } from '../ai'
import type { DecisionPayload } from '../ai/trading/decisionParser'

export interface StoredMessage {
  role: ChatRole
  content: string
}

// Data is scoped per authenticated user: users/{uid}/...
// `ready()` gates every call on both Firestore config and a signed-in user.
const uid = () => auth?.currentUser?.uid ?? null
const ready = (): boolean => Boolean(db && uid())

const userDoc = () => doc(db!, 'users', uid()!)
const messagesCol = () => collection(db!, 'users', uid()!, 'messages')
const decisionsCol = () => collection(db!, 'users', uid()!, 'decisions')

/** Opaque cursor for paginating older messages (newest-first internally). */
export type MessageCursor = QueryDocumentSnapshot<DocumentData> | null

export interface MessagePage {
  /** Oldest → newest, ready to render. */
  messages: StoredMessage[]
  /** Pass back to loadOlderMessages to fetch the next older page. */
  cursor: MessageCursor
  /** Whether more (older) messages exist beyond this page. */
  hasMore: boolean
}

const DEFAULT_PAGE = 20

// Fetches `size` newest messages before `after` (exclusive). We over-fetch by
// one to detect whether an older page exists, then trim and reverse to asc.
async function fetchPage(size: number, after: MessageCursor): Promise<MessagePage> {
  if (!ready()) return { messages: [], cursor: null, hasMore: false }
  const clauses: QueryConstraint[] = [orderBy('createdAt', 'desc')]
  if (after) clauses.push(startAfter(after))
  clauses.push(fbLimit(size + 1))
  const snap = await getDocs(query(messagesCol(), ...clauses))
  const hasMore = snap.docs.length > size
  const docs = snap.docs.slice(0, size) // newest → oldest
  const cursor = docs.length ? docs[docs.length - 1] : after
  const messages = docs
    .map((d) => {
      const data = d.data() as { role: ChatRole; content: string }
      return { role: data.role, content: data.content }
    })
    .reverse() // → oldest → newest for display
  return { messages, cursor, hasMore }
}

/** Loads the most recent page (newest messages). */
export function loadRecentMessages(size = DEFAULT_PAGE): Promise<MessagePage> {
  return fetchPage(size, null)
}

/** Loads the next older page, given the cursor from a previous page. */
export function loadOlderMessages(cursor: MessageCursor, size = DEFAULT_PAGE): Promise<MessagePage> {
  return fetchPage(size, cursor)
}

/** Appends one turn. We persist only cleaned text (never the market digest). */
export async function appendMessage(role: ChatRole, content: string): Promise<void> {
  if (!ready()) return
  await addDoc(messagesCol(), { role, content, createdAt: serverTimestamp() })
}

export async function getLastSymbol(): Promise<string> {
  if (!ready()) return ''
  const snap = await getDoc(userDoc())
  return (snap.data()?.lastSymbol as string) ?? ''
}

export async function setLastSymbol(symbol: string): Promise<void> {
  if (!ready()) return
  await setDoc(userDoc(), { lastSymbol: symbol, updatedAt: serverTimestamp() }, { merge: true })
}

/** Conversation memory: a compact running summary the LLM maintains. */
export async function getMemory(): Promise<string> {
  if (!ready()) return ''
  const snap = await getDoc(userDoc())
  return (snap.data()?.memory as string) ?? ''
}

export async function setMemory(memory: string): Promise<void> {
  if (!ready()) return
  await setDoc(userDoc(), { memory, updatedAt: serverTimestamp() }, { merge: true })
}

/** Persists a parsed trade decision (the agent_decisions equivalent). */
export async function saveDecision(d: DecisionPayload): Promise<void> {
  if (!ready()) return
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
  if (!ready()) return
  const snap = await getDocs(messagesCol())
  const batch = writeBatch(db!)
  snap.docs.forEach((d) => batch.delete(d.ref))
  batch.set(userDoc(), { lastSymbol: '', updatedAt: serverTimestamp() }, { merge: true })
  await batch.commit()
}
