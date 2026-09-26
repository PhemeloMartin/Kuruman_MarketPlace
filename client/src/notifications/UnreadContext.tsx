import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { useOnline } from '../lib/useOnline'

const REFRESH_MS = 30_000

interface Unread {
  unread: number
  refreshUnread: () => void
}

const UnreadContext = createContext<Unread>({ unread: 0, refreshUnread: () => {} })

// How many unread notifications the signed-in person has, checked every 30 seconds while online.
// It's only a small number for the badge; the notifications themselves load on their own page.
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const online = useOnline()
  const [unread, setUnread] = useState(0)
  const active = Boolean(user && user.role !== 'support' && online)

  const refreshUnread = useCallback(() => {
    if (!active) return
    api<{ unread: number }>('/notifications/unread-count')
      .then((r) => setUnread(r.unread))
      .catch(() => {})
  }, [active])

  useEffect(() => {
    if (!active) return
    refreshUnread()
    const t = setInterval(refreshUnread, REFRESH_MS)
    return () => clearInterval(t)
  }, [active, refreshUnread])

  return <UnreadContext.Provider value={{ unread: active ? unread : 0, refreshUnread }}>{children}</UnreadContext.Provider>
}

export function useUnread(): Unread {
  return useContext(UnreadContext)
}
