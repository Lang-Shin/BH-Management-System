import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function renderApp() {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData(): PrototypeAppState {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
}

function tenantDraft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Bills UI Tenant', email: 'bills-ui@example.com', phone: '+63 900 555 0144',
    address: '7 UI Street, Demo City', roomId: 'room-14', moveInDate: DEMO_DATE, notes: '', ...overrides,
  }
}

async function seedUnpaidBillsState() {
  let data = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: tenantDraft(), asOf: DEMO_DATE })
  data = prototypeReducer(data, {
    type: 'tenant/created', asOf: DEMO_DATE,
    draft: tenantDraft({ name: 'Deposit Only UI', email: 'deposit-ui@example.com', roomId: 'room-15' }),
  })
  const depositView = selectMoveInObligations(data, DEMO_DATE, 'room-15')[0]!
  const deposit = prepareMoveInPayment(data, {
    obligationId: depositView.obligation.id, categories: ['SECURITY_DEPOSIT'], paidOn: DEMO_DATE,
  })
  if (!deposit.ok) throw new Error(deposit.reason)
  await localStorageRepository.save(deposit.data)
}

async function billsRow(table: HTMLElement, room: string) {
  return within(table).getByText(room).closest('tr')!
}

describe('Bills table anniversary integration', () => {
  it('shows the anniversary period after Room, omits years, and updates rent to PAID after the move-in advance', async () => {
    const user = userEvent.setup()
    await seedUnpaidBillsState()
    const app = renderApp()
    const table = await screen.findByRole('table', { name: 'Who has paid' })
    await user.selectOptions(screen.getByLabelText('Rows per page for bills'), '10')
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Room', 'Period', 'Rent', 'Electricity', 'Water', 'Washing machine', 'Status',
    ])
    expect(screen.queryByRole('region', { name: 'Anniversary rent periods' })).not.toBeInTheDocument()

    let row = await billsRow(table, 'Room 07')
    let cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('Nov 13 – Dec 12')
    expect(cells[1]).not.toHaveTextContent(/2026|2027/)
    expect(cells[2]).toHaveTextContent('₱4,000.00')
    expect(cells[4]).toHaveTextContent('₱100.00')
    expect(cells[5]).toHaveTextContent('DID NOT AVAIL')
    expect(cells[6]).toHaveTextContent('NOT YET PAID')

    const depositOnlyRow = await billsRow(table, 'Room 02')
    cells = within(depositOnlyRow).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('Nov 13 – Dec 12')
    expect(cells[2]).toHaveTextContent('₱5,000.00')
    expect(cells[2]).not.toHaveTextContent('PAID')
    expect(cells[6]).toHaveTextContent('NOT YET PAID')

    await user.click(screen.getByRole('button', { name: 'Record move-in payment for room 07' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record a move-in payment.' })
    expect(within(dialog).getByLabelText('Advance', { selector: 'input' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    expect(await within(dialog).findByText('Move-in payment saved.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record a move-in payment.' })).not.toBeInTheDocument())

    await waitFor(() => {
      row = within(table).getByText('Room 07').closest('tr')!
      cells = within(row).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('PAID')
      expect(cells[6]).toHaveTextContent('PARTLY PAID')
    })
    const persisted = savedData()
    expect(persisted.advanceApplications).toHaveLength(1)
    const firstRent = persisted.rentObligations.find(obligation => obligation.roomId === 'room-14')!
    expect(rentObligationPaidCents(persisted, firstRent.id, persisted.advanceApplications[0]!.appliedOn)).toBe(400_000)

    app.unmount()
    renderApp()
    const refreshedTable = await screen.findByRole('table', { name: 'Who has paid' })
    await user.selectOptions(screen.getByLabelText('Rows per page for bills'), '10')
    const refreshedRow = await billsRow(refreshedTable, 'Room 07')
    expect(within(refreshedRow).getAllByRole('cell')[2]).toHaveTextContent('PAID')
  }, 30_000)
})
