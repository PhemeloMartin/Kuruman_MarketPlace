import { useState } from 'react'
import { QR, Scanner, canScan } from './Scanner'

// "Scan the customer's QR code": reads the 6-digit handover code from the customer's screen, so
// nobody has to read numbers out loud in a busy market. Typing the code still works as before.
export function CodeScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canScan()) return null
  return (
    <>
      <button type="button" className="btn btn-outline btn-block scan-btn" onClick={() => setOpen(true)}>
        📷 Scan the customer’s QR code
      </button>
      {error && <p className="field-error">{error}</p>}
      {open && (
        <Scanner
          formats={QR}
          title="Scan the customer’s code"
          onClose={() => setOpen(false)}
          onResult={(text) => {
            setOpen(false)
            if (/^\d{6}$/.test(text)) {
              setError(null)
              onCode(text)
            } else setError('That QR code isn’t a KurumanMarketPlace handover code.')
          }}
        />
      )}
    </>
  )
}
