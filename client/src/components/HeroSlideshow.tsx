import { useEffect, useState } from 'react'

// The Home page's top picture: Kuruman's markets, fading from one photo to the next every 5 seconds.
// Our own photos (client/public/hero/), taken with the sellers' permission.
const SLIDES = [
  { src: '/hero/smme-village.webp', position: 'center 20%' }, // the signs at the top of the photo
  { src: '/hero/davids-lunchtime.webp', position: 'center 45%' },
  { src: '/hero/tea-stall.webp', position: 'center 40%' },
  { src: '/hero/sis-dee.webp', position: 'center 40%' },
  { src: '/hero/food-caravan.webp', position: 'center 45%' },
  { src: '/hero/tailor.webp', position: 'center 30%' },
]

const SECONDS = 5

export function HeroSlideshow() {
  const [index, setIndex] = useState(0)
  // Photos are only fetched when their turn is next, so nobody pays data for slides they never see.
  const [loaded, setLoaded] = useState(2)
  // Moving pictures can be switched off (WCAG 2.2.2), and stay still for people who asked their phone for
  // less motion.
  const [playing, setPlaying] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % SLIDES.length) // not while the tab is in the background
    }, SECONDS * 1000)
    return () => clearInterval(timer)
  }, [playing])

  // Showing slide i: fetch the one after it, so it's ready when its turn comes.
  useEffect(() => {
    setLoaded((n) => Math.max(n, Math.min(SLIDES.length, index + 2)))
  }, [index])

  return (
    <div className="hero-slides">
      {SLIDES.slice(0, loaded).map((s, i) => (
        <img
          key={s.src}
          src={s.src}
          alt=""
          className={i === index ? 'active' : undefined}
          style={{ objectPosition: s.position }}
          fetchPriority={i === 0 ? 'high' : 'low'}
        />
      ))}
      <button
        type="button"
        className="hero-pause"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? 'Pause the photos' : 'Play the photos'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
    </div>
  )
}
