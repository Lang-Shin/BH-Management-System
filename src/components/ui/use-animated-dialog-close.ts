import { useCallback, useEffect, useRef, useState, type AnimationEvent } from 'react'

/**
 * Keeps conditionally rendered dialogs mounted until their close animation ends.
 * Call onAnimationEnd on DialogContent.
 */
export function useAnimatedDialogClose(onClose: () => void) {
  const [open, setOpen] = useState(true)
  const closed = useRef(false)

  const finishClose = useCallback(() => {
    if (closed.current) return
    closed.current = true
    onClose()
  }, [onClose])

  const requestClose = useCallback(() => setOpen(false), [])

  const onOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setOpen(false)
  }, [])

  useEffect(() => {
    if (open) return
    // Fallback in case animationend is unavailable; the exit animation is 200ms.
    const timeout = window.setTimeout(finishClose, 240)
    return () => window.clearTimeout(timeout)
  }, [open, finishClose])

  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    if (!open && event.target === event.currentTarget && event.currentTarget.dataset.state === 'closed') finishClose()
  }, [open, finishClose])

  return { open, requestClose, onOpenChange, onAnimationEnd }
}
