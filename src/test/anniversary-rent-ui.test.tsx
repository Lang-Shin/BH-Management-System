import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData } from '@/data/fixtures/demo'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { prepareRentPrepayment } from '@/domain/calculations/rent-schedule'
import { AnniversaryRentSection } from '@/features/billing/anniversary-rent-section'

describe('anniversary rent UI', () => {
  it('shows due dates at each period start and PAID for advance-covered and prepaid periods', async () => {
    let data = prototypeReducer(createDemoData(), {
      type: 'tenant/created', asOf: '2026-11-13',
      draft: {
        name: 'UI Rent Tenant', email: 'ui-rent@example.com', phone: '+63 900 555 0166',
        address: '5 Test Street, Demo City', roomId: 'room-14', moveInDate: '2026-11-13', notes: '',
      },
    })
    const cycle = data.occupancyCycles.find(item => item.roomId === 'room-14' && item.status === 'ACTIVE')!
    const obligation = data.moveInObligations.find(item => item.occupancyCycleId === cycle.id)!
    const paid = prepareMoveInPayment(data, {
      obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-13',
    })
    if (!paid.ok) throw new Error(paid.reason)
    data = paid.data
    const prepaid = prepareRentPrepayment(data, { cycleId: cycle.id, periodCount: 2, paidOn: '2026-11-13' })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    await localStorageRepository.save(prepaid.data)

    render(<PrototypeProvider repository={localStorageRepository}><AnniversaryRentSection /></PrototypeProvider>)
    const section = await screen.findByRole('region', { name: 'Anniversary rent periods' })
    expect(within(section).getAllByText('Paid')).toHaveLength(3)
    expect(within(section).getByText('Covered by advance')).toBeInTheDocument()
    expect(within(section).getByText(/Due Nov 13, 2026/)).toBeInTheDocument()
    expect(within(section).getByText(/Due Dec 13, 2026/)).toBeInTheDocument()
    expect(within(section).getByText(/Due Jan 13, 2027/)).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /collect|pay rent/i })).not.toBeInTheDocument()
  })
})
