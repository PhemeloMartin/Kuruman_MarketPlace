import { useEffect, useRef } from 'react'

interface Props {
  currentSeller: string
  newSeller: string
  onKeep: () => void
  onReplace: () => void
}

// Business rule 1: one seller per order. Instead of silently emptying the cart (spec FR-07),
// we ask the shopper what they want to do.
export function SwitchSellerDialog({ currentSeller, newSeller, onKeep, onReplace }: Props) {
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    keepRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKeep])

  return (
    <div className="dialog-backdrop" onClick={onKeep}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="switch-title">Start a new cart?</h2>
        <p>
          Your cart has items from <strong>{currentSeller}</strong>. Each order comes from one seller, so you can
          order from <strong>{newSeller}</strong> after this order - or empty your cart and start again.
        </p>
        <div className="dialog-actions">
          <button ref={keepRef} type="button" className="btn btn-primary" onClick={onKeep}>
            Keep my cart
          </button>
          <button type="button" className="btn btn-outline" onClick={onReplace}>
            Empty cart and add this item
          </button>
        </div>
      </div>
    </div>
  )
}
