import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, CalendarDays, DoorOpen, ReceiptText, User, Wallet } from 'lucide-react'
import { EmptyState } from '@/components/shared/states'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { useTenantDemo } from '@/app/providers/tenant-demo'
import { tenantAccount } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney, formatMonthYear } from '@/lib/format'
import { selectTenantPersona } from './tenant-persona'

export default function TenantOverview() {
  const { data } = usePrototype()
  const { tenantId } = useTenantDemo()
  const persona = selectTenantPersona(data, tenantId)
  const period = data.billingPeriods.find(item => item.status === 'OPEN') ?? data.billingPeriods.at(-1)
  const monthLabel = period ? formatMonthYear(period.startDate) : 'Not available'
  const account = persona ? tenantAccount(data, persona.tenant.id, DEMO_DATE) : null
  const payments = persona ? data.payments.filter(item => item.tenantId === persona.tenant.id && item.state === 'RECORDED' && item.paidOn <= DEMO_DATE) : []
  const receipts = persona ? data.receipts.filter(item => item.state === 'ISSUED' && payments.some(payment => payment.id === item.paymentId)) : []
  const lastPayment = [...payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn)).at(0)

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
    <section aria-label="Tenant summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Tenant" value={persona.tenant.name} detail="Sample tenant record for this preview." icon={User} />
      <StatCard label="Room" value={persona.room ? `Room ${persona.room.name}` : 'Not assigned'} detail={persona.room ? `Floor ${persona.room.floor} · staying since ${formatDate(persona.assignment!.startDate)}.` : persona.assignment ? `Staying since ${formatDate(persona.assignment.startDate)}.` : 'No active room assignment.'} icon={DoorOpen} />
      <StatCard label="Billing month" value={monthLabel} detail={period?.status === 'OPEN' ? 'Current open billing period.' : 'Closed billing period.'} icon={CalendarDays} />
      <StatCard label="Tenancy status" value={persona.tenant.status === 'ACTIVE' ? 'Active' : 'Moved out'} detail={persona.tenant.status === 'ACTIVE' ? 'Currently staying at Halili BH.' : 'No longer staying at Halili BH.'} icon={BadgeCheck} />
    </section>
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Payment summary</CardTitle>
          <CardDescription>Recorded activity from your existing sample records.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Payments made</dt><dd className="font-semibold"><AnimatedNumber value={payments.length} /></dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Receipts issued</dt><dd className="font-semibold"><AnimatedNumber value={receipts.length} /></dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Last payment</dt><dd className="font-semibold">{lastPayment ? formatDate(lastPayment.paidOn) : '—'}</dd></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><dt className="text-muted-foreground">Outstanding balance</dt><dd className="font-semibold">{account ? formatMoney(account.balance) : '—'}</dd></div>
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
            <li className="flex items-start gap-3"><ReceiptText className="mt-0.5 size-4 shrink-0 text-[var(--tint)]" aria-hidden="true" /><span><strong className="font-semibold text-foreground">Receipt viewing.</strong> Open and review the receipts issued for your payments.</span></li>
            <li className="flex items-start gap-3"><Wallet className="mt-0.5 size-4 shrink-0 text-[var(--tint)]" aria-hidden="true" /><span><strong className="font-semibold text-foreground">Bill details.</strong> See rent, electricity, water, and washing for your room per month.</span></li>
            <li className="flex items-start gap-3"><DoorOpen className="mt-0.5 size-4 shrink-0 text-[var(--tint)]" aria-hidden="true" /><span><strong className="font-semibold text-foreground">Room services.</strong> Request maintenance and manage your stay details.</span></li>
          </ul>
        </CardContent>
      </Card>
    </div>
  </>
}
