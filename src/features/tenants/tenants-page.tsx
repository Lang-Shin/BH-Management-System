import { useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader, PreviewNotice } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
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
import { ACCOUNT_STATUS_LABELS, TENANT_STATUS_LABELS } from '@/lib/labels'
import type { Tenant } from '@/domain/types/models'

function TenantDetails({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { data, dispatch } = usePrototype()
  const [notes, setNotes] = useState(tenant.notes)
  const account = tenantAccount(data, tenant.id, DEMO_DATE)
  const assignments = data.roomAssignments.filter(a => a.tenantId === tenant.id)

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto">
    <DialogHeader className="pr-6"><DialogTitle>{tenant.name}</DialogTitle><DialogDescription>Tenant details · Sample record</DialogDescription></DialogHeader>
    <dl className="grid gap-5 rounded-lg border bg-muted/40 p-4 text-base sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Tenant status</dt><dd className="mt-2"><StatusBadge status={TENANT_STATUS_LABELS[tenant.status]} /></dd></div>
      <div><dt className="text-muted-foreground">Payments</dt><dd className="mt-2"><StatusBadge status={ACCOUNT_STATUS_LABELS[account.status] ?? account.status} /></dd></div>
      <div><dt className="text-muted-foreground">Still to pay</dt><dd className="mt-1 text-xl font-semibold"><AnimatedNumber value={formatMoney(account.balance)} /></dd></div>
      <div><dt className="text-muted-foreground">Advance payment</dt><dd className="mt-1 text-xl font-semibold"><AnimatedNumber value={formatMoney(account.credit)} /></dd></div>
      <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Contact details</dt><dd className="mt-2 break-all">{tenant.email}</dd><dd className="mt-1 break-words">{tenant.phone}</dd><dd className="mt-2 leading-relaxed">{tenant.address}</dd></div>
    </dl>
    <section><h2 className="mb-3 text-lg font-semibold">Rooms rented</h2><ul className="space-y-3">{assignments.map(a => <li key={a.id} className="rounded-lg border p-4 text-base"><p className="font-semibold">Room {data.rooms.find(r => r.id === a.roomId)?.name}</p><p className="mt-2">Agreed rent: <AnimatedNumber value={formatMoney(a.agreedRentCents)} /></p><p className="mt-2 text-sm text-muted-foreground">{formatDate(a.startDate)} – {a.endDate ? formatDate(a.endDate) : 'Still renting'}</p></li>)}</ul></section>
    <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'tenant/noteUpdated', tenantId: tenant.id, notes }); onClose() }}>
      <label htmlFor="tenant-notes" className="text-base font-semibold">Notes</label><p id="notes-help" className="mt-2 text-sm text-muted-foreground">Write a short reminder. Try this using sample information.</p>
      <textarea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} className="mt-3 w-full resize-y rounded-lg border bg-card p-4 text-base" placeholder="For example: prefers a text reminder." />
      <p className="mt-1 text-right text-sm text-muted-foreground">{notes.length} / 500 characters</p>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Save note</Button></DialogFooter>
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
    <PageHeader title="Tenants" description="Find a tenant, check their room, or see what they still need to pay." />
    <PreviewNotice>You can open a tenant’s details and try saving a note.</PreviewNotice>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div className="w-full sm:max-w-md"><label htmlFor="tenant-search" className="mb-2 block text-base font-semibold">Find a tenant</label><div className="relative"><Search className="pointer-events-none absolute top-4 left-4 size-5 text-muted-foreground" aria-hidden="true" /><Input id="tenant-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name or room number" className="h-14 bg-card pl-12 text-base" type="search" /></div></div><p className="text-sm text-muted-foreground" role="status">Showing <AnimatedNumber value={tenants.length} /> of <AnimatedNumber value={data.tenants.length} /> tenants</p></div>
    <DataTable rows={tenants} caption="Tenant list" columns={[
      { key: 'name', label: 'Tenant', render: t => <div><p className="font-semibold">{t.name}</p>{t.notes && <p className="mt-2 text-sm text-muted-foreground">Note saved</p>}</div> },
      { key: 'room', label: 'Room', render: t => roomName(t.id) ? <span className="inline-flex rounded-md border bg-muted px-2 py-1 text-xs font-semibold">Room {roomName(t.id)}</span> : <span className="text-muted-foreground">No room rented now</span> },
      { key: 'status', label: 'Tenant status', render: t => <StatusBadge status={TENANT_STATUS_LABELS[t.status]} /> },
      { key: 'balance', label: 'Still to pay', render: t => { const a = tenantAccount(data, t.id, DEMO_DATE); return <div><p className="font-semibold"><AnimatedNumber value={formatMoney(a.balance)} /></p><div className="mt-2"><StatusBadge status={ACCOUNT_STATUS_LABELS[a.status] ?? a.status} /></div>{a.credit > 0 && <p className="mt-2 text-sm">Advance: <AnimatedNumber value={formatMoney(a.credit)} /></p>}</div> } },
      { key: 'actions', label: 'Details', render: t => <Button variant="outline" onClick={() => setSelectedId(t.id)} aria-label={`View ${t.name}`}>View details</Button> },
    ]} />
    {search && <Button variant="outline" onClick={() => setSearch('')} className="mt-4">Clear search</Button>}
    <WorkflowPlaceholders title="More tenant tools" items={[
      { title: 'Add or update a tenant', description: 'Adding tenants and changing their details will be available later.' },
      { title: 'Move a tenant to another room', description: 'Changing rooms and recording a move-out will be added later.' },
    ]} />
    {selected && <TenantDetails key={selected.id} tenant={selected} onClose={() => setSelectedId(null)} />}
  </>
}
