import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { parsePrototypeSnapshot } from '@/data/repositories/prototype-storage'
import { createDemoData, DEMO_DATE, OCCUPANCY_DATE } from '@/data/fixtures/demo'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { evaluateShortStayAdvanceRefund, prepareShortStayAdvanceRefund } from '@/domain/calculations/advance-refund'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

const moveInDate = '2026-11-16'
const moveOutDate = '2026-11-22'

function tenantDraft(name = 'Kate'): TenantDraft {
  return { name, email: `${name.toLowerCase()}@example.com`, phone: '+63 900 555 0600', address: 'Test', roomId: 'room-5', moveInDate, notes: '' }
}

function createPaidRoom(preserveFirstRentApplication = false) {
  const first = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: tenantDraft(), asOf: OCCUPANCY_DATE })
  const tenant = first.tenants.find(item => item.name === 'Kate')!
  const view = selectMoveInObligations(first, OCCUPANCY_DATE, 'room-5')[0]!
  const paid = prepareMoveInPayment(first, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-16' })
  if (!paid.ok) throw new Error(paid.reason)
  // Legacy refund tests model a paid advance that predates first-period application.
  const applicationIds = new Set(paid.data.advanceApplications.map(application => application.id))
  const data = preserveFirstRentApplication ? paid.data : {
    ...paid.data,
    advanceApplications: [],
    auditEvents: paid.data.auditEvents.filter(event => !(event.entityType === 'ADVANCE_APPLICATION' && applicationIds.has(event.entityId))),
    occupancyCycles: paid.data.occupancyCycles.map(cycle => cycle.roomId === 'room-5'
      ? { ...cycle, rentSchedule: 'LEGACY_CALENDAR' as const, rentAnchorDate: null, rentAnchorDay: null }
      : cycle),
    rentalPeriods: [],
    rentObligations: [],
  }
  return { data, tenant, obligationId: view.obligation.id }
}

