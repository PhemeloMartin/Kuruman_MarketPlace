import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'

const MAX_SECONDS = 60

// The seller records a short spoken note about a product - in any language, no typing needed.
// It uses the phone's microphone through the browser (MediaRecorder): nothing is installed.
export function VoiceNoteRecorder({ productId, existing }: { productId: number; existing: { url: string; seconds: number | null } | null }) {
  const [saved, setSaved] = useState(existing)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [take, setTake] = useState<{ blob: Blob; url: string; seconds: number } | null>(null) // recorded, not saved yet
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
    recorder.current?.stream.getTracks().forEach((t) => t.stop())
  }, [])

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      let elapsed = 0
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()) // microphone off again
        const blob = new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'audio/webm' })
        setTake({ blob, url: URL.createObjectURL(blob), seconds: Math.max(1, elapsed) })
      }
      rec.start()
      recorder.current = rec
      setRecording(true)
      setSeconds(0)
      timer.current = setInterval(() => {
        elapsed += 1
        setSeconds(elapsed)
        if (elapsed >= MAX_SECONDS) stop()
      }, 1000)
    } catch {
      setError('We couldn’t use the microphone. Allow microphone access and try again.')
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    if (recorder.current?.state === 'recording') recorder.current.stop()
    setRecording(false)
  }

  async function save() {
    if (!take) return
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ url: string; seconds: number | null }>(`/seller/products/${productId}/voice?seconds=${take.seconds}`, {
        method: 'PUT',
        body: take.blob,
      })
      setSaved(r)
      setTake(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the recording.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api(`/seller/products/${productId}/voice`, { method: 'DELETE' })
      setSaved(null)
    } finally {
      setBusy(false)
    }
  }

  if (!supported) return null

  return (
    <section className="card voice-card" aria-labelledby="voice-heading">
      <strong id="voice-heading">🎙 Voice note (optional)</strong>
      <p className="fine-print" style={{ marginTop: 4 }}>
        Tell customers about this product in your own words and language, up to a minute. No typing needed.
      </p>
      {saved && !take && !recording && (
        <>
          <audio controls src={saved.url} className="voice-player" preload="none" />
          <div className="btn-row">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={remove}>
              Delete
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={start}>
              Record a new one
            </button>
          </div>
        </>
      )}
      {!saved && !take && !recording && (
        <button type="button" className="btn btn-primary btn-block" onClick={start}>
          🎙 Start recording
        </button>
      )}
      {recording && (
        <div className="recording">
          <span className="rec-dot" aria-hidden="true" /> Recording… {seconds}s of {MAX_SECONDS}s
          <button type="button" className="btn btn-danger btn-block" style={{ marginTop: 8 }} onClick={stop}>
            Stop
          </button>
        </div>
      )}
      {take && (
        <>
          <p className="fine-print">Listen first. Save it if you’re happy.</p>
          <audio controls src={take.url} className="voice-player" />
          <div className="btn-row">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setTake(null)}>
              Try again
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save voice note'}
            </button>
          </div>
        </>
      )}
      {error && <p className="field-error">{error}</p>}
    </section>
  )
}

// On the product page: the seller's voice note.
export function VoiceNotePlayer({ note }: { note: { url: string; seconds: number | null } }) {
  return (
    <section className="voice-card listen" aria-label="Voice note from the seller">
      <strong>🔊 Hear it from the seller</strong>
      {note.seconds && <span className="product-meta"> · {note.seconds} seconds</span>}
      <audio controls src={note.url} className="voice-player" preload="none" />
    </section>
  )
}
