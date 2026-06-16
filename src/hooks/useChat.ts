import { useCallback, useEffect, useRef, useState } from 'react'
import { getHandler, type ChatMessage } from '../ai'
import { buildMessagesWithMarket, WELCOME_MESSAGE } from '../ai/trading/messages'
import { extractDecision } from '../ai/trading/decisionParser'
import { stripLLMEmphasis, stripMarketDataDump } from '../ai/trading/textClean'
import { formatAdvisorReplyForUser, type FreshnessContext } from '../ai/trading/tradeCard'
import { updateMemory } from '../ai/trading/memory'
import { maybeEnrich } from '../trading/advisor'
import {
  appendMessage,
  getLastSymbol,
  getMemory,
  loadOlderMessages,
  loadRecentMessages,
  saveDecision,
  setLastSymbol,
  setMemory,
  type MessageCursor,
} from '../store/sessionStore'

export interface UIMessage extends ChatMessage {
  id: string
  // Transient = UI-only (e.g. the welcome greeting): never sent to the model
  // and never persisted, matching the Go backend's separate-send welcome.
  transient?: boolean
}

// How many recent turns we feed the model. Older context is carried by `memory`
// (a running summary), so we keep the prompt bounded no matter how long the
// conversation grows.
const MODEL_HISTORY_TURNS = 12

let idCounter = 0
const nextId = () => `m${++idCounter}`

const welcomeMsg = (): UIMessage => ({
  id: nextId(),
  role: 'assistant',
  content: WELCOME_MESSAGE,
  transient: true,
})

export function useChat() {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Pinned symbol so follow-ups ("giờ bao nhiêu") re-fetch the same pair.
  const lastSymbolRef = useRef<string>('')
  // Running conversation memory the LLM maintains.
  const memoryRef = useRef<string>('')
  // Pagination cursor for loading older messages.
  const cursorRef = useRef<MessageCursor>(null)

  // Hydrate the latest page + pinned symbol + memory on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [page, lastSymbol, memory] = await Promise.all([
        loadRecentMessages(),
        getLastSymbol(),
        getMemory(),
      ])
      if (cancelled) return
      lastSymbolRef.current = lastSymbol
      memoryRef.current = memory
      cursorRef.current = page.cursor
      setHasMore(page.hasMore)
      setMessages(
        page.messages.length > 0
          ? page.messages.map((m) => ({ id: nextId(), role: m.role, content: m.content }))
          : [welcomeMsg()],
      )
    })().catch(() => {
      if (!cancelled) setMessages([welcomeMsg()])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await loadOlderMessages(cursorRef.current)
      cursorRef.current = page.cursor
      setHasMore(page.hasMore)
      if (page.messages.length > 0) {
        const older = page.messages.map((m) => ({
          id: nextId(),
          role: m.role,
          content: m.content,
        }))
        setMessages((prev) => [...older, ...prev])
      }
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || isStreaming) return

      setError(null)
      setIsStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller

      // History sent to the model = last N non-transient turns (memory carries
      // the rest). System prompt, memory, and market blob are added by
      // buildMessagesWithMarket; none of those are persisted.
      const history: ChatMessage[] = messages
        .filter((m) => !m.transient)
        .slice(-MODEL_HISTORY_TURNS)
        .map(({ role, content }) => ({ role, content }))
      const userMsg: UIMessage = { id: nextId(), role: 'user', content }
      setMessages((prev) => [...prev, userMsg])

      // Phase-2 enrichment: fetch live market data and render the digest.
      let digest = ''
      let fresh: FreshnessContext = { currentPrice: 0, atrM15: 0, generatedAt: 0 }
      try {
        setStatus('Đang lấy dữ liệu thị trường…')
        const enrichment = await maybeEnrich(content, lastSymbolRef.current, controller.signal)
        if (enrichment) {
          digest = enrichment.digest
          fresh = {
            currentPrice: enrichment.currentPrice,
            atrM15: enrichment.atrM15,
            generatedAt: enrichment.generatedAt,
          }
          if (enrichment.symbol) {
            lastSymbolRef.current = enrichment.symbol
            setLastSymbol(enrichment.symbol).catch(() => {})
          }
          if (enrichment.ack) setStatus(enrichment.ack)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setIsStreaming(false)
          setStatus(null)
          abortRef.current = null
          return
        }
        console.warn('enrichment error', err)
      }

      const assistantMsg: UIMessage = { id: nextId(), role: 'assistant', content: '' }
      setMessages((prev) => [...prev, assistantMsg])

      let raw = ''
      try {
        const handler = getHandler()
        const msgs = buildMessagesWithMarket(history, content, digest, memoryRef.current)
        await handler.streamChat(msgs, {
          signal: controller.signal,
          onToken: (token) => {
            raw += token
            setStatus(null)
            const display = stripLLMEmphasis(stripMarketDataDump(raw))
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: display } : m)),
            )
          },
        })

        // Finalise: strip fence/dump; render a trade card if a decision was emitted.
        const reply = raw.trim()
        let finalText = stripLLMEmphasis(stripMarketDataDump(reply))
        const decision = extractDecision(reply)
        if (decision) finalText = formatAdvisorReplyForUser(reply, decision, fresh)

        setMessages((prev) =>
          prev
            .map((m) => (m.id === assistantMsg.id ? { ...m, content: finalText } : m))
            .filter((m) => !(m.id === assistantMsg.id && finalText === '')),
        )

        // Persist the turn pair (only on a non-empty reply, like the backend).
        if (finalText !== '') {
          try {
            await appendMessage('user', content)
            await appendMessage('assistant', finalText)
            if (decision) await saveDecision(decision)
          } catch (perr) {
            console.warn('persist failed (non-fatal)', perr)
          }

          // Update conversation memory in the background (extra LLM call).
          updateMemory(handler, memoryRef.current, content, finalText)
            .then((next) => {
              if (next !== memoryRef.current) {
                memoryRef.current = next
                setMemory(next).catch(() => {})
              }
            })
            .catch(() => {})
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        const message = err instanceof Error ? err.message : 'Something went wrong.'
        setError(message)
        setMessages((prev) => prev.filter((m) => !(m.id === assistantMsg.id && m.content === '')))
      } finally {
        setIsStreaming(false)
        setStatus(null)
        abortRef.current = null
      }
    },
    [messages, isStreaming],
  )

  return { messages, isStreaming, status, error, hasMore, loadingMore, loadMore, send, stop }
}
