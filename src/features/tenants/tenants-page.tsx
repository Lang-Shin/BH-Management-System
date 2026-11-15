import { useState } from 'react'
import { Check, Search, UserPlus } from 'lucide-react'
import { PageHeader, PreviewNotice } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { usePrototype } from '@/hooks/use-prototype'
import { activeAssignments, tenantAccount } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { ACCOUNT_STATUS_LABELS, TENANT_STATUS_LABELS } from '@/lib/labels'
import type { Tenant } from '@/domain/types/models'

function AddTenantDialog() {
  const { data } = usePrototype()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setStep('form')
    setOpen(nextOpen)
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button><UserPlus />Add tenant</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      {step === 'form'
        ? <>
            <DialogHeader className="pr-6"><DialogTitle>Add a tenant</DialogTitle><DialogDescription>Enter sample details to preview the form. Nothing is saved yet.</DialogDescription></DialogHeader>
            <form className="grid gap-5" onSubmit={event => { event.preventDefault(); setStep('success') }}>
              <div className="grid gap-2">
                <label htmlFor="add-tenant-name" className="text-sm font-semibold">Full name</label>
                <Input id="add-tenant-name" autoComplete="name" placeholder="For example: Alex Rivera" className="h-12 bg-card" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="add-tenant-email" className="text-sm font-semibold">Email address</label>
                  <Input id="add-tenant-email" type="email" autoComplete="email" placeholder="resident@example.com" className="h-12 bg-card" />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="add-tenant-phone" className="text-sm font-semibold">Phone number</label>
                  <Input id="add-tenant-phone" type="tel" autoComplete="tel" placeholder="Sample phone number" className="h-12 bg-card" />
                </div>
              </div>
              <div className="grid gap-2">
                <label htmlFor="add-tenant-address" className="text-sm font-semibold">Home address</label>
                <Input id="add-tenant-address" autoComplete="street-address" placeholder="Sample address" className="h-12 bg-card" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="add-tenant-room" className="text-sm font-semibold">Room</label>
                  <select id="add-tenant-room" defaultValue="" className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <option value="">No room yet</option>
                    {data.rooms.map(room => <option key={room.id} value={room.id}>Room {room.name}</option>)}
                  </select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="add-tenant-date" className="text-sm font-semibold">Move-in date</label>
                  <Input id="add-tenant-date" type="date" defaultValue={DEMO_DATE} className="h-12 bg-card" />
                </div>
              </div>
              <div className="grid gap-2">
                <label htmlFor="add-tenant-notes" className="text-sm font-semibold">Notes</label>
                <textarea id="add-tenant-notes" rows={3} maxLength={500} placeholder="Optional sample reminder" className="min-h-24 w-full resize-y rounded-xl border border-input bg-card p-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
              </div>
              <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit"><UserPlus />Add tenant</Button></DialogFooter>
            </form>
          </>
        : <>
            <DialogHeader className="items-start">
              <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent text-primary"><Check className="size-6" aria-hidden="true" /></span>
              <DialogTitle>Tenant added successfully</DialogTitle>
              <DialogDescription className="text-base leading-relaxed" role="status">This is a sample confirmation. No new tenant was saved to the list.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></DialogFooter>
          </>}
    </DialogContent>
  </Dialog>
}

