import type { Actor, WorkerEnv } from './env'
import { ApiError } from './http'
import {
  authCookieNames,
  clientIp,
  openTokens,
  readCookie,
  secureEqual,
  supabaseBaseUrl,
  verifySupabaseJwt,
  type SupabaseClaims,
  type SupabaseTokens,
} from './supabase-auth'

export interface AuthenticatedRequest {
  actor: Actor
  claims: SupabaseClaims
  tokens: SupabaseTokens
  setCookies: string[]
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function bearer(request: Request): string | null {
  const value = request.headers.get('authorization') ?? ''
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : null
}

export async function authenticateRequest(request: Request, env: WorkerEnv): Promise<AuthenticatedRequest> {
  const url = new URL(request.url)
  if (env.ENVIRONMENT === 'development' && isLoopback(url.hostname)) {
    const actor: Actor = { id: 'local-dev', email: 'local-dev@example.invalid', source: 'DEV', role: 'OWNER', aal: 2, authMethod: 'DEV' }
    return { actor, claims: devClaims('local-dev'), tokens: { access_token: '', refresh_token: '' }, setCookies: [] }
  }
  if (env.ENVIRONMENT !== 'production' && env.BHMS_DEV_TOKEN) {
    const token = bearer(request)
    if (token && secureEqual(token, env.BHMS_DEV_TOKEN)) {
      const actor: Actor = { id: 'dev-token', email: null, source: 'DEV', role: 'OWNER', aal: 2, authMethod: 'DEV' }
      return { actor, claims: devClaims('dev-token'), tokens: { access_token: '', refresh_token: '' }, setCookies: [] }
    }
  }

  supabaseBaseUrl(env)
  if (!env.SUPABASE_SECRET_KEY) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured.')
  const names = authCookieNames(env)
  const sealed = readCookie(request, names.session)
  if (!sealed) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in is required.')
  const tokens = await openTokens(env, sealed)
  if (!tokens) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid session is required.')
  const claims = await verifySupabaseJwt(tokens.access_token, env)
  const actor = await resolveActor(env, claims)
  return { actor, claims, tokens, setCookies: [] }
}

function devClaims(sub: string): SupabaseClaims {
  return {
    iss: 'local-development',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: `00000000-0000-4000-8000-${sub === 'dev-token' ? '000000000002' : '000000000001'}`,
    role: 'authenticated',
    session_id: `dev-session-${sub}`,
    aal: 'aal2',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  }
}

export async function resolveActor(env: WorkerEnv, claims: SupabaseClaims): Promise<Actor> {
  const workspaceId = env.WORKSPACE_ID ?? 'demo-workspace'
  const user = await env.DB.prepare(
    'SELECT id, email, status, auth_user_id, session_invalid_after FROM users WHERE auth_user_id = ?',
  ).bind(claims.sub).first<{ id: string; email: string; status: string; auth_user_id: string; session_invalid_after: string }>()
  if (!user) throw new ApiError(403, 'ACCOUNT_NOT_PROVISIONED', 'This account is not provisioned in BHMS.')
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account is not available.')
  if (claims.iat < Math.floor(Date.parse(user.session_invalid_after) / 1000)) {
    throw new ApiError(401, 'SESSION_REVOKED', 'This session is no longer valid. Sign in again.')
  }
  const membership = await env.DB.prepare(
    'SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?',
  ).bind(workspaceId, user.id).first<{ role: string }>()
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'This account has no workspace membership.')
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN' && membership.role !== 'VIEWER' && membership.role !== 'TENANT') {
    throw new ApiError(403, 'FORBIDDEN', 'This account has an invalid workspace role.')
  }
  let tenantId: string | null = null
  if (membership.role === 'TENANT') {
    const link = await env.DB.prepare(
      'SELECT tenant_id, access_expires_at FROM tenant_account_links WHERE workspace_id = ? AND user_id = ?',
    ).bind(workspaceId, user.id).first<{ tenant_id: string; access_expires_at: string | null }>()
    if (!link) throw new ApiError(403, 'FORBIDDEN', 'This account has no tenant association.')
    if (link.access_expires_at && Date.parse(link.access_expires_at) <= Date.now()) {
      throw new ApiError(403, 'TENANT_ACCESS_EXPIRED', 'Authorized historical access has ended.')
    }
    tenantId = link.tenant_id
  }
  return {
    id: user.id,
    email: user.email,
    source: 'ACCESS',
    role: membership.role,
    aal: claims.aal === 'aal2' ? 2 : 1,
    authUserId: user.auth_user_id,
    tenantId,
    authMethod: 'SUPABASE',
  }
}

export function requireAdministrator(actor: Actor, aal2 = true): void {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Landlord access is required.')
  if (aal2 && actor.aal !== 2) throw new ApiError(403, 'MFA_REQUIRED', 'Multi-factor verification is required.')
}

export function requireTenant(actor: Actor): void {
  if (actor.role !== 'TENANT' || !actor.tenantId) throw new ApiError(403, 'FORBIDDEN', 'Tenant access is required.')
}

export function requireRecentAuth(claims: SupabaseClaims, maxAgeSeconds = 15 * 60): void {
  const timestamps = (claims.amr ?? []).map(entry => entry.timestamp).filter((value): value is number => typeof value === 'number')
  const latest = timestamps.length > 0 ? Math.max(...timestamps) : 0
  if (!latest || Math.floor(Date.now() / 1000) - latest > maxAgeSeconds) {
    throw new ApiError(403, 'FRESH_AUTH_REQUIRED', 'Sign in again before changing account security.')
  }
}

export function requireSameOrigin(request: Request, env: WorkerEnv): void {
  let expected: string
  try {
    expected = env.AUTH_APP_URL ? new URL(env.AUTH_APP_URL).origin : new URL(request.url).origin
  } catch {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'The application URL is not configured.')
  }
  const origin = request.headers.get('origin')
  if (!origin || origin !== expected) throw new ApiError(403, 'ORIGIN_REJECTED', 'The request origin is not allowed.')
}

export function requireCsrf(request: Request, env: WorkerEnv): void {
  const names = authCookieNames(env)
  const header = request.headers.get('x-bhms-csrf') ?? ''
  const cookieValue = readCookie(request, names.csrf) ?? ''
  if (!header || !cookieValue || !secureEqual(header, cookieValue)) {
    throw new ApiError(403, 'CSRF_REJECTED', 'The request could not be verified.')
  }
}

export function requireOperator(request: Request, env: WorkerEnv): void {
  if (!env.AUTH_OPERATOR_TOKEN || env.AUTH_OPERATOR_TOKEN.length < 32) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'The operator authentication secret is not configured.')
  }
  const supplied = request.headers.get('x-bhms-operator') ?? ''
  if (!secureEqual(env.AUTH_OPERATOR_TOKEN, supplied)) throw new ApiError(401, 'OPERATOR_REQUIRED', 'Operator authorization is required.')
}

export function requestIp(request: Request): string {
  return clientIp(request)
}
