import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@/components/shared/states'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { PrototypeProvider } from './prototype-provider'
import { AppearanceProvider } from './appearance'

/** Composition root: replace the repository here when an API adapter is approved. */
export function AppProviders({ children }: { children: ReactNode }) {
  return <AppearanceProvider><ErrorBoundary><PrototypeProvider repository={localStorageRepository}><BrowserRouter>{children}</BrowserRouter></PrototypeProvider></ErrorBoundary></AppearanceProvider>
}
