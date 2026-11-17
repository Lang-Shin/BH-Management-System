import { useState } from 'react'
import { Check, Search, UserPlus } from 'lucide-react'
import { Button, Callout, Dialog, Flex, Grid, Heading, Select, Text, TextArea, TextField } from '@radix-ui/themes'
import { PageHeader, PreviewNotice } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { activeAssignments, tenantAccount } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { ACCOUNT_STATUS_LABELS, TENANT_STATUS_LABELS } from '@/lib/labels'
import type { Tenant } from '@/domain/types/models'
import './tenants.css'

function AddTenantDialog() {
  const { data } = usePrototype()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [room, setRoom] = useState('none')

  function validate(field: HTMLInputElement | HTMLTextAreaElement) {
    if (field.required && !field.value.trim()) return 'Enter the tenant’s full name.'
    if (field.validity.typeMismatch) return 'Enter an email address such as resident@example.com.'
    if (field.id === 'add-tenant-phone' && field.value && (!/^\+?[\d\s().-]+$/.test(field.value) || !/^\d{7,15}$/.test(field.value.replace(/\D/g, '')))) return 'Enter 7–15 digits. A leading +, spaces, parentheses, and hyphens are allowed.'
    if (field.validity.badInput) return 'Enter a valid date.'
    return ''
  }

  function fieldProps(id: string, helpId?: string) {
    return {
      'aria-invalid': Boolean(errors[id]),
      'aria-describedby': [helpId, errors[id] ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined,
      onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        // Submission validates every field. Avoid moving the button during a pointer click.
        if (event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.type === 'submit' && event.relatedTarget.form === event.currentTarget.form) return
        const error = validate(event.currentTarget)
        setErrors(previous => ({ ...previous, [id]: error }))
      },
      onChange: () => setErrors(previous => ({ ...previous, [id]: '' })),
    }
  }

  function fieldError(id: string) {
    return errors[id] && <Text as="p" id={`${id}-error`} role="alert" size="2" color="red">{errors[id]}</Text>
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) { setStep('form'); setErrors({}); setRoom('none') }
    setOpen(nextOpen)
  }

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger><Button><UserPlus size={16} aria-hidden="true" />Add tenant</Button></Dialog.Trigger>
    <Dialog.Content maxWidth="32rem">
      {step === 'form'
        ? <>
            <Dialog.Title size="5" mb="1">Add a tenant</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="4">Enter sample details to preview the form. Nothing will be saved. Fields marked * are required.</Dialog.Description>
            <form noValidate onSubmit={event => {
              event.preventDefault()
              const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
              const nextErrors = Object.fromEntries(fields.map(field => [field.id, validate(field)]))
              setErrors(nextErrors)
              const firstInvalid = fields.find(field => nextErrors[field.id])
              if (firstInvalid) firstInvalid.focus()
              else setStep('success')
            }}>
              <Flex direction="column" gap="4">
                <Flex direction="column" gap="1">
                  <Text as="label" htmlFor="add-tenant-name" size="2" weight="medium">Full name <span aria-hidden="true">*</span></Text>
                  <TextField.Root id="add-tenant-name" required maxLength={100} autoComplete="name" placeholder="For example: Alex Rivera" {...fieldProps('add-tenant-name', 'add-tenant-name-help')} />
                  <Text as="p" id="add-tenant-name-help" size="1" color="gray">Up to 100 characters.</Text>
                  {fieldError('add-tenant-name')}
                </Flex>
                <Grid columns={{ initial: '1', sm: '2' }} gap="4">
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-tenant-email" size="2" weight="medium">Email address (optional)</Text>
                    <TextField.Root id="add-tenant-email" type="email" maxLength={254} autoComplete="email" placeholder="resident@example.com" {...fieldProps('add-tenant-email')} />
                    {fieldError('add-tenant-email')}
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-tenant-phone" size="2" weight="medium">Phone number (optional)</Text>
                    <TextField.Root id="add-tenant-phone" type="tel" maxLength={30} autoComplete="tel" placeholder="For example: +63 912 345 6789" {...fieldProps('add-tenant-phone', 'add-tenant-phone-help')} />
                    <Text as="p" id="add-tenant-phone-help" size="1" color="gray">7–15 digits; spaces and a country code are welcome.</Text>
                    {fieldError('add-tenant-phone')}
                  </Flex>
                </Grid>
                <Flex direction="column" gap="1">
                  <Text as="label" htmlFor="add-tenant-address" size="2" weight="medium">Home address (optional)</Text>
                  <TextField.Root id="add-tenant-address" maxLength={250} autoComplete="street-address" placeholder="Sample address" />
                </Flex>
                <Grid columns={{ initial: '1', sm: '2' }} gap="4">
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-tenant-room" size="2" weight="medium">Room (optional)</Text>
                    <Select.Root value={room} onValueChange={setRoom}>
                      <Select.Trigger id="add-tenant-room" style={{ width: '100%' }} />
                      <Select.Content>
                        <Select.Item value="none">No room yet</Select.Item>
                        {data.rooms.map(item => <Select.Item key={item.id} value={item.id}>Room {item.name}</Select.Item>)}
                      </Select.Content>
                    </Select.Root>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text as="label" htmlFor="add-tenant-date" size="2" weight="medium">Move-in date (optional)</Text>
                    <TextField.Root id="add-tenant-date" type="date" defaultValue={DEMO_DATE} {...fieldProps('add-tenant-date')} />
                    {fieldError('add-tenant-date')}
                  </Flex>
                </Grid>
                <Flex direction="column" gap="1">
                  <Text as="label" htmlFor="add-tenant-notes" size="2" weight="medium">Notes (optional)</Text>
                  <TextArea id="add-tenant-notes" rows={3} maxLength={500} aria-describedby="add-tenant-notes-help" placeholder="Sample reminder" />
                  <Text as="p" id="add-tenant-notes-help" size="1" color="gray">Up to 500 characters.</Text>
                </Flex>
              </Flex>
              <Flex gap="3" mt="5" justify="end">
                <Dialog.Close><Button type="button" variant="soft" color="gray">Cancel</Button></Dialog.Close>
                <Button type="submit">Preview tenant</Button>
              </Flex>
            </form>
          </>
        : <>
            <Dialog.Title size="5" mb="2"><Check size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--accent-11)' }} />Tenant preview complete</Dialog.Title>
            <Dialog.Description size="3" role="status">Your sample details passed the form checks. No new tenant was saved to the list.</Dialog.Description>
            <Flex mt="5" justify="end"><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></Flex>
          </>}
    </Dialog.Content>
  </Dialog.Root>
}

