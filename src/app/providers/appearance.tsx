import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

export type Appearance = 'light' | 'dark'
const STORAGE_KEY = 'bhms.appearance'

/** Optional point (viewport px) the new appearance spreads from, usually the toggle's centre. */
export interface RevealOrigin { x: number; y: number }
interface AppearanceValue { appearance: Appearance; toggle: (origin?: RevealOrigin) => void }
const AppearanceContext = createContext<AppearanceValue>({ appearance: 'light', toggle: () => {} })

function initialAppearance(): Appearance {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyAppearance(appearance: Appearance) {
  document.documentElement.classList.toggle('dark', appearance === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#0f1311' : '#f1ece2')
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown }

/** Owns the light/dark choice: follows the system until the user picks one, then remembers it. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance)

  const toggle = useCallback((origin?: RevealOrigin) => {
    const next: Appearance = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    const update = () => { applyAppearance(next); flushSync(() => setAppearance(next)) }

    const doc = document as ViewTransitionDocument
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!doc.startViewTransition || reduceMotion) { update(); return }

    // Circular reveal from the toggle, sized to reach the farthest viewport corner.
    const x = origin?.x ?? window.innerWidth / 2
    const y = origin?.y ?? 0
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const root = document.documentElement.style
    root.setProperty('--vt-x', `${x}px`)
    root.setProperty('--vt-y', `${y}px`)
    root.setProperty('--vt-r', `${radius}px`)
    doc.startViewTransition(update)
  }, [])

  useEffect(() => { applyAppearance(appearance) }, [appearance])

  const value = useMemo(() => ({ appearance, toggle }), [appearance, toggle])
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppearance() { return useContext(AppearanceContext) }
