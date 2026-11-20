import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { usePrototype } from '@/hooks/use-prototype'

export const TENANT_DEMO_STORAGE_KEY = 'bhms:tenant-demo:v1'

interface TenantDemoValue {
  tenantId: string
  selectTenant: (tenantId: string) => void
}

const TenantDemoContext = createContext<TenantDemoValue | null>(null)

function readStoredTenantId(): string | null {
  try {
    return window.localStorage.getItem(TENANT_DEMO_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Demo-only tenant context for the prototype tenant workspace. The selection is a presentation
 * preference, not authentication: tenant records and assignments always come from the shared
 * repository snapshot, and no duplicate tenant records are created.
 */
export function TenantDemoProvider({ children }: { children: ReactNode }) {
  const { data } = usePrototype()
  const [tenantId, setTenantId] = useState(() => {
    const stored = readStoredTenantId()
    if (stored && data.tenants.some(item => item.id === stored)) return stored
    return data.tenants.find(item => item.status === 'ACTIVE')?.id ?? data.tenants[0]?.id ?? ''
  })

  const selectTenant = useCallback((id: string) => {
    if (!data.tenants.some(item => item.id === id)) return
    setTenantId(id)
    try {
      window.localStorage.setItem(TENANT_DEMO_STORAGE_KEY, id)
    } catch {
      // A blocked storage API should not break the prototype.
    }
  }, [data.tenants])

  const value = useMemo(() => ({ tenantId, selectTenant }), [tenantId, selectTenant])
  return <TenantDemoContext.Provider value={value}>{children}</TenantDemoContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTenantDemo() {
  const value = useContext(TenantDemoContext)
  if (!value) throw new Error('useTenantDemo must be used within TenantDemoProvider')
  return value
}
