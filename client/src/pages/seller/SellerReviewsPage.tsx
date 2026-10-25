import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackIcon } from '../../components/Icons'
import { RatingLine, Stars } from '../../components/Stars'
import { api, ApiError } from '../../lib/api'
import { NEGATIVE_THEMES, THEME_LABEL } from '../../lib/types'
import type { Rating, Review } from '../../lib/types'

// The seller's reviews, newest first. Each can get one public reply: a thank-you, or putting a
// complaint right. Unanswered ones are marked so nothing is missed.
export function SellerReviewsPage() {
  const [data, setData] = useState<{ rating: Rating; reviews: Review[]; themes: { theme: string; count: number }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<{ rating: Rating; reviews: Review[]; themes: { theme: string; count: number }[] }>('/seller/reviews')
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  return (
    <main className="page">
      <Link to="/seller" className="back-link">
        <BackIcon /> Dashboard
      </Link>
      <h1 className="page-title">Your reviews</h1>
      {error && <p className="notice error">{error}</p>}
      {data && (
        <>
          <p style={{ marginTop: -6 }}>
            <RatingLine rating={data.rating} />
          </p>
          <p className="fine-print">
            Replies are public. Thank people, and when something went wrong, say how you’ll fix it: future customers
            read that too.
          </p>
          {data.themes.length > 0 && (
            <p className="theme-chips">
              <span className="ai-label">AI summary</span> Customers mention:{' '}
              {data.themes.map((t) => (
                <span key={t.theme} className={`theme-chip${NEGATIVE_THEMES.includes(t.theme) ? ' negative' : ''}`}>
                  {THEME_LABEL[t.theme] ?? t.theme} ({t.count})
                </span>
              ))}
            </p>
          )}
          {data.reviews.length === 0 && <p className="notice">No reviews yet. They appear after customers receive their orders.</p>}
          <ul className="review-list">
            {data.reviews.map((r) => (
              <li key={r.id} className="card">
                <div className="review-head">
                  <Stars value={r.rating} />
                  <span className="product-meta">
                    {r.firstName} · {new Date(r.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                {r.comment && <p className="review-text">{r.comment}</p>}
                {r.sentiment && (
                  <p className="fine-print" style={{ margin: '4px 0 0' }}>
                    AI reads this as <strong className={`sentiment ${r.sentiment}`}>{r.sentiment}</strong>
                    {r.themes.length > 0 && <> · {r.themes.map((t) => THEME_LABEL[t] ?? t).join(', ')}</>}
                  </p>
                )}
                {r.sellerReply ? (
                  <p className="seller-reply">
                    <strong>Your reply:</strong> {r.sellerReply}
                  </p>
                ) : (
                  <ReplyBox reviewId={r.id} onDone={load} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

function ReplyBox({ reviewId, onDone }: { reviewId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        Reply
      </button>
    )
  }
  async function send() {
    setBusy(true)
    setError(null)
    try {
      await api(`/seller/reviews/${reviewId}/reply`, { method: 'POST', body: { reply: text } })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="input-wrap">
        <label className="visually-hidden" htmlFor={`reply-${reviewId}`}>
          Your reply
        </label>
        <textarea id={`reply-${reviewId}`} rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <p className="fine-print">You can reply once, and everyone can read it.</p>
      {error && <p className="field-error">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 2} onClick={send}>
          {busy ? 'Posting…' : 'Post reply'}
        </button>
      </div>
    </div>
  )
}
