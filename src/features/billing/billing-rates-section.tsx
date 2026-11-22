import { useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Droplets, House, Pencil, WashingMachine, Zap, type LucideIcon } from 'lucide-react'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import {
  activeElectricityRate, activeRoomRentRates, activeWashingRate, activeWaterRate,
  scheduledElectricityRate, scheduledRoomRentRates, scheduledWashingRate, scheduledWaterRate,
} from '@/domain/calculations/billing-rates'
import { formatMoney, formatMonthYear } from '@/lib/format'
import { BillingRateDialog } from './billing-rate-dialog'

function RateCard({ title, icon: Icon, value, unit, detail, scheduled, renderDialog }: {
  title: string
  icon: LucideIcon
  value: string
  unit: string
  detail: string
  scheduled?: string
  renderDialog: (key: number) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [dialogVersion, setDialogVersion] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setDialogVersion(version => version + 1)
    setOpen(nextOpen)
    if (!nextOpen) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <button ref={triggerRef} type="button" className="billing-rate-card">
        <span className="billing-rate-card-top">
          <span className="billing-rate-icon"><Icon aria-hidden="true" /></span>
          <span className="billing-rate-edit"><Pencil aria-hidden="true" />Edit rate<ChevronRight aria-hidden="true" /></span>
        </span>{' '}
        <span className="billing-rate-category">{title}</span>{' '}
        <span className="billing-rate-value">{value}</span>{' '}
        <span className="billing-rate-unit">{unit}</span>{' '}
        <span className="billing-rate-detail">{detail}</span>{' '}
        {scheduled && <span className="billing-rate-scheduled">{scheduled}</span>}
      </button>
    </DialogTrigger>
    {renderDialog(dialogVersion)}
  </Dialog>
}

export function BillingRatesSection() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [notice, setNotice] = useState('')
  const rentRates = activeRoomRentRates(data, occupancyDate)
  const rentScheduled = scheduledRoomRentRates(data, occupancyDate)
  const electricity = activeElectricityRate(data, occupancyDate)
  const electricityScheduled = scheduledElectricityRate(data, occupancyDate)
  const water = activeWaterRate(data, occupancyDate)
  const waterScheduled = scheduledWaterRate(data, occupancyDate)
  const washing = activeWashingRate(data, occupancyDate)
  const washingScheduled = scheduledWashingRate(data, occupancyDate)

  const rentValue = rentRates.length > 0 ? rentRates.map(rate => formatMoney(rate.monthlyRentCents)).join(' · ') : 'No rate set'
  const rentSchedule = rentScheduled.length > 0
    ? `Scheduled ${formatMonthYear(rentScheduled[0]!.effectiveFrom)} · ${rentScheduled.map(rate => formatMoney(rate.monthlyRentCents)).join(' · ')}`
    : undefined

  function dialog(kind: 'RENT' | 'ELECTRICITY' | 'WATER' | 'WASHING_MACHINE', title: string) {
    return (key: number) => <BillingRateDialog key={key} kind={kind} title={title} onSaved={setNotice} />
  }

  return <section className="mt-8" aria-labelledby="billing-rates-title">
    <div className="billing-rates-heading">
      <div><h2 id="billing-rates-title" className="text-xl font-semibold">Billing Rates</h2><p className="mt-1 text-sm text-muted-foreground">Manage rates for upcoming billing periods.</p></div>
      <span className="billing-rates-period">Changes apply prospectively</span>
    </div>
    {notice && <p role="status" className="billing-rates-notice">{notice}</p>}
    <div className="billing-rate-grid">
      <RateCard
        title="Monthly Rent Rates" icon={House} value={rentValue} unit="per room per month"
        detail={`${rentRates.length} room-rate ${rentRates.length === 1 ? 'category' : 'categories'}. Each room keeps its assigned category.`}
        scheduled={rentSchedule}
        renderDialog={dialog('RENT', 'Monthly Rent Rates')}
      />
      <RateCard
        title="Electricity" icon={Zap} value={electricity ? formatMoney(electricity.rateCentsPerKwh) : 'No rate set'} unit="per kWh"
        detail="Applied to consumption from the last settled meter reading."
        scheduled={electricityScheduled ? `Scheduled ${formatMonthYear(electricityScheduled.effectiveFrom)} · ${formatMoney(electricityScheduled.rateCentsPerKwh)}` : undefined}
        renderDialog={dialog('ELECTRICITY', 'Electricity Rate')}
      />
      <RateCard
        title="Water" icon={Droplets} value={water ? formatMoney(water.rateCents) : 'No rate set'} unit="per tenant per billing period"
        detail="Charged for each tenant with an applicable bill."
        scheduled={waterScheduled ? `Scheduled ${formatMonthYear(waterScheduled.effectiveFrom)} · ${formatMoney(waterScheduled.rateCents)}` : undefined}
        renderDialog={dialog('WATER', 'Water Rate')}
      />
      <RateCard
        title="Washing Machine" icon={WashingMachine} value={washing ? formatMoney(washing.rateCents) : 'No rate set'} unit="per subscribed room per billing period"
        detail="Optional; only rooms with washing enabled receive this charge."
        scheduled={washingScheduled ? `Scheduled ${formatMonthYear(washingScheduled.effectiveFrom)} · ${formatMoney(washingScheduled.rateCents)}` : undefined}
        renderDialog={dialog('WASHING_MACHINE', 'Washing Machine Rate')}
      />
    </div>
    <p className="billing-rates-footnote">Existing bills, receipts, payments, and settled meter readings are never rewritten by a rate change. Electricity awaiting a reading is calculated when its reading is confirmed.</p>
  </section>
}
