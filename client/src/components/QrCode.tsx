import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Shows text as a QR code image (made in the browser - nothing is sent anywhere).
export function QrCode({ text, label, size = 180 }: { text: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(null))
  }, [text, size])
  return src ? <img src={src} alt={label} width={size} height={size} className="qr" /> : null
}
