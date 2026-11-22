import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@/components/shared/states'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { configuredApiRepository } from '@/data/repositories/api-repository'
import { PrototypeProvider } from './prototype-provider'
import { AppearanceProvider } from './appearance'

const repository = configuredApiRepository() ?? localStorageRepository

/** Composition root: server mode is selected by VITE_BHMS_API_BASE_URL; otherwise local demo mode remains. */
export function AppProviders({ children }: { children: ReactNode }) {
  return <AppearanceProvider><ErrorBoundary><PrototypeProvider repository={repository}><BrowserRouter>{children}</BrowserRouter></PrototypeProvider></ErrorBoundary></AppearanceProvider>
}
