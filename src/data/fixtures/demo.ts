import type { Charge, MeterReading, Payment, PaymentAllocation, PaymentCorrection, PrototypeAppState, RoomAssignment, RoomCategoryId } from '@/domain/types/models'
import {
  DEFAULT_ELECTRICITY_RATE_CENTS, DEFAULT_RENT_CENTS, DEFAULT_WASHING_RATE_CENTS, DEFAULT_WATER_RATE_CENTS,
  initialRoomRentRates, initialWashingRates, initialWaterRates,
} from '@/domain/calculations/billing-rates'
import { DEFAULT_MOVE_IN_POLICY } from '@/domain/calculations/move-in-policy'

export const DEMO_DATE = '2026-11-13'
export const DEMO_PERIOD = 'period-nov'

export const DEMO_RATES = {
  rentCentsPerRoom: DEFAULT_RENT_CENTS.RATE_3500,
  waterCentsPerTenant: DEFAULT_WATER_RATE_CENTS,
  electricityCentsPerKwh: DEFAULT_ELECTRICITY_RATE_CENTS,
  washingCentsPerRoom: DEFAULT_WASHING_RATE_CENTS,
} as const

const names = ['Alex Rivera', 'Sam Navarro', 'Jamie Santos', 'Morgan Cruz', 'Taylor Reyes', 'Jordan Flores', 'Casey Ramos', 'Riley Garcia', 'Avery Lim', 'Quinn Mendoza']
const movedOutTenantNumbers = new Set([7, 9, 10])

function electricityCents(consumptionMilliKwh: number) {
  return consumptionMilliKwh * DEMO_RATES.electricityCentsPerKwh / 1000
}

