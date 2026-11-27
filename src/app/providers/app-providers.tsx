import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@/components/shared/states'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { configuredApiRepository } from '@/data/repositories/api-repository'
import { PrototypeProvider } from './prototype-provider'
import { AuthProvider } from './auth'
import { AppearanceProvider } from './appearance'

const repository = configuredApiRepository() ?? localStorageRepository

/** Composition root: server mode is selected by VITE_BHMS_API_BASE_URL; otherwise local demo mode remains. */
export function AppProviders({ children }: { children: ReactNode }) {
  const authEnabled = Boolean(import.meta.env.VITE_BHMS_API_BASE_URL)
  const content = authEnabled ? children : <PrototypeProvider repository={repository}>{children}</PrototypeProvider>
  return <AuthProvider enabled={authEnabled}><AppearanceProvider><ErrorBoundary><BrowserRouter>{content}</BrowserRouter></ErrorBoundary></AppearanceProvider></AuthProvider>
}
