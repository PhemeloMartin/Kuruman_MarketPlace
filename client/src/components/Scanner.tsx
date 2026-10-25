import { useEffect, useRef, useState } from 'react'

// Reads a QR code or a product barcode with the phone's camera, using the browser's built-in
// BarcodeDetector (Chrome on Android). Where that isn't available (e.g. iPhone Safari) it says so,
// and the person simply types the code instead - scanning is a shortcut, never the only way.

type Format = 'qr_code' | 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'code_128' | 'code_39'

export const QR: Format[] = ['qr_code']
export const PRODUCT_BARCODES: Format[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39']

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: Format[] }) => Detector
  }
}

export const canScan = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices

export function Scanner({ formats, onResult, onClose, title }: { formats: Format[]; onResult: (text: string) => void; onClose: () => void; title: string }) {
  const video = useRef<HTMLVideoElement>(null)
  // Kept in a ref so a page re-drawing (a new onResult function) doesn't restart the camera.
  const resultRef = useRef(onResult)
  useEffect(() => {
    resultRef.current = onResult
  }, [onResult])
  const [error, setError] = useState<string | null>(canScan() ? null : 'Scanning isn’t available in this browser. Please type the code instead.')

  useEffect(() => {
    if (!canScan()) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    const detector = new window.BarcodeDetector!({ formats })

    async function look() {
      if (stopped || !video.current) return
      try {
        const found = await detector.detect(video.current)
        if (found.length && found[0].rawValue) {
          stopped = true
          navigator.vibrate?.(80) // a small buzz: "got it"
          resultRef.current(found[0].rawValue.trim())
          return
        }
      } catch {
        // The video frame wasn't ready yet; try again.
      }
      timer = setTimeout(look, 250)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s
        if (video.current) {
          video.current.srcObject = s
          video.current.play().then(look).catch(look)
        }
      })
      .catch(() => setError('We couldn’t open the camera. Allow camera access, or type the code instead.'))

    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop()) // switch the camera off again
    }
  }, [formats])

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scanner">
        <strong>{title}</strong>
        {error ? (
          <p className="notice" style={{ marginTop: 10 }}>
            {error}
          </p>
        ) : (
          <>
            <video ref={video} className="scanner-video" muted playsInline />
            <p className="fine-print">Hold the code inside the frame. It scans by itself.</p>
          </>
        )}
        <button type="button" className="btn btn-outline btn-block" onClick={onClose}>
          {error ? 'OK' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
