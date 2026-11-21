import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { parsePrototypeSnapshot, STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'
import { roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { chargeRoom, paymentRooms } from '@/domain/calculations/room-finance'
import { selectSummary } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'

// Reconstruct the previous fixture's labels/serials, with saved user changes and a correction.
// This is legacy input to migration tests, never a proposed legacy-to-actual mapping.
function legacySnapshotData() {
  const data = createDemoData()
  data.rooms.forEach((room, index) => { room.name = String(101 + index) })
  data.electricityMeters.forEach((meter, index) => {
    meter.label = `Room ${101 + index} meter`
    meter.serialNumber = `FICTIONAL-MTR-${101 + index}`
  })
  data.rooms[8]!.name = 'Saved custom room'
  data.tenants[0]!.notes = 'Retain this saved note'
  const corrected = preparePaymentCorrection(data, {
    paymentId: 'payment-1-rent-water-washing', selectedCategories: ['RENT', 'WASHING_MACHINE'],
    correctedElectricityReadingMilliKwh: null, reason: 'Saved amount correction',
    settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE,
  })
  if (!corrected.ok) throw new Error('Legacy test correction failed')
  return corrected.data
}

describe('actual boarding house configuration', () => {
  it('initializes exactly the 15 string room numbers with category-based rates', () => {
    const data = createDemoData()
    const groups = [
      { category: 'RATE_3500', names: ['1', '2', '3', '4', '5', '6', '7', '8'], cents: 350_000 },
      { category: 'RATE_4000', names: ['01', '03', '04', '05', '06', '07'], cents: 400_000 },
      { category: 'RATE_5000', names: ['02'], cents: 500_000 },
    ]
    expect(data.rooms).toHaveLength(15)
    expect(new Set(data.rooms.map(room => room.id)).size).toBe(15)
    expect(new Set(data.rooms.map(room => room.name)).size).toBe(15)
    for (const group of groups) {
      const rooms = data.rooms.filter(room => room.categoryId === group.category)
      expect(rooms.map(room => room.name)).toEqual(group.names)
      for (const room of rooms) {
        expect(typeof room.name).toBe('string')
        expect(roomMonthlyRentCents(data, room, DEMO_DATE)).toBe(group.cents)
      }
    }
    const publicRoom = data.rooms.find(room => room.name === '2')!
    const airconRoom = data.rooms.find(room => room.name === '02')!
    expect(publicRoom.id).not.toBe(airconRoom.id)
    // Rate selection depends on the category, even when the label changes.
    const renamedAirconRoom = { ...airconRoom, name: '2' }
    expect(roomMonthlyRentCents(data, renamedAirconRoom, DEMO_DATE)).toBe(500_000)
    expect(isPrototypeData(data)).toBe(true)
    expect(selectSummary(data, DEMO_DATE, DEMO_PERIOD)).toMatchObject({ billed: 1_522_500, applied: 1_152_500 })
    for (const assignment of data.roomAssignments) expect(data.rooms.some(room => room.id === assignment.roomId)).toBe(true)
    for (const obligation of data.electricityBillObligations) {
      expect(data.rooms.some(room => room.id === obligation.roomId)).toBe(true)
      expect(data.meterReadings.find(reading => reading.id === obligation.previousReadingId)?.meterId).toBe(obligation.meterId)
    }
  })

  it('repeated fresh loads and saved round trips do not append rooms or lose zeros', async () => {
    const first = await localStorageRepository.load()
    const second = await localStorageRepository.load()
    expect(first.data).toEqual(second.data)
    await localStorageRepository.save(first.data)
    const saved = await localStorageRepository.load()
    expect(saved.data).toEqual(first.data)
    expect(saved.data.rooms.find(room => room.name === '02')?.id).toBe('room-15')
    expect(saved.data.rooms).toHaveLength(15)
  })

  it('selects Room 2 and Room 02 independently using permanent IDs', async () => {
    const user = userEvent.setup()
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/rooms']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    await user.click(await screen.findByRole('button', { name: 'Room 02 details' }))
    let dialog = screen.getByRole('dialog', { name: 'Room 02' })
    expect(dialog).toHaveTextContent('₱5,000.00/month')
    expect(dialog).toHaveTextContent('Private CR + Aircon')
    await user.click(within(dialog).getByRole('button', { name: 'Edit Room' }))
    dialog = screen.getByRole('dialog', { name: 'Edit Room 02' })
    expect(within(dialog).getByLabelText('Room number or name')).toHaveValue('02')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Room 02' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Match the shared 240ms animated-close lifecycle before selecting another room.
    await new Promise(resolve => setTimeout(resolve, 260))
    await user.click(await screen.findByRole('button', { name: 'Room 2 details' }))
    dialog = await screen.findByRole('dialog', { name: 'Room 2' })
    expect(dialog).toHaveTextContent('₱3,500.00/month')
    expect(dialog).toHaveTextContent('Public CR')
    expect(dialog).toHaveTextContent('Sam Navarro')
    expect(dialog).toHaveTextContent('Room 2 meter')
  })
})

describe('non-destructive version 8/9/10 to 11 migration', () => {
  it('preserves the complete saved dataset, including corrections, labels, and rate history', async () => {
    const legacy = legacySnapshotData()
    const before = JSON.stringify(legacy)
    const raw = JSON.stringify({ version: 8, data: legacy })
    localStorage.setItem(STORAGE_KEY, raw)
    const loaded = await localStorageRepository.load()
    expect(loaded.canPersist).toBe(true)
    expect(JSON.stringify(loaded.data)).toBe(before)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
    expect(chargeRoom(loaded.data, loaded.data.charges.find(charge => charge.id === 'rent-nov-room-1')!).label).toBe('Room 101')
    const payment = loaded.data.payments.find(item => item.id === 'payment-1-rent-water-washing')!
    const receipt = loaded.data.receipts.find(item => item.paymentId === payment.id)!
    expect(paymentRooms(loaded.data, payment, receipt.issuedOn, receipt.allocationIds).label).toBe('Room 101')
    await localStorageRepository.save(loaded.data)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(STORAGE_SCHEMA_VERSION)
    expect((await localStorageRepository.load()).data).toEqual(legacy)
    expect(parsePrototypeSnapshot(JSON.stringify({ version: 9, data: legacy }))).toEqual({ ok: true, data: legacy })
    // Migration is idempotent; no append/rename/ownership changes on repeat loads.
    expect((await localStorageRepository.load()).data).toEqual(legacy)
    expect(isPrototypeData(legacy)).toBe(true)
  })

  it('keeps custom rooms and conflicting target numbers instead of merging them', () => {
    const legacy = legacySnapshotData()
    legacy.rooms.push({ ...legacy.rooms[0]!, id: 'room-user-created', name: '02' })
    const parsed = parsePrototypeSnapshot(JSON.stringify({ version: 8, data: legacy }))
    expect(parsed).toEqual({ ok: true, data: legacy })
    if (!parsed.ok) return
    expect(parsed.data.rooms).toHaveLength(16)
    expect(parsed.data.rooms.find(room => room.id === 'room-user-created')?.name).toBe('02')
    expect(parsed.data.rooms.find(room => room.id === 'room-15')?.name).toBe('115')
  })

  it('shows the legacy-layout notice while retaining all saved room labels', async () => {
    const legacy = legacySnapshotData()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 8, data: legacy }))
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/rooms']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    expect(await screen.findByRole('button', { name: 'Room 101 details' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('owner-approved correspondence is required')
    expect(screen.queryByRole('button', { name: 'Room 1 details' })).not.toBeInTheDocument()
  })
})
