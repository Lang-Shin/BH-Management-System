import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { buildRoomPaymentQuote, prepareRoomPayment } from '@/domain/calculations/room-payment'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { selectBillingEligibleRooms } from '@/domain/calculations/billing-eligibility'
import { selectBillingRooms } from '@/features/billing/billing-room-status'
import { createRoom, updateRoom, type RoomDraft } from '@/domain/calculations/room-management'
import { createTenant } from '@/domain/calculations/tenant-management'
import { reconcileOccupancy } from '@/domain/calculations/move-in'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { ChargeCategory } from '@/domain/types/models'

const emptyTenant = { email: '', phone: '', address: '', notes: '', moveInDate: DEMO_DATE }

function addRoom(data: ReturnType<typeof createDemoData>, name: string, capacity = 1, categoryId: RoomDraft['categoryId'] = 'RATE_4000') {
  const result = createRoom(data, { name, capacity, categoryId, kind: 'PRIVATE', status: 'available' }, DEMO_DATE)
  if (!result.ok) throw new Error('room creation failed')
  return result
}

function addTenant(data: ReturnType<typeof createDemoData>, name: string, roomId: string) {
  const result = createTenant(data, { ...emptyTenant, name, roomId }, DEMO_DATE)
  if (!result.ok) throw new Error(`tenant creation failed: ${JSON.stringify(result.errors)}`)
  return { ...result, data: reconcileOccupancy(data, result.data, DEMO_DATE, { createMoveInObligations: true }) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T04:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dynamic Billing room availability', () => {
  it('keeps anniversary rent out of the legacy room calculator and records only applicable water', () => {
    const room = addRoom(createDemoData(), '906')
    const tenant = addTenant(room.data, 'New Room Tenant', room.room.id)
    const data = tenant.data
    expect(isPrototypeData(data)).toBe(true)
    const eligible = selectBillingEligibleRooms(data, DEMO_PERIOD, DEMO_DATE)
    expect(eligible.filter(item => item.id === room.room.id)).toHaveLength(1)
    expect(new Set(eligible.map(item => item.id)).size).toBe(eligible.length)

    const quote = buildRoomPaymentQuote(data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    const option = (category: ChargeCategory) => quote.options.find(item => item.category === category)!
    expect(option('RENT')).toMatchObject({ state: 'UNAVAILABLE', amountCents: null, detail: 'Rent is due in anniversary billing' })
    expect(option('WATER')).toMatchObject({ state: 'SELECTABLE', amountCents: 10_000 })
    expect(option('WASHING_MACHINE').state).toBe('UNAVAILABLE')
    expect(quote.options.filter(item => item.category === 'RENT')).toHaveLength(1)

    const result = prepareRoomPayment(data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: ['RENT', 'WATER'], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(10_000)
    expect(result.payments).toHaveLength(1)
    expect(result.receipts).toHaveLength(1)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.charges.filter(charge => charge.id === `rent-${DEMO_PERIOD}-${room.room.id}`)).toHaveLength(0)
    expect(result.data.charges.filter(charge => charge.id === `water-${DEMO_PERIOD}-${tenant.tenant.id}`)).toHaveLength(1)
    expect(result.data.rentObligations.filter(obligation => obligation.roomId === room.room.id)).toHaveLength(1)

    const receipts = selectTenantReceipts(result.data, tenant.tenant.id).receipts
    expect(receipts).toHaveLength(1)
    expect(receipts[0]!.rooms.label).toBe('Room 906')
    expect(receipts[0]!.categories.find(item => item.category === 'RENT')).toMatchObject({ included: false, amountCents: 0 })
    expect(receipts[0]!.categories.find(item => item.category === 'WATER')?.amountCents).toBe(10_000)
    const after = buildRoomPaymentQuote(result.data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(after.options.find(item => item.category === 'RENT')?.state).toBe('UNAVAILABLE')
    expect(after.options.find(item => item.category === 'WATER')?.state).toBe('PAID')
    expect(prepareRoomPayment(result.data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: ['RENT'], electricityReadingMilliKwh: null, asOf: DEMO_DATE }).ok).toBe(false)
  })

  it('keeps one anniversary rent obligation while charging water per tenant in a new shared room', () => {
    const room = addRoom(createDemoData(), '907', 2)
    const first = addTenant(room.data, 'Shared One', room.room.id)
    const second = addTenant(first.data, 'Shared Two', room.room.id)
    const data = second.data
    const quote = buildRoomPaymentQuote(data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(quote.options.find(item => item.category === 'RENT')).toMatchObject({ state: 'UNAVAILABLE', amountCents: null })
    expect(quote.options.find(item => item.category === 'WATER')?.amountCents).toBe(20_000)
    const result = prepareRoomPayment(data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: ['RENT', 'WATER'], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(20_000)
    expect(result.payments).toHaveLength(1)
    expect(result.receipts).toHaveLength(1)
    expect(result.data.charges.filter(charge => charge.id === `rent-${DEMO_PERIOD}-${room.room.id}`)).toHaveLength(0)
    expect(result.data.rentObligations.filter(obligation => obligation.roomId === room.room.id)).toHaveLength(1)
    expect(result.data.charges.filter(charge => charge.category === 'WATER' && [first.tenant.id, second.tenant.id].includes(charge.tenantId))).toHaveLength(2)
  })

  it('keeps existing, moved-out, fully paid, and partially paid rooms eligible for their period', () => {
    const data = createDemoData()
    const november = selectBillingEligibleRooms(data, DEMO_PERIOD, DEMO_DATE).map(room => room.name)
    expect(november).toEqual(['1', '2', '3', '4'])
    expect(new Set(november).size).toBe(november.length)
    const october = selectBillingEligibleRooms(data, 'period-oct', DEMO_DATE).map(room => room.name)
    expect(october).toContain('5')

    const paidQuote = buildRoomPaymentQuote(data, { roomId: 'room-1', periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(paidQuote.options.every(option => option.state === 'PAID')).toBe(true)
    const partialQuote = buildRoomPaymentQuote(data, { roomId: 'room-2', periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(partialQuote.options.find(option => option.category === 'RENT')?.state).toBe('PAID')
    expect(partialQuote.options.find(option => option.category === 'WATER')?.state).toBe('PAID')
    expect(partialQuote.options.find(option => option.category === 'ELECTRICITY')?.state).toBe('AWAITING_READING')
    const historical = buildRoomPaymentQuote(data, { roomId: 'room-5', periodId: 'period-oct', selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(historical.options.every(option => ['PAID', 'UNAVAILABLE'].includes(option.state))).toBe(true)
  })

  it('projects washing only when the room subscription is applicable', () => {
    const room = addRoom(createDemoData(), '911')
    room.data.rooms.find(item => item.id === room.room.id)!.washingMachineEnabled = true
    const tenant = addTenant(room.data, 'Washing Tenant', room.room.id)
    const quote = buildRoomPaymentQuote(tenant.data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(quote.options.find(option => option.category === 'WASHING_MACHINE')).toMatchObject({ state: 'SELECTABLE', amountCents: 10_000 })
    const rows = selectBillingRooms(tenant.data, DEMO_PERIOD, DEMO_DATE, false)
    const row = rows.find(item => item.context.roomId === room.room.id)!
    expect(row.projectedCharges.map(charge => charge.category).sort()).toEqual(['WASHING_MACHINE', 'WATER'])
    expect(row.rent).toMatchObject({ source: 'ANNIVERSARY', billedCents: 400_000, outstandingCents: 400_000 })
    expect(row).toMatchObject({ billingStatus: 'NOT YET PAID', outstanding: 420_000 })
  })

  it('shows projected room rows and statuses before any payment is written', () => {
    const room = addRoom(createDemoData(), '909', 2)
    const first = addTenant(room.data, 'Projected One', room.room.id)
    const data = addTenant(first.data, 'Projected Two', room.room.id).data
    const before = JSON.stringify(data)
    const rows = selectBillingRooms(data, DEMO_PERIOD, DEMO_DATE, false)
    const projected = rows.find(row => row.context.roomId === room.room.id)!
    expect(rows.filter(row => row.context.roomId === room.room.id)).toHaveLength(1)
    expect(projected).toMatchObject({ billingStatus: 'NOT YET PAID', paid: 0, outstanding: 420_000, unresolved: 1 })
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    expect(projected.charges).toHaveLength(0)
    expect(projected.projectedCharges.map(charge => charge.category).sort()).toEqual(['WATER', 'WATER'])
    expect(JSON.stringify(data)).toBe(before)

    const moveInView = selectMoveInObligations(data, DEMO_DATE, room.room.id)[0]!
    const partial = prepareMoveInPayment(data, { obligationId: moveInView.obligation.id, categories: ['ADVANCE'], paidOn: DEMO_DATE })
    expect(partial.ok).toBe(true)
    if (!partial.ok) return
    const partialRow = selectBillingRooms(partial.data, DEMO_PERIOD, DEMO_DATE, false).find(row => row.context.roomId === room.room.id)!
    expect(partialRow).toMatchObject({ billingStatus: 'PARTLY PAID', paid: 400_000, outstanding: 20_000 })
    expect(partialRow.rent.status).toBe('PAID')
    expect(partialRow.projectedCharges.filter(charge => charge.category === 'WATER')).toHaveLength(2)

    const full = prepareRoomPayment(partial.data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: ['WATER'], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(full.ok).toBe(true)
    if (!full.ok) return
    const fullRow = selectBillingRooms(full.data, DEMO_PERIOD, DEMO_DATE, false).find(row => row.context.roomId === room.room.id)!
    expect(fullRow).toMatchObject({ billingStatus: 'PARTLY PAID', paid: 420_000, outstanding: 0, unresolved: 1 })
    expect(fullRow.projectedCharges).toHaveLength(0)
  })

  it('surfaces Room 06 and keeps Room 2 and Room 02 independent', () => {    let data = createDemoData()
    const room6 = data.rooms.find(room => room.name === '6')!
    const available = updateRoom(data, room6.id, { name: '6', capacity: 1, categoryId: 'RATE_3500', kind: 'PRIVATE', status: 'available' }, DEMO_DATE)
    expect(available.ok).toBe(true)
    if (!available.ok) return
    data = addTenant(available.data, 'Room Six Tenant', room6.id).data
    const room02 = data.rooms.find(room => room.name === '02')!
    data = addTenant(data, 'Room Zero Two Tenant', room02.id).data
    const eligible = selectBillingEligibleRooms(data, DEMO_PERIOD, DEMO_DATE)
    expect(eligible.some(room => room.name === '06')).toBe(false)
    expect(eligible.find(room => room.name === '6')?.id).toBe(room6.id)
    expect(eligible.find(room => room.name === '02')?.id).toBe(room02.id)
    expect(eligible.find(room => room.name === '2')?.id).toBe('room-2')
    const quote6 = buildRoomPaymentQuote(data, { roomId: room6.id, periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(quote6.options.find(option => option.category === 'RENT')?.state).toBe('UNAVAILABLE')
    expect(data.rentObligations.find(obligation => obligation.roomId === room6.id)?.amountCents).toBe(350_000)
    const quote02 = buildRoomPaymentQuote(data, { roomId: room02.id, periodId: DEMO_PERIOD, selected: [], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(quote02.roomLabel).toBe('Room 02')
    expect(quote02.options.find(option => option.category === 'RENT')?.state).toBe('UNAVAILABLE')
    expect(data.rentObligations.find(obligation => obligation.roomId === room02.id)?.amountCents).toBe(500_000)
    expect(quote02.options.find(option => option.category === 'WATER')?.amountCents).toBe(10_000)
  })
})

describe('Billing selector UI after tenant creation', () => {
  it('shows a newly occupied room without refresh and records its first bill into tenant receipts', async () => {
    const user = userEvent.setup()
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/rooms']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    await user.click(await screen.findByRole('button', { name: 'Add room' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add a room' })
    await user.type(within(dialog).getByLabelText('Room number or name'), '908')
    await user.selectOptions(within(dialog).getByLabelText('Monthly rental rate'), 'RATE_4000')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Room added successfully' })).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data.rooms.some((room: { name: string }) => room.name === '908')).toBe(true))
    const roomId = JSON.parse(localStorage.getItem(STORAGE_KEY)!).data.rooms.find((room: { name: string }) => room.name === '908').id

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Tenants' }))
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    await user.type(within(dialog).getByLabelText('Full name'), 'New Billing Tenant')
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), roomId)
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Tenant added successfully' })).getByRole('button', { name: 'Got it' }))

    await user.click(within(nav).getByRole('link', { name: 'Billing' }))
    const table = await screen.findByRole('table', { name: 'Who has paid' })
    let row = within(table).getByRole('row', { name: /Room 908/ })
    expect(row).toHaveTextContent('NOT YET PAID')
    expect(row).toHaveTextContent('₱4,000.00')
    expect(row).toHaveTextContent('₱100.00')
    expect(row).toHaveTextContent('Nov 13 – Dec 12')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).data.payments).toHaveLength(14)

    await user.click(screen.getByRole('button', { name: 'Record move-in payment for room 908' }))
    dialog = await screen.findByRole('dialog', { name: 'Record a move-in payment.' })
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    expect(await within(dialog).findByText('Move-in payment saved.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      const current = within(screen.getByRole('table', { name: 'Who has paid' })).getByRole('row', { name: /Room 908/ })
      expect(current).toHaveTextContent('PARTLY PAID')
      expect(within(current).getAllByRole('cell')[2]).toHaveTextContent('PAID')
    })

    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    const options = within(within(dialog).getByLabelText('Choose room')).getAllByRole('option').map(option => [option.getAttribute('value'), option.textContent])
    expect(options).toContainEqual([roomId, 'Room 908'])
    expect(new Set(options.map(([value]) => value)).size).toBe(options.length)
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), roomId)
    expect(within(dialog).getByRole('checkbox', { name: 'Rent' })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Water' }))
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('₱100.00')
    await user.click(within(dialog).getByRole('button', { name: /Review payment/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm payment received' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment received' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Payment recorded' })).getByRole('button', { name: 'Got it' }))

    row = within(await screen.findByRole('table', { name: 'Who has paid' })).getByRole('row', { name: /Room 908/ })
    expect(row).not.toHaveTextContent('NOT YET PAID')
    expect(row).toHaveTextContent('AWAITING READING')
    expect(row).toHaveTextContent('PARTLY PAID')

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const demoTenant = screen.getByLabelText('Preview tenant')
    const tenantId = JSON.parse(localStorage.getItem(STORAGE_KEY)!).data.tenants.find((tenant: { name: string }) => tenant.name === 'New Billing Tenant').id
    await user.selectOptions(demoTenant, tenantId)
    expect(within(await screen.findByRole('region', { name: 'Monthly room billing' })).getByRole('status')).toHaveTextContent('PAID')
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))
    const receipts = await screen.findAllByRole('article', { name: /Receipt BHMS-RCT-/ })
    const waterReceipt = receipts.find(receipt => receipt.textContent?.includes('Water'))
    expect(waterReceipt).toBeDefined()
    expect(waterReceipt).toHaveTextContent('Room 908')
  }, 30000)
})
