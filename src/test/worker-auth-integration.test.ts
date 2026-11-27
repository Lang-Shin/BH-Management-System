/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()
const src = path.join(root, 'src')
const origin = 'https://app.example.com'
const supabaseOrigin = 'https://test.supabase.co'
const operatorToken = 'test-operator-token-0123456789abcdef'
const cookieKey = 'test-cookie-encryption-key-0123456789'
const invitePepper = 'test-invite-pepper-0123456789abcdef'
const auditPepper = 'test-audit-pepper-0123456789abcdef'

const landlordEmail = 'landlord@example.invalid'
const landlordPassword = 'Landlord-Synthetic-Password-123'
const tenantEmail = 'tenant@example.invalid'
const tenantPassword = 'Tenant-Synthetic-Password-123'
const replacedPassword = 'Tenant-Replacement-Password-123'
const landlordReplacement = 'Landlord-Replacement-Password-123'

let worker: Miniflare
let workerScript = ''
let keyPair: CryptoKeyPair
let publicJwk: JsonWebKey
const users = new Map<string, { id: string; email: string; password: string; app_metadata: Record<string, unknown> }>()
const refreshTokens = new Map<string, { userId: string; sessionId: string; aal: 'aal1' | 'aal2' }>()
const factors = new Map<string, string[]>()
let failNextCreationEmail: string | null = null
let supabaseOutage = false

function b64(value: string): string {
  return Buffer.from(value).toString('base64url')
}

