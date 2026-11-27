import type { WorkerEnv } from './env'
import { ApiError } from './http'

export interface SupabaseClaims {
  iss: string
  aud: string | string[]
  exp: number
  iat: number
  nbf?: number
  sub: string
  role: string
  session_id: string
  aal?: 'aal1' | 'aal2'
  amr?: { method?: string; timestamp?: number }[]
  email?: string
}

export interface SupabaseTokens {
  access_token: string
  refresh_token: string
  expires_in?: number
}

interface SupabaseUser {
  id: string
  email?: string
  app_metadata?: Record<string, unknown>
}

const JWKS_TTL_MS = 10 * 60_000

let jwksCache: { url: string; expiresAt: number; keys: JsonWebKey[] } | null = null

export function supabaseBaseUrl(env: WorkerEnv): string {
  if (!env.SUPABASE_URL) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase authentication is not configured.')
  let url: URL
  try {
    url = new URL(env.SUPABASE_URL)
  } catch {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase authentication is not configured.')
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase authentication is not configured.')
  }
  return url.origin
}

function secretKey(env: WorkerEnv): string {
  if (!env.SUPABASE_SECRET_KEY) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase authentication is not configured.')
  return env.SUPABASE_SECRET_KEY
}

function authHeaders(env: WorkerEnv, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: secretKey(env), accept: 'application/json' }
  headers.authorization = `Bearer ${accessToken ?? secretKey(env)}`
  return headers
}

