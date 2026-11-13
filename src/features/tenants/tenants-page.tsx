import { useState } from 'react'
import { Search, ArrowUpRight } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { DataTable } from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { formatDate } from '@/lib/format'
import type { Tenant } from '@/domain/types/models'

function TenantDetails({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { data, dispatch } = usePrototype()
  const [notes, setNotes] = useState(tenant.notes)
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>{tenant.name}</DialogTitle><DialogDescription>Fictional tenant profile · {tenant.id}</DialogDescription></DialogHeader>
    <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/40 p-4 text-sm"><div><dt className="text-muted-foreground">Room</dt><dd className="mt-1 font-medium">{data.rooms.find(room => room.id === tenant.roomId)?.name}</dd></div><div><dt className="text-muted-foreground">Moved in</dt><dd className="mt-1 font-medium">{formatDate(tenant.moveInDate)}</dd></div><div className="col-span-2 min-w-0"><dt className="text-muted-foreground">Demo email</dt><dd className="mt-1 break-all">{tenant.email}</dd></div></dl>
    <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'tenant/noteUpdated', tenantId: tenant.id, notes }); onClose() }}>
      <label htmlFor="tenant-notes" className="text-sm font-medium">Demo notes</label><p id="notes-help" className="mt-1 text-xs leading-relaxed text-muted-foreground">Try a fictional note. It will be saved in this browser. Use sample information only.</p>
      <textarea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} rows={4} className="mt-3 w-full resize-y rounded-md border bg-card p-3 text-sm" placeholder="For example: prefers email reminders." />
      <p className="mt-1 text-right text-xs text-muted-foreground">{notes.length}/500</p>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Save demo note</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>
}

export default function Tenants() {
  const { data } = usePrototype()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = data.tenants.find(tenant => tenant.id === selectedId)
  const query = search.trim().toLowerCase()
  const tenants = data.tenants.filter(tenant => `${tenant.name} ${tenant.email} ${data.rooms.find(room => room.id === tenant.roomId)?.name ?? ''}`.toLowerCase().includes(query))
  return <>
    <PageHeader title="Tenants" description="Get to know your sample residents. Open a profile to try saving a fictional note." />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div className="relative w-full sm:max-w-sm"><label htmlFor="tenant-search" className="sr-only">Search tenants</label><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input id="tenant-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, email, or room…" className="h-11 bg-card pl-9" type="search" /></div><p className="text-sm text-muted-foreground" role="status">{tenants.length} of {data.tenants.length} fictional tenants</p></div>
    <DataTable rows={tenants} caption="Fictional tenant directory" columns={[
      { key: 'name', label: 'Tenant', render: tenant => <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary" aria-hidden="true">{tenant.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><div><p className="font-medium">{tenant.name}</p><p className="mt-1 text-xs text-muted-foreground">{tenant.email}</p></div></div> },
      { key: 'room', label: 'Room', render: tenant => `Room ${data.rooms.find(room => room.id === tenant.roomId)?.name ?? 'Unassigned'}` },
      { key: 'move-in', label: 'Move-in date', render: tenant => formatDate(tenant.moveInDate) },
      { key: 'notes', label: 'Notes', render: tenant => <span className="text-xs text-muted-foreground">{tenant.notes ? 'Demo note saved' : 'No notes yet'}</span> },
      { key: 'actions', label: 'Profile', render: tenant => <Button variant="ghost" size="sm" onClick={() => setSelectedId(tenant.id)} aria-label={`View ${tenant.name}`}>View <ArrowUpRight /></Button> },
    ]} />
    {search && <Button variant="link" onClick={() => setSearch('')} className="mt-3">Clear search</Button>}
    {selected && <TenantDetails key={selected.id} tenant={selected} onClose={() => setSelectedId(null)} />}
  </>
}
