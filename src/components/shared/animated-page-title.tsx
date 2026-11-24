import { useEffect, useRef, useState } from 'react'

const TYPE_DELAY_MS = 180
const TYPE_SPEED_MS = 95
const HOLD_COMPLETE_MS = 5_000
const DELETE_SPEED_MS = 55
const EMPTY_PAUSE_MS = 450

/**
 * The full title is always present in a hidden reserve layer and in the screen-reader label.
 * Only the visually animated copy changes, so typing/deleting never changes header geometry.
 */
export function AnimatedPageTitle({ text }: { text: string }) {
  const [visibleText, setVisibleText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let cancelled = false

    const clearTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }

    const restart = () => {
      clearTimer()
      if (cancelled) return
      if (!preference || preference.matches) {
        setVisibleText(text)
        return
      }

      let length = 0
      let erasing = false
      setVisibleText('')
      const step = () => {
        if (cancelled) return
        length += erasing ? -1 : 1
        setVisibleText(text.slice(0, length))
        if (length === text.length) {
          erasing = true
          timer.current = setTimeout(step, HOLD_COMPLETE_MS)
        } else if (length === 0) {
          erasing = false
          timer.current = setTimeout(step, EMPTY_PAUSE_MS)
        } else {
          timer.current = setTimeout(step, erasing ? DELETE_SPEED_MS : TYPE_SPEED_MS)
        }
      }
      if (text.length > 0) timer.current = setTimeout(step, TYPE_DELAY_MS)
    }

    restart()
    preference?.addEventListener('change', restart)
    return () => {
      cancelled = true
      clearTimer()
      preference?.removeEventListener('change', restart)
    }
  }, [text])

  return <p className="page-title brand-acronym">
    <span className="sr-only">{text}</span>
    <span className="header-title-frame" aria-hidden="true">
      <span className="header-title-reserve">{text}</span>
      <span className="header-title-live">
        <span data-typed-title>{visibleText}</span>
        <span className="header-typewriter-caret" />
      </span>
    </span>
  </p>
}
