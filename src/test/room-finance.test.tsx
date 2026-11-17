import { screen, within } from '@testing-library/react'
import { renderWithTheme as render } from './test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { chargeRoom, financialTotals, paymentRooms, selectRoomDues, selectRoomFinance } from '@/domain/calculations/room-finance'
import { chargeBalance, chargeStatus, issuedCharges, selectSummary } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { BillingStatusMatrix } from '@/features/billing/billing-status-matrix'
import { roomReportCsv } from '@/features/reports/room-report'

function blankLedger(): PrototypeAppState {
  return { ...createDemoData(), charges: [], electricityBillObligations: [], payments: [], paymentAllocations: [], tenantCredits: [], receipts: [] }
}

function water(id: string, overrides: Partial<Charge> = {}): Charge {
  return { id, tenantId: 'tenant-6', category: 'WATER', amountCents: 15000, billingPeriodId: DEMO_PERIOD,
    issuedOn: '2026-11-01', dueDate: '2026-11-20', description: 'Test obligation', state: 'ISSUED', correction: null, entryMethod: 'MANUAL', ...overrides } as Charge
}

function transfer(data: PrototypeAppState) {
  data.tenants.find(item => item.id === 'tenant-10')!.status = 'ACTIVE'
  data.roomAssignments.push({ id: 'transfer-10', tenantId: 'tenant-10', roomId: 'room-3', startDate: '2026-11-01', endDate: null, agreedRentCents: 350000 })
}

function csvRows(text: string) {
  return text.trim().split('\r\n').map(row => [...row.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1]!.replaceAll('""', '"')))
}

