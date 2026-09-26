import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { dateTime } from '../lib/labels'
import { notificationLink, notificationText } from '../lib/notificationText'
import { useUnread } from '../notifications/UnreadContext'

interface Notification {
  id: number
  template: string
  args: Record<string, unknown>
  createdAt: string
  read: boolean
}

// In-app notifications (spec FR-17). These are the durable record of what happened - the order
// screens always show the same status too, so nothing depends on seeing a notification.
export function NotificationsPage() {
  const { refreshUnread } = useUnread()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which ones were new when this visit started. Kept separately because marking them read on
  // the server (below) must not make the "new" highlight vanish while you're looking at it.
  const [newIds, setNewIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    api<Notification[]>('/notifications')
      .then((list) => {
        setNewIds((seen) => new Set([...seen, ...list.filter((n) => !n.read).map((n) => n.id)]))
        setItems(list)
        // Opening the page counts as reading them; the "new" dots stay for this visit.
        if (list.some((n) => !n.read)) return api('/notifications/read-all', { method: 'POST' }).then(refreshUnread)
      })
      .catch((err) => setError(err.message))
  }, [refreshUnread])

  return (
    <main className="page">
      <h1 className="page-title">Notifications</h1>
      {error && <p className="notice error">{error}</p>}
      {!items && !error && <div className="skeleton" style={{ minHeight: 200 }} />}
      {items?.length === 0 && <p className="notice">Nothing yet. Updates about your orders will appear here.</p>}
      {items && items.length > 0 && (
        <ul className="notification-list">
          {items.map((n) => (
            <li key={n.id}>
              <Link to={notificationLink(n.template)} className={`notification${newIds.has(n.id) ? ' unread' : ''}`}>
                {newIds.has(n.id) && <span className="unread-dot" aria-label="New" />}
                <span>
                  {notificationText(n.template, n.args)}
                  <span className="product-meta" style={{ display: 'block' }}>
                    {dateTime(n.createdAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="fine-print">Notifications are kept for 30 days.</p>
    </main>
  )
}