async function signToken(userId: string, sessionId: string, aal: 'aal1' | 'aal2' = 'aal1'): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const amr = [{ method: 'password', timestamp: now }, ...(aal === 'aal2' ? [{ method: 'totp', timestamp: now }] : [])]
  const header = b64(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'mock-key' }))
  const payload = b64(JSON.stringify({
    iss: `${supabaseOrigin}/auth/v1`, aud: 'authenticated', exp: now + 3600, iat: now,
    sub: userId, role: 'authenticated', session_id: sessionId, aal, amr,
  }))
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`
}

async function tokensFor(userId: string, sessionId: string = crypto.randomUUID(), aal: 'aal1' | 'aal2' = 'aal1') {
  const access_token = await signToken(userId, sessionId, aal)
  const refresh_token = `refresh-${crypto.randomUUID()}`
  refreshTokens.set(refresh_token, { userId, sessionId, aal })
  return { access_token, refresh_token, expires_in: 3600 }
}

function userPayload(userId: string) {
  const user = users.get(userId)
  return user ? { id: user.id, email: user.email, app_metadata: user.app_metadata } : null
}

function authUser(request: Request): { sub: string; session_id: string } | null {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
  } catch {
    return null
  }
}

async function fakeSupabase(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathName = url.pathname
  const method = request.method
  if (pathName === '/auth/v1/.well-known/jwks.json') {
    return Response.json({ keys: [publicJwk] })
  }
  if (supabaseOutage) return Response.json({ error_code: 'temporarily_unavailable' }, { status: 503 })
  if (pathName === '/auth/v1/token' && method === 'POST') {
    const body = await request.json() as Record<string, unknown>
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const record = refreshTokens.get(String(body.refresh_token))
      if (!record) return Response.json({ error_code: 'invalid_grant' }, { status: 400 })
      refreshTokens.delete(String(body.refresh_token))
      return Response.json(await tokensFor(record.userId, record.sessionId, record.aal))
    }
    const user = [...users.values()].find(item => item.email === body.email && item.password === body.password)
    if (!user) return Response.json({ error_code: 'invalid_credentials' }, { status: 400 })
    return Response.json(await tokensFor(user.id))
  }
  if (pathName === '/auth/v1/logout') {
    const claims = authUser(request)
    if (claims) for (const [key, value] of refreshTokens) if (value.sessionId === claims.session_id) refreshTokens.delete(key)
    return new Response(null, { status: 204 })
  }
  if (pathName === '/auth/v1/admin/users' && method === 'POST') {
    const body = await request.json() as Record<string, unknown>
    if (typeof body.id !== 'string' || typeof body.email !== 'string' || typeof body.password !== 'string') {
      return Response.json({ error_code: 'validation_failed' }, { status: 400 })
    }
    if (users.has(body.id) || [...users.values()].some(item => item.email === body.email)) {
      return Response.json({ error_code: 'email_exists' }, { status: 422 })
    }
    const user = { id: body.id, email: body.email, password: body.password, app_metadata: (body.app_metadata as Record<string, unknown>) ?? {} }
    users.set(user.id, user)
    if (failNextCreationEmail === user.email) {
      failNextCreationEmail = null
      return Response.json({ error_code: 'temporary_provisioning_failure' }, { status: 503 })
    }
    return Response.json({ user: userPayload(user.id) })
  }
  const factorList = pathName.match(/^\/auth\/v1\/admin\/users\/([^/]+)\/factors$/)
  if (factorList?.[1]) {
    const id = decodeURIComponent(factorList[1])
    return Response.json((factors.get(id) ?? []).map(factorId => ({ id: factorId, status: 'verified', factor_type: 'totp', friendly_name: 'BHMS landlord' })))
  }
  const adminUser = pathName.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)
  if (adminUser?.[1]) {
    const id = decodeURIComponent(adminUser[1])
    if (method === 'DELETE') {
      users.delete(id)
      for (const [key, value] of refreshTokens) if (value.userId === id) refreshTokens.delete(key)
      factors.delete(id)
      return users.has(id) ? Response.json({}) : Response.json({ error_code: 'user_not_found' }, { status: 404 })
    }
    if (!users.has(id)) return Response.json({ error_code: 'user_not_found' }, { status: 404 })
    if (method === 'PUT') return Response.json({ user: userPayload(id) })
    return Response.json({ user: userPayload(id) })
  }
  const factorCollection = pathName === '/auth/v1/factors' && method === 'POST'
  if (factorCollection) {
    const claims = authUser(request)
    if (!claims || !users.has(claims.sub)) return Response.json({ error_code: 'no_authorization' }, { status: 401 })
    const factorId = crypto.randomUUID()
    factors.set(claims.sub, [...(factors.get(claims.sub) ?? []), factorId])
    return Response.json({ id: factorId, type: 'totp', totp: { uri: 'otpauth://totp/Halili:landlord?secret=JBSWY3DPEHPK3PXP&issuer=Halili' } })
  }
  const factorChallenge = pathName.match(/^\/auth\/v1\/factors\/([^/]+)\/challenge$/)
  if (factorChallenge && method === 'POST') return Response.json({ id: 'challenge-123456' })
  const factorVerify = pathName.match(/^\/auth\/v1\/factors\/([^/]+)\/verify$/)
  if (factorVerify && method === 'POST') {
    const body = await request.json() as Record<string, unknown>
    if (body.code !== '123456') return Response.json({ error_code: 'mfa_verification_failed' }, { status: 422 })
    const claims = authUser(request)
    if (!claims) return Response.json({ error_code: 'no_authorization' }, { status: 401 })
    return Response.json(await tokensFor(claims.sub, claims.session_id, 'aal2'))
  }
  return Response.json({ error_code: 'not_found' }, { status: 404 })
}

class Client {
  cookies = new Map<string, string>()
  csrf = ''
  async request(pathname: string, option: { method?: string; body?: unknown; csrf?: boolean; origin?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { accept: 'application/json', origin: option.origin ?? origin, ...option.headers }
    if (option.body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ')
    if (option.csrf !== false && option.method && option.method !== 'GET' && this.csrf) headers['x-bhms-csrf'] = this.csrf
    const response = await worker.dispatchFetch(`${origin}${pathname}`, {
      method: option.method ?? 'GET',
      headers,
      body: option.body === undefined ? undefined : JSON.stringify(option.body),
    } as never)
    const data = await response.json().catch(() => null) as any
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? ''
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index)
      const value = pair.slice(index + 1)
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(name)
      else {
        this.cookies.set(name, value)
        if (name.endsWith('_csrf')) this.csrf = value
      }
    }
    if (data?.csrfToken) this.csrf = data.csrfToken
    return { status: response.status, data, response }
  }
}

async function operator(pathname: string, body: unknown = {}) {
  const response = await worker.dispatchFetch(`${origin}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bhms-operator': operatorToken, origin },
    body: JSON.stringify(body),
  } as never)
  return { status: response.status, data: await response.json().catch(() => null) as any }
}

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  Object.assign(publicJwk, { kid: 'mock-key', alg: 'ES256', use: 'sig' })
  const result = await build({
    entryPoints: [path.join(src, 'worker/index.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'bhms-alias', setup(context) {
      context.onResolve({ filter: /^@\// }, args => {
        const target = path.join(src, args.path.slice(2))
        const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find(candidate => existsSync(candidate))
        return resolved ? { path: resolved } : { errors: [{ text: `Cannot resolve ${args.path}` }] }
      })
    } }],
  })
  workerScript = result.outputFiles[0]!.text
  worker = new Miniflare({
    modules: true, script: workerScript, compatibilityDate: '2025-07-18',
    d1Databases: { DB: 'bhms-auth-test-db' },
    bindings: {
      ENVIRONMENT: 'development', WORKSPACE_ID: 'auth-workspace', APP_TIMEZONE: 'Asia/Manila',
      ALLOW_IMPORT_APPLY: 'false', ALLOW_TEST_RESET: 'true', SUPABASE_URL: supabaseOrigin, SUPABASE_SECRET_KEY: 'test-secret',
      AUTH_OPERATOR_TOKEN: operatorToken, COOKIE_ENCRYPTION_KEY: cookieKey, INVITE_TOKEN_PEPPER: invitePepper,
      AUDIT_PEPPER: auditPepper, AUTH_COOKIE_SECURE: 'false', AUTH_APP_URL: origin,
    },
    outboundService: fakeSupabase,
  })
  const db = await worker.getD1Database('DB')
  for (const file of readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(root, 'migrations', file), 'utf8').split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('PRAGMA')).join('\n')
    const triggerPattern = /CREATE\s+TRIGGER[\s\S]*?END;/gi
    const triggers = [...sql.matchAll(triggerPattern)].map(match => match[0])
    const tables = sql.replace(triggerPattern, '')
    for (const statement of tables.split(';').map(item => item.trim()).filter(Boolean)) await db.prepare(statement).run()
    for (const trigger of triggers) await db.prepare(trigger).run()
  }
}, 60_000)

