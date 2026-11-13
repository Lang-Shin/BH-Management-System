import { useState } from 'react'
import { Search, ArrowUpRight } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { activeAssignments, tenantAccount } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import type { Tenant } from '@/domain/types/models'

function TenantDetails({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { data, dispatch } = usePrototype()
  const [notes, setNotes] = useState(tenant.notes)
  const account = tenantAccount(data, tenant.id, DEMO_DATE)
  const assignments = data.roomAssignments.filter(a => a.tenantId === tenant.id)

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto">
    <DialogHeader className="pr-6"><DialogTitle>{tenant.name}</DialogTitle><DialogDescription>Fictional tenant profile · {tenant.id}</DialogDescription></DialogHeader>
    <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/40 p-4 text-sm">
      <div><dt className="text-muted-foreground">Tenant status</dt><dd className="mt-2"><StatusBadge status={tenant.status === 'ACTIVE' ? 'Active' : 'Moved out'} /></dd></div>
      <div><dt className="text-muted-foreground">Account status</dt><dd className="mt-2"><StatusBadge status={account.status} /></dd></div>
      <div><dt className="text-muted-foreground">Outstanding charges</dt><dd className="mt-1">{formatMoney(account.balance)}</dd></div>
      <div><dt className="text-muted-foreground">Unapplied credit</dt><dd className="mt-1">{formatMoney(account.credit)}</dd></div>
      <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">Fictional contact information</dt><dd className="mt-1 break-all">{tenant.email}</dd><dd className="mt-1 break-words">{tenant.phone}</dd><dd className="mt-1 leading-relaxed">{tenant.address}</dd></div>
    </dl>
    <section><h2 className="mb-2 text-sm font-semibold">Room assignment history</h2><ul className="space-y-3">{assignments.map(a => <li key={a.id} className="rounded-lg border p-3 text-sm"><p className="font-medium">Room {data.rooms.find(r => r.id === a.roomId)?.name} · Agreed rent {formatMoney(a.agreedRentCents)}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(a.startDate)} – {a.endDate ? formatDate(a.endDate) : 'Current assignment'}</p></li>)}</ul></section>
    <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'tenant/noteUpdated', tenantId: tenant.id, notes }); onClose() }}>
      <label htmlFor="tenant-notes" className="text-sm font-medium">Demo notes</label><p id="notes-help" className="mt-1 text-xs leading-relaxed text-muted-foreground">The only editable profile field in this foundation. Use fictional information; saved in this browser.</p>
      <textarea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} rows={3} className="mt-3 w-full resize-y rounded-md border bg-card p-3 text-sm" placeholder="For example: prefers email reminders." />
      <p className="mt-1 text-right text-xs text-muted-foreground">{notes.length}/500</p>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Save demo note</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>
}

export default function Tenants() {
  const { data } = usePrototype()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = data.tenants.find(t => t.id === selectedId)
  const assignments = activeAssignments(data, DEMO_DATE)
  const roomName = (tenantId: string) => data.rooms.find(r => r.id === assignments.find(a => a.tenantId === tenantId)?.roomId)?.name
  const query = search.trim().toLowerCase()
  const tenants = data.tenants.filter(t => `${t.name} ${t.email} ${roomName(t.id) ?? ''}`.toLowerCase().includes(query))

  return <>
    <PageHeader title="Tenants" description="A fictional directory with active and moved-out residents, assignment history, and account visibility." />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div className="relative w-full sm:max-w-sm"><label htmlFor="tenant-search" className="sr-only">Search tenants</label><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input id="tenant-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, or current room…" className="h-11 bg-card pl-9" type="search" /></div><p className="text-sm text-muted-foreground" role="status">{tenants.length} of {data.tenants.length} fictional tenants</p></div>
    <DataTable rows={tenants} caption="Fictional tenant directory" columns={[
      { key: 'name', label: 'Tenant', render: t => <div><p className="font-medium">{t.name}</p><p className="mt-1 text-xs text-muted-foreground">{t.email}</p></div> },
      { key: 'room', label: 'Current assignment', render: t => roomName(t.id) ? `Room ${roomName(t.id)}` : 'No current assignment' },
      { key: 'status', label: 'Tenant status', render: t => <StatusBadge status={t.status === 'ACTIVE' ? 'Active' : 'Moved out'} /> },
      { key: 'account', label: 'Tenant account', render: t => { const a = tenantAccount(data, t.id, DEMO_DATE); return <div><StatusBadge status={a.status} /><p className="mt-1 text-xs">Balance {formatMoney(a.balance)} · Credit {formatMoney(a.credit)}</p></div> } },
      { key: 'notes', label: 'Notes', render: t => <span className="text-xs text-muted-foreground">{t.notes ? 'Demo note saved' : 'No notes yet'}</span> },
      { key: 'actions', label: 'Profile', render: t => <Button variant="ghost" size="sm" onClick={() => setSelectedId(t.id)} aria-label={`View ${t.name}`}>View <ArrowUpRight /></Button> },
    ]} />
    {search && <Button variant="link" onClick={() => setSearch('')} className="mt-3">Clear search</Button>}
    <WorkflowPlaceholders items={[
      { title: 'Tenant creation and editing', description: 'Full tenant CRUD and move-out workflows belong to the next milestone.' },
      { title: 'Room assignment and tenant status changes', description: 'Assignment and status history are shown read-only. Transfers and status changes are not implemented.' },
    ]} />
    {selected && <TenantDetails key={selected.id} tenant={selected} onClose={() => setSelectedId(null)} />}
  </>
}
