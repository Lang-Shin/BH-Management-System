import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, DoorOpen, Download, User } from 'lucide-react'
import { EmptyState } from '@/components/shared/states'
import { PageHeader, PreviewNotice } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { StatusBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { useTenantDemo } from '@/app/providers/tenant-demo'
import { roomOccupants, roomOccupancy, tenantAccount } from '@/domain/calculations/summary'
import { selectMoveInObligations } from '@/domain/calculations/move-in'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney, formatMonthYear } from '@/lib/format'
import { selectTenantPersona } from './tenant-persona'
import { tenantRoomBilling } from './tenant-room-billing'
import { roomCategoryLabel } from '@/lib/room-rates'
import { CATEGORY_LABELS } from '@/lib/labels'

export default function TenantOverview() {
  const { data } = usePrototype()
  const { tenantId } = useTenantDemo()
  const persona = selectTenantPersona(data, tenantId)
  const defaultPeriod = data.billingPeriods.find(item => item.startDate <= DEMO_DATE && item.endDate >= DEMO_DATE) ?? data.billingPeriods.at(-1)
  const [periodId, setPeriodId] = useState(defaultPeriod?.id ?? '')
  const period = data.billingPeriods.find(item => item.id === periodId) ?? defaultPeriod
  const monthLabel = period ? formatMonthYear(period.startDate) : 'Not available'
  const account = persona ? tenantAccount(data, persona.tenant.id, DEMO_DATE) : null
  const payments = persona ? data.payments.filter(item => item.tenantId === persona.tenant.id && item.state === 'RECORDED' && item.paidOn <= DEMO_DATE) : []
  const receipts = persona ? data.receipts.filter(item => item.state === 'ISSUED' && payments.some(payment => payment.id === item.paymentId)) : []
  const lastPayment = [...payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn)).at(0)
  const occupants = persona?.room ? roomOccupants(data, persona.room.id, DEMO_DATE).filter(tenant => tenant.status === 'ACTIVE') : []
  const occupantTitle = occupants.length === 0 ? 'No current tenants' : occupants.length === 1 ? 'Tenant' : 'Tenants'
  const occupancy = persona?.room ? roomOccupancy(data, persona.room, DEMO_DATE) : null
  const billing = tenantRoomBilling(data, tenantId, persona?.room?.id ?? null, period?.id ?? '', DEMO_DATE)
  const moveIn = persona?.room ? selectMoveInObligations(data, DEMO_DATE, persona.room.id).find(view => view.cycle.status === 'ACTIVE') : undefined
  const statusTone = billing.status === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : billing.status === 'NOT PAID' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-950'

  if (!persona) {
    return <>
      <PageHeader title="Overview" description="Your stay at Halili BH at a glance." />
      <EmptyState title="No tenant profile to show" description="The sample records do not include an active tenant yet. Restore sample records in the landlord workspace to preview this view." />
    </>
  }

  return <>
    <PageHeader title="Overview" description={`${monthLabel} · Your stay at Halili BH at a glance.`} />
    <PreviewNotice>This tenant workspace previews one fictional tenant’s existing records. Tenant sign-in is not part of this phase.</PreviewNotice>
    {persona.tenant.status === 'MOVED_OUT' && <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">This sample tenant has moved out. The payments and tenancy details below are retained historical records.</p>}
    <section aria-label="Room overview" className="mb-6">
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Your room</p>
              <h2 className="break-words text-5xl font-bold tracking-tight text-[var(--tint)] sm:text-6xl">{persona.room ? `Room ${persona.room.name}` : 'Not assigned'}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{persona.room ? roomCategoryLabel(persona.room.categoryId) : persona.tenant.name}</p>
              {persona.assignment && <p className="mt-2 text-sm text-muted-foreground">Staying since {formatDate(persona.assignment.startDate)}.</p>}
            </div>
            <div className="flex flex-wrap gap-2">{occupancy && <StatusBadge status={occupancy === 'OCCUPIED' ? 'Occupied' : occupancy === 'AVAILABLE' ? 'Available' : 'Under repair'} />}<StatusBadge status={persona.tenant.status === 'ACTIVE' ? 'Active' : 'Moved out'} /></div>
          </div>
          <h3 className="mt-6 mb-3 text-base font-semibold">{occupantTitle}</h3>
          {occupants.length > 0 ? <ul className="grid gap-3 sm:grid-cols-2">{occupants.map(tenant => <li key={tenant.id} className="flex min-w-0 items-center gap-3 rounded-2xl border bg-muted/30 p-4"><User className="size-5 shrink-0 text-[var(--tint)]" aria-hidden="true" /><span className="break-words font-semibold">{tenant.name}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No active occupants are recorded for the selected room.</p>}
        </CardContent>
      </Card>
    </section>
    <section aria-label="Move-in advance and security deposit" className="mb-6">
      <Card>
        <CardHeader><CardTitle>Move-in advance &amp; security deposit</CardTitle><CardDescription>Room-level amounts for this occupancy. Roommates share the same obligation; this is not a separate personal debt.</CardDescription></CardHeader>
        <CardContent>
          {moveIn ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border bg-muted/30 p-4"><p className="text-sm text-muted-foreground">Advance</p><p className="mt-1 text-lg font-bold">{formatMoney(moveIn.advancePaidCents)} paid of {formatMoney(moveIn.obligation.advanceRequiredCents)}</p><p className="mt-1 text-sm text-muted-foreground">{formatMoney(moveIn.advanceRemainingCents)} remaining</p><span className="move-in-status mt-2" data-status={moveIn.advanceStatus}>{moveIn.advanceStatus}</span></div>
              <div className="rounded-2xl border bg-muted/30 p-4"><p className="text-sm text-muted-foreground">Security deposit</p><p className="mt-1 text-lg font-bold">{formatMoney(moveIn.depositPaidCents)} paid of {formatMoney(moveIn.obligation.depositRequiredCents)}</p><p className="mt-1 text-sm text-muted-foreground">{formatMoney(moveIn.depositRemainingCents)} remaining</p><span className="move-in-status mt-2" data-status={moveIn.depositStatus}>{moveIn.depositStatus}</span></div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">The advance is not automatically used to pay a month. Deposit refund or deduction needs manual review. Monthly bills remain separate.</p>
          </> : <p className="text-sm leading-relaxed text-muted-foreground">No move-in advance or deposit obligation is recorded for the current room occupancy. Legacy tenancies do not receive invented deposit records.</p>}
        </CardContent>
      </Card>
    </section>
    <section aria-label="Monthly room billing">
      <Card>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-4"><div><CardTitle>Monthly payment status</CardTitle><CardDescription>Shared room billing, separate from your own payment receipts.</CardDescription></div><Badge role="status" className={`px-4 py-2 text-sm ${statusTone}`} variant="outline">{billing.status}</Badge></div></CardHeader>
        <CardContent>
          <label htmlFor="tenant-overview-period" className="mb-2 block text-sm font-semibold">Billing month</label>
          <select id="tenant-overview-period" value={period?.id ?? ''} onChange={event => setPeriodId(event.target.value)} className="min-h-12 max-w-full rounded-xl border bg-card px-3 text-base">{data.billingPeriods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <p className="mt-3 text-sm text-muted-foreground">{billing.detail}</p>
          {['PAID', 'PARTLY PAID', 'NOT PAID'].includes(billing.status) && <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Applicable room bills</dt><dd className="mt-1 font-semibold">{formatMoney(billing.billedCents)}</dd></div><div><dt className="text-muted-foreground">Applied to room bills</dt><dd className="mt-1 font-semibold">{formatMoney(billing.appliedCents)}</dd></div><div><dt className="text-muted-foreground">{billing.pendingCalculation ? 'Known outstanding' : 'Room outstanding'}</dt><dd className="mt-1 font-semibold">{formatMoney(billing.outstandingCents)}{billing.pendingCalculation && ' + electricity pending calculation'}</dd></div></dl>}
          {billing.unsettled.length > 0 && <section aria-label="Unpaid bills" className="mt-5"><h3 className="mb-3 font-semibold">Unpaid bills</h3><ul className="divide-y rounded-2xl border px-4">{billing.unsettled.map(item => <li key={item.category} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-semibold">{item.category === 'WASHING_MACHINE' ? 'Washing' : CATEGORY_LABELS[item.category]}</span><span>{item.outstandingCents > 0 && formatMoney(item.outstandingCents)}{item.outstandingCents > 0 && item.pendingCalculation && ' + '}{item.pendingCalculation && 'Pending calculation'}</span></li>)}</ul><p className="mt-3 text-xs text-muted-foreground">Issued rent keeps its applied rate snapshot. Water reflects the billed tenants; washing appears only when applicable. Electricity is not priced until a valid payment-time meter reading is confirmed in Billing.</p></section>}
        </CardContent>
      </Card>
    </section>
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Payment summary</CardTitle>
          <CardDescription>Your own recorded activity across all months. Roommates’ transactions are not included.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Payments made</dt><dd className="font-semibold"><AnimatedNumber value={payments.length} /></dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Receipts issued</dt><dd className="font-semibold"><AnimatedNumber value={receipts.length} /></dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Last payment</dt><dd className="font-semibold">{lastPayment ? formatDate(lastPayment.paidOn) : '—'}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Outstanding balance (issued personal bills)</dt><dd className="font-semibold">{account ? formatMoney(account.balance) : '—'}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Advance credit held</dt><dd className="font-semibold">{account ? formatMoney(account.credit) : '—'}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Account status</dt><dd>{account && <StatusBadge status={account.status} />}</dd></div>
          </dl>
          <Button variant="outline" className="mt-6" asChild><Link to="/tenant/payments">View My Payments &amp; Receipts <ArrowRight /></Link></Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Coming in a later phase</CardTitle>
          <CardDescription>The tenant workspace keeps growing after this layout phase.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4 text-sm text-muted-foreground">
            <li className="flex items-start gap-3"><Download className="mt-0.5 size-4 shrink-0 text-[var(--tint)]" aria-hidden="true" /><span><strong className="font-semibold text-foreground">Receipt downloads.</strong> Save or print a copy of each receipt.</span></li>
            <li className="flex items-start gap-3"><DoorOpen className="mt-0.5 size-4 shrink-0 text-[var(--tint)]" aria-hidden="true" /><span><strong className="font-semibold text-foreground">Room services.</strong> Request maintenance and manage your stay details.</span></li>
          </ul>
        </CardContent>
      </Card>
    </div>
  </>
}
