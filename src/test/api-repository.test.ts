import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import {
  ApiRepositoryError, createApiRepository, fetchRentPrepaymentQuote,
} from '@/data/repositories/api-repository'

beforeAll(() => {
  vi.stubEnv('VITE_BHMS_API_BASE_URL', '/api/v1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => {
  vi.unstubAllEnvs()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('server-authoritative API repository', () => {
  it('loads and validates authoritative workspace records', async () => {
    const data = createDemoData()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data, revision: 12, serverDate: '2026-11-22' }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createApiRepository()
    const snapshot = await repository.load()
    expect(snapshot.data.tenants).toHaveLength(data.tenants.length)
    expect(snapshot).toMatchObject({ canPersist: true, revision: 12, serverDate: '2026-11-22' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bootstrap', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  })

  it('sends typed commands with an idempotency key and accepts a replay', async () => {
    const data = createDemoData()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data, revision: 13, replayed: true }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createApiRepository()
    const result = await repository.command!({ type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: 'Server note' }, 'idempotency-key-0001')
    expect(result).toMatchObject({ revision: 13, replayed: true })
    const request = fetchMock.mock.calls[0]![1] as RequestInit
    expect(new Headers(request.headers).get('idempotency-key')).toBe('idempotency-key-0001')
    expect(JSON.parse(String(request.body))).toEqual({ action: { type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: 'Server note' } })
  })

  it('surfaces safe retry metadata for network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const repository = createApiRepository()
    await expect(repository.command!({ type: 'demo/reset' })).rejects.toMatchObject({
      name: 'ApiRepositoryError', code: 'NETWORK_ERROR', retryable: true,
    })
  })

  it('preserves the server rejection code and message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'COMMAND_REJECTED', message: 'The command was rejected.' },
    }, 422)))
    const repository = createApiRepository()
    await expect(repository.command!({ type: 'demo/reset' })).rejects.toMatchObject({
      code: 'COMMAND_REJECTED', status: 422, retryable: false,
      message: 'The command was rejected.',
    })
    await expect(repository.command!({ type: 'demo/reset' })).rejects.toBeInstanceOf(ApiRepositoryError)
  })

  it('loads a rent prepayment quote through the typed endpoint', async () => {
    const quote = {
      cycleId: 'cycle-room-9-2026-11-22', roomId: 'room-9', rateId: 'rent-rate-RATE_4000-2026-09-01',
      rateCents: 400_000, rateLockedOn: '2026-11-22', totalCents: 800_000,
      periods: [2, 3].map(sequence => ({
        sequence, rentalPeriodId: `period-${sequence}`, rentObligationId: `obligation-${sequence}`,
        startDate: sequence === 2 ? '2026-12-22' : '2027-01-22', endDateExclusive: sequence === 2 ? '2027-01-22' : '2027-02-22',
        dueDate: '2026-12-22', amountCents: 400_000, paidCents: 0, status: 'UNPAID', coveredByAdvance: false, existing: false,
      })),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ quote, revision: 8 })))
    await expect(fetchRentPrepaymentQuote(quote.cycleId, 2)).resolves.toEqual(quote)
  })
})
