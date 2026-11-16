import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, Calculator, Check, Droplets, House, WashingMachine, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import type { ChargeCategory } from '@/domain/types/models'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import { buildRoomPaymentQuote, prepareRoomPayment, roomPaymentCategories, type RoomPaymentResult } from '@/domain/calculations/room-payment'
import { parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

const icons = { RENT: House, ELECTRICITY: Zap, WATER: Droplets, WASHING_MACHINE: WashingMachine }
const emptySelection: ChargeCategory[] = []

function electricityError(code: string | undefined) {
  switch (code) {
    case 'READING_BELOW_PREVIOUS': return 'Current reading cannot be lower than the last settled reading.'
    case 'READING_NOT_ADVANCED': return 'Current reading must be higher than the last settled reading.'
    case 'READING_DATE_INVALID': return 'The payment date must be after the last settled reading date.'
    case 'RATE_NOT_FOUND': return 'No electricity rate applies to this payment date.'
    case 'DUPLICATE_INTERVAL': return 'This meter interval was already billed.'
    case 'INVALID_AMOUNT': return 'This reading produces an amount the prototype cannot represent safely.'
    default: return 'Enter a valid current reading to calculate electricity.'
  }
}

export function PaymentCalculator({ periodId, periodLabel }: { periodId: string; periodLabel: string }) {
  const { data, dispatch } = usePrototype()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'calculator' | 'confirm' | 'success'>('calculator')
  const [roomId, setRoomId] = useState('')
  const [selected, setSelected] = useState<ChargeCategory[]>(emptySelection)
  const [reading, setReading] = useState('')
  const [preview, setPreview] = useState<Extract<RoomPaymentResult, { ok: true }> | null>(null)
  const [submitError, setSubmitError] = useState('')
  const roomIds = new Set(selectRoomFinance(data, DEMO_DATE, periodId).map(row => row.context.roomId).filter((id): id is string => Boolean(id)))
  const rooms = data.rooms.filter(room => roomIds.has(room.id))
  const parsedReading = reading === '' ? null : parseMeterReadingMilliKwh(reading)
  const readingError = reading !== '' && parsedReading === null ? 'Enter a non-negative reading with up to three decimal places.' : null
  const quote = roomId ? buildRoomPaymentQuote(data, { roomId, periodId, selected, electricityReadingMilliKwh: parsedReading, asOf: DEMO_DATE }) : null
  const electricityOption = quote?.options.find(option => option.category === 'ELECTRICITY')
  const electricityErrorText = electricityOption?.state === 'INVALID_READING'
    ? electricityError(quote?.electricity?.error) : null
  const canReview = Boolean(quote?.canConfirm && !readingError)

  function reset() {
    setStep('calculator')
    setRoomId('')
    setSelected(emptySelection)
    setReading('')
    setPreview(null)
    setSubmitError('')
  }

  function changeOpen(next: boolean) {
    if (next) reset()
    setOpen(next)
  }

  function chooseRoom(nextRoomId: string) {
    setRoomId(nextRoomId)
    setSelected(emptySelection)
    setReading('')
    setPreview(null)
    setSubmitError('')
  }

  function toggle(category: ChargeCategory) {
    setSelected(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category])
    setPreview(null)
    setSubmitError('')
  }

  function review() {
    if (!quote || !roomId) return
    const result = prepareRoomPayment(data, { roomId, periodId, selected, electricityReadingMilliKwh: parsedReading, asOf: DEMO_DATE })
    if (!result.ok) {
      setSubmitError(result.reason === 'ELECTRICITY_READING_REQUIRED' ? 'Enter a valid current electricity reading before continuing.' : 'These bills changed. Close and reopen the calculator.')
      return
    }
    setPreview(result)
    setStep('confirm')
  }

  function confirm() {
    if (!roomId) return
    const result = prepareRoomPayment(data, { roomId, periodId, selected, electricityReadingMilliKwh: parsedReading, asOf: DEMO_DATE })
    if (!result.ok) {
      setSubmitError('This payment could not be recorded because the underlying bills changed. Cancelling has not advanced the meter.')
      return
    }
    dispatch({ type: 'room/paymentConfirmed', roomId, periodId, selected, electricityReadingMilliKwh: parsedReading, asOf: DEMO_DATE })
    setPreview(result)
    setStep('success')
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <button type="button" className="payment-launcher">
        <span className="payment-launcher-icon"><Calculator aria-hidden="true" /></span>
        <span className="text-left"><span className="block font-bold">Calculate payment</span><span className="block text-xs opacity-85">Room-based, calculated for you</span></span>
        <ArrowUpRight className="ml-2 size-5 shrink-0" aria-hidden="true" />
      </button>
    </DialogTrigger>
    <DialogContent className="payment-calculator" aria-describedby="payment-calculator-description">
      {step === 'calculator' && <form onSubmit={event => { event.preventDefault(); if (canReview) review() }}>
        <div className="payment-calculator-heading">
          <span className="payment-eyebrow">PAYMENT STUDIO · PHP</span>
          <DialogTitle className="mt-2 text-2xl">Choose a room and its bills.</DialogTitle>
          <DialogDescription id="payment-calculator-description" className="mt-2">Select the bills this room is paying. Amounts are calculated from the sample billing rules.</DialogDescription>
          <p className="mt-2 text-xs text-muted-foreground">{periodLabel} · Only this billing period is included; older pending periods remain in Pending Payments.</p>
        </div>
        <div className="payment-calculator-body">
          <label htmlFor="payment-room" className="mb-2 block text-sm font-semibold">Choose room</label>
          <select id="payment-room" value={roomId} onChange={event => chooseRoom(event.target.value)} className="payment-tenant-select">
            <option value="">Choose a room</option>
            {rooms.map(room => <option key={room.id} value={room.id}>Room {room.name}</option>)}
          </select>

          {roomId && quote && <fieldset className="room-payment-options">
            <legend className="sr-only">Bills to pay</legend>
            {roomPaymentCategories.map(category => {
              const option = quote.options.find(item => item.category === category)!
              const Icon = icons[category]
              const selectable = ['SELECTABLE', 'AWAITING_READING', 'INVALID_READING'].includes(option.state)
              const checked = selected.includes(category)
              return <div key={category} className="room-payment-option" data-state={option.state}>
                <label className="room-payment-option-label">
                  <input type="checkbox" checked={checked} disabled={!selectable} onChange={() => toggle(category)} aria-label={CATEGORY_LABELS[category]} />
                  <span className="payment-category-icon"><Icon className="size-[18px]" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold">{CATEGORY_LABELS[category]}{category === 'WASHING_MACHINE' && <span className="ml-2 text-xs font-medium text-muted-foreground">Optional</span>}</span><span className="mt-0.5 block text-xs text-muted-foreground">{option.detail}{category === 'ELECTRICITY' && quote.electricity ? ` · Last settled ${quote.electricity.previousReadingMilliKwh / 1000} kWh on ${formatDate(quote.electricity.previousReadOn)}` : ''}</span></span>
                  <span className="shrink-0 text-right font-semibold tabular-nums">{option.state === 'PAID' ? 'Paid' : option.state === 'UNAVAILABLE' ? option.detail : option.amountCents == null ? 'Amount pending calculation' : formatMoney(option.amountCents)}</span>
                </label>
                {category === 'ELECTRICITY' && checked && <div className="room-payment-electricity">
                  <label htmlFor="room-electricity-reading" className="text-sm font-semibold">Current meter reading (kWh)</label>
                  <input id="room-electricity-reading" type="text" inputMode="decimal" maxLength={14} value={reading} onChange={event => { setReading(event.target.value); setPreview(null); setSubmitError('') }} aria-invalid={Boolean(readingError || electricityErrorText)} aria-describedby={readingError || electricityErrorText ? 'room-electricity-error' : undefined} className="electricity-reading-input" />
                  <p className="text-xs text-muted-foreground">Rate {quote.electricity ? `${formatMoney(quote.electricity.rateCentsPerKwh)} per kWh` : 'unavailable'} · Consumption is billed from the last settled reading.</p>
                  {quote.electricity?.consumptionMilliKwh != null && <p className="text-sm font-semibold">{quote.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(quote.electricity.rateCentsPerKwh)} = {formatMoney(quote.electricity.amountCents ?? 0)}</p>}
                  {(readingError || electricityErrorText) && <p id="room-electricity-error" role="alert" className="text-sm text-destructive">{readingError ?? electricityErrorText}</p>}
                </div>}
              </div>
            })}
          </fieldset>}
          {submitError && <p role="alert" className="mt-3 text-sm text-destructive">{submitError}</p>}
          <p className="mt-3 text-xs text-muted-foreground">Paid bills are disabled. Electricity remains uncalculated until a valid reading is entered.</p>
        </div>
        <div className="payment-total-panel">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-sm opacity-85">Total to pay</p><output aria-label="Total to pay" aria-live="polite" aria-atomic="true" className="payment-total-value">{quote && quote.selected.length > 0 ? formatMoney(quote.totalCents) : formatMoney(0)}</output>{quote?.pendingElectricity && <p className="mt-1 text-xs">Electricity is excluded until a valid reading is entered.</p>}</div>
            <span className="payment-total-tag">{selected.length} of 4 selected</span>
          </div>
          <div className="mt-5 flex gap-3"><DialogClose asChild><Button type="button" variant="ghost" className="payment-cancel">Cancel</Button></DialogClose><Button type="submit" className="flex-1" disabled={!canReview}>Review payment <Check className="size-4" aria-hidden="true" /></Button></div>
          {!roomId && <p className="mt-3 text-xs opacity-85">Choose a room to see its bills.</p>}
        </div>
      </form>}

      {step === 'confirm' && quote && preview?.ok && <div className="room-payment-confirm">
        <span className="payment-eyebrow">REVIEW BEFORE SAVING</span>
        <DialogTitle className="mt-2 text-2xl">Confirm payment received</DialogTitle>
        <DialogDescription className="mt-2">Nothing has been saved yet. Confirm that the landlord received the total below.</DialogDescription>
        <dl className="room-payment-summary">
          <div><dt>Room</dt><dd>{quote.roomLabel}</dd></div>
          <div><dt>Billing period</dt><dd>{quote.periodLabel}</dd></div>
          {quote.selected.map(category => <div key={category}><dt>{CATEGORY_LABELS[category]}</dt><dd>{formatMoney(quote.options.find(option => option.category === category)?.amountCents ?? 0)}</dd></div>)}
          {quote.electricity?.charge && <div><dt>Electricity interval</dt><dd>{quote.electricity.previousReadingMilliKwh / 1000} → {quote.electricity.currentReadingMilliKwh! / 1000} kWh</dd></div>}
          <div className="room-payment-summary-total"><dt>Total to receive</dt><dd>{formatMoney(preview.totalCents)}</dd></div>
        </dl>
        {preview.payments.length > 1 && <p className="text-sm text-muted-foreground">This room’s bills belong to {preview.payments.length} tenants, so confirmation records {preview.payments.length} separate tenant payments and receipts.</p>}
        {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
        <div className="mt-5 flex gap-3"><Button variant="outline" onClick={() => { setStep('calculator'); setSubmitError('') }}><ArrowLeft aria-hidden="true" />Back</Button><Button className="flex-1" onClick={confirm}>Confirm payment received</Button></div>
      </div>}

      {step === 'success' && preview?.ok && <div className="payment-success">
        <span className="payment-success-icon"><Check className="size-8" aria-hidden="true" /></span>
        <span className="payment-eyebrow mt-5">PAYMENT RECORDED</span>
        <DialogTitle className="mt-2 text-2xl">Payment recorded</DialogTitle>
        <DialogDescription className="mt-2">Room {rooms.find(room => room.id === roomId)?.name ?? ''} · {periodLabel}. {preview.payments.length === 1 ? 'One tenant payment was recorded.' : `${preview.payments.length} tenant payments were recorded for this room.`}</DialogDescription>
        <p className="payment-success-amount">{formatMoney(preview.totalCents)}</p>
        <p className="mt-1 text-sm font-semibold">{preview.receipts.map(receipt => receipt.receiptNumber).join(' · ')}</p>
        {preview.quote.electricity?.charge && <p className="mt-2 text-sm text-muted-foreground">Meter baseline advanced to {preview.quote.electricity.currentReadingMilliKwh! / 1000} kWh.</p>}
        <Button autoFocus className="mt-5 w-full" onClick={() => changeOpen(false)}>Got it</Button>
      </div>}
    </DialogContent>
  </Dialog>
}
