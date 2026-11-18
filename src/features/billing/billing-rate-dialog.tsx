import { useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarClock, Check, History, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import {
  activeElectricityRate, activeRoomRentRate, activeWashingRate, activeWaterRate,
  nextRateEffectiveFrom, parseRateInput, planRateChange, ROOM_RATE_CATEGORY_IDS,
  type RatePlan, type RatePlanInput,
} from '@/domain/calculations/billing-rates'
import { formatDate, formatMoney, formatMonthYear } from '@/lib/format'
import { roomCategoryLabel } from '@/lib/room-rates'
import type { ChargeCategory, RoomCategoryId } from '@/domain/types/models'

const unitLabels: Record<ChargeCategory, string> = {
  RENT: 'per room per month',
  ELECTRICITY: 'per kWh',
  WATER: 'per tenant per billing period',
  WASHING_MACHINE: 'per subscribed room per billing period',
}

const currentRentRateLabels: Record<RoomCategoryId, string> = {
  RATE_3500: 'Rate Category 1 · Public CR',
  RATE_4000: 'Rate Category 2 · Private CR',
  RATE_5000: 'Rate Category 3 · Private CR + Aircon',
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

function utilityCents(rate: { rateCentsPerKwh: number } | { rateCents: number } | undefined): number | undefined {
  return rate ? ('rateCentsPerKwh' in rate ? rate.rateCentsPerKwh : rate.rateCents) : undefined
}

export function BillingRateDialog({ kind, title, onSaved }: { kind: ChargeCategory; title: string; onSaved: (message: string) => void }) {
  const { data, dispatch } = usePrototype()
  const effectiveFrom = nextRateEffectiveFrom(data, DEMO_DATE)
  const activeRentRates = ROOM_RATE_CATEGORY_IDS.map(categoryId => ({ categoryId, rate: activeRoomRentRate(data, categoryId, DEMO_DATE) }))
  const activeUtility = kind === 'ELECTRICITY' ? activeElectricityRate(data, DEMO_DATE)
    : kind === 'WATER' ? activeWaterRate(data, DEMO_DATE)
      : kind === 'WASHING_MACHINE' ? activeWashingRate(data, DEMO_DATE) : undefined
  const activeUtilityCents = utilityCents(activeUtility)
  const scheduledRentRates = data.roomRentRates.filter(rate => rate.effectiveFrom === effectiveFrom)
  const scheduledUtility = kind === 'ELECTRICITY' ? data.electricityRates.find(rate => rate.effectiveFrom === effectiveFrom)
    : kind === 'WATER' ? data.waterRates.find(rate => rate.effectiveFrom === effectiveFrom)
      : kind === 'WASHING_MACHINE' ? data.washingRates.find(rate => rate.effectiveFrom === effectiveFrom) : undefined
  const initialValues: Record<string, string> = kind === 'RENT'
    ? Object.fromEntries(ROOM_RATE_CATEGORY_IDS.map(categoryId => {
        const scheduled = scheduledRentRates.find(rate => rate.categoryId === categoryId)
        const current = activeRentRates.find(item => item.categoryId === categoryId)?.rate
        return [categoryId, centsToInput(scheduled?.monthlyRentCents ?? current?.monthlyRentCents ?? 0)]
      }))
    : { amount: centsToInput(utilityCents(scheduledUtility) ?? utilityCents(activeUtility) ?? 0) }
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [mode, setMode] = useState<'edit' | 'review'>('edit')
  const [plan, setPlan] = useState<RatePlan | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submitting = useRef(false)
  const hasScheduled = kind === 'RENT' ? scheduledRentRates.length > 0 : Boolean(scheduledUtility)

  const history = kind === 'RENT'
    ? [...data.roomRentRates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    : kind === 'ELECTRICITY' ? [...data.electricityRates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
      : kind === 'WATER' ? [...data.waterRates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
        : [...data.washingRates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
  const activeIds = new Set(kind === 'RENT'
    ? activeRentRates.flatMap(item => item.rate ? [item.rate.id] : [])
    : activeUtility ? [activeUtility.id] : [])

  function updateValue(key: string, value: string) {
    setValues(current => ({ ...current, [key]: value }))
    setErrors({})
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    let input: RatePlanInput
    if (kind === 'RENT') {
      const rentValues = {} as Record<RoomCategoryId, number>
      for (const categoryId of ROOM_RATE_CATEGORY_IDS) {
        const parsed = parseRateInput(values[categoryId] ?? '')
        if (!parsed.ok) nextErrors[categoryId] = parsed.message
        else rentValues[categoryId] = parsed.cents
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors)
        return
      }
      input = { kind: 'RENT', values: rentValues }
    } else {
      const parsed = parseRateInput(values.amount ?? '')
      if (!parsed.ok) {
        setErrors({ amount: parsed.message })
        return
      }
      input = { kind, amountCents: parsed.cents }
    }
    const result = planRateChange(data, input, DEMO_DATE)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setPlan(result.plan)
    setMode('review')
  }

  function confirm() {
    if (!plan || submitting.current) return
    submitting.current = true
    dispatch({ type: 'rates/planned', plan })
    onSaved(`Billing rates for ${formatMonthYear(plan.effectiveFrom)} were scheduled. Existing bills and receipts were not changed.`)
  }

  function rateHistoryAmount(rate: typeof history[number]): string {
    if ('monthlyRentCents' in rate) return formatMoney(rate.monthlyRentCents)
    return formatMoney(utilityCents(rate) ?? 0)
  }

  return <DialogContent className="billing-rate-dialog sm:max-w-xl" aria-describedby="billing-rate-description">
    {mode === 'edit' ? <form onSubmit={review} noValidate>
      <DialogHeader className="pr-6">
        <span className="billing-rate-dialog-icon"><CalendarClock aria-hidden="true" /></span>
        <DialogTitle>Edit {title}</DialogTitle>
        <DialogDescription id="billing-rate-description">Review the current rate and schedule a new rate for the next billing period.</DialogDescription>
      </DialogHeader>

      <section className="billing-rate-dialog-section" aria-labelledby="current-rate-title">
        <h2 id="current-rate-title">Current rate</h2>
        {kind === 'RENT'
          ? <dl className="billing-rate-current-list">{activeRentRates.map(({ categoryId, rate }) => <div key={categoryId}><dt>{currentRentRateLabels[categoryId]}</dt><dd>{rate ? `${formatMoney(rate.monthlyRentCents)}/month` : 'Rate needs review'}</dd></div>)}</dl>
          : <p className="billing-rate-current-value">{activeUtilityCents != null ? formatMoney(activeUtilityCents) : 'Rate needs review'}<span>{unitLabels[kind]}</span></p>}
      </section>

      <section className="billing-rate-dialog-section" aria-labelledby="new-rate-title">
        <h2 id="new-rate-title">{kind === 'RENT' ? 'New monthly rates' : 'New rate'}</h2>
        {kind === 'RENT'
          ? <div className="billing-rate-inputs">{ROOM_RATE_CATEGORY_IDS.map((categoryId, index) => {
              const roomCount = data.rooms.filter(room => room.categoryId === categoryId).length
              return <div className="grid gap-2" key={categoryId}>
                <label htmlFor={`rent-rate-${categoryId}`} className="text-sm font-semibold">{roomCategoryLabel(categoryId)} <span className="font-normal text-muted-foreground">· {roomCount} {roomCount === 1 ? 'room' : 'rooms'}</span></label>
                <div className="billing-rate-input-wrap"><span aria-hidden="true">₱</span><input id={`rent-rate-${categoryId}`} type="text" inputMode="decimal" value={values[categoryId] ?? ''} onChange={event => updateValue(categoryId, event.target.value)} aria-invalid={Boolean(errors[categoryId])} aria-describedby={errors[categoryId] ? `rent-rate-${categoryId}-error` : undefined} autoFocus={index === 0} /></div>
                {errors[categoryId] && <p id={`rent-rate-${categoryId}-error`} role="alert" className="text-sm text-destructive">{errors[categoryId]}</p>}
              </div>
            })}</div>
          : <div className="grid gap-2">
              <label htmlFor="billing-rate-amount" className="text-sm font-semibold">New rate {unitLabels[kind]}</label>
              <div className="billing-rate-input-wrap"><span aria-hidden="true">₱</span><input id="billing-rate-amount" type="text" inputMode="decimal" value={values.amount ?? ''} onChange={event => updateValue('amount', event.target.value)} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'billing-rate-amount-error' : undefined} autoFocus /></div>
              {errors.amount && <p id="billing-rate-amount-error" role="alert" className="text-sm text-destructive">{errors.amount}</p>}
            </div>}
        {errors.general && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
        {hasScheduled && <p className="billing-rate-scheduled-note">A scheduled change already exists for {formatMonthYear(effectiveFrom)}. Reviewing replaces that scheduled amount; historical records remain intact.</p>}
      </section>

      <section className="billing-rate-dialog-section" aria-labelledby="effective-period-title">
        <h2 id="effective-period-title">Effective billing period</h2>
        <div className="billing-rate-effective"><strong>{formatMonthYear(effectiveFrom)}</strong><span>Starts {formatDate(effectiveFrom)}</span></div>
        <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />Historical bills, receipts, payments, and settled electricity readings keep their original rates. The active rate does not change until this date.</p>
      </section>

      <details className="billing-rate-history">
        <summary><History aria-hidden="true" />Rate history</summary>
        <ul>{history.map(rate => {
          const status = rate.effectiveFrom > DEMO_DATE ? 'Scheduled' : activeIds.has(rate.id) ? 'Active' : 'Historical'
          const label = kind === 'RENT' && 'categoryId' in rate ? roomCategoryLabel(rate.categoryId) : kind === 'ELECTRICITY' ? 'Electricity' : kind === 'WATER' ? 'Water' : 'Washing machine'
          return <li key={rate.id}><span>{label}<small>{formatDate(rate.effectiveFrom)} · Recorded {formatDate(rate.recordedOn)}</small></span><span>{rateHistoryAmount(rate)}<small>{status}</small></span></li>
        })}</ul>
      </details>

      <DialogFooter className="mt-5"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit">Review Changes</Button></DialogFooter>
    </form> : plan && <>
      <DialogHeader className="pr-6">
        <span className="billing-rate-dialog-icon"><Check aria-hidden="true" /></span>
        <DialogTitle>Review Changes</DialogTitle>
        <DialogDescription id="billing-rate-description">Nothing has been saved yet. Confirm the prospective rate change below.</DialogDescription>
      </DialogHeader>
      <section className="billing-rate-dialog-section">
        <dl className="billing-rate-review">
          {plan.changes.map(change => <div key={change.key}><dt>{change.label}{change.roomCount != null ? ` · ${change.roomCount} ${change.roomCount === 1 ? 'room' : 'rooms'}` : ''}</dt><dd><span><small>Previous</small><del>{formatMoney(change.previousCents)}</del></span><span><small>New</small><strong>{formatMoney(change.newCents)}</strong></span><small>{change.unit}</small></dd></div>)}
          <div><dt>Effective billing period</dt><dd><strong>{formatMonthYear(plan.effectiveFrom)}</strong><small>Starts {formatDate(plan.effectiveFrom)}</small></dd></div>
        </dl>
        <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />This only changes future rate configuration. Existing bills, receipts, payments, and settled electricity readings remain unchanged.</p>
      </section>
      <DialogFooter className="mt-5"><Button variant="outline" onClick={() => { setMode('edit'); setPlan(null) }}><ArrowLeft aria-hidden="true" />Back</Button><DialogClose asChild><Button onClick={confirm}>Confirm Changes</Button></DialogClose></DialogFooter>
    </>}
  </DialogContent>
}
