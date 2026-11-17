import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Theme } from '@radix-ui/themes'

export type Appearance = 'light' | 'dark'
const KEY = 'bhms.appearance'

interface AppearanceValue { appearance: Appearance; toggle: () => void }
const AppearanceContext = createContext<AppearanceValue>({ appearance: 'light', toggle: () => {} })

function initial(): Appearance {
  try {
    const saved = window.localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Owns the light/dark choice and renders the root Radix Theme. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(initial)
  const toggle = useCallback(() => setAppearance(current => {
    const next = current === 'dark' ? 'light' : 'dark'
    try { window.localStorage.setItem(KEY, next) } catch { /* ignore */ }
    return next
  }), [])
  useEffect(() => {
    document.documentElement.style.colorScheme = appearance
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#1b1a17' : '#f5f1e8')
  }, [appearance])
  const value = useMemo(() => ({ appearance, toggle }), [appearance, toggle])
  return <AppearanceContext.Provider value={value}>
    <Theme appearance={appearance} accentColor="green" grayColor="sand" radius="medium" scaling="100%" panelBackground="solid">{children}</Theme>
  </AppearanceContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppearance() { return useContext(AppearanceContext) }