export async function supabaseRequest(
  env: WorkerEnv,
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string; forwardedIp?: string; admin?: boolean } = {},
): Promise<{ status: number; data: unknown }> {
  const headers = authHeaders(env, options.accessToken)
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.forwardedIp) headers['sb-forwarded-for'] = options.forwardedIp
  let response: Response
  try {
    response = await fetch(`${supabaseBaseUrl(env)}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable. Try again shortly.')
  }
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  return { status: response.status, data }
}

function authCode(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  return typeof record.error_code === 'string' ? record.error_code : typeof record.code === 'string' ? record.code : ''
}

function authMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  return typeof record.msg === 'string' ? record.msg : typeof record.message === 'string' ? record.message : ''
}

export function authFailure(result: { status: number; data: unknown }): ApiError {
  if (result.status === 429) return new ApiError(429, 'AUTH_RATE_LIMITED', 'Too many authentication attempts. Try again later.')
  if (result.status >= 500) return new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable. Try again shortly.')
  if (/banned|disabled|user_banned/i.test(`${authCode(result.data)} ${authMessage(result.data)}`)) {
    return new ApiError(403, 'ACCOUNT_DISABLED', 'This account is not available.')
  }
  if (/weak_password/i.test(authCode(result.data))) {
    return new ApiError(400, 'WEAK_PASSWORD', 'Choose a stronger password that meets the authentication policy.')
  }
  return new ApiError(401, 'INVALID_CREDENTIALS', 'The supplied credentials are not valid.')
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T
}

async function loadJwks(env: WorkerEnv, force = false): Promise<JsonWebKey[]> {
  const url = `${supabaseBaseUrl(env)}/auth/v1/.well-known/jwks.json`
  if (!force && jwksCache?.url === url && jwksCache.expiresAt > Date.now()) return jwksCache.keys
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
  } catch {
    throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication keys are unavailable. Try again shortly.')
  }
  if (!response.ok) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication keys are unavailable. Try again shortly.')
  let body: { keys?: JsonWebKey[] }
  try {
    body = await response.json() as { keys?: JsonWebKey[] }
  } catch {
    throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication keys are unavailable. Try again shortly.')
  }
  if (!Array.isArray(body.keys)) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication keys are unavailable.')
  jwksCache = { url, expiresAt: Date.now() + JWKS_TTL_MS, keys: body.keys }
  return body.keys
}

export function clearJwksCache(): void {
  jwksCache = null
}

export async function verifySupabaseJwt(token: string, env: WorkerEnv): Promise<SupabaseClaims> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid session is required.')
  let header: { alg?: string; kid?: string; typ?: string }
  let claims: SupabaseClaims
  try {
    header = decodeJson(parts[0]!)
    claims = decodeJson(parts[1]!)
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A valid session is required.')
  }
  if (header.typ !== 'JWT' || (header.alg !== 'ES256' && header.alg !== 'RS256') || !header.kid) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'The session token uses an unsupported signing algorithm.')
  }
  let keys = await loadJwks(env)
  let jwk = keys.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid)
  if (!jwk) {
    keys = await loadJwks(env, true)
    jwk = keys.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid)
  }
  if (!jwk) throw new ApiError(401, 'UNAUTHENTICATED', 'The session signing key is not trusted.')
  const algorithm = header.alg === 'ES256'
    ? { import: { name: 'ECDSA', namedCurve: 'P-256' } as const, verify: { name: 'ECDSA', hash: 'SHA-256' } as const }
    : { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const, verify: { name: 'RSASSA-PKCS1-v1_5' } as const }
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('jwk', jwk, algorithm.import, false, ['verify'])
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'The session signing key is invalid.')
  }
  let valid: boolean
  try {
    valid = await crypto.subtle.verify(algorithm.verify, key, decodeBase64Url(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  } catch {
    valid = false
  }
  if (!valid) throw new ApiError(401, 'UNAUTHENTICATED', 'The session signature is invalid.')

  const now = Math.floor(Date.now() / 1000)
  const issuer = `${supabaseBaseUrl(env)}/auth/v1`
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer || !audiences.includes('authenticated')) throw new ApiError(401, 'UNAUTHENTICATED', 'The session token claims are invalid.')
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new ApiError(401, 'SESSION_EXPIRED', 'The session has expired.')
  if (typeof claims.iat !== 'number' || claims.iat > now + 30) throw new ApiError(401, 'UNAUTHENTICATED', 'The session token issue time is invalid.')
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) throw new ApiError(401, 'UNAUTHENTICATED', 'The session token is not valid yet.')
  if (typeof claims.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub)) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'The session subject is invalid.')
  }
  if (claims.role !== 'authenticated') throw new ApiError(401, 'UNAUTHENTICATED', 'The session role is invalid.')
  if (typeof claims.session_id !== 'string' || claims.session_id.length < 16) throw new ApiError(401, 'UNAUTHENTICATED', 'The session identity is invalid.')
  if (claims.aal !== undefined && claims.aal !== 'aal1' && claims.aal !== 'aal2') throw new ApiError(401, 'UNAUTHENTICATED', 'The session assurance level is invalid.')
  return claims
}

export async function signInWithPassword(env: WorkerEnv, email: string, password: string, forwardedIp: string) {
  return supabaseRequest(env, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, forwardedIp })
}

export async function refreshSupabaseSession(env: WorkerEnv, refreshToken: string, forwardedIp: string) {
  return supabaseRequest(env, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken }, forwardedIp })
}

export async function signOutSupabase(env: WorkerEnv, accessToken: string, forwardedIp: string) {
  return supabaseRequest(env, '/auth/v1/logout?scope=global', { method: 'POST', accessToken, forwardedIp })
}

export async function createSupabaseUser(env: WorkerEnv, input: {
  id: string; email: string; password: string; bhmsUserId: string; invitationId: string; displayName?: string; forwardedIp: string
}) {
  return supabaseRequest(env, '/auth/v1/admin/users', {
    method: 'POST',
    forwardedIp: input.forwardedIp,
    body: {
      id: input.id,
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { bhms_user_id: input.bhmsUserId, bhms_invitation_id: input.invitationId, bhms_managed: true },
      ...(input.displayName ? { user_metadata: { display_name: input.displayName } } : {}),
    },
  })
}

export async function getSupabaseUser(env: WorkerEnv, id: string, forwardedIp: string) {
  return supabaseRequest(env, `/auth/v1/admin/users/${encodeURIComponent(id)}`, { forwardedIp })
}

export async function deleteSupabaseUser(env: WorkerEnv, id: string, forwardedIp: string) {
  return supabaseRequest(env, `/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', forwardedIp })
}

export async function listSupabaseFactors(env: WorkerEnv, userId: string, forwardedIp: string) {
  return supabaseRequest(env, `/auth/v1/admin/users/${encodeURIComponent(userId)}/factors`, { forwardedIp })
}

export async function updateSupabaseUser(env: WorkerEnv, id: string, body: Record<string, unknown>, forwardedIp: string) {
  return supabaseRequest(env, `/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body, forwardedIp })
}

export async function enrollTotp(env: WorkerEnv, accessToken: string, issuer: string, forwardedIp: string) {
  return supabaseRequest(env, '/auth/v1/factors', {
    method: 'POST', accessToken, forwardedIp,
    body: { factor_type: 'totp', friendly_name: 'BHMS landlord', issuer },
  })
}

export async function challengeTotp(env: WorkerEnv, accessToken: string, factorId: string, forwardedIp: string) {
  return supabaseRequest(env, `/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, {
    method: 'POST', accessToken, forwardedIp, body: {},
  })
}

export async function verifyTotp(env: WorkerEnv, accessToken: string, factorId: string, challengeId: string, code: string, forwardedIp: string) {
  return supabaseRequest(env, `/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, {
    method: 'POST', accessToken, forwardedIp, body: { challenge_id: challengeId, code },
  })
}

export function supabaseUser(data: unknown): SupabaseUser | null {
  if (!data || typeof data !== 'object') return null
  const record = data as { user?: unknown }
  const candidate = record.user && typeof record.user === 'object' ? record.user : data
  if (!candidate || typeof candidate !== 'object') return null
  const user = candidate as Partial<SupabaseUser>
  return typeof user.id === 'string' ? user as SupabaseUser : null
}

export function tokenPair(data: unknown): SupabaseTokens | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Partial<SupabaseTokens>
  return typeof record.access_token === 'string' && typeof record.refresh_token === 'string'
    ? { access_token: record.access_token, refresh_token: record.refresh_token, expires_in: record.expires_in }
    : null
}

/* ------------------------------- cookies ------------------------------- */

export interface AuthCookieNames {
  session: string
  csrf: string
  secure: boolean
}

export function authCookieNames(env: WorkerEnv): AuthCookieNames {
  const secure = env.ENVIRONMENT === 'production' || env.AUTH_COOKIE_SECURE !== 'false'
  return { session: secure ? '__Host-bhms_session' : 'bhms_session', csrf: secure ? '__Host-bhms_csrf' : 'bhms_csrf', secure }
}

function cookieKeySource(env: WorkerEnv): string {
  if (!env.COOKIE_ENCRYPTION_KEY || env.COOKIE_ENCRYPTION_KEY.length < 32) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Session cookie encryption is not configured.')
  }
  return env.COOKIE_ENCRYPTION_KEY
}

let cookieKeyCache: { source: string; key: CryptoKey } | null = null

async function cookieKey(env: WorkerEnv): Promise<CryptoKey> {
  const source = cookieKeySource(env)
  if (cookieKeyCache?.source === source) return cookieKeyCache.key
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  cookieKeyCache = { source, key }
  return key
}

export async function sealTokens(env: WorkerEnv, tokens: SupabaseTokens): Promise<string> {
  const key = await cookieKey(env)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('bhms-supabase-auth-v1') },
    key,
    new TextEncoder().encode(JSON.stringify({ access: tokens.access_token, refresh: tokens.refresh_token })),
  )
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(cipher))}`
}

export async function openTokens(env: WorkerEnv, value: string): Promise<SupabaseTokens | null> {
  try {
    const [version, iv, cipher] = value.split('.')
    if (version !== 'v1' || !iv || !cipher) return null
    const key = await cookieKey(env)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64Url(iv), additionalData: new TextEncoder().encode('bhms-supabase-auth-v1') },
      key,
      decodeBase64Url(cipher),
    )
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as { access?: unknown; refresh?: unknown }
    return typeof parsed.access === 'string' && typeof parsed.refresh === 'string'
      ? { access_token: parsed.access, refresh_token: parsed.refresh }
      : null
  } catch {
    return null
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return null
}

function cookie(name: string, value: string, options: { secure: boolean; httpOnly: boolean; maxAge?: number }): string {
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${options.maxAge ?? 30 * 24 * 60 * 60}`, 'SameSite=Strict']
  if (options.secure) parts.push('Secure')
  if (options.httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

export async function sessionCookieHeaders(env: WorkerEnv, tokens: SupabaseTokens, csrfToken: string): Promise<string[]> {
  const names = authCookieNames(env)
  const sealed = await sealTokens(env, tokens)
  return [
    cookie(names.session, sealed, { secure: names.secure, httpOnly: true }),
    cookie(names.csrf, csrfToken, { secure: names.secure, httpOnly: false }),
  ]
}

export function clearAuthCookieHeaders(env: WorkerEnv): string[] {
  const names = authCookieNames(env)
  return [
    cookie(names.session, '', { secure: names.secure, httpOnly: true, maxAge: 0 }),
    cookie(names.csrf, '', { secure: names.secure, httpOnly: false, maxAge: 0 }),
  ]
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return encodeBase64Url(value)
}

export function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? ''
}