describe('room financial presentation and reconciliation', () => {
  it('shows only electricity and water from the latest transaction, excluding rent paid earlier', async () => {
    const data = blankLedger()
    data.charges = createDemoData().charges.filter(charge => ['rent-oct-room-1', 'electricity-nov-room-1', 'water-nov-tenant-1'].includes(charge.id))
    const earlier = { id: 'earlier-rent', tenantId: 'tenant-1', amountCents: 350000, paidOn: '2026-11-03', method: 'cash' as const, state: 'RECORDED' as const, correction: null }
    const latest = { ...earlier, id: 'latest-utilities', amountCents: 26900, paidOn: DEMO_DATE }
    data.payments = [earlier, latest]
    data.paymentAllocations = data.charges.map(charge => ({ id: `allocated-${charge.id}`, paymentId: charge.category === 'RENT' ? earlier.id : latest.id, chargeId: charge.id, amountCents: charge.amountCents, allocatedOn: charge.category === 'RENT' ? earlier.paidOn : latest.paidOn, state: 'ACTIVE' as const, creditId: null, reversalAuditEventId: null }))
    expect(isPrototypeData(data)).toBe(true)
    const before = JSON.stringify(data)
    const user = userEvent.setup()
    render(<PaymentHistoryTable data={data} payments={[latest]} compact transactionDisplay="categories" />)
    await user.click(screen.getByText('See all transaction'))
    const boxes = screen.getAllByRole('listitem')
    expect(boxes.map(box => box.getAttribute('data-category'))).toEqual(['ELECTRICITY', 'WATER'])
    expect(boxes.every(box => box.getAttribute('data-paid') === 'true')).toBe(true)
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
    expect(screen.queryByText('Washing')).not.toBeInTheDocument()
    expect(JSON.stringify(data)).toBe(before)
  })

  it('shows historical room bills once, even after both occupants moved out', () => {
    const data = createDemoData()
    const rows = selectRoomFinance(data, DEMO_DATE, 'period-oct')
    expect(rows).toHaveLength(5)
    expect(rows.find(row => row.id === 'room-5')).toMatchObject({ context: { label: 'Room 105' }, billed: 393000, paid: 393000, outstanding: 0, unresolved: 0, paymentStatus: 'PAID' })
    expect(rows.find(row => row.id === 'room-1')).toMatchObject({ billed: 385600, paid: 385600, outstanding: 0, paymentStatus: 'PAID' })
    expect(rows.find(row => row.id === 'room-2')).toMatchObject({ billed: 380000, paid: 30000, outstanding: 350000, paymentStatus: 'PARTLY_PAID' })
  })

  it('groups two occupants under one shared-room rent charge without duplication', () => {
    const data = createDemoData()
    const rows = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD)
    expect(rows).toHaveLength(4)
    const shared = rows.find(row => row.id === 'room-2')!
    expect(shared).toMatchObject({ billed: 380000, paid: 380000, outstanding: 0, unresolved: 1, partial: 0, overdue: 0, paymentStatus: 'PARTLY_PAID' })
    expect(new Set(shared.charges.map(charge => charge.tenantId)).size).toBe(2)
    expect(shared.charges.filter(charge => charge.category === 'RENT')).toHaveLength(1)
    expect(shared.charges).toHaveLength(4)
    const ids = rows.flatMap(row => row.charges.map(charge => charge.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(issuedCharges(data, DEMO_DATE, DEMO_PERIOD).map(charge => charge.id).sort())
    for (const row of rows) expect(row.outstanding).toBe(row.charges.reduce((sum, charge) => sum + chargeBalance(data, charge, DEMO_DATE), 0))
  })

  it.each([undefined, 'period-oct', DEMO_PERIOD])('reconciles every room/context with the unchanged ledger for %s', periodId => {
    const data = createDemoData()
    const before = JSON.stringify(data)
    const rows = selectRoomFinance(data, DEMO_DATE, periodId)
    const original = selectSummary(data, DEMO_DATE, periodId)
    expect(rows.reduce((sum, row) => sum + row.billed, 0)).toBe(original.billed)
    expect(rows.reduce((sum, row) => sum + row.paid, 0)).toBe(original.applied)
    expect(rows.reduce((sum, row) => sum + row.outstanding, 0)).toBe(original.outstanding)
    expect(rows.every(row => row.outstanding >= 0 && row.billed === row.paid + row.outstanding)).toBe(true)
    expect(JSON.stringify(data)).toBe(before)
    expect(selectSummary(data, DEMO_DATE, DEMO_PERIOD)).toMatchObject({ billed: 1522500, applied: 1152500, outstanding: 370000, received: 2011100, unresolved: 2, credit: 50000 })
  })

  it('applies a partial payment only to the room of its referenced charge', () => {
    const data = createDemoData()
    const original = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD)
    data.payments.push({ id: 'extra', tenantId: 'tenant-5', amountCents: 5000, paidOn: DEMO_DATE, method: 'cash', state: 'RECORDED', correction: null })
    data.paymentAllocations.push({ id: 'extra-allocation', paymentId: 'extra', chargeId: 'water-nov-tenant-5', amountCents: 5000, allocatedOn: DEMO_DATE, state: 'ACTIVE', creditId: null, reversalAuditEventId: null })
    expect(isPrototypeData(data)).toBe(true)
    const rows = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD)
    expect(rows.find(row => row.id === 'room-4')?.outstanding).toBe(365000)
    expect(rows.filter(row => row.id !== 'room-4')).toEqual(original.filter(row => row.id !== 'room-4'))
  })

  it('does not count advance credits toward bills and uses payment-date context only for unallocated money', () => {
    const data = createDemoData()
    expect(selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD).find(row => row.id === 'room-3')).toMatchObject({ paid: 385600, outstanding: 0 })
    const advance = paymentRooms(data, data.payments.find(payment => payment.id === 'payment-advance')!, DEMO_DATE)
    expect(advance).toMatchObject({ label: 'Room 103', unallocated: 50000, allocations: [] })
    expect(advance.note).toContain('context only')
  })

  it('keeps historical bills in their original rooms after a later transfer and payment', () => {
    const data = createDemoData()
    transfer(data)
    expect(isPrototypeData(data)).toBe(true)
    for (const charge of data.charges.filter(charge => charge.tenantId === 'tenant-10')) expect(chargeRoom(data, charge).label).toBe('Room 105')
    expect(paymentRooms(data, data.payments.find(payment => payment.id === 'payment-old')!, DEMO_DATE).label).toBe('Room 105')
    expect(selectRoomFinance(data, DEMO_DATE, 'period-oct')[0]?.billed).toBe(385600)
  })

  it('does not guess a utility room when a tenant moved within the billed period', () => {
    const data = createDemoData()
    data.roomAssignments.find(item => item.id === 'assignment-1')!.endDate = '2026-11-14'
    data.roomAssignments.push({ id: 'mid-period-transfer', tenantId: 'tenant-1', roomId: 'room-2', startDate: '2026-11-15', endDate: null, agreedRentCents: 350000 })
    expect(isPrototypeData(data)).toBe(true)
    expect(chargeRoom(data, data.charges.find(charge => charge.id === 'rent-nov-room-1')!).label).toBe('Room 101')
    expect(chargeRoom(data, data.charges.find(charge => charge.id === 'water-nov-tenant-1')!).source).toBe('unresolved')
    const rows = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD)
    expect(rows.filter(row => row.context.roomId === null)).toHaveLength(3)
    expect(rows.reduce((sum, row) => sum + row.billed, 0)).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).billed)
  })

  it('retains missing-assignment charges in explicit review buckets', () => {
    const data = blankLedger()
    data.roomAssignments = data.roomAssignments.filter(item => item.tenantId !== 'tenant-6')
    data.charges = [water('unknown-room')]
    expect(isPrototypeData(data)).toBe(true)
    const rows = selectRoomFinance(data, DEMO_DATE)
    expect(rows[0]).toMatchObject({ context: { label: 'Room needs review' }, outstanding: 15000 })
  })

  it('combines unpaid categories on one room due date while keeping dates and periods separate', () => {
    const data = blankLedger()
    data.charges = [water('one'), water('two', { tenantId: 'tenant-3' }), water('later', { dueDate: '2026-11-21' }), water('washing', { category: 'WASHING_MACHINE' }), water('other-period', { billingPeriodId: 'period-oct' })]
    const rows = selectRoomDues(data, DEMO_DATE)
    const combined = rows.find(row => row.charges.some(charge => charge.id === 'one'))!
    expect(combined.charges.map(charge => charge.id)).toEqual(['one', 'two', 'washing'])
    expect(combined.categories).toEqual(['WATER', 'WASHING_MACHINE'])
    expect(combined.outstanding).toBe(45000)
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.dueDate)).toContain('2026-11-21')
    data.payments.push({ id: 'partial', tenantId: 'tenant-6', amountCents: 5000, paidOn: DEMO_DATE, method: 'cash', state: 'RECORDED', correction: null })
    data.paymentAllocations.push({ id: 'partial-allocation', paymentId: 'partial', chargeId: 'one', amountCents: 5000, allocatedOn: DEMO_DATE, state: 'ACTIVE', creditId: null, reversalAuditEventId: null })
    expect(selectRoomDues(data, DEMO_DATE)).toHaveLength(3)
    expect(selectRoomDues(data, DEMO_DATE)[0]).toMatchObject({ status: 'PARTIALLY_PAID', outstanding: 40000 })
  })

  it('shows only unpaid categories in the current due-date groups', () => {
    const data = createDemoData()
    const dues = selectRoomDues(data, DEMO_DATE)
    expect(dues.map(group => [group.context.label, group.categories, group.outstanding])).toEqual([
      ['Room 102', ['ELECTRICITY'], 0],
      ['Room 104', ['RENT', 'ELECTRICITY', 'WATER'], 370000],
    ])
    const room104 = dues[1]!
    expect(room104.charges.some(charge => charge.id === 'rent-nov-room-4' && charge.tenantId === 'tenant-5')).toBe(true)
    expect(data.charges.some(charge => charge.id === 'electricity-nov-room-4')).toBe(false)
    expect(data.charges.find(charge => charge.id === 'electricity-nov-room-3')?.category).toBe('ELECTRICITY')
    for (const id of ['rent-nov-room-3', 'water-nov-tenant-3', 'water-nov-tenant-6', 'electricity-nov-room-3']) {
      expect(chargeStatus(data, data.charges.find(charge => charge.id === id)!, DEMO_DATE)).toBe('PAID')
    }
  })

  it('preserves a multi-room payment as one transaction and exposes exact allocation amounts and remainder', async () => {
    const user = userEvent.setup()
    const data = blankLedger()
    transfer(data)
    data.charges = [
      { id: 'old-water', tenantId: 'tenant-10', category: 'WATER', amountCents: 15000, billingPeriodId: 'period-oct', issuedOn: '2026-10-31', dueDate: '2026-11-05', description: 'Old obligation', state: 'ISSUED', entryMethod: 'MANUAL', correction: null },
      { id: 'new-water', tenantId: 'tenant-10', category: 'WATER', amountCents: 20000, billingPeriodId: DEMO_PERIOD, issuedOn: '2026-11-01', dueDate: '2026-11-20', description: 'New obligation', state: 'ISSUED', entryMethod: 'MANUAL', correction: null },
    ]
    const payment = { id: 'multi', tenantId: 'tenant-10', amountCents: 25000, paidOn: DEMO_DATE, method: 'cash' as const, state: 'RECORDED' as const, correction: null }
    data.payments = [payment]
    data.paymentAllocations = data.charges.map(charge => ({ id: `allocation-${charge.id}`, paymentId: payment.id, chargeId: charge.id, amountCents: 10000, allocatedOn: DEMO_DATE, state: 'ACTIVE' as const, creditId: null, reversalAuditEventId: null }))
    expect(isPrototypeData(data)).toBe(true)
    const context = paymentRooms(data, payment, DEMO_DATE)
    expect(context.label).toBe('Multiple rooms / contexts')
    expect(context.allocations.map(item => [item.context.label, item.amountCents])).toEqual([['Room 105', 10000], ['Room 103', 10000]])
    expect(context.unallocated).toBe(5000)
    render(<PaymentHistoryTable data={data} payments={data.payments} />)
    const region = screen.getByRole('region', { name: 'Payment history' })
    expect(within(region).getAllByRole('row')).toHaveLength(2)
    expect(region).toHaveTextContent('Multiple rooms / contexts')
    expect(within(region).queryByRole('columnheader', { name: 'What was paid' })).not.toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: /See Transaction/ }))
    const dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent('Multiple rooms / contexts')
    expect(within(dialog).getByText('Room 105')).toBeInTheDocument()
    expect(within(dialog).getByText('Room 103')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Paid by: Quinn Mendoza')
    expect(dialog).toHaveTextContent('Payment ID: multi')
    expect(dialog).toHaveTextContent('Water')
    expect(dialog).toHaveTextContent('Unallocated amount')
    expect(dialog).toHaveTextContent('₱50.00')
  })

  it('does not count voided payments or reversed allocations as collected bill money', () => {
    const data = createDemoData()
    const payment = data.payments.find(item => item.id === 'payment-1-electricity')!
    payment.state = 'VOIDED'
    data.receipts.find(item => item.paymentId === payment.id)!.state = 'VOIDED'
    const allocation = data.paymentAllocations.find(item => item.paymentId === payment.id)!
    allocation.state = 'REVERSED'
    allocation.reversalAuditEventId = 'reversal'
    data.auditEvents.push({ id: 'reversal', actorId: 'admin', occurredOn: DEMO_DATE, action: 'ALLOCATION_REVERSED', entityType: 'PAYMENT_ALLOCATION', entityId: allocation.id, reason: 'Test void', beforeSnapshot: '{}', afterSnapshot: '{}' })
    expect(isPrototypeData(data)).toBe(true)
    expect(selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD).find(row => row.id === 'room-1')).toMatchObject({ paid: 370000, outstanding: 16900, paymentStatus: 'PARTLY_PAID' })
    expect(selectSummary(data, DEMO_DATE, DEMO_PERIOD)).toMatchObject({ applied: 1135600, received: 1994200 })
  })

  it('does not attribute an unallocated remainder or future allocation to current bill collections', () => {
    const data = blankLedger()
    data.charges = [water('water')]
    const payment = { id: 'payment', tenantId: 'tenant-6', amountCents: 20000, paidOn: DEMO_DATE, method: 'cash' as const, state: 'RECORDED' as const, correction: null }
    data.payments = [payment]
    data.paymentAllocations = [{ id: 'later', paymentId: payment.id, chargeId: 'water', amountCents: 10000, allocatedOn: '2026-11-14', state: 'ACTIVE', creditId: null, reversalAuditEventId: null }]
    expect(isPrototypeData(data)).toBe(true)
    expect(selectRoomFinance(data, DEMO_DATE)[0]).toMatchObject({ paid: 0, outstanding: 15000 })
    expect(paymentRooms(data, payment, DEMO_DATE)).toMatchObject({ unallocated: 20000, allocations: [] })
    expect(paymentRooms(data, payment, '2026-11-14')).toMatchObject({ label: 'Room 103 + unallocated', unallocated: 10000 })
    expect(selectRoomFinance(data, '2026-11-14')[0]).toMatchObject({ paid: 10000, outstanding: 5000 })
  })

  it('retains receipt issue-time room context after a later reversal, transfer and reallocation', () => {
    const data = createDemoData()
    data.roomAssignments.find(item => item.id === 'assignment-1')!.endDate = '2026-11-14'
    data.roomAssignments.push({ id: 'transfer-1', tenantId: 'tenant-1', roomId: 'room-2', startDate: '2026-11-15', endDate: null, agreedRentCents: 350000 })
    const rent = data.charges.find(charge => charge.id === 'rent-nov-room-1')!
    if (rent.category !== 'RENT') throw new Error('Rent fixture missing')
    data.charges.push({ ...rent, id: 'rent-after-transfer', amountCents: 175000, agreedRentCents: 175000, roomAssignmentId: 'transfer-1', issuedOn: '2026-11-16', dueDate: '2026-11-20' })
    const oldAllocations = data.paymentAllocations.filter(item => item.paymentId === 'payment-oct-1')
    oldAllocations.forEach((allocation, index) => {
      allocation.state = 'REVERSED'
      allocation.reversalAuditEventId = `transfer-reversal-${index}`
      data.auditEvents.push({ id: allocation.reversalAuditEventId, actorId: 'admin', occurredOn: '2026-11-16', action: 'ALLOCATION_REVERSED', entityType: 'PAYMENT_ALLOCATION', entityId: allocation.id, reason: 'Test reallocation', beforeSnapshot: '{}', afterSnapshot: '{}' })
    })
    data.paymentAllocations.push({ id: 'new-allocation', paymentId: 'payment-oct-1', chargeId: 'rent-after-transfer', amountCents: 175000, allocatedOn: '2026-11-16', state: 'ACTIVE', creditId: null, reversalAuditEventId: null })
    expect(isPrototypeData(data)).toBe(true)
    const payment = data.payments.find(item => item.id === 'payment-oct-1')!
    const receipt = data.receipts.find(item => item.paymentId === payment.id)!
    expect(paymentRooms(data, payment, '2026-11-20')).toMatchObject({ label: 'Room 102 + unallocated', unallocated: 210600 })
    expect(paymentRooms(data, payment, receipt.issuedOn, receipt.allocationIds).label).toBe('Room 101')
    expect(receipt.allocationIds).toEqual(oldAllocations.map(allocation => allocation.id))
  })

  it('shows one settled room Rent charge and a PAID room status', () => {
    const data = createDemoData()
    const room = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD).find(row => row.id === 'room-3')!
    expect(financialTotals(data, room.charges.filter(charge => charge.category === 'RENT'), DEMO_DATE)).toMatchObject({ billed: 350000, paid: 350000, outstanding: 0, status: 'PAID' })
    render(<BillingStatusMatrix data={data} periodId={DEMO_PERIOD} asOf={DEMO_DATE} outstandingOnly={false} />)
    const row = screen.getByRole('row', { name: /Room 103/ })
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('PAID')
    expect(cells[2]).toHaveTextContent('PAID')
    expect(cells[3]).toHaveTextContent('PAID')
    expect(cells[4]).toHaveTextContent('DID NOT AVAIL')
    expect(cells[5]).toHaveTextContent('Paid')
    expect(row).not.toHaveTextContent(/left to pay|not yet paid/i)
    expect(within(screen.getByRole('region', { name: 'Who has paid' })).getAllByRole('row')).toHaveLength(5)
    expect(screen.queryByRole('columnheader', { name: 'Underlying charges' })).not.toBeInTheDocument()
  })

  it('shows DID NOT AVAIL only for a skipped washing charge while other missing categories remain NO BILL', () => {
    const data = createDemoData()
    data.charges = data.charges.filter(charge => !(charge.category === 'WATER' && charge.billingPeriodId === DEMO_PERIOD && chargeRoom(data, charge).id === 'room-3'))
    render(<BillingStatusMatrix data={data} periodId={DEMO_PERIOD} asOf={DEMO_DATE} outstandingOnly={false} />)
    const cells = within(screen.getByRole('row', { name: /Room 103/ })).getAllByRole('cell')
    expect(cells[3]).toHaveTextContent('NO BILL')
    expect(cells[4]).toHaveTextContent('DID NOT AVAIL')
  })

  it('shows NOT YET PAID for electricity and an amount for unpaid washing', () => {
    const data = createDemoData()
    const washing = data.charges.find(charge => charge.id === 'washing-nov-room-1')!
    data.charges.push({ ...washing, id: 'washing-extra-unpaid', tenantId: 'tenant-5' })
    render(<BillingStatusMatrix data={data} periodId={DEMO_PERIOD} asOf={DEMO_DATE} outstandingOnly={false} />)
    const row = screen.getByRole('row', { name: /Room 104/ })
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('₱3,500.00')
    expect(cells[2]).toHaveTextContent('AWAITING READING')
    expect(cells[2]).not.toHaveTextContent('₱')
    expect(cells[3]).toHaveTextContent('₱200.00')
    expect(cells[4]).toHaveTextContent('₱100.00')
    expect(cells[5]).toHaveTextContent('NOT YET PAID')
  })

  it.each(['period-oct', DEMO_PERIOD])('exports the same room totals and charge IDs as the %s report', periodId => {
    const data = createDemoData()
    const [header, ...csv] = csvRows(roomReportCsv(data, DEMO_DATE, periodId))
    expect(header?.slice(0, 6)).toEqual(['Room', 'Billing period', 'Total billed (PHP)', 'Applied to bills (PHP)', 'Outstanding (PHP)', 'Unresolved electricity bills'])
    const rows = selectRoomFinance(data, DEMO_DATE, periodId)
    expect(csv).toHaveLength(rows.length)
    for (const [index, row] of rows.entries()) {
      expect(csv[index]?.[0]).toBe(row.context.label)
      expect(csv[index]?.slice(2, 5)).toEqual([row.billed, row.paid, row.outstanding].map(value => (value / 100).toFixed(2)))
      expect(csv[index]?.[5]).toBe(String(row.unresolved))
      expect(csv[index]?.[8]?.split('; ').filter(Boolean).sort()).toEqual(row.charges.map(charge => charge.id).sort())
    }
    const summary = selectSummary(data, DEMO_DATE, periodId)
    expect(csv.reduce((sum, row) => sum + Math.round(Number(row[2]) * 100), 0)).toBe(summary.billed)
    expect(csv.reduce((sum, row) => sum + Math.round(Number(row[3]) * 100), 0)).toBe(summary.applied)
    expect(csv.reduce((sum, row) => sum + Math.round(Number(row[4]) * 100), 0)).toBe(summary.outstanding)
    expect(csv.reduce((sum, row) => sum + Number(row[5]), 0)).toBe(summary.unresolved)
  })

  it('escapes CSV text and retains unresolved rows rather than dropping amounts', () => {
    const data = blankLedger()
    data.billingPeriods.find(period => period.id === DEMO_PERIOD)!.label = '=SUM(1,2) "sample"'
    data.roomAssignments = []
    data.charges = [water('needs-review')]
    const csv = csvRows(roomReportCsv(data, DEMO_DATE, DEMO_PERIOD))
    expect(csv[1]?.[0]).toBe('Room needs review')
    expect(csv[1]?.[1]).toBe('\'=SUM(1,2) "sample"')
    expect(csv[1]?.[4]).toBe('150.00')
    expect(csv[1]?.[5]).toBe('0')
    expect(csv[1]?.[6]).toBe('Not yet paid')
    expect(csv[1]?.[7]).toBe('unresolved')
  })
})
