import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { dateTime } from '../../lib/labels'
import { Conversation, TOPIC_LABEL, type Ticket } from '../HelpPage'

type SupportTicket = Ticket & { person: { name: string; role: string } }
type Message = Parameters<typeof Conversation>[0]['messages'][number]

const ROLE: Record<string, string> = { consumer: 'customer', entrepreneur: 'seller', courier: 'courier', support: 'support' }

// Help tickets in the support console: the ones waiting for an answer first, oldest first. Open one to
// read the conversation and answer; the person gets a notification and an SMS with the link.
export function TicketsTab() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<SupportTicket[]>('/support/tickets')
      .then(setTickets)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  if (!tickets) return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />
  if (openId) return <TicketDetail id={openId} onBack={() => { setOpenId(null); load() }} />

  const groups: [string, SupportTicket[]][] = [
    ['Waiting for an answer', tickets.filter((t) => t.status === 'open')],
    ['Answered, waiting for them', tickets.filter((t) => t.status === 'answered')],
    ['Recently closed', tickets.filter((t) => t.status === 'closed')],
  ]
  return (
    <>
      {groups.map(([title, list]) => (
        <section key={title} style={{ marginBottom: 16 }}>
          <div className="section-head">
            <h2>
              {title} ({list.length})
            </h2>
          </div>
          {list.length === 0 && <p className="fine-print">None.</p>}
          {list.map((t) => (
            <button key={t.id} type="button" className="card ticket-row" onClick={() => setOpenId(t.id)}>
              <strong>
                #{t.id} · {t.subject}
              </strong>
              <span className="product-meta">
                {t.person.name} ({ROLE[t.person.role] ?? t.person.role}) · {TOPIC_LABEL[t.topic]} · updated {dateTime(t.updatedAt)}
              </span>
            </button>
          ))}
        </section>
      ))}
    </>
  )
}

function TicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [ticket, setTicket] = useState<(SupportTicket & { messages: Message[] }) | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<SupportTicket & { messages: Message[] }>(`/support/tickets/${id}`)
      .then(setTicket)
      .catch((err) => setError(err.message))
  }, [id])
  useEffect(load, [load])

  async function answer(close: boolean) {
    setBusy(true)
    setError(null)
    try {
      await api(`/support/tickets/${id}/messages`, { method: 'POST', body: { message: text, close } })
      setText('')
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={onBack} style={{ marginBottom: 12 }}>
        ← All tickets
      </button>
      {error && <p className="notice error">{error}</p>}
      {ticket && (
        <article className="card">
          <strong>
            #{ticket.id} · {ticket.subject}
          </strong>
          <p className="product-meta" style={{ margin: '4px 0 8px' }}>
            {ticket.person.name} ({ROLE[ticket.person.role] ?? ticket.person.role}) · {TOPIC_LABEL[ticket.topic]} · opened{' '}
            {dateTime(ticket.createdAt)}
          </p>
          <Conversation messages={ticket.messages} />
          {ticket.status === 'closed' ? (
            <p className="notice">Closed {ticket.closedAt && dateTime(ticket.closedAt)}.</p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="answer">Your answer</label>
                <div className="input-wrap">
                  <textarea id="answer" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <p className="fine-print">They get a notification and an SMS with a link. Never ask for ID documents or PINs here.</p>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 5} onClick={() => answer(false)}>
                  {busy ? 'Sending…' : 'Send answer'}
                </button>
                <button type="button" className="btn btn-outline" disabled={busy || text.trim().length < 5} onClick={() => answer(true)}>
                  Send and close
                </button>
              </div>
            </>
          )}
        </article>
      )}
    </>
  )
}
