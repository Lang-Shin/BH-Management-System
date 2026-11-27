import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { getTenantBootstrap, type TenantBootstrap } from '@/features/auth/auth-api'
import { PrototypeProvider } from './prototype-provider'
import { useOptionalAuth } from './auth'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'

export function TenantWorkspaceBoundary({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth()
  const [bootstrap, setBootstrap] = useState<TenantBootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const enabled = Boolean(auth?.enabled)

  useEffect(() => {
    if (!enabled || !auth?.session?.tenantId) return
    let cancelled = false
    getTenantBootstrap().then(value => {
      if (cancelled) return
      setBootstrap(value)
      setError(null)
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Your tenant records could not be loaded.')
    })
    return () => { cancelled = true }
  }, [enabled, auth?.session?.tenantId])

  const repository = useMemo<PrototypeRepository | null>(() => bootstrap ? {
    mode: 'server',
    load: async () => ({
      data: bootstrap.state, warning: null, canPersist: false, revision: bootstrap.revision,
      serverDate: bootstrap.serverDate, capabilities: { clearAllRecords: false },
    }),
    save: async () => 'Tenant records are read-only in this workspace.',
    command: async () => { throw new Error('Tenant account changes are not available in this workspace.') },
  } : null, [bootstrap])

  if (!enabled) return children
  if (error) return <div className="p-6"><EmptyState title="Tenant workspace unavailable" description={error} /></div>
  if (!bootstrap || !repository) return <div className="p-6"><LoadingState /></div>
  return <PrototypeProvider repository={repository}>{children}</PrototypeProvider>
}