function TenantDetails({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { data, dispatch } = usePrototype()
  const [notes, setNotes] = useState(tenant.notes)
  const account = tenantAccount(data, tenant.id, DEMO_DATE)
  const assignments = data.roomAssignments.filter(a => a.tenantId === tenant.id)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85dvh] overflow-y-auto" onAnimationEnd={onAnimationEnd}>
    <DialogHeader className="pr-6"><DialogTitle>{tenant.name}</DialogTitle><DialogDescription>Tenant details · Sample record</DialogDescription></DialogHeader>
    <dl className="grid gap-5 rounded-lg border bg-muted/40 p-4 text-base sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Tenant status</dt><dd className="mt-2"><StatusBadge status={TENANT_STATUS_LABELS[tenant.status]} /></dd></div>
      <div><dt className="text-muted-foreground">Payments</dt><dd className="mt-2"><StatusBadge status={ACCOUNT_STATUS_LABELS[account.status] ?? account.status} /></dd></div>
      <div><dt className="text-muted-foreground">Still to pay</dt><dd className="mt-1 text-xl font-semibold"><AnimatedNumber value={formatMoney(account.balance)} /></dd></div>
      <div><dt className="text-muted-foreground">Advance payment</dt><dd className="mt-1 text-xl font-semibold"><AnimatedNumber value={formatMoney(account.credit)} /></dd></div>
      <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Contact details</dt><dd className="mt-2 break-all">{tenant.email}</dd><dd className="mt-1 break-words">{tenant.phone}</dd><dd className="mt-2 leading-relaxed">{tenant.address}</dd></div>
    </dl>
    <section><h2 className="mb-3 text-lg font-semibold">Rooms rented</h2><ul className="space-y-3">{assignments.map(a => <li key={a.id} className="rounded-lg border p-4 text-base"><p className="font-semibold">Room {data.rooms.find(r => r.id === a.roomId)?.name}</p><p className="mt-2">Agreed rent: <AnimatedNumber value={formatMoney(a.agreedRentCents)} /></p><p className="mt-2 text-sm text-muted-foreground">{formatDate(a.startDate)} – {a.endDate ? formatDate(a.endDate) : 'Still renting'}</p></li>)}</ul></section>
    <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'tenant/noteUpdated', tenantId: tenant.id, notes }); requestClose() }}>
      <label htmlFor="tenant-notes" className="text-base font-semibold">Notes</label><p id="notes-help" className="mt-2 text-sm text-muted-foreground">Write a short reminder. Try this using sample information.</p>
      <textarea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} className="mt-3 w-full resize-y rounded-lg border bg-card p-4 text-base" placeholder="For example: prefers a text reminder." />
      <p className="mt-1 text-right text-sm text-muted-foreground">{notes.length} / 500 characters</p>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="submit">Save note</Button></DialogFooter>
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
  const activeTenants = data.tenants.filter(t => t.status === 'ACTIVE')
  const tenants = activeTenants.filter(t => `${t.name} ${t.email} ${roomName(t.id) ?? ''}`.toLowerCase().includes(query))

  return <>
    <PageHeader title="Tenants" description="Find a tenant, check their room, or see what they still need to pay." action={<AddTenantDialog />} />
    <PreviewNotice>You can open a tenant’s details, try saving a note, or preview the add-tenant form.</PreviewNotice>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div className="w-full sm:max-w-md"><label htmlFor="tenant-search" className="mb-2 block text-base font-semibold">Find a tenant</label><div className="relative"><Search className="pointer-events-none absolute top-4 left-4 size-5 text-muted-foreground" aria-hidden="true" /><Input id="tenant-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name or room number" className="h-14 bg-card pl-12 text-base" type="search" /></div></div><p className="text-sm text-muted-foreground" role="status">Showing <AnimatedNumber value={tenants.length} /> of <AnimatedNumber value={activeTenants.length} /> tenants</p></div>
    <DataTable rows={tenants} caption="Tenant list" columns={[
      { key: 'name', label: 'Tenant', render: t => <div><p className="font-semibold">{t.name}</p>{t.notes && <p className="mt-2 text-sm text-muted-foreground">Note saved</p>}</div> },
      { key: 'room', label: 'Room', render: t => roomName(t.id) ? <span className="inline-flex rounded-md border bg-muted px-2 py-1 text-xs font-semibold">Room {roomName(t.id)}</span> : <span className="text-muted-foreground">No room rented now</span> },
      { key: 'status', label: 'Tenant status', render: t => <StatusBadge status={TENANT_STATUS_LABELS[t.status]} /> },
      { key: 'actions', label: 'Details', render: t => <Button variant="outline" onClick={() => setSelectedId(t.id)} aria-label={`View ${t.name}`}>View details</Button> },
    ]} />
    {search && <Button variant="outline" onClick={() => setSearch('')} className="mt-4">Clear search</Button>}
    <WorkflowPlaceholders title="More tenant tools" items={[
      { title: 'Update tenant details', description: 'Changing saved tenant details will be available later.' },
      { title: 'Move a tenant to another room', description: 'Changing rooms and recording a move-out will be added later.' },
    ]} />
    {selected && <TenantDetails key={selected.id} tenant={selected} onClose={() => setSelectedId(null)} />}
  </>
}
