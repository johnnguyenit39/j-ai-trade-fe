import { useCallback, useEffect, useRef, useState } from 'react'
import { getHandler, type ChatMessage } from '../ai'
import { buildMessagesWithMarket, WELCOME_MESSAGE } from '../ai/trading/messages'
import { extractDecision } from '../ai/trading/decisionParser'
import { stripLLMEmphasis, stripMarketDataDump } from '../ai/trading/textClean'
import { formatAdvisorReplyForUser, type FreshnessContext } from '../ai/trading/tradeCard'
import { maybeEnrich } from '../trading/advisor'
import {
  appendMessage,
  getLastSymbol,
  loadMessages,
  saveDecision,
  setLastSymbol,
} from '../store/sessionStore'

export interface UIMessage extends ChatMessage {
  id: string
  // Transient = UI-only (e.g. the welcome greeting): never sent to the model
  // and never persisted, matching the Go backend's separate-send welcome.
  transient?: boolean
}

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
  const abortRef = useRef<AbortController | null>(null)
  // Pinned symbol so follow-ups ("giờ bao nhiêu") re-fetch the same pair.
  const lastSymbolRef = useRef<string>('')

  // Hydrate persisted history + pinned symbol on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [history, lastSymbol] = await Promise.all([loadMessages(), getLastSymbol()])
      if (cancelled) return
      lastSymbolRef.current = lastSymbol
      setMessages(
        history.length > 0
          ? history.map((m) => ({ id: nextId(), role: m.role, content: m.content }))
          : [welcomeMsg()],
      )
    })().catch(() => {
      if (!cancelled) setMessages([welcomeMsg()])
    })
    return () => {
      cancelled = true
    }
  }, [])

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

      // History sent to the model = prior NON-transient turns only (system
      // prompt + market blob are added by buildMessagesWithMarket; neither is
      // persisted, and the welcome greeting is excluded).
      const history: ChatMessage[] = messages
        .filter((m) => !m.transient)
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
        const msgs = buildMessagesWithMarket(history, content, digest)
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
        // Cleaned text only — never the market digest.
        if (finalText !== '') {
          try {
            await appendMessage('user', content)
            await appendMessage('assistant', finalText)
            if (decision) await saveDecision(decision)
          } catch (perr) {
            console.warn('persist failed (non-fatal)', perr)
          }
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

  return { messages, isStreaming, status, error, send, stop }
}
