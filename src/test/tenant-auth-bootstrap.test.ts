import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { buildTenantBootstrap } from '@/server/tenant-bootstrap'

describe('tenant authentication bootstrap projection', () => {
  it('exposes only authorized shared-room information and strips payer/private fields', () => {
    const data = createDemoData()
    const bootstrap = buildTenantBootstrap(data, 7, 'tenant-2', DEMO_DATE, 'Asia/Manila', 'demo-workspace')
    expect(bootstrap.data.tenant).toEqual({ id: 'tenant-2', name: 'Sam Navarro', status: 'ACTIVE' })
    expect(bootstrap.data.room).toMatchObject({ id: 'room-2' })
    expect(bootstrap.data.roommates).toEqual([{ id: 'tenant-4', name: 'Morgan Cruz' }])
    expect(bootstrap.data.billing).not.toBeNull()
    expect(bootstrap.data.receipts.length).toBeGreaterThan(0)
    expect(bootstrap.data.receipts.every(item => !('tenant' in item.receipt) && !('tenant' in item.payment) && !('viewerIsPayer' in item))).toBe(true)
    const serialized = JSON.stringify(bootstrap)
    expect(serialized).not.toContain('resident4@example.com')
    expect(serialized).not.toContain('payerName')
    expect(serialized).not.toContain('tenant-4@example.com')
    expect(bootstrap.data.tenant).not.toHaveProperty('email')
    expect(bootstrap.data.tenant).not.toHaveProperty('notes')
    expect(bootstrap.state.tenants.map(item => item.id)).toEqual(['tenant-2', 'tenant-4'])
    expect(bootstrap.state.tenants.find(item => item.id === 'tenant-4')).toMatchObject({ email: '', phone: '', address: '', notes: '' })
    expect(bootstrap.state.payments.every(payment => payment.tenantId === 'tenant-2' || payment.scope === 'ROOM')).toBe(true)
    expect(bootstrap.state.auditEvents).toEqual([])
    expect(bootstrap.state.financialReviewCases).toEqual([])
  })
})
