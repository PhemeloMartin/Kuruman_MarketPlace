import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BackIcon } from '../components/Icons'
import { MokalaSmall } from '../components/Art'
import { api, ApiError } from '../lib/api'
import { dateTime } from '../lib/labels'

// Help tickets, like a support centre: open a ticket on the site and follow it here - its number, its
// status and the conversation with support. When support answers, you get a notification and an SMS.

export interface Ticket {
  id: number
  topic: string
  subject: string
  status: 'open' | 'answered' | 'closed'
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

interface Message {
  id: number
  fromSupport: boolean
  author: string
  body: string
  at: string
}

export const TOPIC_LABEL: Record<string, string> = {
  order: 'An order',
  selling: 'Selling on the site',
  payment: 'A payment or refund',
  account: 'My account',
  other: 'Something else',
}

// What the person sees; support's console words it from their side.
const STATUS: Record<Ticket['status'], { label: string; tone: string }> = {
  open: { label: 'Waiting for support', tone: 'wait' },
  answered: { label: 'Support replied', tone: 'good' },
  closed: { label: 'Closed', tone: '' },
}

function SignInFirst() {
  return (
    <main className="page">
      <h1 className="page-title">Help</h1>
      <div className="empty">
        <MokalaSmall />
        <h2>Sign in to ask for help</h2>
        <p>Your questions and support’s answers stay private to your account.</p>
        <Link to="/signin" state={{ from: '/help' }} className="btn btn-primary">
          Sign in
        </Link>
      </div>
    </main>
  )
}

// /help - my tickets, and a form to open a new one.
export function HelpPage() {
  const { user, loading } = useAuth()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Ticket[]>('/tickets')
      .then(setTickets)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(() => {
    if (user) load()
  }, [user, load])

  if (loading) return null
  if (!user) return <SignInFirst />

  return (
    <main className="page">
      <h1 className="page-title">Help</h1>
      <p style={{ marginTop: -8 }}>
        Ask our support team anything: an order, selling, a payment or your account. You can follow your question here,
        and we’ll send you an SMS when we answer.
      </p>
      {error && <p className="notice error">{error}</p>}
      {writing ? (
        <NewTicket onCancel={() => setWriting(false)} />
      ) : (
        <button type="button" className="btn btn-primary btn-block" onClick={() => setWriting(true)}>
          + Ask for help
        </button>
      )}

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2>Your questions</h2>
      </div>
      {tickets === null && !error && <div className="skeleton" style={{ minHeight: 120 }} />}
      {tickets?.length === 0 && <p className="notice">No questions yet.</p>}
      <ul className="ticket-list">
        {tickets?.map((t) => (
          <li key={t.id}>
            <Link to={`/help/${t.id}`} className="card ticket-row">
              <div className="order-card-head">
                <strong>
                  #{t.id} · {t.subject}
                </strong>
                <span className={`status-pill ${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
              </div>
              <span className="product-meta">
                {TOPIC_LABEL[t.topic]} · opened {dateTime(t.createdAt)} · last update {dateTime(t.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

function NewTicket({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ topic: '', subject: '', message: '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = (k: string) => (fields[k] ? <p className="field-error">{fields[k]}</p> : null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const r = await api<{ id: number }>('/tickets', { method: 'POST', body: form })
      navigate(`/help/${r.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: '1.1rem' }}>Ask for help</h2>
      <form className="form" onSubmit={submit} noValidate>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="field" data-invalid={Boolean(fields.topic)}>
          <label htmlFor="topic">What is it about?</label>
          <div className="input-wrap">
            <select id="topic" className="select" value={form.topic} onChange={set('topic')}>
              <option value="">Choose…</option>
              {Object.entries(TOPIC_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {err('topic')}
        </div>
        <div className="field" data-invalid={Boolean(fields.subject)}>
          <label htmlFor="subject">In a few words</label>
          <div className="input-wrap">
            <input id="subject" value={form.subject} onChange={set('subject')} maxLength={120} placeholder="e.g. Wrong items in my order" />
          </div>
          {err('subject')}
        </div>
        <div className="field" data-invalid={Boolean(fields.message)}>
          <label htmlFor="message">Tell us what happened</label>
          <div className="input-wrap">
            <textarea id="message" rows={5} maxLength={2000} value={form.message} onChange={set('message')} />
          </div>
          <p className="fine-print">If it’s about an order, add the order number (e.g. KMP-001234). Never send ID documents or bank PINs here.</p>
          {err('message')}
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}

// /help/:id - one ticket: the conversation, a reply box, and "my problem is solved".
export function TicketPage() {
  const { id } = useParams()
  const { user, loading } = useAuth()
  const [ticket, setTicket] = useState<(Ticket & { messages: Message[] }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Ticket & { messages: Message[] }>(`/tickets/${id}`)
      .then(setTicket)
      .catch((err) => setError(err.message))
  }, [id])
  useEffect(() => {
    if (user) load()
  }, [user, load])

  if (loading) return null
  if (!user) return <SignInFirst />

  return (
    <main className="page">
      <Link to="/help" className="back-link">
        <BackIcon /> Help
      </Link>
      {error && <p className="notice error">{error}</p>}
      {ticket && (
        <>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            #{ticket.id} · {ticket.subject}
          </h1>
          <p className="product-meta" style={{ marginTop: 0 }}>
            <span className={`status-pill ${STATUS[ticket.status].tone}`}>{STATUS[ticket.status].label}</span> ·{' '}
            {TOPIC_LABEL[ticket.topic]} · opened {dateTime(ticket.createdAt)}
          </p>
          <Conversation messages={ticket.messages} />
          {ticket.status === 'closed' ? (
            <p className="notice">
              This question is closed. Need more help? <Link to="/help">Ask a new question</Link>.
            </p>
          ) : (
            <ReplyBox ticketId={ticket.id} onDone={load} />
          )}
        </>
      )}
    </main>
  )
}

export function Conversation({ messages }: { messages: Message[] }) {
  return (
    <ul className="conversation">
      {messages.map((m) => (
        <li key={m.id} className={m.fromSupport ? 'from-support' : 'from-person'}>
          <span className="product-meta">
            {m.author} · {dateTime(m.at)}
          </span>
          <p>{m.body}</p>
        </li>
      ))}
    </ul>
  )
}

function ReplyBox({ ticketId, onDone }: { ticketId: number; onDone: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await api(path, { method: 'POST', body })
      setText('')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="field">
        <label htmlFor="reply">Add a message</label>
        <div className="input-wrap">
          <textarea id="reply" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 5} onClick={() => run(`/tickets/${ticketId}/messages`, { message: text })}>
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(`/tickets/${ticketId}/close`)}>
          My problem is solved
        </button>
      </div>
    </section>
  )
}
