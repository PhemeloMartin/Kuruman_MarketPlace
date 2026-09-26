import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api } from '../../lib/api'
import { VEHICLE_LABEL } from '../../lib/labels'

interface Accounts {
  businesses: { id: number; name: string; area: string; active: boolean; ownerName: string }[]
  couriers: { userId: number; name: string; area: string; vehicleType: string; active: boolean }[]
}

interface Target {
  kind: 'businesses' | 'couriers'
  id: number
  name: string
  active: boolean
}

// Suspend or reinstate approved sellers and couriers. A suspended shop is hidden and can't
// change listings; a suspended courier can't take new jobs. Work in progress can finish.
export function AccountsTab() {
  const [accounts, setAccounts] = useState<Accounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)

  const load = useCallback(() => {
    api<Accounts>('/support/accounts')
      .then(setAccounts)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  if (!accounts) return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />

  const row = (t: Target, detail: string) => (
    <div key={`${t.kind}-${t.id}`} className="account-row">
      <div>
        <strong>{t.name}</strong>
        <div className="product-meta">{detail}</div>
      </div>
      <div className="account-actions">
        <span className={`status-pill ${t.active ? 'good' : 'bad'}`}>{t.active ? 'Active' : 'Suspended'}</span>
        <button type="button" className="link-btn" onClick={() => setTarget(t)}>
          {t.active ? 'Suspend' : 'Reinstate'}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <div className="section-head">
        <h2>Shops</h2>
      </div>
      <section className="card">
        {accounts.businesses.map((b) =>
          row({ kind: 'businesses', id: b.id, name: b.name, active: b.active }, `${b.area} · owner ${b.ownerName}`),
        )}
      </section>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2>Couriers</h2>
      </div>
      <section className="card">
        {accounts.couriers.map((c) =>
          row({ kind: 'couriers', id: c.userId, name: c.name, active: c.active }, `${c.area} · ${VEHICLE_LABEL[c.vehicleType]}`),
        )}
      </section>

      {target && (
        <ReasonDialog
          title={target.active ? `Suspend ${target.name}?` : `Reinstate ${target.name}?`}
          description={
            target.active
              ? target.kind === 'businesses'
                ? 'The shop disappears from the catalogue and can’t change its listings. Orders already in progress can still be finished.'
                : 'This courier can’t take new jobs. Jobs they already hold can still be finished.'
              : 'Everything works again as normal.'
          }
          confirmLabel={target.active ? 'Suspend' : 'Reinstate'}
          danger={target.active}
          onClose={() => setTarget(null)}
          onConfirm={async (reason) => {
            await api(`/support/${target.kind}/${target.id}/${target.active ? 'suspend' : 'reinstate'}`, {
              method: 'POST',
              body: { reason },
            })
            setTarget(null)
            load()
          }}
        />
      )}
    </>
  )
}
