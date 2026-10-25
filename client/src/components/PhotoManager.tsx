import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { shrinkPhoto } from '../lib/photos'

interface Photo {
  id: number
  url: string
}

const MAX_PHOTOS = 5

// A seller's photos for one product: add (camera or gallery), make one the main photo, remove.
// The first photo is the one customers see on the product card.
export function PhotoManager({ productId }: { productId: number }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api<Photo[]>(`/seller/products/${productId}/photos`)
      .then(setPhotos)
      .catch(() => {})
  }, [productId])
  useEffect(load, [load])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      load()
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    // Several photos can be chosen at once; they upload one after the other, up to the limit.
    const room = MAX_PHOTOS - photos.length
    const chosen = Array.from(files).slice(0, room)
    await run(async () => {
      for (const file of chosen) {
        const blob = await shrinkPhoto(file)
        await api(`/seller/photos?productId=${productId}`, { method: 'POST', body: blob })
      }
    })
    if (input.current) input.current.value = ''
  }

  return (
    <section className="photo-manager" aria-labelledby="photos-heading">
      <div className="section-head">
        <h2 id="photos-heading">Photos</h2>
        <span className="product-meta">
          {photos.length} of {MAX_PHOTOS}
        </span>
      </div>
      <p className="fine-print" style={{ marginTop: -6 }}>
        Clear photos sell more. Use daylight and show the real product. The first photo is the one customers see first.
      </p>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <figure key={p.id} className="photo-tile">
            <img src={p.url} alt={`Photo ${i + 1}`} />
            {i === 0 ? (
              <span className="photo-badge">Main photo</span>
            ) : (
              <button type="button" className="photo-action" disabled={busy} onClick={() => run(() => api(`/seller/photos/${p.id}/main`, { method: 'POST' }))}>
                Make main
              </button>
            )}
            <button
              type="button"
              className="photo-remove"
              disabled={busy}
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => run(() => api(`/seller/photos/${p.id}`, { method: 'DELETE' }))}
            >
              ×
            </button>
          </figure>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className={`photo-add${busy ? ' busy' : ''}`}>
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              className="visually-hidden"
              disabled={busy}
              onChange={(e) => addFiles(e.target.files)}
            />
            <span aria-hidden="true">＋</span>
            {busy ? 'Uploading…' : 'Add photo'}
          </label>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
