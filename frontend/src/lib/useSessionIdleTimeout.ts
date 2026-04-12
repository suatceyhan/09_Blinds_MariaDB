import { useEffect, useRef } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import {
  clearTokens,
  getAccessToken,
  getLastActivityMs,
  touchLastActivity,
} from '@/lib/authStorage'
import { idleLogoutMs } from '@/lib/sessionIdle'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'] as const
const THROTTLE_MS = 10_000
const TICK_MS = 30_000

/**
 * Oturum açıkken: belirlenen süre boyunca etkileşim/API yoksa token temizlenir, /login yönlendirilir.
 */
export function useSessionIdleTimeout(navigate: NavigateFunction): void {
  const throttledUntil = useRef(0)

  useEffect(() => {
    const limitMs = idleLogoutMs() ?? 0
    if (limitMs <= 0) return
    if (!getAccessToken()) return

    function checkIdle(): void {
      if (!getAccessToken()) return
      const last = getLastActivityMs()
      if (last == null) {
        touchLastActivity()
        return
      }
      if (Date.now() - last > limitMs) {
        clearTokens()
        navigate('/login', { replace: true })
      }
    }

    if (getLastActivityMs() == null) touchLastActivity()
    checkIdle()

    const onActivity = (): void => {
      const now = Date.now()
      if (now - throttledUntil.current < THROTTLE_MS) return
      throttledUntil.current = now
      touchLastActivity()
    }

    const tick = globalThis.setInterval(checkIdle, TICK_MS)
    ACTIVITY_EVENTS.forEach((ev) => globalThis.addEventListener(ev, onActivity, { passive: true }))

    return () => {
      globalThis.clearInterval(tick)
      ACTIVITY_EVENTS.forEach((ev) => globalThis.removeEventListener(ev, onActivity))
    }
  }, [navigate])
}