afterAll(async () => { await worker?.dispose() })

describe('Supabase BFF integration and authorization', () => {
  it('does not allow loopback or development tokens in production', async () => {
    const production = new Miniflare({
      modules: true, script: workerScript, compatibilityDate: '2025-07-18',
      bindings: {
        ENVIRONMENT: 'production', SUPABASE_URL: supabaseOrigin, SUPABASE_SECRET_KEY: 'test-secret',
        BHMS_DEV_TOKEN: 'must-not-work-in-production',
      },
    })
    try {
      const loopback = await production.dispatchFetch('http://localhost/api/v1/bootstrap')
      expect(loopback.status).toBe(401)
      const token = await production.dispatchFetch('http://localhost/api/v1/bootstrap', { headers: { authorization: 'Bearer must-not-work-in-production' } } as never)
      expect(token.status).toBe(401)
    } finally {
      await production.dispose()
    }
  })

  it('provisions the single landlord, enforces AAL1 denial, and accepts AAL2', async () => {
    const unauthenticated = await new Client().request('/api/v1/bootstrap')
    expect(unauthenticated.status).toBe(401)
    const setup = await operator('/api/v1/auth/operator/setup-invitation')
    expect(setup.status).toBe(201)
    const setupToken = new URL(setup.data.setupUrl).searchParams.get('token')
    const setupStatus = await new Client().request('/api/v1/auth/invitation-status', { method: 'POST', csrf: false, body: { token: setupToken } })
    expect(setupStatus).toMatchObject({ status: 200, data: { valid: true, kind: 'LANDLORD_SETUP' } })
    const landlord = new Client()
    const accepted = await landlord.request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: setupToken, email: landlordEmail, password: landlordPassword } })
    expect(accepted.status).toBe(201)
    expect((await operator('/api/v1/auth/operator/setup-invitation')).status).toBe(409)
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: setupToken, email: landlordEmail, password: landlordPassword } })).status).toBe(409)
    expect(accepted.data).toMatchObject({ role: 'OWNER', aal: 'aal1', mfaRequired: true })
    expect((await landlord.request('/api/v1/bootstrap')).status).toBe(403)
    const enroll = await landlord.request('/api/v1/auth/mfa/enroll', { method: 'POST', body: {} })
    expect(enroll.status).toBe(200)
    expect((await landlord.request('/api/v1/auth/mfa/status')).data.enrolled).toBe(true)
    const challenge = await landlord.request('/api/v1/auth/mfa/challenge', { method: 'POST', body: { factorId: enroll.data.id } })
    expect(challenge.status).toBe(200)
    const verified = await landlord.request('/api/v1/auth/mfa/verify', { method: 'POST', body: { factorId: enroll.data.id, challengeId: challenge.data.id, code: '123456' } })
    expect(verified.status).toBe(200)
    expect(verified.data).toMatchObject({ aal: 'aal2', mfaRequired: false })
    const bootstrap = await landlord.request('/api/v1/bootstrap')
    expect(bootstrap.status).toBe(200)
    expect(bootstrap.data.capabilities.anniversaryRent).toBe(true)
  })

  it('creates a tenant by invitation, scopes bootstrap, and rejects cross-role access', async () => {
    const landlord = new Client()
    const signIn = await landlord.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: landlordEmail, password: landlordPassword } })
    expect(signIn.status).toBe(200)
    expect(signIn.data).toMatchObject({ email: landlordEmail, emailVerified: false })
    const enroll = await landlord.request('/api/v1/auth/mfa/enroll', { method: 'POST', body: {} })
    const challenge = await landlord.request('/api/v1/auth/mfa/challenge', { method: 'POST', body: { factorId: enroll.data.id } })
    await landlord.request('/api/v1/auth/mfa/verify', { method: 'POST', body: { factorId: enroll.data.id, challengeId: challenge.data.id, code: '123456' } })
    const bootstrap = await landlord.request('/api/v1/bootstrap')
    const serverDate = bootstrap.data.serverDate as string
    const createTenant = await landlord.request('/api/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'auth-tenant-create-0001' },
      body: { action: { type: 'tenant/created', draft: { name: 'Tenant One', email: tenantEmail, phone: '', address: '', notes: '', roomId: 'room-1', moveInDate: serverDate } } },
    })
    expect(createTenant.status).toBe(200)
    const tenantId = createTenant.data.data.tenants[0].id as string
    const invitation = await landlord.request(`/api/v1/auth/tenants/${tenantId}/invitation`, { method: 'POST', body: {} })
    expect(invitation.status).toBe(201)
    const invitationStatus = await new Client().request('/api/v1/auth/invitation-status', { method: 'POST', csrf: false, body: { token: new URL(invitation.data.inviteUrl).searchParams.get('token') } })
    expect(invitationStatus).toMatchObject({ status: 200, data: { valid: true, kind: 'TENANT' } })
    expect((await landlord.request('/api/v1/auth/accounts')).data.invitations.some((item: any) => item.tenant_id === tenantId)).toBe(true)
    const inviteToken = new URL(invitation.data.inviteUrl).searchParams.get('token')
    const tenant = new Client()
    const accepted = await tenant.request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: inviteToken, email: tenantEmail, password: tenantPassword } })
    expect(accepted.status).toBe(201)
    const replay = await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: inviteToken, email: tenantEmail, password: tenantPassword } })
    expect(replay.status).toBe(409)
    expect((await new Client().request('/api/v1/auth/invitation-status', { method: 'POST', csrf: false, body: { token: inviteToken } })).status).toBe(410)
    const scoped = await tenant.request('/api/v1/tenant/bootstrap')
    expect(scoped.status).toBe(200)
    expect(scoped.data).toMatchObject({ role: 'TENANT', tenantId, data: { tenant: { id: tenantId, name: 'Tenant One' } } })
    expect(JSON.stringify(scoped.data)).not.toContain('tenantEmail')
    const roomOptions = await tenant.request('/api/v1/tenant/room-change-options')
    expect(roomOptions.status).toBe(200)
    expect(roomOptions.data.current).toMatchObject({ roomId: 'room-1' })
    expect(roomOptions.data.options.some((room: any) => room.id === 'room-2')).toBe(true)
    const moveDate = new Date(`${scoped.data.serverDate}T00:00:00Z`)
    moveDate.setUTCDate(moveDate.getUTCDate() + 1)
    const roomChange = await tenant.request('/api/v1/tenant/room-change-requests', {
      method: 'POST', headers: { 'idempotency-key': 'tenant-room-change-0001' },
      body: { requestedRoomId: 'room-2', requestedStartDate: moveDate.toISOString().slice(0, 10), reason: 'Need a quieter room.' },
    })
    expect(roomChange.status).toBe(201)
    expect(roomChange.data.request).toMatchObject({ status: 'PENDING', requestedRoomName: '2' })
    const afterRequest = await tenant.request('/api/v1/tenant/bootstrap')
    expect(afterRequest.data.data.assignment).toMatchObject({ id: expect.any(String) })
    expect(afterRequest.data.state.roomAssignments.find((item: any) => item.tenantId === tenantId)).toMatchObject({ roomId: 'room-1' })
    const cancelRequest = await tenant.request(`/api/v1/tenant/room-change-requests/${roomChange.data.request.id}/cancel`, {
      method: 'POST', headers: { 'idempotency-key': 'tenant-room-change-cancel-0001' }, body: {},
    })
    expect(cancelRequest.status).toBe(200)
    expect((await tenant.request('/api/v1/bootstrap')).status).toBe(403)
    expect((await tenant.request('/api/v1/commands', { method: 'POST', body: {} })).status).toBe(403)
    expect((await tenant.request('/api/v1/auth/sign-out', { method: 'POST', origin: 'https://evil.example' })).status).toBe(403)
    expect((await tenant.request('/api/v1/auth/sign-out', { method: 'POST', body: {} })).status).toBe(200)
    expect((await tenant.request('/api/v1/tenant/bootstrap')).status).toBe(401)
    supabaseOutage = true
    expect((await new Client().request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: tenantEmail, password: tenantPassword } })).status).toBe(503)
    expect((await landlord.request('/api/v1/bootstrap')).status).toBe(200)
    supabaseOutage = false
  })

  it('rejects expired, replayed, concurrent, and interrupted invitations safely', async () => {
    const landlord = new Client()
    await landlord.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: landlordEmail, password: landlordPassword } })
    const enroll = await landlord.request('/api/v1/auth/mfa/enroll', { method: 'POST', body: {} })
    const challenge = await landlord.request('/api/v1/auth/mfa/challenge', { method: 'POST', body: { factorId: enroll.data.id } })
    await landlord.request('/api/v1/auth/mfa/verify', { method: 'POST', body: { factorId: enroll.data.id, challengeId: challenge.data.id, code: '123456' } })
    const db = await worker.getD1Database('DB')
    const serverDate = (await landlord.request('/api/v1/bootstrap')).data.serverDate as string
    async function makeTenant(name: string, roomId: string, accountEmail: string, key: string) {
      const created = await landlord.request('/api/v1/commands', { method: 'POST', headers: { 'idempotency-key': key }, body: { action: { type: 'tenant/created', draft: { name, email: accountEmail, phone: '', address: '', notes: '', roomId, moveInDate: serverDate } } } })
      expect(created.status).toBe(200)
      const tenantId = (created.data.data.tenants as { id: string; name: string }[]).find(item => item.name === name)!.id
      const invite = await landlord.request(`/api/v1/auth/tenants/${tenantId}/invitation`, { method: 'POST', body: {} })
      expect(invite.status).toBe(201)
      return { tenantId, invite, token: new URL(invite.data.inviteUrl).searchParams.get('token') as string }
    }
    const first = await makeTenant('Concurrent One', 'room-2', 'concurrent@example.invalid', 'auth-concurrent-create-1')
    const one = new Client(); const two = new Client()
    const [a, b] = await Promise.all([
      one.request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: first.token, email: 'concurrent@example.invalid', password: tenantPassword } }),
      two.request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: first.token, email: 'concurrent@example.invalid', password: tenantPassword } }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    const winner = a.status === 201 ? one : two
    expect((await winner.request('/api/v1/tenant/bootstrap')).status).toBe(200)
    const expired = await makeTenant('Expired One', 'room-3', 'expired@example.invalid', 'auth-expired-create-1')
    await db.prepare('UPDATE auth_invitations SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', expired.invite.data.invitationId).run()
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: expired.token, email: 'expired@example.invalid', password: tenantPassword } })).status).toBe(410)
    const interrupted = await makeTenant('Interrupted One', 'room-4', 'interrupted@example.invalid', 'auth-interrupted-create-1')
    failNextCreationEmail = 'interrupted@example.invalid'
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: interrupted.token, email: 'interrupted@example.invalid', password: tenantPassword } })).status).toBe(503)
    expect((await new Client().request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: 'interrupted@example.invalid', password: tenantPassword } })).status).toBe(403)
    await db.prepare('UPDATE auth_invitations SET lease_expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', interrupted.invite.data.invitationId).run()
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: interrupted.token, email: 'interrupted@example.invalid', password: tenantPassword } })).status).toBe(201)
    const reissued = await makeTenant('Reissued One', 'room-7', 'reissued@example.invalid', 'auth-reissued-create-1')
    const replacement = await landlord.request(`/api/v1/auth/tenants/${reissued.tenantId}/invitation`, { method: 'POST', body: {} })
    expect(replacement.status).toBe(201)
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: reissued.token, email: 'reissued@example.invalid', password: tenantPassword } })).status).toBe(410)
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: new URL(replacement.data.inviteUrl).searchParams.get('token'), email: 'reissued@example.invalid', password: tenantPassword } })).status).toBe(201)
    const cancellable = await makeTenant('Cancelled One', 'room-8', 'cancelled@example.invalid', 'auth-cancelled-create-1')
    expect((await landlord.request(`/api/v1/auth/invitations/${cancellable.invite.data.invitationId}`, { method: 'DELETE' })).status).toBe(200)
    expect((await new Client().request('/api/v1/auth/accept', { method: 'POST', csrf: false, body: { token: cancellable.token, email: 'cancelled@example.invalid', password: tenantPassword } })).status).toBe(410)
    const accounts = await landlord.request('/api/v1/auth/accounts')
    const concurrent = accounts.data.accounts.find((item: any) => item.email === 'concurrent@example.invalid')
    await db.prepare('UPDATE tenant_account_links SET access_expires_at = ? WHERE tenant_id = ?').bind('2000-01-01T00:00:00.000Z', concurrent.tenant_id).run()
    expect((await winner.request('/api/v1/tenant/bootstrap')).status).toBe(403)
    const noCsrf = await worker.dispatchFetch(`${origin}/api/v1/auth/sign-out`, { method: 'POST', headers: { origin, cookie: [...winner.cookies].map(([key, value]) => `${key}=${value}`).join('; ') } } as never)
    expect(noCsrf.status).toBe(403)
  })

  it('rotates sessions, denies after suspension, and recovers credentials', async () => {
    const landlord = new Client()
    await landlord.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: landlordEmail, password: landlordPassword } })
    const enroll = await landlord.request('/api/v1/auth/mfa/enroll', { method: 'POST', body: {} })
    const challenge = await landlord.request('/api/v1/auth/mfa/challenge', { method: 'POST', body: { factorId: enroll.data.id } })
    await landlord.request('/api/v1/auth/mfa/verify', { method: 'POST', body: { factorId: enroll.data.id, challengeId: challenge.data.id, code: '123456' } })
    const refreshed = await landlord.request('/api/v1/auth/refresh', { method: 'POST', body: {} })
    expect(refreshed.status).toBe(200)
    expect(refreshed.data).toMatchObject({ refreshed: true, authenticated: true, email: landlordEmail, emailVerified: false })
    expect((await landlord.request('/api/v1/bootstrap')).status).toBe(200)
    const accounts = await landlord.request('/api/v1/auth/accounts')
    const tenantAccount = accounts.data.accounts.find((item: any) => item.role === 'TENANT')
    const tenant = new Client()
    await tenant.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: tenantEmail, password: tenantPassword } })
    expect((await tenant.request('/api/v1/tenant/bootstrap')).status).toBe(200)
    const suspend = await landlord.request(`/api/v1/auth/accounts/${tenantAccount.id}/suspend`, { method: 'POST', body: {} })
    expect(suspend.status).toBe(200)
    expect((await tenant.request('/api/v1/tenant/bootstrap')).status).toBe(403)
    expect((await landlord.request(`/api/v1/auth/accounts/${tenantAccount.id}/reactivate`, { method: 'POST', body: {} })).status).toBe(200)
    expect((await tenant.request('/api/v1/tenant/bootstrap')).status).toBe(401)
    await new Promise(resolve => setTimeout(resolve, 1100))
    const reactivatedTenant = new Client()
    expect((await reactivatedTenant.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: tenantEmail, password: tenantPassword } })).status).toBe(200)
    expect((await reactivatedTenant.request('/api/v1/tenant/bootstrap')).status).toBe(200)
    const recovery = await landlord.request(`/api/v1/auth/accounts/${tenantAccount.id}/recovery`, { method: 'POST', body: {} })
    expect(recovery.status).toBe(201)
    const recoveryToken = new URL(recovery.data.recoveryUrl).searchParams.get('token')
    const recovered = await new Client().request('/api/v1/auth/recover', { method: 'POST', csrf: false, body: { token: recoveryToken, newPassword: replacedPassword } })
    expect(recovered.status).toBe(200)
    expect((await reactivatedTenant.request('/api/v1/tenant/bootstrap')).status).toBe(401)
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect((await new Client().request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: tenantEmail, password: tenantPassword } })).status).toBe(401)
    const recoveredTenant = new Client()
    expect((await recoveredTenant.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: tenantEmail, password: replacedPassword } })).status).toBe(200)
    expect((await recoveredTenant.request('/api/v1/tenant/bootstrap')).data.tenantId).toBe(tenantAccount.tenant_id)
    const landlordRecovery = await operator('/api/v1/auth/operator/landlord-recovery')
    expect(landlordRecovery.status).toBe(201)
    const landlordToken = new URL(landlordRecovery.data.recoveryUrl).searchParams.get('token')
    const landlordReset = await new Client().request('/api/v1/auth/recover', { method: 'POST', csrf: false, body: { token: landlordToken, newPassword: landlordReplacement } })
    expect(landlordReset.status).toBe(200)
    expect((await landlord.request('/api/v1/bootstrap')).status).toBe(401)
    await new Promise(resolve => setTimeout(resolve, 1100))
    const recoveredLandlord = new Client()
    const login = await recoveredLandlord.request('/api/v1/auth/sign-in', { method: 'POST', csrf: false, body: { email: landlordEmail, password: landlordReplacement } })
    expect(login.status).toBe(200)
    expect((await recoveredLandlord.request('/api/v1/bootstrap')).status).toBe(403)
    const newEnroll = await recoveredLandlord.request('/api/v1/auth/mfa/enroll', { method: 'POST', body: {} })
    const newChallenge = await recoveredLandlord.request('/api/v1/auth/mfa/challenge', { method: 'POST', body: { factorId: newEnroll.data.id } })
    expect((await recoveredLandlord.request('/api/v1/auth/mfa/verify', { method: 'POST', body: { factorId: newEnroll.data.id, challengeId: newChallenge.data.id, code: '123456' } })).status).toBe(200)
    expect((await recoveredLandlord.request('/api/v1/bootstrap')).status).toBe(200)
  })
})
