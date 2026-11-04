import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'

interface Chat {
  canSend: boolean
  otherName: string | null
  messages: { id: number; mine: boolean; text: string; outside: boolean; at: string }[]
}

// Messages between a customer and the courier delivering their order ("I'm at the blue gate"). Opens as a
// panel; while it's open it checks for new messages every 5 seconds. The quick replies are one tap, which
// matters when you're on a bike or carrying the order.
export function DeliveryChat({ orderId, otherName, unread, quickReplies }: { orderId: number; otherName: string; unread: number; quickReplies: string[] }) {
  const [open, setOpen] = useState(false)
  const [chat, setChat] = useState<Chat | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    api<Chat>(`/orders/${orderId}/messages`)
      .then(setChat)
      .catch(() => {}) // no signal: the next check will do
  }, [orderId])

  useEffect(() => {
    if (!open) return
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [open, load])

  // Keep the newest message in view.
  const count = chat?.messages.length ?? 0
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [count])

  async function send(body: string) {
    if (!body.trim()) return
    setSending(true)
    setError(null)
    try {
      await api(`/orders/${orderId}/messages`, { method: 'POST', body: { text: body } })
      setText('')
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        💬 Message {otherName}
        {unread > 0 && (
          <span className="count-badge" style={{ marginLeft: 8 }} aria-label={`${unread} new`}>
            {unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <section className="chat" aria-label={`Messages with ${otherName}`}>
      <div className="chat-head">
        <strong>Messages with {otherName}</strong>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="chat-list" aria-live="polite">
        {chat === null && <p className="fine-print">Loading…</p>}
        {chat?.messages.length === 0 && <p className="fine-print">No messages yet. Say where to find you, or ask a question.</p>}
        {chat?.messages.map((m) => (
          <p key={m.id} className={m.mine ? 'mine' : 'theirs'}>
            {m.outside && '📍 '}
            {m.text}
            <time dateTime={m.at}>{new Date(m.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</time>
          </p>
        ))}
        <div ref={end} />
      </div>
      {chat?.canSend === false ? (
        <p className="fine-print">The chat closed when the delivery ended.</p>
      ) : (
        <>
          <div className="chips chat-replies">
            {quickReplies.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => send(q)} disabled={sending}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault()
              send(text)
            }}
          >
            <label htmlFor={`chat-${orderId}`} className="visually-hidden">
              Message to {otherName}
            </label>
            <div className="input-wrap">
              <input id={`chat-${orderId}`} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Write a message" autoComplete="off" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
              Send
            </button>
          </form>
        </>
      )}
      {error && <p className="field-error">{error}</p>}
    </section>
  )
}