function TenantDetails({ tenant, onClose, onNoteUpdated }: { tenant: Tenant; onClose: () => void; onNoteUpdated: () => void }) {
  const { data, dispatch } = usePrototype()
  const [notes, setNotes] = useState(tenant.notes)
  const account = tenantAccount(data, tenant.id, DEMO_DATE)
  const assignments = data.roomAssignments.filter(a => a.tenantId === tenant.id)

  return <Dialog.Root open onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Content maxWidth="34rem">
      <Dialog.Title size="5" mb="1">{tenant.name}</Dialog.Title>
      <Dialog.Description size="2" color="gray">Tenant details · Sample record</Dialog.Description>
      <dl className="tenant-facts">
        <div><Text asChild size="2" color="gray"><dt>Tenant status</dt></Text><dd><StatusBadge status={TENANT_STATUS_LABELS[tenant.status]} /></dd></div>
        <div><Text asChild size="2" color="gray"><dt>Payments</dt></Text><dd><StatusBadge status={ACCOUNT_STATUS_LABELS[account.status] ?? account.status} /></dd></div>
        <div><Text asChild size="2" color="gray"><dt>Still to pay</dt></Text><dd><Text size="5" weight="bold" className="num"><AnimatedNumber value={formatMoney(account.balance)} /></Text></dd></div>
        <div><Text asChild size="2" color="gray"><dt>Advance payment</dt></Text><dd><Text size="5" weight="bold" className="num"><AnimatedNumber value={formatMoney(account.credit)} /></Text></dd></div>
        <div className="tenant-facts-wide"><Text asChild size="2" color="gray"><dt>Contact details</dt></Text><dd><Text size="2">{tenant.email}</Text></dd><dd><Text size="2">{tenant.phone}</Text></dd><dd><Text size="2">{tenant.address}</Text></dd></div>
      </dl>
      <section aria-labelledby="tenant-rooms-title" style={{ marginTop: 20 }}>
        <Heading as="h2" id="tenant-rooms-title" size="3">Rooms rented</Heading>
        <Text as="p" size="2" color="gray" mt="1">Room rent is charged once per occupied room, not once per tenant.</Text>
        <ul className="tenant-rooms">{assignments.map(a => <li key={a.id}>
          <Text as="p" size="2" weight="bold">Room {data.rooms.find(r => r.id === a.roomId)?.name}</Text>
          <Text as="p" size="2" className="num">Room rent: <AnimatedNumber value={formatMoney(a.agreedRentCents)} /></Text>
          <Text as="p" size="1" color="gray">{formatDate(a.startDate)} – {a.endDate ? formatDate(a.endDate) : 'Still renting'}</Text>
        </li>)}</ul>
      </section>
      <form style={{ marginTop: 20 }} onSubmit={event => { event.preventDefault(); if (notes === tenant.notes) return; dispatch({ type: 'tenant/noteUpdated', tenantId: tenant.id, notes }); onNoteUpdated(); onClose() }}>
        <Text as="label" htmlFor="tenant-notes" size="3" weight="bold">Notes</Text>
        <Text as="p" id="notes-help" size="2" color="gray" mb="2">Write a short reminder. Try this using sample information.</Text>
        <TextArea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} placeholder="For example: prefers a text reminder." />
        <Text as="p" size="1" color="gray" align="right" mt="1">{notes.length} / 500 characters</Text>
        <Flex gap="3" mt="4" justify="end">
          <Button type="button" variant="soft" color="gray" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={notes === tenant.notes}>Save note</Button>
        </Flex>
      </form>
    </Dialog.Content>
  </Dialog.Root>
}

