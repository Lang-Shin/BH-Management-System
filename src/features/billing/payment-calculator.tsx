import { useState } from 'react'
import { Button, Checkbox, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import type { ChargeCategory } from '@/domain/types/models'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import { buildRoomPaymentQuote, prepareRoomPayment, roomPaymentCategories, type RoomPaymentResult } from '@/domain/calculations/room-payment'
import { parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'
import '@/components/shared/shared-parts.css'
import './billing.css'

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

export function PaymentCalculator({ periodId, periodLabel, initialRoomId, label = 'Calculate payment', ariaLabel, variant = 'solid' }: {
  periodId: string
  periodLabel: string
  /** Pre-select a room when the dialog opens. */
  initialRoomId?: string
  label?: string
  ariaLabel?: string
  variant?: 'solid' | 'soft'
}) {
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
  const quote = open && roomId ? buildRoomPaymentQuote(data, { roomId, periodId, selected, electricityReadingMilliKwh: parsedReading, asOf: DEMO_DATE }) : null
  const electricityOption = quote?.options.find(option => option.category === 'ELECTRICITY')
  const electricityErrorText = electricityOption?.state === 'INVALID_READING'
    ? electricityError(quote?.electricity?.error) : null
  const canReview = Boolean(quote?.canConfirm && !readingError)

  function reset() {
    setStep('calculator')
    setRoomId(initialRoomId && roomIds.has(initialRoomId) ? initialRoomId : '')
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

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger>
      <Button variant={variant} color={variant === 'soft' ? 'gray' : undefined} aria-label={ariaLabel}>{label}</Button>
    </Dialog.Trigger>
    <Dialog.Content maxWidth="34rem">
      {step === 'calculator' && <form onSubmit={event => { event.preventDefault(); if (canReview) review() }}>
        <Dialog.Title size="5" mb="1">Choose a room and its bills.</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="1">Select the bills this room is paying. Amounts are calculated from the sample billing rules.</Dialog.Description>
        <Text as="p" size="1" color="gray" mb="4">{periodLabel} · Only this billing period is included; older pending periods remain in Pending Payments.</Text>

        <Text as="label" htmlFor="payment-room" size="2" weight="medium" style={{ display: 'block', marginBottom: 6 }}>Choose room</Text>
        <select id="payment-room" value={roomId} onChange={event => chooseRoom(event.target.value)} className="field-select">
          <option value="">Choose a room</option>
          {rooms.map(room => <option key={room.id} value={room.id}>Room {room.name}</option>)}
        </select>

        {roomId && quote && <fieldset className="pay-options">
          <legend className="sr-only">Bills to pay</legend>
          {roomPaymentCategories.map(category => {
            const option = quote.options.find(item => item.category === category)!
            const selectable = ['SELECTABLE', 'AWAITING_READING', 'INVALID_READING'].includes(option.state)
            const checked = selected.includes(category)
            return <div key={category} className="pay-option" data-state={option.state}>
              <label className="pay-option-label">
                <Checkbox checked={checked} disabled={!selectable} onCheckedChange={() => toggle(category)} aria-label={CATEGORY_LABELS[category]} />
                <span className="pay-option-text">
                  <Text as="div" size="2" weight="medium">{CATEGORY_LABELS[category]}{category === 'WASHING_MACHINE' && <Text size="1" color="gray" weight="regular" ml="2">Optional</Text>}</Text>
                  <Text as="div" size="1" color="gray">{option.detail}{category === 'ELECTRICITY' && quote.electricity ? ` · Last settled ${quote.electricity.previousReadingMilliKwh / 1000} kWh on ${formatDate(quote.electricity.previousReadOn)}` : ''}</Text>
                </span>
                <Text size="2" weight="medium" className="num pay-option-amount">{option.state === 'PAID' ? 'Paid' : option.state === 'UNAVAILABLE' ? option.detail : option.amountCents == null ? 'Amount pending calculation' : formatMoney(option.amountCents)}</Text>
              </label>
              {category === 'ELECTRICITY' && checked && <div className="pay-electricity">
                <Text as="label" htmlFor="room-electricity-reading" size="2" weight="medium">Current meter reading (kWh)</Text>
                <TextField.Root id="room-electricity-reading" type="text" inputMode="decimal" maxLength={14} value={reading} onChange={event => { setReading(event.target.value); setPreview(null); setSubmitError('') }} aria-invalid={Boolean(readingError || electricityErrorText)} aria-describedby={readingError || electricityErrorText ? 'room-electricity-error' : undefined} />
                <Text as="p" size="1" color="gray">Rate {quote.electricity ? `${formatMoney(quote.electricity.rateCentsPerKwh)} per kWh` : 'unavailable'} · Consumption is billed from the last settled reading.</Text>
                {quote.electricity?.consumptionMilliKwh != null && <Text as="p" size="2" weight="medium" className="num">{quote.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(quote.electricity.rateCentsPerKwh)} = {formatMoney(quote.electricity.amountCents ?? 0)}</Text>}
                {(readingError || electricityErrorText) && <Text as="p" id="room-electricity-error" role="alert" size="2" color="red">{readingError ?? electricityErrorText}</Text>}
              </div>}
            </div>
          })}
        </fieldset>}
        {submitError && <Text as="p" role="alert" size="2" color="red" mt="3">{submitError}</Text>}
        <Text as="p" size="1" color="gray" mt="3">Paid bills are disabled. Electricity remains uncalculated until a valid reading is entered.</Text>

        <div className="pay-total">
          <Flex align="end" justify="between" gap="3" wrap="wrap">
            <div>
              <Text as="p" size="2" color="gray">Total to pay</Text>
              <output aria-label="Total to pay" aria-live="polite" aria-atomic="true" className="pay-total-value">{quote && quote.selected.length > 0 ? formatMoney(quote.totalCents) : formatMoney(0)}</output>
              {quote?.pendingElectricity && <Text as="p" size="1" color="gray">Electricity is excluded until a valid reading is entered.</Text>}
            </div>
            <Text size="2" color="gray">{selected.length} of 4 selected</Text>
          </Flex>
          {!roomId && <Text as="p" size="1" color="gray" mt="2">Choose a room to see its bills.</Text>}
          <Flex gap="3" justify="end" mt="4">
            <Dialog.Close><Button type="button" variant="soft" color="gray">Cancel</Button></Dialog.Close>
            <Button type="submit" disabled={!canReview}>Review payment</Button>
          </Flex>
        </div>
      </form>}

      {step === 'confirm' && quote && preview?.ok && <div>
        <Dialog.Title size="5" mb="1">Confirm payment received</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">Nothing has been saved yet. Confirm that the landlord received the total below.</Dialog.Description>
        <dl className="kv panel panel-pad">
          <div><dt>Room</dt><dd>{quote.roomLabel}</dd></div>
          <div><dt>Billing period</dt><dd>{quote.periodLabel}</dd></div>
          {quote.selected.map(category => <div key={category}><dt>{CATEGORY_LABELS[category]}</dt><dd className="num">{formatMoney(quote.options.find(option => option.category === category)?.amountCents ?? 0)}</dd></div>)}
          {quote.electricity?.charge && <div><dt>Electricity interval</dt><dd className="num">{quote.electricity.previousReadingMilliKwh / 1000} → {quote.electricity.currentReadingMilliKwh! / 1000} kWh</dd></div>}
          <div className="kv-total"><dt>Total to receive</dt><dd className="num">{formatMoney(preview.totalCents)}</dd></div>
        </dl>
        {preview.payments.length > 1 && <Text as="p" size="2" color="gray" mt="3">This room’s bills belong to {preview.payments.length} tenants, so confirmation records {preview.payments.length} separate tenant payments and receipts.</Text>}
        {submitError && <Text as="p" role="alert" size="2" color="red" mt="3">{submitError}</Text>}
        <Flex gap="3" justify="end" mt="4">
          <Button variant="soft" color="gray" onClick={() => { setStep('calculator'); setSubmitError('') }}>Back</Button>
          <Button onClick={confirm}>Confirm payment received</Button>
        </Flex>
      </div>}

      {step === 'success' && preview?.ok && <div>
        <Dialog.Title size="5" mb="1">Payment recorded</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">Room {rooms.find(room => room.id === roomId)?.name ?? ''} · {periodLabel}. {preview.payments.length === 1 ? 'One tenant payment was recorded.' : `${preview.payments.length} tenant payments were recorded for this room.`}</Dialog.Description>
        <Text as="p" size="8" weight="bold" className="num">{formatMoney(preview.totalCents)}</Text>
        <Text as="p" size="2" weight="medium" mt="1">{preview.receipts.map(receipt => receipt.receiptNumber).join(' · ')}</Text>
        {preview.quote.electricity?.charge && <Text as="p" size="2" color="gray" mt="2">Meter baseline advanced to {preview.quote.electricity.currentReadingMilliKwh! / 1000} kWh.</Text>}
        <Flex justify="end" mt="4"><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></Flex>
      </div>}
    </Dialog.Content>
  </Dialog.Root>
}
