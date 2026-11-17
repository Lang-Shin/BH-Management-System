import { useRef, useState } from 'react'
import { Button, Flex, Heading, Text } from '@radix-ui/themes'
import type { PrototypeAppState } from '@/domain/types/models'
import { DataTable } from '@/components/shared/data-table'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { formatDate, formatMoney } from '@/lib/format'
import { chargeRoom } from '@/domain/calculations/room-finance'
import { unresolvedElectricity } from '@/domain/calculations/summary'
import { ElectricityPaymentDialog } from './electricity-payment-dialog'
import '@/components/shared/shared-parts.css'
import './billing.css'

export function ElectricityPreview({ data, periodId, asOf }: { data: PrototypeAppState; periodId: string; asOf: string }) {
  const [obligationId, setObligationId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const trigger = useRef<HTMLButtonElement | null>(null)
  const charge = data.charges.find(c => c.category === 'ELECTRICITY' && c.billingPeriodId === periodId && c.state === 'ISSUED')
  const awaiting = unresolvedElectricity(data, asOf, periodId)
  return <>
    <details className="disclosure"><summary>View electricity readings and prices</summary>
      <div className="disclosure-body">
        <div className="billing-two-col">
          <div>
            <Heading as="h3" size="3" mb="2">Electricity bill</Heading>
            {charge?.category === 'ELECTRICITY' ? <>
              <dl className="kv">{([
                ['Room context', chargeRoom(data, charge).label],
                ['Charge owner', data.tenants.find(t => t.id === charge.tenantId)?.name],
                ['Meter', data.electricityMeters.find(m => m.id === charge.electricity.meterId)?.label],
                ['Last reading', <AnimatedNumber value={`${charge.electricity.previousReadingMilliKwh / 1000} kWh`} />],
                ['New reading', <AnimatedNumber value={`${charge.electricity.currentReadingMilliKwh / 1000} kWh`} />],
                ['Electricity used', <AnimatedNumber value={`${charge.electricity.consumptionMilliKwh / 1000} kWh`} />],
                ['Price per kWh', <AnimatedNumber value={formatMoney(charge.electricity.appliedRateCentsPerKwh)} />],
                ['Price started on', formatDate(charge.electricity.appliedRateEffectiveFrom)],
                ['Amount to pay', <AnimatedNumber value={formatMoney(charge.amountCents)} />],
              ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="num">{value}</dd></div>)}</dl>
              <Text as="p" size="2" mt="3"><AnimatedNumber value={`${charge.electricity.consumptionMilliKwh / 1000} kWh`} /> × <AnimatedNumber value={formatMoney(charge.electricity.appliedRateCentsPerKwh)} /> = <Text weight="bold"><AnimatedNumber value={formatMoney(charge.amountCents)} /></Text></Text>
              <Text as="p" size="1" color="gray" mt="1">Changing the price later will not change this bill.</Text>
            </> : <Text as="p" size="2" color="gray">There is no calculated electricity bill for this month.</Text>}
          </div>
          <div>
            <Heading as="h3" size="3" mb="2">Electricity prices</Heading>
            <dl className="kv">{data.electricityRates.map(rate => <div key={rate.id}><dt><Text weight="medium" highContrast><AnimatedNumber value={formatMoney(rate.rateCentsPerKwh)} /> per kWh</Text></dt><dd>Starting {formatDate(rate.effectiveFrom)}</dd></div>)}</dl>
            <Text as="p" size="1" color="gray" mt="3">Who uses each meter and how shared electricity is divided still need to be agreed.</Text>
          </div>
        </div>

        {awaiting.length > 0 && <section className="panel panel-pad billing-awaiting" aria-label="Electricity awaiting meter reading">
          <Heading as="h3" size="3">Electricity awaiting meter reading</Heading>
          <Text as="p" size="2" color="gray">The current reading has not been entered, so no electricity amount is invented.</Text>
          {notice && <Text as="p" role="status" size="2" color="green" weight="medium" mt="2">{notice}</Text>}
          <ul className="row-list">{awaiting.map(item => {
            const room = data.rooms.find(room => room.id === item.roomId)
            const meter = data.electricityMeters.find(meter => meter.id === item.meterId)
            const previous = data.meterReadings.find(reading => reading.id === item.previousReadingId)
            return <li key={item.id} className="row" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <Text as="p" size="2" weight="bold">{room ? `Room ${room.name}` : 'Room needs review'} · {meter?.label ?? 'Meter needs review'}</Text>
                <Text as="p" size="2">Last settled reading: {previous ? `${previous.readingMilliKwh / 1000} kWh on ${formatDate(previous.readOn)}` : 'Not recorded'} · Current reading: not entered</Text>
                <Text as="p" size="2" weight="medium">Amount pending calculation</Text>
              </div>
              <Button variant="soft" color="gray" onClick={event => { trigger.current = event.currentTarget; setObligationId(item.id) }} aria-label={`Enter meter reading for Room ${room?.name ?? ''} electricity`}>Enter meter reading</Button>
            </li>
          })}</ul>
        </section>}

        <Flex direction="column" gap="2" mt="5">
          <Heading as="h3" size="3">Past meter readings</Heading>
          <DataTable rows={data.meterReadings} caption="Past meter readings" columns={[
            { key: 'meter', label: 'Meter', render: r => data.electricityMeters.find(m => m.id === r.meterId)?.label },
            { key: 'date', label: 'Date', render: r => formatDate(r.readOn) },
            { key: 'reading', label: 'Reading', render: r => `${r.readingMilliKwh / 1000} kWh` },
          ]} />
        </Flex>
      </div>
    </details>
    {obligationId && <ElectricityPaymentDialog obligationId={obligationId} onClose={() => setObligationId(null)} onReturnFocus={() => { if (trigger.current?.isConnected) trigger.current.focus() }} onConfirmed={receiptNumber => setNotice(`Electricity payment recorded · ${receiptNumber}. The settled reading has advanced.`)} />}
  </>
}
