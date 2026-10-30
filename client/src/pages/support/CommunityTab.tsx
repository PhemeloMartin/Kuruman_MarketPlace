import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api } from '../../lib/api'
import { dateTime } from '../../lib/labels'

interface Pending {
  id: number
  name: string
  categoryName: string
  description: string | null
  area: string
  phone: string
  hours: string | null
  submittedBy: string
  createdAt: string
}

// Directory listings waiting for approval: support checks the business is real and the number may be
// shown (the submitter confirmed the owner's permission), then approves or rejects with a reason.
export function DirectoryTab() {
  const [pending, setPending] = useState<Pending[] | null>(null)
  const [deciding, setDeciding] = useState<{ item: Pending; decision: 'approve' | 'reject' } | null>(null)
  const load = useCallback(() => {
    api<Pending[]>('/support/directory')
      .then(setPending)
      .catch(() => setPending([]))
  }, [])
  useEffect(load, [load])

  return (
    <section>
      {pending?.length === 0 && <p className="notice">No directory listings waiting.</p>}
      {pending?.map((p) => (
        <article key={p.id} className="card">
          <div className="order-card-head">
            <strong>{p.name}</strong>
            <span className="tag">{p.categoryName}</span>
          </div>
          {p.description && <p className="review-text">{p.description}</p>}
          <p className="fine-print">
            {p.area} · {p.phone} {p.hours && `· ${p.hours}`} · sent by {p.submittedBy}, {dateTime(p.createdAt)}
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setDeciding({ item: p, decision: 'reject' })}>
              Reject
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDeciding({ item: p, decision: 'approve' })}>
              Approve
            </button>
          </div>
        </article>
      ))}
      {deciding && (
        <ReasonDialog
          title={deciding.decision === 'approve' ? `Approve ${deciding.item.name}?` : `Reject ${deciding.item.name}?`}
          description={
            deciding.decision === 'approve'
              ? 'It appears in the directory straight away. Note how you checked it (e.g. phoned the number).'
              : 'The person who sent it sees your reason.'
          }
          confirmLabel={deciding.decision === 'approve' ? 'Approve' : 'Reject'}
          danger={deciding.decision === 'reject'}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            await api(`/support/directory/${deciding.item.id}`, { method: 'POST', body: { decision: deciding.decision, reason } })
            setDeciding(null)
            load()
          }}
        />
      )}
    </section>
  )
}

// The weekly post for the KurumanMarketPlace WhatsApp Channel, ready to copy. Every line links to the site:
// WhatsApp is where Kuruman finds the shops; the site is where it buys safely.
export function WhatsappPostTab() {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api<{ text: string }>('/support/whatsapp-post').then((r) => setText(r.text))
  }, [])
  return (
    <section>
      <p className="fine-print" style={{ marginTop: 0 }}>
        Made from this week’s numbers. Check it, change anything you like, then copy it into the KurumanMarketPlace
        WhatsApp Channel.
      </p>
      <div className="input-wrap">
        <label className="visually-hidden" htmlFor="wa-post">
          Weekly post
        </label>
        <textarea id="wa-post" rows={18} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
          }}
        >
          {copied ? '✓ Copied' : 'Copy the post'}
        </button>
        <a className="btn btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          Open in WhatsApp
        </a>
      </div>
    </section>
  )
}