export default function Tenants() {
  const { data, storageWarning } = usePrototype()
  const [noteUpdated, setNoteUpdated] = useState(false)
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
    {noteUpdated && <Callout.Root size="1" color="gray" variant="outline" mb="4"><Callout.Text role="status">Note updated in this workspace.{storageWarning ? ' Browser saving could not be confirmed. Changes may not survive a refresh.' : ''}</Callout.Text></Callout.Root>}
    <div className="tenants-toolbar">
      <div className="tenants-toolbar-search">
        <label htmlFor="tenant-search" className="sr-only">Find a tenant</label>
        <TextField.Root id="tenant-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a tenant by name or room number" size="3">
          <TextField.Slot><Search size={16} aria-hidden="true" /></TextField.Slot>
        </TextField.Root>
      </div>
      {search && <Button variant="ghost" color="gray" onClick={() => setSearch('')}>Clear search</Button>}
      <Text as="p" size="2" color="gray" role="status" className="tenants-toolbar-count">Showing <AnimatedNumber value={tenants.length} /> of <AnimatedNumber value={activeTenants.length} /> tenants</Text>
    </div>
    <DataTable rows={tenants} caption="Tenant list" columns={[
      { key: 'name', label: 'Tenant', render: t => <div><Text as="p" size="2" weight="bold">{t.name}</Text>{t.notes && <Text as="p" size="1" color="gray">Note saved</Text>}</div> },
      { key: 'room', label: 'Room', render: t => roomName(t.id) ? <Text size="2">Room {roomName(t.id)}</Text> : <Text size="2" color="gray">No room rented now</Text> },
      { key: 'status', label: 'Tenant status', render: t => <StatusBadge status={TENANT_STATUS_LABELS[t.status]} /> },
      { key: 'actions', label: 'Details', render: t => <Button variant="soft" color="gray" onClick={() => setSelectedId(t.id)} aria-label={`View ${t.name}`}>View details</Button> },
    ]} />
    <WorkflowPlaceholders title="More tenant tools" items={[
      { title: 'Update tenant details', description: 'Changing saved tenant details will be available later.' },
      { title: 'Move a tenant to another room', description: 'Changing rooms and recording a move-out will be added later.' },
    ]} />
    {selected && <TenantDetails key={selected.id} tenant={selected} onClose={() => setSelectedId(null)} onNoteUpdated={() => setNoteUpdated(true)} />}
  </>
}
