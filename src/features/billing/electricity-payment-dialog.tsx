import { useState } from 'react'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { usePrototype } from '@/hooks/use-prototype'
import { calculateElectricityCharge, latestSettledReading, parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { prepareElectricityPayment } from '@/domain/calculations/electricity-payment'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import '@/components/shared/shared-parts.css'

function formatKwh(milliKwh: number) {
  return `${milliKwh / 1000} kWh`
}

function reasonMessage(reason: string, previousMilliKwh: number) {
  switch (reason) {
    case 'READING_BELOW_PREVIOUS': return `Current reading cannot be lower than the last settled reading (${formatKwh(previousMilliKwh)}).`
    case 'READING_NOT_ADVANCED': return 'The current reading must be higher than the last settled reading.'
    case 'READING_DATE_INVALID': return 'The payment date must be after the last settled reading date.'
    case 'RATE_NOT_FOUND': return 'No electricity rate applies to this payment date.'
    case 'INVALID_AMOUNT': return 'This reading produces an amount the prototype cannot represent safely.'
    case 'DUPLICATE_INTERVAL': return 'This meter interval was already billed.'
    case 'DUPLICATE_PAYMENT': return 'This electricity payment was already recorded.'
    case 'STALE_BASELINE': return 'The settled reading changed. Close this form and reopen it.'
    case 'OBLIGATION_NOT_FOUND': return 'This electricity obligation is no longer pending.'
    default: return 'This reading could not be confirmed.'
  }
}

export function ElectricityPaymentDialog({ obligationId, onClose, onReturnFocus, onConfirmed }: {
  obligationId: string
  onClose: () => void
  onReturnFocus: () => void
  onConfirmed: (receiptNumber: string) => void
}) {
  const { data, dispatch } = usePrototype()
  const [reading, setReading] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const obligation = data.electricityBillObligations.find(item => item.id === obligationId)
  const room = data.rooms.find(item => item.id === obligation?.roomId)
  const previous = obligation ? latestSettledReading(data, obligation.meterId) : null
  const rate = [...data.electricityRates].filter(item => item.effectiveFrom <= DEMO_DATE).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  const parsed = parseMeterReadingMilliKwh(reading)
  const calculation = obligation && parsed !== null
    ? calculateElectricityCharge(data, obligationId, { readingMilliKwh: parsed, readOn: DEMO_DATE })
    : null
  const error = reading === ''
    ? null
    : parsed === null
      ? 'Enter a non-negative reading with up to three decimal places, for example 325 or 325.125.'
      : calculation && !calculation.ok
        ? reasonMessage(calculation.reason, previous?.readingMilliKwh ?? 0)
        : null
  const canConfirm = Boolean(calculation?.ok)

  function confirm() {
    if (!obligation || parsed === null) return
    const result = prepareElectricityPayment(data, obligation.id, parsed, DEMO_DATE)
    if (!result.ok) {
      setSubmitError(reasonMessage(result.reason, previous?.readingMilliKwh ?? 0))
      return
    }
    dispatch({ type: 'electricity/paymentConfirmed', obligationId: obligation.id, currentReadingMilliKwh: parsed, paidOn: DEMO_DATE })
    onConfirmed(result.receipt.receiptNumber)
    onClose()
  }

  return <Dialog.Root open onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Content maxWidth="32rem" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Dialog.Title size="5" mb="1">Electricity payment · {room ? `Room ${room.name}` : 'Room needs review'}</Dialog.Title>
      <Dialog.Description size="2" color="gray" mb="4">Enter the current meter reading when the tenant is ready to pay electricity.</Dialog.Description>
      {!obligation || !previous ? <Text as="p" role="alert" size="2">This electricity obligation is no longer pending. Close this form to refresh the room.</Text> : <>
        <dl className="kv panel panel-pad" aria-label="Previous settled electricity reading">
          <div><dt>Last settled reading</dt><dd className="num">{formatKwh(previous.readingMilliKwh)}</dd></div>
          <div><dt>Last settled date</dt><dd>{formatDate(previous.readOn)}</dd></div>
          <div><dt>Electricity rate</dt><dd className="num">{rate ? `${formatMoney(rate.rateCentsPerKwh)} per kWh` : 'No rate available'}</dd></div>
        </dl>
        <Text as="label" htmlFor="electricity-current-reading" size="2" weight="medium" style={{ display: 'block', margin: '16px 0 6px' }}>Current meter reading (kWh)</Text>
        <TextField.Root id="electricity-current-reading" type="text" inputMode="decimal" maxLength={14} value={reading} onChange={event => { setReading(event.target.value); setSubmitError(null) }} aria-invalid={Boolean(error)} aria-describedby={error ? 'electricity-reading-error' : 'electricity-reading-help'} autoFocus />
        <Text as="p" id="electricity-reading-help" size="1" color="gray" mt="1">The calculation covers all consumption since the last settled reading. Nothing is saved until you confirm.</Text>
        {error && <Text as="p" id="electricity-reading-error" role="alert" size="2" color="red" mt="2">{error}</Text>}
        {calculation?.ok && <section aria-label="Calculated electricity charge" aria-live="polite" style={{ marginTop: 16 }}>
          <dl className="kv">
            <div><dt>Current reading</dt><dd className="num">{formatKwh(calculation.currentReading.readingMilliKwh)}</dd></div>
            <div><dt>Consumption</dt><dd className="num">{formatKwh(calculation.charge.electricity.consumptionMilliKwh)}</dd></div>
            <div><dt>Rate</dt><dd className="num">{formatMoney(calculation.charge.electricity.appliedRateCentsPerKwh)} per kWh</dd></div>
            <div className="kv-total"><dt>Amount to collect</dt><dd className="num">{formatMoney(calculation.charge.amountCents)}</dd></div>
          </dl>
        </section>}
        {submitError && <Text as="p" role="alert" size="2" color="red" mt="2">{submitError}</Text>}
      </>}
      <Flex gap="3" justify="end" mt="4">
        <Dialog.Close><Button variant="soft" color="gray">Cancel</Button></Dialog.Close>
        <Button disabled={!canConfirm} onClick={confirm}>Confirm payment received</Button>
      </Flex>
    </Dialog.Content>
  </Dialog.Root>
}
