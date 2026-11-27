import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, DoorOpen, User } from 'lucide-react'
import { EmptyState } from '@/components/shared/states'
import { PageHeader, PreviewNotice } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { StatusBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { useTenantDemo } from '@/app/providers/tenant-demo'
import { useOptionalAuth } from '@/app/providers/auth'
import { roomOccupants, roomOccupancy, tenantAccount } from '@/domain/calculations/summary'
import { selectMoveInObligations } from '@/domain/calculations/move-in'
import { selectRentCycleReport } from '@/domain/calculations/rent-reporting'
import { rentPrepaymentStarts } from '@/domain/calculations/rent-schedule'
import { formatDate, formatMoney, formatMonthYear, previousCalendarDate } from '@/lib/format'
import { selectTenantPersona } from './tenant-persona'
import { tenantRoomBilling } from './tenant-room-billing'
import { selectTenantReceipts } from './tenant-receipts'
import { roomCategoryLabel } from '@/lib/room-rates'
import { CATEGORY_LABELS } from '@/lib/labels'

export default function TenantOverview() {
  const { data } = usePrototype()
  const { tenantId } = useTenantDemo()
  const auth = useOptionalAuth()
  const occupancyDate = useOccupancyDate()
  const persona = selectTenantPersona(data, tenantId, occupancyDate)
  const defaultPeriod = data.billingPeriods.find(item => item.startDate <= occupancyDate && item.endDate >= occupancyDate) ?? data.billingPeriods.at(-1)
  const [periodId, setPeriodId] = useState(defaultPeriod?.id ?? '')
  const period = data.billingPeriods.find(item => item.id === periodId) ?? defaultPeriod
  const monthLabel = period ? formatMonthYear(period.startDate) : 'Not available'
  const account = persona ? tenantAccount(data, persona.tenant.id, occupancyDate) : null
  const sharedReceipts = persona ? selectTenantReceipts(data, persona.tenant.id).receipts : []
  const effectiveReceipts = sharedReceipts.filter(item => item.effective)
  const payments = [...new Map(sharedReceipts.map(item => [item.payment.id, item.payment])).values()]
    .filter(item => item.state === 'RECORDED' && item.paidOn <= occupancyDate)
  const lastPayment = [...payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn)).at(0)
  const occupants = persona?.room ? roomOccupants(data, persona.room.id, occupancyDate).filter(tenant => tenant.status === 'ACTIVE') : []
  const occupantTitle = occupants.length === 0 ? 'No current tenants' : occupants.length === 1 ? 'Tenant' : 'Tenants'
  const occupancy = persona?.room ? roomOccupancy(data, persona.room, occupancyDate) : null
  const billing = tenantRoomBilling(data, tenantId, persona?.room?.id ?? null, period?.id ?? '', occupancyDate)
  const moveIn = persona?.room ? selectMoveInObligations(data, occupancyDate, persona.room.id).find(view => view.cycle.status === 'ACTIVE') : undefined
  const activeCycle = persona?.room ? data.occupancyCycles.find(cycle => cycle.roomId === persona.room!.id && cycle.status === 'ACTIVE' && cycle.startedAt <= occupancyDate) : undefined
  const rentCoverage = activeCycle ? selectRentCycleReport(data, activeCycle.id, occupancyDate) : null
  const prepaidPeriodIds = new Set(activeCycle ? data.rentPrepayments.filter(item => item.occupancyCycleId === activeCycle.id).flatMap(item => item.rentalPeriodIds) : [])
  const nextRent = persona?.room ? rentPrepaymentStarts(data, persona.room.id, occupancyDate)[0] : undefined
  const statusTone = billing.status === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : billing.status === 'NOT PAID' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-950'

  if (!persona) {
    return <>
      <PageHeader title="Overview" description="Your stay at Halili BH at a glance." />
      <EmptyState title="No tenant profile to show" description="No active tenant record is available yet. Ask the landlord to add a tenant before previewing this view." />
    </>
  }

  return <>
    <PageHeader title="Overview" description={`${monthLabel} · Your stay at Halili BH at a glance.`} />
    {!auth?.enabled && <PreviewNotice>This is a demo preview of one tenant's existing records.</PreviewNotice>}
    {persona.tenant.status === 'MOVED_OUT' && <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">This tenant has moved out. The payments and tenancy details below are retained historical records.</p>}
    <section aria-label="Room overview" className="mb-6">
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Your room</p>
              <h2 className="break-words text-5xl font-bold tracking-tight text-[var(--tint)] sm:text-6xl">{persona.room ? `Room ${persona.room.name}` : 'Not assigned'}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{persona.room ? roomCategoryLabel(persona.room.categoryId) : persona.tenant.name}</p>
              {persona.assignment && <p className="mt-2 text-sm text-muted-foreground">Staying since {formatDate(persona.assignment.startDate)}.</p>}
            </div>
            <div className="flex flex-wrap gap-2">{occupancy && <StatusBadge status={occupancy === 'OCCUPIED' ? 'Occupied' : occupancy === 'RESERVED' ? 'Reserved' : occupancy === 'AVAILABLE' ? 'Available' : 'Under repair'} />}<StatusBadge status={persona.tenant.status === 'ACTIVE' ? 'Active' : 'Moved out'} /></div>
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
              <div className="rounded-2xl border bg-muted/30 p-4"><p className="text-sm text-muted-foreground">{moveIn.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Security deposit (non-refundable)' : 'Security deposit'}</p><p className="mt-1 text-lg font-bold">{formatMoney(moveIn.depositPaidCents)} paid of {formatMoney(moveIn.obligation.depositRequiredCents)}</p><p className="mt-1 text-sm text-muted-foreground">{formatMoney(moveIn.depositRemainingCents)} remaining</p><span className="move-in-status mt-2" data-status={moveIn.depositStatus}>{moveIn.depositStatus}</span></div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">The mandatory advance is the first anniversary rental period’s rent; that period is marked {moveIn.firstRentStatus === 'PAID' ? 'PAID' : 'unpaid until the advance is received'}. {moveIn.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'The security deposit is non-refundable and is not counted as rent income. No refund, forfeiture, or income recognition is posted automatically.' : 'Deposit refund or deduction needs manual review.'} Later monthly periods remain separate.</p>
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
          {billing.categories.length > 0 && <section aria-label="Bill categories" className="mt-5"><h3 className="mb-3 font-semibold">Bill categories</h3><ul className="divide-y rounded-2xl border px-4">{billing.categories.map(item => <li key={item.category} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-semibold">{item.category === 'WASHING_MACHINE' ? 'Washing' : CATEGORY_LABELS[item.category]}</span><span className="flex flex-wrap items-center justify-end gap-3"><span className="move-in-status" data-status={item.status === 'PAID' ? 'PAID' : item.status === 'PARTLY PAID' ? 'PARTLY PAID' : 'NOT PAID'}>{item.status}</span>{item.status !== 'PAID' && item.status !== 'DID NOT AVAIL' && item.status !== 'NO BILL' && item.status !== 'AWAITING READING' && <span className="tabular-nums">{formatMoney(item.outstandingCents)} outstanding</span>}</span></li>)}</ul><p className="mt-3 text-xs text-muted-foreground">Room-level status derived from the same issued charges and allocations as landlord Billing. Electricity is not priced until a valid payment-time meter reading is confirmed. Washing appears as not availed when the room has no subscription.</p></section>}
        </CardContent>
      </Card>
    </section>
    {rentCoverage && <section aria-label="Rent coverage" className="mt-6">
      <Card>
        <CardHeader><CardTitle>Rent coverage</CardTitle><CardDescription>Anniversary periods covered by the move-in advance or prepaid rent. Rent is room-level and shared with authorized occupants.</CardDescription></CardHeader>
        <CardContent>
          <p className="text-sm"><span className="text-muted-foreground">Next unpaid rent period:</span> <strong>{nextRent ? `${formatDate(nextRent.startDate)} – ${formatDate(previousCalendarDate(nextRent.endDateExclusive))}` : 'No unpaid period in the current schedule'}</strong></p>
          <ul className="mt-4 divide-y rounded-2xl border px-4">
            {rentCoverage.periods.map(item => <li key={item.period.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span className="min-w-0"><strong>{formatDate(item.period.startDate)} – {formatDate(previousCalendarDate(item.period.endDateExclusive))}</strong><small className="block text-xs text-muted-foreground">Due {formatDate(item.period.dueDate)}</small></span>
              <span className="flex flex-wrap items-center justify-end gap-3">
                <span className="move-in-status" data-status={item.status === 'PAID' ? 'PAID' : item.status === 'PARTIALLY_PAID' ? 'PARTLY PAID' : 'NOT PAID'}>{item.status === 'PAID' ? 'PAID' : item.status === 'PARTIALLY_PAID' ? 'PARTLY PAID' : 'NOT PAID'}</span>
                <span className="text-xs text-muted-foreground">{item.advanceAppliedCents > 0 ? 'Move-in advance' : prepaidPeriodIds.has(item.period.id) ? 'Prepaid rent' : item.cashPaidCents > 0 ? 'Rent payment' : 'Unpaid'}</span>
                <span className="font-semibold tabular-nums">{formatMoney(item.amountCents)}</span>
              </span>
            </li>)}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Receipts list each covered period and its collection date. A prepaid period is not counted as new cash when its future month begins.</p>
          <Button variant="outline" className="mt-4" asChild><Link to="/tenant/payments">View payment dates and receipts <ArrowRight /></Link></Button>
        </CardContent>
      </Card>
    </section>}
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Payment summary</CardTitle>
          <CardDescription>Room-level payment activity is shared with authorized occupants. Private account details of other tenants are not shown.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Payments made</dt><dd className="font-semibold"><AnimatedNumber value={payments.length} /></dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Receipts issued</dt><dd className="font-semibold"><AnimatedNumber value={effectiveReceipts.length} /></dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Last payment</dt><dd className="font-semibold">{lastPayment ? formatDate(lastPayment.paidOn) : '-'}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Outstanding balance</dt><dd className="font-semibold">{formatMoney(billing.outstandingCents)}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Advance credit held</dt><dd className="font-semibold">{account ? formatMoney(account.credit) : '-'}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Account status</dt><dd>{account && <StatusBadge status={account.status} />}</dd></div>
          </dl>
          <Button variant="outline" className="mt-6" asChild><Link to="/tenant/payments">View My Payments &amp; Receipts <ArrowRight /></Link></Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Account &amp; support</CardTitle>
          <CardDescription>Manage your access or ask your landlord about your stay.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button variant="outline" asChild><Link to="/account-security">Account security <ArrowRight /></Link></Button>
          <Button variant="outline" asChild><Link to="/tenant/room"><DoorOpen /> Request a room change</Link></Button>
          <p className="text-sm text-muted-foreground">For billing questions or other account help, contact your landlord directly.</p>
        </CardContent>
      </Card>
    </div>
  </>
}
