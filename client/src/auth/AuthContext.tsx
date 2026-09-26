import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import type { User } from '../lib/types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (phone: string, passphrase: string) => Promise<void>
  register: (input: { phone: string; displayName: string; passphrase: string }) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// Keeps track of who is signed in. The browser never sees the session token itself
// (it's in an HttpOnly cookie) - we just ask the server "who am I?".
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ user: User | null }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (phone: string, passphrase: string) => {
    const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { phone, passphrase } })
    setUser(r.user)
  }, [])

  const register = useCallback(async (input: { phone: string; displayName: string; passphrase: string }) => {
    const r = await api<{ user: User }>('/auth/register', { method: 'POST', body: input })
    setUser(r.user)
  }, [])

  // Asks the server again - e.g. after support approves you as a seller, or after the
  // authenticator-code step - because the server, not the browser, knows your role.
  const refresh = useCallback(async () => {
    const r = await api<{ user: User | null }>('/auth/me')
    setUser(r.user)
  }, [])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
