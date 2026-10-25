import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'

interface Sms {
  id: number
  direction: 'out' | 'in'
  body: string
  at: string
}

// DEMO ONLY: a pretend basic phone, to show how a market-stall holder without a smartphone runs
// orders by SMS. "out" messages were sent BY KurumanMarketPlace TO this phone; "in" were sent FROM it.
// With a real SMS gateway connected this page is switched off and real phones are used.
export function DemoPhonePage() {
  const [number, setNumber] = useState('071 000 0014')
  const [messages, setMessages] = useState<Sms[] | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    api<Sms[]>(`/demo/phone?number=${encodeURIComponent(number)}`)
      .then((m) => {
        setMessages(m)
        setError(null)
      })
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'The demo phone is switched off on this site.' : err.message))
  }, [number])

  // New SMS appear by themselves, like on a real phone.
  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  async function send(body: string) {
    if (!body.trim()) return
    setBusy(true)
    try {
      await api('/demo/phone', { method: 'POST', body: { number, text: body } })
      setText('')
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Demo: a basic phone</h1>
      <p className="lead">
        This is how Mma Kefilwe runs her market stall with a phone that only does calls and SMS. Place an order at her
        stall in another window, then answer it here.
      </p>
      <label className="field" htmlFor="phone-number">
        <span>Phone number</span>
        <span className="input-wrap">
          <input id="phone-number" type="tel" value={number} onChange={(e) => setNumber(e.target.value)} />
        </span>
      </label>

      <div className="basic-phone" aria-label="Phone screen">
        <div className="basic-phone-screen" aria-live="polite">
          {error && <p className="basic-phone-note">{error}</p>}
          {messages?.length === 0 && <p className="basic-phone-note">No messages yet.</p>}
          {messages?.map((m) => (
            <p key={m.id} className={`sms ${m.direction === 'out' ? 'received' : 'sent'}`}>
              {m.body}
              <span className="sms-time">
                {new Date(m.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </p>
          ))}
          <div ref={end} />
        </div>
        <form
          className="basic-phone-keys"
          onSubmit={(e) => {
            e.preventDefault()
            send(text)
          }}
        >
          <button type="button" className="phone-key" disabled={busy} onClick={() => send('1')}>
            1<small>accept</small>
          </button>
          <button type="button" className="phone-key" disabled={busy} onClick={() => send('2')}>
            2<small>sold out</small>
          </button>
          <label className="visually-hidden" htmlFor="sms-text">
            Type an SMS (e.g. the customer's code)
          </label>
          <input
            id="sms-text"
            className="phone-input"
            inputMode="numeric"
            placeholder="Customer’s code"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={160}
          />
          <button type="submit" className="phone-key send" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      </div>
      <p className="fine-print">
        Demo only: no real SMS is sent. With an SMS gateway, the same messages go to the stall holder’s real phone.
      </p>
    </main>
  )
}
