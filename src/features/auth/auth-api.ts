export type AuthRole = 'OWNER' | 'ADMIN' | 'TENANT' | 'VIEWER'
export type AssuranceLevel = 'aal1' | 'aal2'

export interface AuthSession {
  authenticated: true
  role: AuthRole
  aal: AssuranceLevel
  tenantId: string | null
  mfaRequired: boolean
  csrfToken: string
}

export interface TenantBootstrap {
  data: {
    tenant: { id: string; name: string; status: string }
    room: { id: string; name: string; floor: number; kind: string; capacity: number; washingMachineEnabled: boolean } | null
    assignment: { id: string; startDate: string; endDate: string | null } | null
    roommates: { id: string; name: string }[]
    cycleId: string | null
    billingPeriods: { id: string; label: string; startDate: string; endDate: string; status: string }[]
  }
  revision: number
  serverDate: string
  timezone: string
  workspaceId: string
  role: 'TENANT'
  tenantId: string
  schemaVersion: number
}

export interface AuthAccount {
  id: string
  email: string
  display_name: string | null
  status: string
  email_verified: number
  role: string
  tenant_id: string | null
  access_expires_at: string | null
}

export interface AccountInvitation {
  invitationId?: string
  inviteUrl?: string
  recoveryUrl?: string
  expiresAt?: string
}

export class AuthApiError extends Error {
  status: number
  code: string
  retryable: boolean

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
  }
}

function baseUrl(): string {
  const configured = import.meta.env.VITE_BHMS_API_BASE_URL
  return typeof configured === 'string' && configured.trim() ? configured.replace(/\/$/, '') : '/api/v1'
}

function csrfFromCookie(): string {
  if (typeof document === 'undefined') return ''
  const names = ['__Host-bhms_csrf', 'bhms_csrf']
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name && names.includes(name)) return rest.join('=')
  }
  return ''
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  const headers = new Headers({ accept: 'application/json' })
  const method = init.method ?? 'GET'
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (method !== 'GET') {
    const csrf = csrfFromCookie()
    if (csrf) headers.set('x-bhms-csrf', csrf)
  }
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
  } catch (error) {
    throw new AuthApiError(
      error instanceof DOMException && error.name === 'AbortError'
        ? 'The authentication service took too long to respond.'
        : 'The authentication service could not be reached.',
      0,
      'AUTH_NETWORK_ERROR',
    )
  } finally {
    clearTimeout(timeout)
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const envelope = body && typeof body === 'object'
      ? body as { error?: { code?: unknown; message?: unknown } }
      : null
    throw new AuthApiError(
      typeof envelope?.error?.message === 'string' ? envelope.error.message : `Authentication failed (${response.status}).`,
      response.status,
      typeof envelope?.error?.code === 'string' ? envelope.error.code : 'AUTH_REQUEST_FAILED',
    )
  }
  if (!body || typeof body !== 'object') throw new AuthApiError('The authentication service returned an unreadable response.', response.status, 'INVALID_RESPONSE')
  return body as T
}

export function signIn(email: string, password: string): Promise<AuthSession> {
  return request<AuthSession>('/auth/sign-in', { method: 'POST', body: { email, password } })
}

export function getAuthSession(): Promise<AuthSession> {
  return request<AuthSession>('/auth/session')
}

export function refreshAuthSession(): Promise<AuthSession & { refreshed: true }> {
  return request<AuthSession & { refreshed: true }>('/auth/refresh', { method: 'POST', body: {} })
}

export function signOut(): Promise<{ signedOut: true; provider: string }> {
  return request('/auth/sign-out', { method: 'POST', body: {} })
}

export function acceptInvitation(token: string, email: string, password: string) {
  return request<{ provisioned: true; authenticated: boolean; role?: AuthRole; aal?: AssuranceLevel; tenantId?: string | null; csrfToken?: string }>(
    '/auth/accept', { method: 'POST', body: { token, email, password } },
  )
}

export function recoverAccount(token: string, newPassword: string) {
  return request<{ recovered: true; sessionsRevoked: true }>('/auth/recover', { method: 'POST', body: { token, newPassword } })
}

export function enrollMfa() {
  return request<{ id: string; totp: { uri: string; qr_code?: string; secret?: string } }>('/auth/mfa/enroll', { method: 'POST', body: {} })
}

export function challengeMfa(factorId: string) {
  return request<{ id: string }>('/auth/mfa/challenge', { method: 'POST', body: { factorId } })
}

export function verifyMfa(factorId: string, challengeId: string, code: string) {
  return request<AuthSession>('/auth/mfa/verify', { method: 'POST', body: { factorId, challengeId, code } })
}

export function getTenantBootstrap(): Promise<TenantBootstrap> {
  return request<TenantBootstrap>('/tenant/bootstrap')
}

export function listAccounts(): Promise<{ accounts: AuthAccount[] }> {
  return request('/auth/accounts')
}

export function createTenantInvitation(tenantId: string) {
  return request<AccountInvitation>(`/auth/tenants/${encodeURIComponent(tenantId)}/invitation`, { method: 'POST', body: {} })
}

export function cancelInvitation(invitationId: string) {
  return request<{ cancelled: true }>(`/auth/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' })
}

export function issueAccountRecovery(userId: string) {
  return request<AccountInvitation>(`/auth/accounts/${encodeURIComponent(userId)}/recovery`, { method: 'POST', body: {} })
}

export function suspendAccount(userId: string) {
  return request<{ userId: string; status: string }>(`/auth/accounts/${encodeURIComponent(userId)}/suspend`, { method: 'POST', body: {} })
}

export function reactivateAccount(userId: string) {
  return request<{ userId: string; status: string }>(`/auth/accounts/${encodeURIComponent(userId)}/reactivate`, { method: 'POST', body: {} })
}
