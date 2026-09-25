import { useEffect, useState } from 'react'

// True while the phone reports a network connection. It can't promise the server is
// reachable, so API errors are still handled - this just drives the offline banner and
// switches off actions that need the server (spec 5.3).
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
