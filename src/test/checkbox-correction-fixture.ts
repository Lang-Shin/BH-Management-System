import { createEmptyData } from '@/data/fixtures/empty'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { collectionCatalog, prepareCollection } from '@/domain/calculations/payment-collection'

/** Isolated owner-example fixture created through the existing collection engine. */
export function checkboxCorrectionFixture() {
  const asOf = '2026-11-23'
  let data = createEmptyData(asOf)
  data.electricityRates = data.electricityRates.map(rate => ({ ...rate, rateCentsPerKwh: 1200 }))
  data.rooms = data.rooms.map(room => room.id === 'room-8' ? { ...room, washingMachineEnabled: true } : room)
  data = prototypeReducer(data, { type: 'tenant/created', asOf, draft: {
    name: 'Charles Checkbox', email: 'charles.checkbox@example.com', phone: '', address: '', notes: '',
    roomId: 'room-8', moveInDate: '2026-10-01',
  } })
  const moveIn = prepareMoveInPayment(data, {
    obligationId: data.moveInObligations[0]!.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-10-01',
  })
  if (!moveIn.ok) throw new Error(moveIn.reason)
  const initialized = prepareMeterInitialization(moveIn.data, {
    roomId: 'room-8', readingMilliKwh: 100_000, readOn: '2026-10-01', initializedOn: '2026-10-01', sourceNote: 'Verified fixture baseline',
  })
  if (!initialized.ok) throw new Error(initialized.reason)
  data = initialized.data
  const meter = data.electricityMeters.find(item => item.roomId === 'room-8')!
  const readings = { [`reading:${meter.id}:cumulative`]: 150_000 }
  const items = collectionCatalog(data, 'room-8', asOf, readings)
    .filter(item => item.selectable && item.amountCents > 0 && item.periodStart >= '2026-11-01')
  const collected = prepareCollection(data, {
    transactionId: 'checkbox-owner-example', roomId: 'room-8', collectedOn: asOf, readings,
    selections: items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
  })
  if (!collected.ok) throw new Error(collected.reason)
  return {
    data: collected.data, asOf, paymentId: collected.paymentId, receiptId: collected.receiptId,
    tenantId: collected.data.tenants[0]!.id,
    allocations: collected.data.paymentAllocations.filter(allocation => allocation.paymentId === collected.paymentId && allocation.state === 'ACTIVE'),
  }
}
