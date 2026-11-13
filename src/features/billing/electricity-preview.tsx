import type { PrototypeAppState } from '@/domain/types/models'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/shared/data-table'
import { formatDate, formatMoney } from '@/lib/format'

export function ElectricityPreview({ data, periodId }: { data: PrototypeAppState; periodId: string }) {
  const charge = data.charges.find(c => c.category === 'ELECTRICITY' && c.billingPeriodId === periodId && c.state === 'ISSUED')
  return <section className="mt-7" aria-labelledby="electricity-foundation"><h2 id="electricity-foundation" className="mb-4 text-lg font-semibold">Electricity reading and rate foundations</h2>
    <div className="grid gap-5 xl:grid-cols-2"><Card className="shadow-none"><CardHeader><CardTitle>Issued sample charge snapshot</CardTitle><CardDescription>Ownership and shared-room allocation remain unconfirmed.</CardDescription></CardHeader><CardContent>
      {charge?.category === 'ELECTRICITY' ? <><dl className="grid grid-cols-2 gap-4 text-sm">{[
        ['Meter', data.electricityMeters.find(m => m.id === charge.electricity.meterId)?.label],
        ['Tenant example', data.tenants.find(t => t.id === charge.tenantId)?.name],
        ['Previous confirmed reading', `${charge.electricity.previousReadingMilliKwh / 1000} kWh`],
        ['Current confirmed reading', `${charge.electricity.currentReadingMilliKwh / 1000} kWh`],
        ['Consumption', `${charge.electricity.consumptionMilliKwh / 1000} kWh`],
        ['Applied rate', `${formatMoney(charge.electricity.appliedRateCentsPerKwh)} / kWh`],
        ['Rate effective date', formatDate(charge.electricity.appliedRateEffectiveFrom)],
        ['Issued charge', formatMoney(charge.amountCents)],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl><p className="mt-5 text-sm leading-relaxed text-muted-foreground">({charge.electricity.currentReadingMilliKwh / 1000} − {charge.electricity.previousReadingMilliKwh / 1000}) kWh × {formatMoney(charge.electricity.appliedRateCentsPerKwh)} = {formatMoney(charge.amountCents)}. This basis is stored on the charge, not recalculated from the latest rate.</p></> : <p className="text-sm text-muted-foreground">No applicable electricity charge in this sample period.</p>}
    </CardContent></Card>
    <Card className="shadow-none"><CardHeader><CardTitle>Sample rate history</CardTitle><CardDescription>Separate effective-dated records; later rates do not rewrite history.</CardDescription></CardHeader><CardContent><dl className="space-y-4 text-sm">{data.electricityRates.map(rate => <div key={rate.id} className="rounded-lg bg-muted p-3"><dt className="font-medium">{formatMoney(rate.rateCentsPerKwh)} / kWh · {formatDate(rate.effectiveFrom)}</dt><dd className="mt-1 text-muted-foreground">{rate.label}</dd></div>)}</dl><p className="mt-4 text-sm leading-relaxed text-muted-foreground">The future workflow will retrieve the previous confirmed reading before accepting a current reading. Meter entry, authorized corrections, and fractional-consumption rounding rules are not implemented.</p></CardContent></Card></div>
    <h3 className="mt-5 mb-3 font-semibold">Sample confirmed reading history</h3><DataTable rows={data.meterReadings} caption="Fictional electricity meter reading history" columns={[
      { key: 'meter', label: 'Meter', render: r => data.electricityMeters.find(m => m.id === r.meterId)?.label },
      { key: 'date', label: 'Reading date', render: r => formatDate(r.readOn) },
      { key: 'reading', label: 'Reading', render: r => `${r.readingMilliKwh / 1000} kWh` },
      { key: 'state', label: 'State', render: r => r.status },
      { key: 'actor', label: 'Confirmed by (demo)', render: r => r.confirmedBy ?? 'Not confirmed' },
    ]} />
  </section>
}
