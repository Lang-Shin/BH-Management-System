import { useEffect, useState } from 'react'

export function AnimatedPageTitle({ text }: { text: string }) {
  const [visibleText, setVisibleText] = useState('')

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setTimeout>

    const restart = () => {
      clearTimeout(timer)
      if (!preference || preference.matches) {
        setVisibleText(text)
        return
      }

      let length = 0
      let erasing = false
      setVisibleText('')
      const step = () => {
        length += erasing ? -1 : 1
        setVisibleText(text.slice(0, length))
        if (length === text.length) {
          erasing = true
          timer = setTimeout(step, 5000)
        } else if (length === 0) {
          erasing = false
          timer = setTimeout(step, 450)
        } else {
          timer = setTimeout(step, erasing ? 55 : 95)
        }
      }
      if (text.length > 0) timer = setTimeout(step, 180)
    }

    restart()
    preference?.addEventListener('change', restart)
    return () => {
      clearTimeout(timer)
      preference?.removeEventListener('change', restart)
    }
  }, [text])

  return <p className="page-title header-typewriter brand-acronym truncate text-2xl sm:text-3xl">
    <span className="sr-only">{text}</span>
    <span aria-hidden="true"><span data-typed-title>{visibleText}</span><span className="header-typewriter-caret" /></span>
  </p>
}
