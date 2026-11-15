import { useLayoutEffect, useRef } from 'react'

const DURATION = 1200

/** Animate presentation only; the final, accessible value always stays intact. */
export function AnimatedNumber({ value }: { value: number | string }) {
  const finalText = typeof value === 'number' ? value.toLocaleString('en-PH', { maximumFractionDigits: 6 }) : value
  const visualRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const visual = visualRef.current
    // Accept one formatted quantity, including currency, decimal places and units.
    const match = finalText.match(/^([^\d]*?)(-?\d[\d,]*(?:\.\d+)?)([^\d]*)$/)
    if (!visual || !match) return
    const [, prefix = '', numeric, suffix = ''] = match
    if (!numeric) return
    const target = Number(numeric.replaceAll(',', ''))
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!Number.isFinite(target) || target === 0 || preference?.matches || !window.requestAnimationFrame) return

    const decimals = numeric.split('.')[1]?.length ?? 0
    const formatter = new Intl.NumberFormat('en-PH', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      useGrouping: numeric.includes(','),
    })
    let frame = 0
    let observer: IntersectionObserver | undefined
    let started = false
    let disposed = false
    const finish = () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      visual.dataset.value = finalText
    }
    const start = () => {
      if (started || disposed) return
      started = true
      observer?.disconnect()
      const startTime = performance.now()
      const tick = (now: number) => {
        if (disposed) return
        const progress = Math.min(1, Math.max(0, (now - startTime) / DURATION))
        if (progress === 1) { finish(); return }
        const eased = 1 - Math.pow(1 - progress, 3)
        visual.dataset.value = `${prefix}${formatter.format(target * eased)}${suffix}`
        frame = window.requestAnimationFrame(tick)
      }
      frame = window.requestAnimationFrame(tick)
    }
    const onMotionChange = () => { if (preference?.matches) { started = true; finish() } }
    visual.dataset.value = `${prefix}${formatter.format(0)}${suffix}`
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) start()
      }, { threshold: 0.1 })
      observer.observe(visual)
    } else start()
    preference?.addEventListener('change', onMotionChange)
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      preference?.removeEventListener('change', onMotionChange)
    }
  }, [finalText])

  return <span className="animated-number">
    <span className="animated-number-final">{finalText}</span>
    <span ref={visualRef} className="animated-number-visual" aria-hidden="true" data-value={finalText} />
  </span>
}
