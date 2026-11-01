import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'

type Target = { orderId: number; with: 'seller' | 'customer' | 'courier' } | { shopId: number }
type Phase = 'idle' | 'starting' | 'ringing' | 'talking' | 'ended'

// Asked once per page load: are free calls set up on this site (Twilio)?
let configured: Promise<boolean> | null = null
function callsAvailable(): Promise<boolean> {
  configured ??= api<{ available: boolean }>('/calls/config')
    .then((c) => c.available)
    .catch(() => false)
  return configured
}

// Says what actually went wrong, so the person (and support) know what to do next.
function callErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  const e = err as { name?: string; code?: number } | null
  if (e?.name === 'NotAllowedError' || e?.code === 31208 || e?.code === 31401) {
    return 'The call needs your microphone. Allow it in the browser (the lock icon next to the address), then try again.'
  }
  if (e?.name === 'TypeError' || e?.name === 'ChunkLoadError') {
    return 'The app was just updated. Refresh the page, then try again.'
  }
  return `The call couldn’t start${e?.code ? ` (error ${e.code})` : ''}. Check your connection and try again.`
}

// "Call free": the call goes over this phone's mobile data (no airtime), and the other person's normal
// phone rings. The server decides whether this call is allowed and dials the number itself - this page
// never sees anyone's phone number. Twilio's library is loaded only when a call starts.
export function CallButton({ target, label }: { target: Target; label: string }) {
  const [available, setAvailable] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const hangUp = useRef<(() => void) | null>(null)

  useEffect(() => {
    callsAvailable().then(setAvailable)
  }, [])

  useEffect(() => {
    if (phase !== 'talking') return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  useEffect(() => () => hangUp.current?.(), [])

  async function call() {
    setError(null)
    setSeconds(0)
    setPhase('starting')
    try {
      const { callId, token } = await api<{ callId: number; token: string }>('/calls/start', { method: 'POST', body: target })
      const { Device } = await import('@twilio/voice-sdk')
      const device = new Device(token, { closeProtection: true })
      const connection = await device.connect({ params: { callId: String(callId) } })
      setPhase('ringing')
      const finish = () => {
        setPhase('ended')
        device.destroy()
        hangUp.current = null
      }
      connection.on('accept', () => setPhase('talking'))
      connection.on('disconnect', finish)
      connection.on('cancel', finish)
      connection.on('error', (e: { code?: number }) => {
        setError(`The call dropped${e?.code ? ` (error ${e.code})` : ''}. Check your data connection and try again.`)
        finish()
      })
      hangUp.current = () => {
        connection.disconnect()
        finish()
      }
    } catch (err) {
      setPhase('idle')
      setError(callErrorMessage(err))
    }
  }

  if (!available) return null
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="call-box">
      {phase === 'idle' || phase === 'ended' ? (
        <button type="button" className="btn btn-outline btn-block" onClick={call}>
          📞 {label}
        </button>
      ) : (
        <div className="call-live" role="status">
          <span>
            {phase === 'starting' ? 'Connecting…' : phase === 'ringing' ? 'Ringing…' : `On the call · ${time}`}
          </span>
          <button type="button" className="btn btn-danger" onClick={() => hangUp.current?.()} disabled={phase === 'starting'}>
            Hang up
          </button>
        </div>
      )}
      {phase === 'ended' && <p className="fine-print">Call ended.</p>}
      {error && <p className="field-error">{error}</p>}
      {phase === 'idle' && <p className="fine-print">Uses your mobile data, not airtime. Your number stays private.</p>}
    </div>
  )
}
