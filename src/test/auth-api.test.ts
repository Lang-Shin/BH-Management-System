import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AuthApiError, getAuthSession, requestTenantRoomChange, signOut, signIn } from '@/features/auth/auth-api'

beforeAll(() => {
  vi.stubEnv('VITE_BHMS_API_BASE_URL', '/api/v1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'bhms_csrf=; Max-Age=0; path=/'
  document.cookie = '__Host-bhms_csrf=; Max-Age=0; path=/'
})

afterAll(() => {
  vi.unstubAllEnvs()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('typed authentication API client', () => {
  it('signs in without a CSRF header and loads the server session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, role: 'OWNER', aal: 'aal1', tenantId: null, mfaRequired: true, csrfToken: 'csrf-one' }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, role: 'OWNER', aal: 'aal2', tenantId: null, mfaRequired: false, csrfToken: 'csrf-one' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(signIn('landlord@example.invalid', 'Synthetic-Password-123')).resolves.toMatchObject({ role: 'OWNER', aal: 'aal1' })
    const first = fetchMock.mock.calls[0]![1] as RequestInit
    expect(new Headers(first.headers).get('x-bhms-csrf')).toBeNull()
    expect(first.credentials).toBe('same-origin')
    await expect(getAuthSession()).resolves.toMatchObject({ role: 'OWNER', aal: 'aal2' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/session', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  })

  it('sends the double-submit CSRF token from the auth cookie on state changes', async () => {
    document.cookie = 'bhms_csrf=csrf-cookie-value; path=/'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ signedOut: true, provider: 'revoked' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(signOut()).resolves.toEqual({ signedOut: true, provider: 'revoked' })
    const request = fetchMock.mock.calls[0]![1] as RequestInit
    expect(new Headers(request.headers).get('x-bhms-csrf')).toBe('csrf-cookie-value')
  })

  it('refreshes once and retries a protected request with the rotated CSRF cookie', async () => {
    document.cookie = 'bhms_csrf=old-csrf; path=/'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } }, 401))
      .mockImplementationOnce(async () => {
        document.cookie = 'bhms_csrf=new-csrf; path=/'
        return jsonResponse({ authenticated: true, refreshed: true, role: 'TENANT', aal: 'aal1', tenantId: 'tenant-1', mfaRequired: false, csrfToken: 'new-csrf' })
      })
      .mockResolvedValueOnce(jsonResponse({ request: { id: 'request-1' }, revision: 2, replayed: false, serverDate: '2026-11-27' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestTenantRoomChange({ requestedRoomId: 'room-2', requestedStartDate: '2026-11-28', reason: 'Need a quieter room.' })).resolves.toMatchObject({ revision: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/v1/tenant/room-change-requests')
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/api/v1/auth/refresh')
    expect(String(fetchMock.mock.calls[2]![0])).toBe('/api/v1/tenant/room-change-requests')
    expect(new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers).get('x-bhms-csrf')).toBe('new-csrf')
  })

  it('preserves safe authentication error codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'ACCOUNT_DISABLED', message: 'This account is not available.' } }, 403)))
    await expect(signIn('tenant@example.invalid', 'Synthetic-Password-123')).rejects.toMatchObject({
      name: 'AuthApiError', code: 'ACCOUNT_DISABLED', status: 403, retryable: false,
    })
    await expect(signIn('tenant@example.invalid', 'Synthetic-Password-123')).rejects.toBeInstanceOf(AuthApiError)
  })
})
