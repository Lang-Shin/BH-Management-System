import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader, PreviewNotice } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { activeAssignments } from '@/domain/calculations/summary'
import { TENANT_STATUS_LABELS } from '@/lib/labels'
import { AddTenantDialog } from './add-tenant-dialog'
import { TenantDetailsDialog } from './tenant-details-dialog'
import { RoomChangeRequestsPanel } from './room-change-requests-panel'

export default function Tenants() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selected = data.tenants.find(tenant => tenant.id === selectedId)
  const assignments = activeAssignments(data, occupancyDate)
  const roomName = (tenantId: string) => data.rooms.find(room => room.id === assignments.find(assignment => assignment.tenantId === tenantId)?.roomId)?.name
  const query = search.trim().toLowerCase()
  const activeTenants = data.tenants.filter(tenant => tenant.status === 'ACTIVE')
  const tenants = activeTenants.filter(tenant => `${tenant.name} ${tenant.email} ${roomName(tenant.id) ?? ''}`.toLowerCase().includes(query))

  return <>
    <PageHeader title="Tenants" description="Find a tenant, check their room, or see what they still need to pay." action={<AddTenantDialog onSaved={setNotice} />} />
    <PreviewNotice>Add or edit tenants, record a safe room transfer, or move a tenant out while preserving historical bills and receipts.</PreviewNotice>
    {notice ? <p role="status" className="tenant-management-notice">{notice}</p> : <p role="status" className="sr-only" />}
    <RoomChangeRequestsPanel onNotice={setNotice} />
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div className="w-full sm:max-w-md"><label htmlFor="tenant-search" className="mb-2 block text-base font-semibold">Find a tenant</label><div className="relative"><Search className="pointer-events-none absolute top-4 left-4 size-5 text-muted-foreground" aria-hidden="true" /><Input id="tenant-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Type a name or room number" className="h-14 bg-card pl-12 text-base" type="search" /></div></div><p className="text-sm text-muted-foreground" role="status">Showing <AnimatedNumber value={tenants.length} /> of <AnimatedNumber value={activeTenants.length} /> tenants</p></div>
    <PaginatedDataTable rows={tenants} resetKey={query} recordLabel="tenants" caption="Tenant list" columns={[
      { key: 'name', label: 'Tenant', render: tenant => <div><p className="font-semibold">{tenant.name}</p>{tenant.notes && <p className="mt-2 text-sm text-muted-foreground">Note saved</p>}</div> },
      { key: 'room', label: 'Room', render: tenant => roomName(tenant.id) ? <span className="inline-flex rounded-md border bg-muted px-2 py-1 text-xs font-semibold">Room {roomName(tenant.id)}</span> : <span className="text-muted-foreground">No room rented now</span> },
      { key: 'status', label: 'Tenant status', render: tenant => <StatusBadge status={TENANT_STATUS_LABELS[tenant.status]} /> },
      { key: 'actions', label: 'Details', render: tenant => <Button variant="outline" onClick={event => { triggerRef.current = event.currentTarget; setNotice(''); setSelectedId(tenant.id) }} aria-label={`View ${tenant.name}`}>View details</Button> },
    ]} />
    {search && <Button variant="outline" onClick={() => setSearch('')} className="mt-4">Clear search</Button>}
    {selected && <TenantDetailsDialog key={selected.id} tenant={selected} onClose={() => setSelectedId(null)} onReturnFocus={() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else document.getElementById('tenant-search')?.focus() }} onNotice={setNotice} />}
  </>
}
