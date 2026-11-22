import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Review UI Tenant', email: 'review-ui@example.com', phone: '+63 900 555 0122',
    address: 'Review Street, Demo City', roomId: 'room-14', moveInDate: '2026-11-13', notes: '', ...overrides,
  }
}

function createTenant(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}, asOf = '2026-11-13') {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides), asOf })
  return { data: next, tenant: next.tenants.find(item => item.email === (overrides.email ?? draft().email))! }
}

function payMoveIn(data: PrototypeAppState, roomId: string, paidOn: string) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

describe('transfer financial review notice', () => {
  it('shows open transfer reconciliation cases on Billing without changing money', async () => {
    const first = createTenant(createDemoData())
    const firstPaid = payMoveIn(first.data, 'room-14', DEMO_DATE)
    const second = createTenant(firstPaid, {
      name: 'Occupied Review Destination', email: 'occupied-review@example.com', roomId: 'room-15',
    }, '2026-11-14')
    const secondPaid = payMoveIn(second.data, 'room-15', '2026-11-14')
    const beforePayments = JSON.stringify(secondPaid.payments)
    const beforeAllocations = JSON.stringify(secondPaid.paymentAllocations)
    const secondTenant = second.tenant
    const transferred = prototypeReducer(secondPaid, {
      type: 'tenant/updated', tenantId: secondTenant.id, asOf: '2026-11-18',
      draft: draft({
        name: secondTenant.name, email: secondTenant.email, phone: secondTenant.phone, address: secondTenant.address,
        roomId: 'room-14', moveInDate: '2026-11-18',
      }),
    })
    expect(JSON.stringify(transferred.payments)).toBe(beforePayments)
    expect(JSON.stringify(transferred.paymentAllocations)).toBe(beforeAllocations)
    await localStorageRepository.save(transferred)

    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    expect(await screen.findByText('Transfer financial review')).toBeVisible()
    expect(screen.getByText(/No rent, refund, prepayment, or deposit was moved automatically/)).toBeVisible()
    expect(screen.getByText(/Destination room already has an occupancy rent schedule/)).toBeVisible()
  })
})
