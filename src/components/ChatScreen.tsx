import { useEffect, useRef, useState } from 'react'
import { useChat } from '../hooks/useChat'
import { ACTIVE_PROVIDER } from '../ai'

export function ChatScreen() {
  const { messages, isStreaming, status, error, send, stop } = useChat()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return
    send(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="chat">
      <header className="chat__header">
        <span className="chat__title">J AI Trade</span>
        <span className="chat__provider">{ACTIVE_PROVIDER}</span>
      </header>

      <div className="chat__messages" ref={scrollRef}>
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
