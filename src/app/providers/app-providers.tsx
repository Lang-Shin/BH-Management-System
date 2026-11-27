import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@/components/shared/states'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { PrototypeProvider } from './prototype-provider'
import { AuthProvider } from './auth'
import { AppearanceProvider } from './appearance'
import { demoModeEnabled } from '@/lib/demo-mode'

/** Composition root: real authentication is the default; demo data requires explicit demo mode. */
export function AppProviders({ children }: { children: ReactNode }) {
  const authEnabled = !demoModeEnabled()
  const content = authEnabled ? children : <PrototypeProvider repository={localStorageRepository}>{children}</PrototypeProvider>
  return <AuthProvider enabled={authEnabled}><AppearanceProvider><ErrorBoundary><BrowserRouter>{content}</BrowserRouter></ErrorBoundary></AppearanceProvider></AuthProvider>
}
