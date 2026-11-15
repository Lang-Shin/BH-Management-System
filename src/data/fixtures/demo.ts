import type { Charge, Payment, PaymentAllocation, PrototypeAppState, RoomAssignment } from '@/domain/types/models'

export const DEMO_DATE = '2026-11-13'
export const DEMO_PERIOD = 'period-nov'

const names = ['Alex Rivera', 'Sam Navarro', 'Jamie Santos', 'Morgan Cruz', 'Taylor Reyes', 'Jordan Flores', 'Casey Ramos', 'Riley Garcia', 'Avery Lim', 'Quinn Mendoza']

/** Fictional fixtures only. This is not bill-generation or allocation logic. */
export function createDemoData(): PrototypeAppState {
  const tenants = names.map((name, index) => ({
    id: `tenant-${index + 1}`, name, email: `resident${index + 1}@example.com`,
    phone: `DEMO +63 000 000 ${String(index + 1).padStart(4, '0')}`,
    address: `${index + 1} Sample Lane, Barangay Halimbawa, Demo City (fictional)`,
    status: index === 9 ? 'MOVED_OUT' as const : 'ACTIVE' as const, notes: '',
  }))
  // Room 101 is a two-bed room with a PHP 3,500 room rent shared by two tenants.
  // Room 102 has one tenant paying the full PHP 3,500 room rent.
  const rooms = [2, 2, 3, 3, 1, 2].map((capacity, index) => ({
    id: `room-${index + 1}`, name: String(101 + index), floor: 1, capacity,
    kind: index === 4 ? 'PRIVATE' as const : 'SHARED' as const, status: index === 5 ? 'maintenance' as const : 'available' as const,
  }))
  const roomIds = [1, 1, 3, 2, 4, 3, 3, 4, 4, 5]
  const roomAssignments: RoomAssignment[] = tenants.map((tenant, index) => ({
    id: `assignment-${index + 1}`, tenantId: tenant.id, roomId: `room-${roomIds[index]}`,
    startDate: '2026-09-01', endDate: index === 9 ? '2026-10-31' : null,
    agreedRentCents: index === 9 ? 300_000 : index < 2 ? 175_000 : 350_000,
  }))
  const billingPeriods = [
    { id: 'period-oct', label: 'October 2026 (sample)', startDate: '2026-10-01', endDate: '2026-10-31', status: 'CLOSED' as const },
    { id: DEMO_PERIOD, label: 'November 2026 (sample)', startDate: '2026-11-01', endDate: '2026-11-30', status: 'OPEN' as const },
  ]
  const electricityMeters = [{ id: 'meter-demo-a', label: 'Demo meter A', serialNumber: 'FICTIONAL-MTR-001', ownership: 'UNCONFIRMED' as const }]
  const meterReadings = [
    { id: 'reading-sep', readOn: '2026-09-30', readingMilliKwh: 288_000 },
    { id: 'reading-oct', readOn: '2026-10-31', readingMilliKwh: 300_000 },
    { id: 'reading-nov', readOn: '2026-11-10', readingMilliKwh: 312_000 },
  ].map(reading => ({ ...reading, meterId: 'meter-demo-a', status: 'CONFIRMED' as const, confirmedBy: 'demo-admin', correction: null }))
  const electricityRates = [
    { id: 'rate-oct', label: 'Historical sample rate', rateCentsPerKwh: 1_200, effectiveFrom: '2026-10-01' },
    { id: 'rate-nov', label: 'Current sample rate', rateCentsPerKwh: 1_300, effectiveFrom: '2026-11-01' },
    { id: 'rate-dec', label: 'Future sample rate', rateCentsPerKwh: 1_450, effectiveFrom: '2026-12-01' },
  ]
  const charges: Charge[] = []
  for (let index = 0; index < 9; index++) {
    const rentCents = index < 2 ? 175_000 : 350_000
    const base = { tenantId: `tenant-${index + 1}`, billingPeriodId: DEMO_PERIOD, issuedOn: '2026-11-01', dueDate: index < 4 ? '2026-11-05' : '2026-11-20', state: 'ISSUED' as const, correction: null }
    charges.push({ ...base, id: `rent-${index + 1}`, category: 'RENT', description: 'Sample agreed room rent share', amountCents: rentCents, agreedRentCents: rentCents, roomAssignmentId: `assignment-${index + 1}` })
    charges.push({ ...base, id: `water-${index + 1}`, category: 'WATER', description: 'Manually entered sample water charge', amountCents: 15_000, entryMethod: 'MANUAL' })
  }
  charges.push({ id: 'washing-2', tenantId: 'tenant-2', billingPeriodId: DEMO_PERIOD, category: 'WASHING_MACHINE', description: 'Optional manually entered sample charge', amountCents: 8_000, issuedOn: '2026-11-01', dueDate: '2026-11-20', state: 'ISSUED', entryMethod: 'MANUAL', correction: null })
  charges.push({ id: 'rent-old', tenantId: 'tenant-10', billingPeriodId: 'period-oct', category: 'RENT', description: 'Historical agreed rent', amountCents: 300_000, agreedRentCents: 300_000, roomAssignmentId: 'assignment-10', issuedOn: '2026-10-31', dueDate: '2026-11-05', state: 'ISSUED', correction: null })
  charges.push({ id: 'water-old', tenantId: 'tenant-10', billingPeriodId: 'period-oct', category: 'WATER', description: 'Historical manual water charge', amountCents: 10_000, entryMethod: 'MANUAL', issuedOn: '2026-10-31', dueDate: '2026-11-05', state: 'ISSUED', correction: null })
  charges.push(...[
    { id: 'electricity-old', tenantId: 'tenant-10', billingPeriodId: 'period-oct', amountCents: 14_400, issuedOn: '2026-10-31', dueDate: '2026-11-05', previousReadingId: 'reading-sep', currentReadingId: 'reading-oct', previousReadingMilliKwh: 288_000, currentReadingMilliKwh: 300_000, rateId: 'rate-oct', appliedRateCentsPerKwh: 1_200, appliedRateEffectiveFrom: '2026-10-01' },
    { id: 'electricity-1', tenantId: 'tenant-1', billingPeriodId: DEMO_PERIOD, amountCents: 15_600, issuedOn: '2026-11-10', dueDate: '2026-11-20', previousReadingId: 'reading-oct', currentReadingId: 'reading-nov', previousReadingMilliKwh: 300_000, currentReadingMilliKwh: 312_000, rateId: 'rate-nov', appliedRateCentsPerKwh: 1_300, appliedRateEffectiveFrom: '2026-11-01' },
  ].map(({ previousReadingId, currentReadingId, previousReadingMilliKwh, currentReadingMilliKwh, rateId, appliedRateCentsPerKwh, appliedRateEffectiveFrom, ...base }): Charge => ({
    ...base, category: 'ELECTRICITY', description: 'Illustrative charge only; meter ownership and shared allocation unconfirmed', state: 'ISSUED', correction: null,
    electricity: { meterId: 'meter-demo-a', previousReadingId, currentReadingId, previousReadingMilliKwh, currentReadingMilliKwh, consumptionMilliKwh: currentReadingMilliKwh - previousReadingMilliKwh, rateId, appliedRateCentsPerKwh, appliedRateEffectiveFrom },
  })))

  const octoberBase = { billingPeriodId: 'period-oct', issuedOn: '2026-10-31', dueDate: '2026-11-05', state: 'ISSUED' as const, correction: null }
  charges.push(
    { ...octoberBase, id: 'rent-oct-1', tenantId: 'tenant-1', category: 'RENT', description: 'October sample room rent share', amountCents: 175_000, agreedRentCents: 175_000, roomAssignmentId: 'assignment-1' },
    { ...octoberBase, id: 'rent-oct-2', tenantId: 'tenant-2', category: 'RENT', description: 'October sample room rent share', amountCents: 175_000, agreedRentCents: 175_000, roomAssignmentId: 'assignment-2' },
    { ...octoberBase, id: 'rent-oct-4', tenantId: 'tenant-4', category: 'RENT', description: 'October sample room rent', amountCents: 350_000, agreedRentCents: 350_000, roomAssignmentId: 'assignment-4' },
    { ...octoberBase, id: 'water-oct-1', tenantId: 'tenant-1', category: 'WATER', description: 'October sample water charge', amountCents: 15_000, entryMethod: 'MANUAL' },
    { ...octoberBase, id: 'water-oct-2', tenantId: 'tenant-2', category: 'WATER', description: 'October sample water charge', amountCents: 15_000, entryMethod: 'MANUAL' },
    { ...octoberBase, id: 'water-oct-4', tenantId: 'tenant-4', category: 'WATER', description: 'October sample water charge', amountCents: 15_000, entryMethod: 'MANUAL' },
    { ...octoberBase, id: 'washing-oct-2', tenantId: 'tenant-2', category: 'WASHING_MACHINE', description: 'October optional washing charge', amountCents: 8_000, entryMethod: 'MANUAL' },
  )
  const octoberElectricity = charges.find(charge => charge.id === 'electricity-old')
  if (octoberElectricity?.category === 'ELECTRICITY') {
    charges.push({ ...octoberElectricity, id: 'electricity-oct-1', tenantId: 'tenant-1', description: 'October sample electricity for Room 101' })
  }

  const payments: Payment[] = []
  const paymentAllocations: PaymentAllocation[] = []
  // Explicit fixture allocations; categories can be paid separately on different dates.
  const examples = [
    { id: 'payment-old', tenantId: 'tenant-10', paidOn: '2026-11-02', items: [['rent-old', 300_000], ['water-old', 10_000], ['electricity-old', 14_400]] },
    { id: 'payment-oct-1', tenantId: 'tenant-1', paidOn: '2026-11-02', items: [['water-oct-1', 15_000], ['electricity-oct-1', 14_400]] },
    { id: 'payment-oct-2', tenantId: 'tenant-2', paidOn: '2026-11-02', items: [['water-oct-2', 15_000], ['washing-oct-2', 8_000]] },
    { id: 'payment-oct-4-rent', tenantId: 'tenant-4', paidOn: '2026-11-02', items: [['rent-oct-4', 350_000]] },
    { id: 'payment-1-water', tenantId: 'tenant-1', paidOn: '2026-11-08', items: [['water-1', 15_000]] },
    { id: 'payment-1-electricity', tenantId: 'tenant-1', paidOn: '2026-11-11', items: [['electricity-1', 15_600]] },
    { id: 'payment-2-water', tenantId: 'tenant-2', paidOn: '2026-11-06', items: [['water-2', 15_000]] },
    { id: 'payment-2-washing', tenantId: 'tenant-2', paidOn: '2026-11-06', items: [['washing-2', 8_000]] },
    { id: 'payment-3', tenantId: 'tenant-3', paidOn: '2026-11-05', items: [['rent-3', 350_000], ['water-3', 15_000]] },
    { id: 'payment-7', tenantId: 'tenant-7', paidOn: '2026-11-07', items: [['rent-7', 350_000]] },
  ] satisfies { id: string; tenantId: string; paidOn: string; items: [string, number][] }[]
  examples.forEach((example, index) => {
    payments.push({ id: example.id, tenantId: example.tenantId, paidOn: example.paidOn, amountCents: example.items.reduce((sum, [, amount]) => sum + amount, 0), method: index % 2 ? 'cash' : 'bank-transfer', state: 'RECORDED', correction: null })
    example.items.forEach(([chargeId, amountCents]) => paymentAllocations.push({ id: `allocation-${example.id}-${chargeId}`, paymentId: example.id, chargeId, amountCents, allocatedOn: example.paidOn, creditId: null, state: 'ACTIVE', reversalAuditEventId: null }))
  })
  payments.push({ id: 'payment-advance', tenantId: 'tenant-6', amountCents: 50_000, paidOn: '2026-11-12', method: 'cash', state: 'RECORDED', correction: null })
  const tenantCredits = [{ id: 'credit-6', tenantId: 'tenant-6', sourcePaymentId: 'payment-advance', amountCents: 50_000, createdOn: '2026-11-12' }]
  const receipts = payments.map((payment, index) => ({ id: `receipt-${index + 1}`, paymentId: payment.id, receiptNumber: `DEMO-RCT-${String(index + 1).padStart(3, '0')}`, issuedOn: payment.paidOn, amountCents: payment.amountCents, allocationIds: paymentAllocations.filter(a => a.paymentId === payment.id).map(a => a.id), state: 'ISSUED' as const }))
  const auditEvents = [{ id: 'audit-seed', actorId: 'demo-admin', occurredOn: DEMO_DATE, action: 'DEMO_SEEDED' as const, entityType: 'PROTOTYPE' as const, entityId: 'demo-workspace', reason: 'Fictional fixture snapshot prepared; no real transaction or authenticated actor.', beforeSnapshot: null, afterSnapshot: 'Sample records loaded' }]
  return { tenants, rooms, roomAssignments, electricityMeters, meterReadings, electricityRates, billingPeriods, charges, payments, paymentAllocations, tenantCredits, receipts, auditEvents }
}
