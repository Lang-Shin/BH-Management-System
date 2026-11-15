import type { PrototypeAppState } from '@/domain/types/models'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/shared/data-table'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { formatDate, formatMoney } from '@/lib/format'

export function ElectricityPreview({ data, periodId }: { data: PrototypeAppState; periodId: string }) {
  const charge = data.charges.find(c => c.category === 'ELECTRICITY' && c.billingPeriodId === periodId && c.state === 'ISSUED')
  return <details className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">View electricity readings and prices</summary>
    <div className="mt-5 grid gap-5 2xl:grid-cols-2"><Card className="shadow-none"><CardHeader><CardTitle>Electricity bill</CardTitle><CardDescription>See how this sample amount was worked out.</CardDescription></CardHeader><CardContent>
      {charge?.category === 'ELECTRICITY' ? <><dl className="grid gap-5 text-base sm:grid-cols-2">{([
        ['Tenant', data.tenants.find(t => t.id === charge.tenantId)?.name],
        ['Meter', data.electricityMeters.find(m => m.id === charge.electricity.meterId)?.label],
        ['Last reading', <AnimatedNumber value={`${charge.electricity.previousReadingMilliKwh / 1000} kWh`} />],
        ['New reading', <AnimatedNumber value={`${charge.electricity.currentReadingMilliKwh / 1000} kWh`} />],
        ['Electricity used', <AnimatedNumber value={`${charge.electricity.consumptionMilliKwh / 1000} kWh`} />],
        ['Price per kWh', <AnimatedNumber value={formatMoney(charge.electricity.appliedRateCentsPerKwh)} />],
        ['Price started on', formatDate(charge.electricity.appliedRateEffectiveFrom)],
        ['Amount to pay', <AnimatedNumber value={formatMoney(charge.amountCents)} />],
      ] as const).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-2 font-semibold">{value}</dd></div>)}</dl><p className="mt-6 text-base"><AnimatedNumber value={`${charge.electricity.consumptionMilliKwh / 1000} kWh`} /> × <AnimatedNumber value={formatMoney(charge.electricity.appliedRateCentsPerKwh)} /> = <strong><AnimatedNumber value={formatMoney(charge.amountCents)} /></strong></p><p className="mt-3 text-sm text-muted-foreground">Changing the price later will not change this bill.</p></> : <p className="text-base text-muted-foreground">There is no electricity bill for this month.</p>}
    </CardContent></Card>
    <Card className="shadow-none"><CardHeader><CardTitle>Electricity prices</CardTitle><CardDescription>Each price has its own starting date.</CardDescription></CardHeader><CardContent><dl className="space-y-4 text-base">{data.electricityRates.map(rate => <div key={rate.id} className="rounded-lg bg-muted p-4"><dt className="font-semibold"><AnimatedNumber value={formatMoney(rate.rateCentsPerKwh)} /> per kWh</dt><dd className="mt-2 text-sm text-muted-foreground">Starting {formatDate(rate.effectiveFrom)}</dd></div>)}</dl><p className="mt-5 text-sm text-muted-foreground">Who uses each meter and how shared electricity is divided still need to be agreed.</p></CardContent></Card></div>
    <h2 className="mt-6 mb-4 text-xl font-semibold">Past meter readings</h2><DataTable rows={data.meterReadings} caption="Past meter readings" columns={[
      { key: 'meter', label: 'Meter', render: r => data.electricityMeters.find(m => m.id === r.meterId)?.label },
      { key: 'date', label: 'Date', render: r => formatDate(r.readOn) },
      { key: 'reading', label: 'Reading', render: r => `${r.readingMilliKwh / 1000} kWh` },
    ]} />
  </details>
}
