import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Role } from '../lib/types'
import { useAuth } from './AuthContext'

// Hides pages from the wrong role. This is only for a friendly experience -
// the real protection is on the server, which checks the role on every request.
export function RequireRole({ role }: { role: Role }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname }} replace />
  if (user.role !== role) return <Navigate to="/" replace />
  return <Outlet />
}
