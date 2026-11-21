import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { parsePrototypeSnapshot } from '@/data/repositories/prototype-storage'
import { applyRateChange, planRateChange, roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { calculateElectricityCharge } from '@/domain/calculations/electricity-calculation'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { chargeRoom, paymentRooms, selectRoomDues, selectRoomFinance } from '@/domain/calculations/room-finance'
import { roomOccupants, selectSummary } from '@/domain/calculations/summary'
import { roomReportCsv } from '@/features/reports/room-report'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'

function roomByName(data: ReturnType<typeof createDemoData>, name: string) {
  const room = data.rooms.find(item => item.name === name)
  if (!room) throw new Error(`Room ${name} is missing`)
  return room
}

describe('room numbering across billing and payments', () => {
  it('calculates each category from its room while preserving rate history and issued bills', () => {
    const data = createDemoData()
    expect(roomByName(data, '2').id).toBe('room-2')
    expect(roomByName(data, '2').categoryId).toBe('RATE_3500')
    expect(roomByName(data, '01').id).toBe('room-9')
    expect(roomByName(data, '01').categoryId).toBe('RATE_4000')
    expect(roomByName(data, '02').id).toBe('room-15')
    expect(roomByName(data, '02').categoryId).toBe('RATE_5000')
    expect(roomMonthlyRentCents(data, roomByName(data, '2'), DEMO_DATE)).toBe(350_000)
    expect(roomMonthlyRentCents(data, roomByName(data, '01'), DEMO_DATE)).toBe(400_000)
    expect(roomMonthlyRentCents(data, roomByName(data, '02'), DEMO_DATE)).toBe(500_000)

    const plan = planRateChange(data, {
      kind: 'RENT', values: { RATE_3500: 360_000, RATE_4000: 410_000, RATE_5000: 510_000 },
    }, DEMO_DATE)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const updated = applyRateChange(data, plan.plan)
    expect(roomMonthlyRentCents(updated, roomByName(updated, '2'), DEMO_DATE)).toBe(350_000)
    expect(roomMonthlyRentCents(updated, roomByName(updated, '2'), plan.plan.effectiveFrom)).toBe(360_000)
    expect(roomMonthlyRentCents(updated, roomByName(updated, '01'), plan.plan.effectiveFrom)).toBe(410_000)
    expect(roomMonthlyRentCents(updated, roomByName(updated, '02'), plan.plan.effectiveFrom)).toBe(510_000)
    expect(updated.charges).toEqual(data.charges)
    expect(updated.roomAssignments).toEqual(data.roomAssignments)
    expect(updated.payments).toEqual(data.payments)
    expect(updated.roomRentRates.length).toBeGreaterThan(data.roomRentRates.length)
  })

  it('keeps Room 2 and Room 02 financially separate through receipts and corrections', () => {
    const data = createDemoData()
    expect(data.charges.filter(charge => chargeRoom(data, charge).roomId === 'room-15')).toHaveLength(0)
    expect(data.payments.filter(payment => paymentRooms(data, payment, DEMO_DATE).allocations.some(item => item.context.roomId === 'room-15'))).toHaveLength(0)
    expect(data.roomAssignments.filter(assignment => assignment.roomId === 'room-15')).toHaveLength(0)
    expect(data.electricityBillObligations.filter(obligation => obligation.roomId === 'room-15')).toHaveLength(0)

    const room2Receipts = selectTenantReceipts(data, 'tenant-2')
    expect(room2Receipts.receipts.map(view => view.receipt.receiptNumber).sort()).toEqual(['DEMO-RCT-003', 'DEMO-RCT-008', 'DEMO-RCT-009'])
    for (const view of room2Receipts.receipts) {
      expect(view.rooms.label).toBe('Room 2')
      for (const allocation of view.rooms.allocations) expect(allocation.context.roomId).toBe('room-2')
    }
    expect(room2Receipts.receipts.some(view => view.rooms.label.includes('02'))).toBe(false)

    const originalReceipt = data.receipts.find(receipt => receipt.receiptNumber === 'DEMO-RCT-008')!
    const result = preparePaymentCorrection(data, {
      paymentId: 'payment-2-water', selectedCategories: ['WATER'], correctedElectricityReadingMilliKwh: null,
      reason: 'Verify Room 2 numbering', settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.receiptNumber).toBe('DEMO-RCT-008-R2')
    expect(result.data.charges).toEqual(data.charges)

    const views = selectTenantReceipts(result.data, 'tenant-2').receipts
    const revised = views.find(view => view.receipt.id === result.receipt.id)!
    const superseded = views.find(view => view.receipt.id === originalReceipt.id)!
    expect(revised.effective).toBe(true)
    expect(revised.rooms.label).toBe('Room 2')
    expect(superseded.effective).toBe(false)
    expect(superseded.rooms.label).toBe('Room 2')
    expect(superseded.receipt.amountCents).toBe(originalReceipt.amountCents)
    expect(superseded.receipt.allocationIds).toEqual(originalReceipt.allocationIds)
    expect(views.filter(view => view.effective).map(view => view.receipt.receiptNumber).sort()).toEqual(['DEMO-RCT-003', 'DEMO-RCT-008-R2', 'DEMO-RCT-009'])
    expect(views.some(view => view.rooms.label === 'Room 02')).toBe(false)
    expect(selectTenantReceipts(result.data, 'tenant-4').receipts.some(view => view.receipt.id === result.receipt.id)).toBe(false)
  })
})

describe('room numbering across electricity, tenants, dashboard, and reports', () => {
  it('keeps Room 2 electricity on its own meter with Room 02 untouched', () => {
    const data = createDemoData()
    const meter = data.electricityMeters.find(item => item.id === 'meter-room-2')!
    expect(meter.label).toBe('Room 2 meter')
    expect(data.electricityMeters.some(item => item.label.startsWith('Room 02'))).toBe(false)
    expect(data.meterReadings.filter(reading => reading.meterId === 'meter-room-2').map(reading => reading.id)).toEqual(['reading-room-2-sep'])
    expect(data.meterReadings.some(reading => reading.meterId === 'meter-room-15')).toBe(false)

    const obligation = data.electricityBillObligations.find(item => item.roomId === 'room-2')!
    expect(obligation.meterId).toBe('meter-room-2')
    expect(obligation.tenantId).toBe('tenant-2')
    const calculated = calculateElectricityCharge(data, obligation.id, { readingMilliKwh: 130_000, readOn: DEMO_DATE })
    expect(calculated.ok).toBe(true)
    if (!calculated.ok) return
    expect(calculated.charge.id).toBe('electricity-period-nov-room-2')
    expect(calculated.charge.tenantId).toBe('tenant-2')
    expect(calculated.charge.electricity.meterId).toBe('meter-room-2')
    expect(calculated.currentReading.meterId).toBe('meter-room-2')

    const parsed = parsePrototypeSnapshot(JSON.stringify({ version: 8, data }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.electricityMeters).toEqual(data.electricityMeters)
    expect(parsed.data.meterReadings).toEqual(data.meterReadings)
    expect(parsed.data.electricityBillObligations).toEqual(data.electricityBillObligations)
  })

  it('preserves tenants, shared rooms, occupancy, and tenancy history', () => {
    const data = createDemoData()
    const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
    expect(summary).toMatchObject({ tenants: 7, totalRooms: 15, occupiedRooms: 4, availableRooms: 10, maintenanceRooms: 1 })
    expect(roomOccupants(data, 'room-1', DEMO_DATE).map(tenant => tenant.name)).toEqual(['Alex Rivera'])
    expect(roomOccupants(data, 'room-2', DEMO_DATE).map(tenant => tenant.name)).toEqual(['Sam Navarro', 'Morgan Cruz'])
    expect(roomOccupants(data, 'room-3', DEMO_DATE).map(tenant => tenant.name)).toEqual(['Jamie Santos', 'Jordan Flores'])
    expect(roomOccupants(data, 'room-4', DEMO_DATE).map(tenant => tenant.name)).toEqual(['Taylor Reyes', 'Riley Garcia'])
    expect(roomOccupants(data, 'room-15', DEMO_DATE)).toHaveLength(0)

    const assignment = (tenantId: string) => data.roomAssignments.find(item => item.tenantId === tenantId)!
    expect(assignment('tenant-1').roomId).toBe('room-1')
    expect(assignment('tenant-2').roomId).toBe('room-2')
    expect(assignment('tenant-4').roomId).toBe('room-2')
    expect(assignment('tenant-7')).toMatchObject({ roomId: 'room-5', endDate: '2026-10-31' })
    expect(assignment('tenant-9')).toMatchObject({ roomId: 'room-1', endDate: '2026-09-30' })
    expect(assignment('tenant-10')).toMatchObject({ roomId: 'room-5', endDate: '2026-10-31' })
    expect(data.rooms.find(room => room.name === '2')).not.toBe(data.rooms.find(room => room.name === '02'))
  })

  it('uses actual room records in dashboard and report totals without duplicates', () => {
    const data = createDemoData()
    const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
    expect(summary).toMatchObject({
      billed: 1_522_500, applied: 1_152_500, outstanding: 370_000, received: 2_011_100, credit: 50_000, unresolved: 2,
    })
    expect(data.payments).toHaveLength(14)
    expect(data.receipts).toHaveLength(14)
    expect(data.charges).toHaveLength(35)
    expect(data.paymentAllocations).toHaveLength(24)
    expect(new Set(data.payments.map(item => item.id)).size).toBe(14)
    expect(new Set(data.receipts.map(item => item.receiptNumber)).size).toBe(14)
    expect(new Set(data.charges.map(item => item.id)).size).toBe(35)

    const rows = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD)
    expect(rows.map(row => row.context.label)).toEqual(['Room 1', 'Room 2', 'Room 3', 'Room 4'])
    expect(rows.reduce((sum, row) => sum + row.billed, 0)).toBe(summary.billed)
    expect(rows.reduce((sum, row) => sum + row.paid, 0)).toBe(summary.applied)
    expect(rows.reduce((sum, row) => sum + row.outstanding, 0)).toBe(summary.outstanding)
    expect(selectRoomDues(data, DEMO_DATE).map(group => group.context.label)).toEqual(['Room 2', 'Room 4'])

    const csv = roomReportCsv(data, DEMO_DATE, DEMO_PERIOD).trim().split('\r\n')
    expect(csv).toHaveLength(5)
    expect(csv[0]).toContain('"Room"')
    expect(csv.some(line => line.startsWith('"Room 2"'))).toBe(true)
    expect(csv.some(line => line.startsWith('"Room 02"') || line.startsWith('"Room 01"'))).toBe(false)
  })

  it('shows unambiguous room labels in billing and tenant selectors', async () => {
    const user = userEvent.setup()
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)

    const matrix = await screen.findByRole('region', { name: 'Who has paid' })
    expect(within(matrix).getAllByText(/^Room \d+$/).map(element => element.textContent)).toEqual([
      'Room 1', 'Room 2', 'Room 3', 'Room 4',
    ])
    expect(within(matrix).queryByText('Room 01')).not.toBeInTheDocument()
    expect(within(matrix).queryByText('Room 02')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Calculate payment/ }))
    const calculator = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    const roomSelect = within(calculator).getByLabelText('Choose room')
    expect(within(roomSelect).getAllByRole('option').slice(1).map(option => [option.getAttribute('value'), option.textContent])).toEqual([
      ['room-1', 'Room 1'], ['room-2', 'Room 2'], ['room-3', 'Room 3'], ['room-4', 'Room 4'],
    ])
    await user.click(within(calculator).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Tenants' }))
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    const assignment = within(dialog).getByLabelText('Room assignment')
    const options = within(assignment).getAllByRole('option').map(option => [option.getAttribute('value'), option.textContent])
    const labelFor = (value: string) => options.find(([optionValue]) => optionValue === value)?.[1]
    expect(labelFor('room-2')).toMatch(/^Room 2 · /)
    expect(labelFor('room-15')).toMatch(/^Room 02 · /)
    expect(new Set(options.map(([value]) => value)).size).toBe(options.length)
  }, 15000)
})
