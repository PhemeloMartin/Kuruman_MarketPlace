import { useEffect, useState } from 'react'
import { api } from './api'

// Whether online payment is in Payfast's test mode (sandbox: no real money moves). Asked once per visit
// and shared by every screen that mentions an online payment, so a test payment is never mistaken for a
// real one. Until the answer arrives - or if it can't be fetched - it's treated as real money.
let asked: Promise<boolean> | null = null

export function usePaymentTestMode(): boolean {
  const [test, setTest] = useState(false)
  useEffect(() => {
    asked ??= api<{ onlinePaymentTest?: boolean }>('/config')
      .then((c) => Boolean(c.onlinePaymentTest))
      .catch(() => {
        asked = null // try again next time
        return false
      })
    let live = true
    asked.then((t) => live && setTest(t))
    return () => {
      live = false
    }
  }, [])
  return test
}
