import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import type { User } from '../lib/types'

// What the server answers when it has sent an SMS code. demoCode is only there in demo mode,
// when no SMS gateway is connected: the code is shown on screen instead of being sent.
export interface CodeSent {
  resendAfterSeconds: number
  demoCode?: string
}

export type VerifyResult = { user: User } | { needsName: true }

interface AuthState {
  user: User | null
  loading: boolean
  requestCode: (phone: string) => Promise<CodeSent>
  // Signs in with the SMS code. A number without an account answers { needsName: true }: call
  // again with the same code and a name to create the account.
  verifyCode: (phone: string, code: string, displayName?: string) => Promise<VerifyResult>
  staffLogin: (phone: string, passphrase: string) => Promise<User>
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

  const requestCode = useCallback(
    (phone: string) => api<CodeSent>('/auth/code', { method: 'POST', body: { phone } }),
    [],
  )

  const verifyCode = useCallback(async (phone: string, code: string, displayName?: string) => {
    const r = await api<VerifyResult>('/auth/code/verify', { method: 'POST', body: { phone, code, displayName } })
    if ('user' in r) setUser(r.user)
    return r
  }, [])

  // Support staff: passphrase first, then the authenticator-app code in the console.
  const staffLogin = useCallback(async (phone: string, passphrase: string) => {
    const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { phone, passphrase } })
    setUser(r.user)
    return r.user
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
    <AuthContext.Provider value={{ user, loading, requestCode, verifyCode, staffLogin, logout, refresh }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