/** Fictional fixtures only. This is not bill-generation or allocation logic. */
export function createDemoData(): PrototypeAppState {
  const tenants = names.map((name, index) => {
    const number = index + 1
    return {
      id: `tenant-${number}`, name, email: `resident${number}@example.com`,
      phone: `DEMO +63 000 000 ${String(number).padStart(4, '0')}`,
      address: `${number} Sample Lane, Barangay Halimbawa, Demo City (fictional)`,
      status: movedOutTenantNumbers.has(number) ? 'MOVED_OUT' as const : 'ACTIVE' as const, notes: '',
    }
  })
  /**
   * Actual Halili BH room configuration: room numbers are strings and keep leading zeros.
   * IDs stay opaque and stable; "2" and "02" are different rooms with different IDs.
   */
  const roomSpecs: {
    id: string; name: string; capacity: number; kind: 'PRIVATE' | 'SHARED'; status: 'available' | 'maintenance'
    categoryId: RoomCategoryId; washingMachineEnabled: boolean
  }[] = [
    { id: 'room-1', name: '1', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: true },
    { id: 'room-2', name: '2', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: true },
    { id: 'room-3', name: '3', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-4', name: '4', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-5', name: '5', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-6', name: '6', capacity: 1, kind: 'PRIVATE', status: 'maintenance', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-7', name: '7', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-8', name: '8', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-9', name: '01', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-10', name: '03', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-11', name: '04', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-12', name: '05', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-13', name: '06', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-14', name: '07', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-15', name: '02', capacity: 1, kind: 'PRIVATE', status: 'available', categoryId: 'RATE_5000', washingMachineEnabled: false },
  ]
  const rooms = roomSpecs.map(({ id, name, ...room }) => ({ id, name, floor: 1, ...room }))
  const assignmentSpecs: { tenant: number; room: number; endDate: string | null }[] = [
    { tenant: 1, room: 1, endDate: null },
    { tenant: 2, room: 2, endDate: null },
    { tenant: 3, room: 3, endDate: null },
    { tenant: 4, room: 2, endDate: null },
    { tenant: 5, room: 4, endDate: null },
    { tenant: 6, room: 3, endDate: null },
    { tenant: 7, room: 5, endDate: '2026-10-31' },
    { tenant: 8, room: 4, endDate: null },
    { tenant: 9, room: 1, endDate: '2026-09-30' },
    { tenant: 10, room: 5, endDate: '2026-10-31' },
  ]
  const roomRentRates = initialRoomRentRates()
  const waterRates = initialWaterRates()
  const washingRates = initialWashingRates()
  const roomAssignments: RoomAssignment[] = assignmentSpecs.map(({ tenant, room, endDate }) => {
    const assignedRoom = rooms[room - 1]!
    return {
      id: `assignment-${tenant}`, tenantId: `tenant-${tenant}`, roomId: `room-${room}`,
      startDate: '2026-09-01', endDate, agreedRentCents: DEFAULT_RENT_CENTS[assignedRoom.categoryId],
    }
  })
  const billingPeriods = [
    { id: 'period-oct', label: 'October 2026 (sample)', startDate: '2026-10-01', endDate: '2026-10-31', status: 'CLOSED' as const },
    { id: DEMO_PERIOD, label: 'November 2026 (sample)', startDate: '2026-11-01', endDate: '2026-11-30', status: 'OPEN' as const },
  ]
  const meterSeries = [
    { room: 1, values: [300_000, 312_000, 325_000] },
    { room: 2, values: [120_000] },
    { room: 3, values: [180_000, 192_000, 204_000] },
    { room: 4, values: [300_000] },
    { room: 5, values: [90_000, 100_000] },
  ]
  const electricityMeters = meterSeries.map(({ room }) => {
    const roomName = rooms[room - 1]?.name ?? String(room)
    return {
      id: `meter-room-${room}`, label: `Room ${roomName} meter`, serialNumber: `FICTIONAL-MTR-${roomName}`, ownership: 'UNCONFIRMED' as const,
    }
  })
  const readingDates = [
    ['sep', '2026-09-30'],
    ['oct', '2026-10-31'],
    ['nov', '2026-11-10'],
  ] as const
  const meterReadings: MeterReading[] = meterSeries.flatMap(({ room, values }) => values.map((readingMilliKwh, index) => {
    const [suffix, readOn] = readingDates[index]!
    return { id: `reading-room-${room}-${suffix}`, meterId: `meter-room-${room}`, readOn, readingMilliKwh,
      status: 'CONFIRMED' as const, confirmedBy: 'demo-admin', correction: null }
  }))
  const electricityRates = [
    { id: 'rate-oct', label: 'Historical sample rate', rateCentsPerKwh: DEMO_RATES.electricityCentsPerKwh, effectiveFrom: '2026-10-01', recordedOn: '2026-10-01' },
    { id: 'rate-nov', label: 'Current sample rate', rateCentsPerKwh: DEMO_RATES.electricityCentsPerKwh, effectiveFrom: '2026-11-01', recordedOn: '2026-11-01' },
  ]

  const rentPayer: Record<string, number> = { 'room-1': 1, 'room-2': 4, 'room-3': 3, 'room-4': 5, 'room-5': 10 }
  const utilityPayer: Record<string, number> = { 'room-1': 1, 'room-2': 2, 'room-3': 6, 'room-4': 5, 'room-5': 10 }
  const washingRooms = new Set(['room-1', 'room-2', 'room-5'])
  const periodSpecs = [
    { key: 'oct', periodId: 'period-oct', startDate: '2026-10-01', endDate: '2026-10-31', issuedOn: '2026-10-31', electricityIssuedOn: '2026-10-31', dueDate: '2026-11-05', previous: 'sep', current: 'oct', rateId: 'rate-oct', rateEffectiveFrom: '2026-10-01' },
    { key: 'nov', periodId: DEMO_PERIOD, startDate: '2026-11-01', endDate: '2026-11-30', issuedOn: '2026-11-01', electricityIssuedOn: '2026-11-10', dueDate: '2026-11-20', previous: 'oct', current: 'nov', rateId: 'rate-nov', rateEffectiveFrom: '2026-11-01' },
  ]
  const charges: Charge[] = []
  for (const spec of periodSpecs) {
    const roomIds = rooms.filter(room => roomAssignments.some(assignment => assignment.roomId === room.id
      && assignment.startDate <= spec.endDate && (assignment.endDate === null || assignment.endDate >= spec.startDate))).map(room => room.id)
    for (const roomId of roomIds) {
      const occupants = tenants.filter(tenant => roomAssignments.some(assignment => assignment.tenantId === tenant.id && assignment.roomId === roomId
        && assignment.startDate <= spec.endDate && (assignment.endDate === null || assignment.endDate >= spec.startDate)))
      const rentTenant = `tenant-${rentPayer[roomId]}`
      const rentAssignment = roomAssignments.find(assignment => assignment.tenantId === rentTenant && assignment.roomId === roomId)!
      const base = { billingPeriodId: spec.periodId, issuedOn: spec.issuedOn, dueDate: spec.dueDate, state: 'ISSUED' as const, correction: null }
      charges.push({ ...base, id: `rent-${spec.key}-${roomId}`, tenantId: rentTenant, category: 'RENT', description: 'Room rent — charged once per occupied room', amountCents: rentAssignment.agreedRentCents, agreedRentCents: rentAssignment.agreedRentCents, roomAssignmentId: rentAssignment.id })
      for (const occupant of occupants) {
        charges.push({ ...base, id: `water-${spec.key}-${occupant.id}`, tenantId: occupant.id, category: 'WATER', description: 'Room water — charged per tenant', amountCents: DEMO_RATES.waterCentsPerTenant, entryMethod: 'MANUAL' })
      }
      const utilityTenant = `tenant-${utilityPayer[roomId]}`
      // Electricity is collected cumulatively when payment is made, so these rooms
      // intentionally have no monthly electricity charge or fabricated placeholder.
      const awaitingReading = roomId === 'room-2' || roomId === 'room-4'
      if (!awaitingReading) {
        const previousReading = meterReadings.find(reading => reading.id === `reading-${roomId}-${spec.previous}`)!
        const currentReading = meterReadings.find(reading => reading.id === `reading-${roomId}-${spec.current}`)!
        const consumptionMilliKwh = currentReading.readingMilliKwh - previousReading.readingMilliKwh
        charges.push({
          ...base, id: `electricity-${spec.key}-${roomId}`, tenantId: utilityTenant, category: 'ELECTRICITY', description: 'Room electricity — consumed meter difference',
          amountCents: electricityCents(consumptionMilliKwh), issuedOn: spec.electricityIssuedOn,
          electricity: {
            intervalId: `meter-room-${roomId.slice(5)}:${previousReading.id}>${currentReading.id}`,
            meterId: `meter-room-${roomId.slice(5)}`, previousReadingId: previousReading.id, currentReadingId: currentReading.id,
            previousReadingMilliKwh: previousReading.readingMilliKwh, currentReadingMilliKwh: currentReading.readingMilliKwh,
            consumptionMilliKwh, rateId: spec.rateId, appliedRateCentsPerKwh: DEMO_RATES.electricityCentsPerKwh,
            appliedRateEffectiveFrom: spec.rateEffectiveFrom,
          },
        })
      }
      if (washingRooms.has(roomId)) {
        charges.push({ ...base, id: `washing-${spec.key}-${roomId}`, tenantId: utilityTenant, category: 'WASHING_MACHINE', description: 'Optional washing machine — charged once per room', amountCents: DEMO_RATES.washingCentsPerRoom, entryMethod: 'MANUAL' })
      }
    }
  }

  const electricityBillObligations = [
    { id: 'electricity-nov-room-2-awaiting', roomId: 'room-2', tenantId: 'tenant-2', billingPeriodId: 'period-nov',
      meterId: 'meter-room-2', previousReadingId: 'reading-room-2-sep', createdAt: '2026-10-01', dueDate: '2026-11-20',
      state: 'AWAITING_READING' as const },
    { id: 'electricity-nov-room-4-awaiting', roomId: 'room-4', tenantId: 'tenant-5', billingPeriodId: 'period-nov',
      meterId: 'meter-room-4', previousReadingId: 'reading-room-4-sep', createdAt: '2026-10-01', dueDate: '2026-11-20',
      state: 'AWAITING_READING' as const },
  ]

  const payments: Payment[] = []
  const paymentAllocations: PaymentAllocation[] = []
  const examples = [
    { id: 'payment-old', tenantId: 'tenant-10', paidOn: '2026-11-02', items: [['rent-oct-room-5', 350_000], ['water-oct-tenant-10', 10_000], ['electricity-oct-room-5', 13_000], ['washing-oct-room-5', 10_000]] },
    { id: 'payment-oct-1', tenantId: 'tenant-1', paidOn: '2026-11-02', items: [['rent-oct-room-1', 350_000], ['water-oct-tenant-1', 10_000], ['electricity-oct-room-1', 15_600], ['washing-oct-room-1', 10_000]] },
    { id: 'payment-oct-2', tenantId: 'tenant-2', paidOn: '2026-11-02', items: [['water-oct-tenant-2', 10_000], ['washing-oct-room-2', 10_000]] },
    { id: 'payment-oct-4-water', tenantId: 'tenant-4', paidOn: '2026-11-02', items: [['water-oct-tenant-4', 10_000]] },
    { id: 'payment-casey-oct', tenantId: 'tenant-7', paidOn: '2026-11-02', items: [['water-oct-tenant-7', 10_000]] },
    { id: 'payment-1-rent-water-washing', tenantId: 'tenant-1', paidOn: '2026-11-08', items: [['rent-nov-room-1', 350_000], ['water-nov-tenant-1', 10_000], ['washing-nov-room-1', 10_000]] },
    { id: 'payment-1-electricity', tenantId: 'tenant-1', paidOn: '2026-11-11', items: [['electricity-nov-room-1', 16_900]] },
    { id: 'payment-2-water', tenantId: 'tenant-2', paidOn: '2026-11-06', items: [['water-nov-tenant-2', 10_000]] },
    { id: 'payment-2-washing', tenantId: 'tenant-2', paidOn: '2026-11-06', items: [['washing-nov-room-2', 10_000]] },
    { id: 'payment-3', tenantId: 'tenant-3', paidOn: '2026-11-05', items: [['rent-nov-room-3', 350_000], ['water-nov-tenant-3', 10_000]] },
    { id: 'payment-6-utilities', tenantId: 'tenant-6', paidOn: '2026-11-10', items: [['water-nov-tenant-6', 10_000], ['electricity-nov-room-3', 15_600]] },
    { id: 'payment-2-rent', tenantId: 'tenant-4', paidOn: '2026-11-07', items: [['rent-nov-room-2', 350_000]] },
    { id: 'payment-2-water-2', tenantId: 'tenant-4', paidOn: '2026-11-12', items: [['water-nov-tenant-4', 10_000]] },
  ] satisfies { id: string; tenantId: string; paidOn: string; items: [string, number][] }[]
  examples.forEach((example, index) => {
    payments.push({ id: example.id, scope: 'TENANT', tenantId: example.tenantId, roomId: null, occupancyCycleId: null, paidOn: example.paidOn, amountCents: example.items.reduce((sum, [, amount]) => sum + amount, 0), method: index % 2 ? 'cash' : 'bank-transfer', state: 'RECORDED', correction: null })
    example.items.forEach(([chargeId, amountCents]) => paymentAllocations.push({ id: `allocation-${example.id}-${chargeId}`, paymentId: example.id, chargeId, amountCents, allocatedOn: example.paidOn, creditId: null, state: 'ACTIVE', reversalAuditEventId: null }))
  })
  payments.push({ id: 'payment-advance', scope: 'TENANT', tenantId: 'tenant-6', roomId: null, occupancyCycleId: null, amountCents: 50_000, paidOn: '2026-11-12', method: 'cash', state: 'RECORDED', correction: null })
  const tenantCredits = [{ id: 'credit-6', tenantId: 'tenant-6', sourcePaymentId: 'payment-advance', amountCents: 50_000, createdOn: '2026-11-12' }]
  const receipts = payments.map((payment, index) => ({ id: `receipt-${index + 1}`, paymentId: payment.id, receiptNumber: `DEMO-RCT-${String(index + 1).padStart(3, '0')}`, issuedOn: payment.paidOn, amountCents: payment.amountCents, allocationIds: paymentAllocations.filter(a => a.paymentId === payment.id).map(a => a.id), state: 'ISSUED' as const, revision: 1, supersedesReceiptId: null }))
  const paymentCorrections: PaymentCorrection[] = []
  const auditEvents = [{ id: 'audit-seed', actorId: 'demo-admin', occurredOn: DEMO_DATE, action: 'DEMO_SEEDED' as const, entityType: 'PROTOTYPE' as const, entityId: 'demo-workspace', reason: 'Fictional fixture snapshot prepared; no real transaction or authenticated actor.', beforeSnapshot: null, afterSnapshot: 'Sample records loaded' }]
  const occupancyCycles = [...new Set(roomAssignments.filter(assignment => assignment.endDate === null).map(assignment => assignment.roomId))]
    .map(roomId => {
      const startedAt = roomAssignments.filter(assignment => assignment.roomId === roomId && assignment.endDate === null)
        .map(assignment => assignment.startDate).sort()[0] ?? '2026-09-01'
      return {
        id: `cycle-${roomId}`, roomId, startedAt, endedAt: null, status: 'ACTIVE' as const,
        createdAt: startedAt, updatedAt: startedAt,
      }
    })
  return {
    tenants, rooms, roomAssignments, electricityMeters, meterReadings, electricityBillObligations, electricityRates,
    roomRentRates, waterRates, washingRates, billingPeriods, charges, payments, paymentAllocations, tenantCredits, receipts,
    paymentCorrections, auditEvents, occupancyCycles, moveInObligations: [], moveInPolicy: { ...DEFAULT_MOVE_IN_POLICY }, roomChangeRequests: [],
  }
}
