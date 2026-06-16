import { useEffect, useRef, useState } from 'react'
import { useChat } from '../hooks/useChat'
import { ACTIVE_PROVIDER } from '../ai'
import { useAuth } from '../auth/AuthContext'

export function ChatScreen() {
  const { messages, isStreaming, status, error, hasMore, loadingMore, loadMore, send, stop } =
    useChat()
  const { user, logout, configured } = useAuth()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Skip the auto-scroll-to-bottom once when older messages are prepended.
  const skipScrollRef = useRef(false)

  // Auto-scroll to the latest message (but not when loading older history).
  useEffect(() => {
    if (skipScrollRef.current) {
      skipScrollRef.current = false
      return
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleLoadMore = () => {
    skipScrollRef.current = true
    loadMore()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return
    send(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter while an IME composition is active (e.g. Vietnamese input),
    // otherwise the last composed word gets re-inserted after we clear the box.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="chat">
      <header className="chat__header">
        <span className="chat__title">J AI Trade</span>
        <span className="chat__provider">{ACTIVE_PROVIDER}</span>
        <span className="chat__spacer" />
        {configured && user && (
          <>
            <span className="chat__user">{user.email}</span>
            <button className="chat__logout" type="button" onClick={() => logout()}>
              Đăng xuất
            </button>
          </>
        )}
      </header>

      <div className="chat__messages" ref={scrollRef}>
        {hasMore && (
          <button
            type="button"
            className="chat__loadmore"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Đang tải…' : 'Tải thêm tin cũ'}
          </button>
        )}
        {messages.length === 0 && (
          <div className="chat__empty">Ask me anything to get started.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble--${m.role}`}>
            {m.content || <span className="bubble__cursor">▍</span>}
          </div>
        ))}
        {status && <div className="chat__status">{status}</div>}
        {error && <div className="chat__error">⚠️ {error}</div>}
      </div>

      <form className="chat__input" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
        />
        {isStreaming ? (
          <button type="button" className="chat__btn chat__btn--stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="chat__btn" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  )
}