describe('short-stay advance refunds', () => {
  it('allows days 0 through 6 and blocks the seventh completed day', () => {
    const { data, tenant } = createPaidRoom()
    for (let day = 0; day <= 6; day++) {
      const date = new Date(`${moveInDate}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + day)
      const iso = date.toISOString().slice(0, 10)
      expect(evaluateShortStayAdvanceRefund(data, tenant.id, iso)).toMatchObject({ eligible: true, stayDays: day, refundableCents: 350_000 })
    }
    expect(evaluateShortStayAdvanceRefund(data, tenant.id, '2026-11-23')).toMatchObject({ eligible: false, stayDays: 7 })
  })

  it('blocks automatic refund once the advance has settled the first anniversary period', () => {
    const { data, tenant } = createPaidRoom(true)
    const eligibility = evaluateShortStayAdvanceRefund(data, tenant.id, moveOutDate)
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.blockers.join(' ')).toMatch(/already settled the first anniversary rent period/)
    const attempt = prepareShortStayAdvanceRefund(data, {
      tenantId: tenant.id, moveOutDate, refundedOn: moveOutDate, reason: 'Automatic refund should be blocked.',
    })
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.blockers?.join(' ')).toMatch(/owner reconciliation is required/)
    expect(data.advanceRefunds).toHaveLength(0)
  })

  it('blocks outstanding bills, shared remaining occupants, and duplicate refunds', () => {
    const { data, tenant } = createPaidRoom()
    const assignment = data.roomAssignments.find(item => item.tenantId === tenant.id && item.endDate === null)!
    const rent = data.charges[0]!
    const unpaid = { ...data, charges: [...data.charges, { ...rent, id: 'unpaid-kate-rent', tenantId: tenant.id, category: 'RENT' as const, roomAssignmentId: assignment.id, amountCents: 100_000, agreedRentCents: 100_000 }] }
    expect(evaluateShortStayAdvanceRefund(unpaid, tenant.id, moveOutDate).blockers.join(' ')).toMatch(/Outstanding bills/)

    const roommate = prototypeReducer(data, {
      type: 'tenant/created', asOf: OCCUPANCY_DATE,
      draft: { ...tenantDraft('Carl'), email: 'carl@example.com', moveInDate },
    })
    expect(evaluateShortStayAdvanceRefund(roommate, tenant.id, moveOutDate).blockers.join(' ')).toMatch(/shared room/)

    const refunded = prepareShortStayAdvanceRefund(data, { tenantId: tenant.id, moveOutDate, refundedOn: moveOutDate, reason: 'Moved out after four days.' })
    expect(refunded.ok).toBe(true)
    if (!refunded.ok) return
    expect(evaluateShortStayAdvanceRefund(refunded.data, tenant.id, moveOutDate).blockers.join(' ')).toMatch(/already been refunded/)
    const duplicate = prepareShortStayAdvanceRefund(refunded.data, { tenantId: tenant.id, moveOutDate, refundedOn: moveOutDate, reason: 'Duplicate refund.' })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.blockers?.join(' ')).toMatch(/already been refunded/)
  })

  it('records the refund separately and never rewrites the original payment or deposit', async () => {
    const { data, tenant } = createPaidRoom()
    const beforePayment = data.payments.find(payment => payment.id.startsWith('payment-move-in-'))!
    const beforeReceipt = data.receipts.find(receipt => receipt.paymentId === beforePayment.id)!
    const beforeAllocations = data.paymentAllocations.filter(allocation => allocation.paymentId === beforePayment.id)
    const movedOut = prototypeReducer(data, {
      type: 'tenant/movedOut', tenantId: tenant.id, asOf: moveOutDate,
      refundAdvance: { refundedOn: moveOutDate, reason: 'Moved out after four days.' },
    })
    expect(isPrototypeData(movedOut)).toBe(true)
    expect(movedOut.advanceRefunds).toHaveLength(1)
    expect(movedOut.advanceRefunds[0]).toMatchObject({ tenantId: tenant.id, roomId: 'room-5', amountCents: 350_000, refundedOn: moveOutDate })
    expect(movedOut.tenants.find(item => item.id === tenant.id)?.status).toBe('MOVED_OUT')
    expect(movedOut.payments.find(payment => payment.id === beforePayment.id)).toEqual(beforePayment)
    expect(movedOut.receipts.find(receipt => receipt.id === beforeReceipt.id)).toEqual(beforeReceipt)
    expect(movedOut.paymentAllocations.filter(allocation => allocation.paymentId === beforePayment.id)).toEqual(beforeAllocations)
    expect(movedOut.charges.find(charge => charge.id === data.moveInObligations[0]!.depositChargeId)?.state).toBe('ISSUED')
    const view = selectMoveInObligations(movedOut, moveOutDate, 'room-5')[0]!
    expect(view).toMatchObject({ advanceStatus: 'REFUNDED', depositStatus: 'PAID', advanceRefundedCents: 350_000, advanceNetCents: 0, totalRemainingCents: 0 })
    expect(movedOut.auditEvents.at(-1)).toMatchObject({ action: 'ADVANCE_REFUNDED', entityId: beforePayment.id })

    expect(await localStorageRepository.save(movedOut)).toBeNull()
    const loaded = await localStorageRepository.load()
    expect(loaded.data.advanceRefunds).toEqual(movedOut.advanceRefunds)
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/payments']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    const refunds = await screen.findByRole('table', { name: 'Advance refunds' })
    const row = within(refunds).getByRole('row', { name: /Kate/ })
    expect(row).toHaveTextContent('Room 5')
    expect(row).toHaveTextContent(/3,500\.00/)
    expect(row).toHaveTextContent(beforeReceipt.receiptNumber)
  })

  it('supports a same-day move-out refund when no bills are outstanding', () => {
    const { data, tenant } = createPaidRoom()
    expect(evaluateShortStayAdvanceRefund(data, tenant.id, moveInDate)).toMatchObject({ eligible: true, stayDays: 0 })
    const movedOut = prototypeReducer(data, {
      type: 'tenant/movedOut', tenantId: tenant.id, asOf: moveInDate,
      refundAdvance: { refundedOn: moveInDate, reason: 'Moved out on the same day.' },
    })
    expect(movedOut.advanceRefunds).toHaveLength(1)
    expect(movedOut.roomAssignments.find(assignment => assignment.tenantId === tenant.id)?.endDate).toBe(moveInDate)
  })

  it('exposes the refund as an explicit move-out choice in the landlord UI', async () => {
    const user = userEvent.setup()
    const { data } = createPaidRoom()
    await localStorageRepository.save(data)
    render(<PrototypeProvider repository={localStorageRepository} now={() => new Date('2026-11-22T04:00:00Z')}><MemoryRouter initialEntries={['/tenants']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    await user.selectOptions(await screen.findByLabelText('Rows per page for tenants'), '20')
    await user.click(await screen.findByRole('button', { name: 'View Kate' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Kate' })).getByRole('button', { name: 'Move Out / Archive' }))
    const dialog = screen.getByRole('dialog', { name: 'Move Out / Archive Kate' })
    expect(within(dialog).getByRole('heading', { name: 'Short-stay advance refund' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /unused advance was returned/ }))
    await user.type(within(dialog).getByLabelText('Refund reason'), 'Moved out within the seven-day window.')
    await user.click(within(dialog).getByRole('button', { name: 'Move Out / Archive' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move Out / Archive Kate' })).not.toBeInTheDocument())
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.data.advanceRefunds).toHaveLength(1)
      expect(saved.data.advanceRefunds[0]).toMatchObject({ amountCents: 350_000, reason: 'Moved out within the seven-day window.' })
      expect(saved.data.tenants.find((tenant: { name: string }) => tenant.name === 'Kate').status).toBe('MOVED_OUT')
    })
    expect(screen.getByText(/unused advance was recorded as refunded/)).toBeInTheDocument()
  })

  it('migrates version 15 records with an empty refund list and the refund policy window', () => {
    const current = createDemoData()
    const { advanceRefunds: _refunds, ...withoutRefunds } = current
    void _refunds
    const policy = { ...withoutRefunds.moveInPolicy } as Record<string, unknown>
    delete policy.shortStayAdvanceRefundDays
    const parsed = parsePrototypeSnapshot(JSON.stringify({ version: 15, data: { ...withoutRefunds, moveInPolicy: policy } }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.advanceRefunds).toEqual([])
    expect(parsed.data.moveInPolicy.shortStayAdvanceRefundDays).toBe(7)
  })

  it('rejects corrections dated before the original payment', async () => {
    localStorage.clear()
    const { buildPaymentCorrectionQuote } = await import('@/domain/calculations/payment-correction')
    const data = createDemoData()
    expect(buildPaymentCorrectionQuote(data, {
      paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: null,
      reason: 'Incorrect recording', settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE < '2026-11-11' ? DEMO_DATE : '2026-01-01',
    })).toEqual({ quoteError: 'INVALID_DATE' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toBeNull()
  })
})
