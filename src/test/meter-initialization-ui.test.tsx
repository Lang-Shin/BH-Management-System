import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import type { PrototypeAppState } from '@/domain/types/models'

function renderRooms(repository: PrototypeRepository = localStorageRepository) {
  return render(<PrototypeProvider repository={repository}><MemoryRouter initialEntries={['/rooms']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}
function savedData(): PrototypeAppState { return JSON.parse(localStorage.getItem(STORAGE_KEY)!).data }

describe('initial meter reading setup in room details', () => {
  it('defaults to locked, isolates each room, and never mutates financial data on activate/deactivate', async () => {
    const user = userEvent.setup()
    renderRooms()
    await user.click(await screen.findByRole('button', { name: 'Room 06 details' }))
    let dialog = screen.getByRole('dialog', { name: 'Room 06' })
    let setup = within(dialog).getByRole('region', { name: 'Initial meter reading setup' })
    expect(within(setup).getByText('LOCKED')).toBeInTheDocument()
    expect(within(setup).queryByLabelText('Previous settled meter reading (kWh)')).not.toBeInTheDocument()
    const before = localStorage.getItem(STORAGE_KEY)
    await user.click(within(setup).getByRole('button', { name: 'Activate' }))
    expect(within(setup).getByText('ACTIVE')).toBeInTheDocument()
    await user.type(within(setup).getByLabelText('Previous settled meter reading (kWh)'), '850')
    await user.click(within(setup).getByRole('button', { name: 'Deactivate' }))
    expect(within(setup).queryByLabelText('Previous settled meter reading (kWh)')).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Room 6 details' }))
    dialog = screen.getByRole('dialog', { name: 'Room 6' })
    setup = within(dialog).getByRole('region', { name: 'Initial meter reading setup' })
    expect(within(setup).getByText('LOCKED')).toBeInTheDocument()
    expect(within(setup).queryByLabelText('Previous settled meter reading (kWh)')).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('explicitly saves, locks, labels, and reloads the initial reading without changing room edits or finances', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    const mounted = renderRooms()
    await user.click(await screen.findByRole('button', { name: 'Room 06 details' }))
    const dialog = screen.getByRole('dialog', { name: 'Room 06' })
    const setup = within(dialog).getByRole('region', { name: 'Initial meter reading setup' })
    await user.click(within(dialog).getByRole('checkbox', { name: /Washing Machine/ }))
    await user.click(within(setup).getByRole('button', { name: 'Activate' }))
    await user.type(within(setup).getByLabelText('Previous settled meter reading (kWh)'), '850')
    expect(within(setup).getByLabelText('Date of previous settled reading')).toHaveValue(DEMO_DATE)
    await user.type(within(setup).getByLabelText('Source note (optional)'), 'Landlord handwritten records')
    await user.click(within(setup).getByRole('button', { name: 'Save Initial Reading' }))
    expect(await within(setup).findByRole('status')).toHaveTextContent('Initial reading saved. Setup is locked.')
    expect(within(setup).getByText('LOCKED')).toBeInTheDocument()
    expect(within(setup).getByText('INITIALIZED')).toBeInTheDocument()
    expect(within(setup).getByRole('button', { name: 'Activate' })).toBeDisabled()
    expect(within(dialog).getByText('INITIAL READING')).toBeInTheDocument()
    expect(within(dialog).queryByText('SETTLED READING')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Source: Landlord handwritten records')).toBeInTheDocument()
    const stored = savedData()
    expect(stored.rooms.find(room => room.id === 'room-13')?.washingMachineEnabled).toBe(false)
    expect(stored.charges).toEqual(original.charges)
    expect(stored.payments).toEqual(original.payments)
    expect(stored.receipts).toEqual(original.receipts)
    expect(stored.paymentCorrections).toEqual(original.paymentCorrections)
    mounted.unmount()
    renderRooms()
    await user.click(await screen.findByRole('button', { name: 'Room 06 details' }))
    const reopened = screen.getByRole('dialog', { name: 'Room 06' })
    expect(within(reopened).getByText('INITIAL READING')).toBeInTheDocument()
    expect(within(reopened).getAllByText('850 kWh')).toHaveLength(2)
    expect(within(reopened).getByRole('button', { name: 'Activate' })).toBeDisabled()
  })

  it('does not save a baseline through the unrelated Save Changes button', async () => {
    const user = userEvent.setup()
    renderRooms()
    await user.click(await screen.findByRole('button', { name: 'Room 06 details' }))
    const dialog = screen.getByRole('dialog', { name: 'Room 06' })
    await user.click(within(dialog).getByRole('button', { name: 'Activate' }))
    await user.type(within(dialog).getByLabelText('Previous settled meter reading (kWh)'), '850')
    await user.click(within(dialog).getByRole('checkbox', { name: /Washing Machine/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(savedData().rooms.find(room => room.id === 'room-13')?.washingMachineEnabled).toBe(true))
    expect(savedData().meterReadings.some(reading => reading.status === 'INITIAL')).toBe(false)
  })

  it('shows accessible validation errors before any baseline is saved', async () => {
    const user = userEvent.setup()
    renderRooms()
    await user.click(await screen.findByRole('button', { name: 'Room 06 details' }))
    const dialog = screen.getByRole('dialog', { name: 'Room 06' })
    await user.click(within(dialog).getByRole('button', { name: 'Activate' }))
    const reading = within(dialog).getByLabelText('Previous settled meter reading (kWh)')
    const date = within(dialog).getByLabelText('Date of previous settled reading')
    for (const value of ['-1', 'Infinity', '850.1234']) {
      await user.clear(reading)
      await user.type(reading, value)
      await user.click(within(dialog).getByRole('button', { name: 'Save Initial Reading' }))
      expect(reading).toHaveAttribute('aria-invalid', 'true')
      expect(within(dialog).getByRole('alert')).toHaveTextContent('up to three decimal places')
    }
    await user.clear(reading)
    await user.type(reading, '850')
    await user.clear(date)
    await user.type(date, '2026-11-14')
    await user.click(within(dialog).getByRole('button', { name: 'Save Initial Reading' }))
    expect(date).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('valid reading date')
    expect(savedData().meterReadings.some(item => item.status === 'INITIAL')).toBe(false)
  })

  it('protects settled history and marks ambiguous legacy meters for review', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    data.electricityMeters.push({ id: 'meter-room-13', label: 'Legacy room meter', serialNumber: 'OLD', ownership: 'UNCONFIRMED' })
    await localStorageRepository.save(data)
    renderRooms()
    await user.click(await screen.findByRole('button', { name: 'Room 1 details' }))
    let dialog = screen.getByRole('dialog', { name: 'Room 1' })
    expect(within(dialog).getByText('HAS HISTORY')).toBeInTheDocument()
    expect(within(dialog).getByText('Recent reading history')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Activate' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Room 06 details' }))
    dialog = screen.getByRole('dialog', { name: 'Room 06' })
    expect(within(dialog).getByText('REQUIRES REVIEW')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Activate' })).toBeDisabled()
  })

  it('keeps setup active without claiming success when the repository rejects the baseline', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderRooms({
      load: async () => ({ data: original, warning: null, canPersist: true }),
      save: async data => data.meterReadings.some(reading => reading.status === 'INITIAL') ? 'Storage full' : null,
    })
    await user.click(await screen.findByRole('button', { name: 'Room 06 details' }))
    const dialog = screen.getByRole('dialog', { name: 'Room 06' })
    await user.click(within(dialog).getByRole('button', { name: 'Activate' }))
    await user.type(within(dialog).getByLabelText('Previous settled meter reading (kWh)'), '850')
    await user.click(within(dialog).getByRole('button', { name: 'Save Initial Reading' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Initial reading was not saved. Storage full')
    expect(within(dialog).getByText('ACTIVE')).toBeInTheDocument()
    expect(within(dialog).queryByText('INITIAL READING')).not.toBeInTheDocument()
    expect(original.meterReadings.some(reading => reading.status === 'INITIAL')).toBe(false)
  })
})
