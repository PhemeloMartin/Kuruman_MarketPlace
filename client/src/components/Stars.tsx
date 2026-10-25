// Star ratings. Shown stars are decoration; the text next to them ("4.7 from 12 reviews") carries the
// meaning for screen readers. Picking stars uses real buttons, each at least 44 px wide.

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value * 2) / 2 // to the nearest half star
  return (
    <span className="stars" aria-hidden="true" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rounded ? 'star on' : n - 0.5 === rounded ? 'star half' : 'star'}>
          ★
        </span>
      ))}
    </span>
  )
}

// "★★★★½ 4.7 (12 reviews)", or "No reviews yet".
export function RatingLine({ rating }: { rating: { average: number | null; count: number } }) {
  if (!rating.count || rating.average === null) return <span className="product-meta">No reviews yet</span>
  return (
    <span className="rating-line">
      <Stars value={rating.average} />
      <strong>{rating.average.toFixed(1)}</strong>
      <span className="product-meta">
        ({rating.count} {rating.count === 1 ? 'review' : 'reviews'})
      </span>
    </span>
  )
}

const WORDS = ['', 'Bad', 'Not good', 'Okay', 'Good', 'Excellent']

export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="star-picker" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}: ${WORDS[n]}`}
          className={n <= value ? 'on' : undefined}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
      <span className="star-word">{WORDS[value]}</span>
    </div>
  )
}
