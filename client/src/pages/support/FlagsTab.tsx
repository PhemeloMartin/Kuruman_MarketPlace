import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api } from '../../lib/api'
import { dateTime } from '../../lib/labels'

interface Flag {
  id: number
  itemType: 'product' | 'shop' | 'review'
  itemId: number
  excerpt: string
  score: number | null
  reasons: string[]
  modelVersion: string
  shopName: string | null
  createdAt: string
}

const ITEM_LABEL = { product: 'Product', shop: 'Shop “about” text', review: 'Review' }
const HIDE_LABEL = { product: 'Take off sale', shop: 'Remove the text', review: 'Hide the review' }

// Texts the AI screening model thinks may move sales off the site or be a scam. The AI only
// suggests; a person reads each one and decides, with a written reason (kept in the audit log).
export function FlagsTab() {
  const [flags, setFlags] = useState<Flag[] | null>(null)
  const [deciding, setDeciding] = useState<{ flag: Flag; decision: 'dismiss' | 'hide' } | null>(null)

  const load = useCallback(() => {
    api<Flag[]>('/support/ops/flags')
      .then(setFlags)
      .catch(() => setFlags([]))
  }, [])
  useEffect(load, [load])

  return (
    <section>
      <p className="fine-print" style={{ marginTop: 0 }}>
        The AI checks new product descriptions, shop texts and reviews for signs of payment outside the site (“pay me on
        eWallet first”), phone numbers or scams. It never hides anything by itself: you decide.
      </p>
      {flags?.length === 0 && <p className="notice">Nothing flagged right now.</p>}
      {flags?.map((f) => (
        <article key={f.id} className="card">
          <div className="order-card-head">
            <strong>
              {ITEM_LABEL[f.itemType]} · {f.shopName ?? 'unknown shop'}
            </strong>
            <span className="status-pill wait">{f.score !== null ? `${Math.round(f.score * 100)}%` : 'rule'}</span>
          </div>
          <p className="review-text">“{f.excerpt}”</p>
          <p className="fine-print">
            Why: {f.reasons.join(' and ')} · {f.modelVersion} · {dateTime(f.createdAt)}
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setDeciding({ flag: f, decision: 'dismiss' })}>
              It’s fine
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setDeciding({ flag: f, decision: 'hide' })}>
              {HIDE_LABEL[f.itemType]}
            </button>
          </div>
        </article>
      ))}
      {deciding && (
        <ReasonDialog
          title={deciding.decision === 'hide' ? HIDE_LABEL[deciding.flag.itemType] : 'Mark as fine'}
          description={
            deciding.decision === 'hide'
              ? 'The seller can see this reason. It is also kept in the audit log.'
              : 'The flag is closed. Your reason is kept in the audit log, which helps improve the model.'
          }
          confirmLabel={deciding.decision === 'hide' ? 'Hide' : 'Mark as fine'}
          danger={deciding.decision === 'hide'}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            await api(`/support/ops/flags/${deciding.flag.id}`, { method: 'POST', body: { decision: deciding.decision, reason } })
            setDeciding(null)
            load()
          }}
        />
      )}
    </section>
  )
}
