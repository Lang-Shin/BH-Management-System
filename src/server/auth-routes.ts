import { authenticateRequest, requireAdministrator, requireCsrf, requireOperator, requireRecentAuth, requireSameOrigin, resolveActor } from './auth'
import type { WorkerEnv } from './env'
import { ApiError, errorResponse, json, readJson, requestId } from './http'
import { assertTimeZone } from './date'
import {
  authCookieNames,
  authFailure,
  challengeTotp,
  clearAuthCookieHeaders,
  clientIp,
  createSupabaseUser,
  deleteSupabaseUser,
  enrollTotp,
  getSupabaseUser,
  listSupabaseFactors,
  openTokens,
  randomToken,
  readCookie,
  refreshSupabaseSession,
  sessionCookieHeaders,
  signInWithPassword,
  signOutSupabase,
  supabaseUser,
  tokenPair,
  updateSupabaseUser,
  verifySupabaseJwt,
  verifyTotp,
} from './supabase-auth'

const LEASE_MS = 60_000
const SETUP_TTL_MS = 24 * 60 * 60_000
const TENANT_TTL_MS = 24 * 60 * 60_000
const RECOVERY_TTL_MS = 60 * 60_000

interface InvitationRow {
  id: string
  workspace_id: string
  kind: 'LANDLORD_SETUP' | 'TENANT' | 'TENANT_RECOVERY' | 'LANDLORD_RECOVERY'
  tenant_id: string | null
  target_user_id: string | null
  state: string
  expires_at: string
  auth_user_id: string | null
  bhms_user_id: string | null
}

interface AccountRow {
  id: string
  email: string
  display_name: string | null
  status: string
  email_verified: number
  role: string
  tenant_id: string | null
  access_expires_at: string | null
}

const nowIso = (): string => new Date().toISOString()
const plusMs = (milliseconds: number): string => new Date(Date.now() + milliseconds).toISOString()
const workspaceId = (env: WorkerEnv): string => env.WORKSPACE_ID ?? 'demo-workspace'
const aalLabel = (value: 1 | 2): 'aal1' | 'aal2' => value === 2 ? 'aal2' : 'aal1'

function withCookies(data: unknown, status: number, cookies: string[], id: string): Response {
  const response = json(data, { status }, id)
  for (const value of cookies) response.headers.append('set-cookie', value)
  return response
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, name: string, min = 1, max = 320): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_INPUT', `${name} is required.`)
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) throw new ApiError(400, 'INVALID_INPUT', `${name} has an invalid length.`)
  return trimmed
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be between 12 and 128 characters.')
  }
  return value
}

function email(value: unknown): string {
  const normalized = text(value, 'email', 3, 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ApiError(400, 'INVALID_INPUT', 'Enter a valid email address.')
  return normalized
}

function appBase(request: Request, env: WorkerEnv): string {
  const configured = env.AUTH_APP_URL
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'The application URL is not configured.')
    }
  }
  return new URL(request.url).origin
}

function invitationUrl(request: Request, env: WorkerEnv, kind: InvitationRow['kind'] | 'LANDLORD_SETUP' | 'TENANT' | 'TENANT_RECOVERY' | 'LANDLORD_RECOVERY', token: string): string {
  const path = kind.endsWith('_RECOVERY') ? '/reset-password' : '/accept'
  return `${appBase(request, env)}${path}?token=${encodeURIComponent(token)}`
}

async function digest(env: WorkerEnv, token: string): Promise<string> {
  if (!env.INVITE_TOKEN_PEPPER || env.INVITE_TOKEN_PEPPER.length < 32) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Invitation token security is not configured.')
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.INVITE_TOKEN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`bhms-auth-invite-v1\0${token}`))
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function audit(env: WorkerEnv, input: {
  request: Request
  actorType: 'OPERATOR' | 'OWNER' | 'TENANT' | 'SYSTEM'
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILED'
  metadata?: Record<string, unknown>
}): Promise<void> {
  let ipHash: string | null = null
  if (env.AUDIT_PEPPER && env.AUDIT_PEPPER.length >= 32) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.AUDIT_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`bhms-audit-ip-v1\0${clientIp(input.request)}`))
    ipHash = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  try {
    await env.DB.prepare(
      `INSERT INTO security_audit_events
       (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, outcome, ip_hash, request_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), workspaceId(env), input.actorType, input.actorId ?? null, input.action,
      input.entityType, input.entityId ?? null, input.outcome ?? 'SUCCESS', ipHash,
      requestId(input.request), input.metadata ? JSON.stringify(input.metadata) : null, nowIso(),
    ).run()
  } catch {
    // Security audit is best-effort; D1 authorization still fails closed.
  }
}

async function ensureWorkspace(env: WorkerEnv): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO workspaces (id, name, timezone, dataset_kind, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(workspaceId(env), 'Halili BH', assertTimeZone(env.APP_TIMEZONE), 'REAL', nowIso()).run()
}

async function tenantFromState(env: WorkerEnv, tenantId: string): Promise<{ id: string; name: string; status: string }> {
  const row = await env.DB.prepare('SELECT data_json FROM workspace_state WHERE workspace_id = ?').bind(workspaceId(env))
    .first<{ data_json: string }>()
  if (!row) throw new ApiError(409, 'WORKSPACE_NOT_INITIALIZED', 'Import or initialize the workspace before adding tenant accounts.')
  let parsed: unknown
  try {
    parsed = JSON.parse(row.data_json)
  } catch {
    throw new ApiError(500, 'STATE_INVALID', 'The workspace state is not readable.')
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tenants)) throw new ApiError(500, 'STATE_INVALID', 'The workspace state is invalid.')
  const tenant = parsed.tenants.find(item => isRecord(item) && item.id === tenantId)
  if (!tenant || typeof tenant.name !== 'string' || typeof tenant.status !== 'string') {
    throw new ApiError(404, 'TENANT_NOT_FOUND', 'The tenant record was not found.')
  }
  return { id: tenantId, name: tenant.name, status: tenant.status }
}

async function cancelPending(env: WorkerEnv, kind: InvitationRow['kind'], tenantId?: string | null, targetUserId?: string | null): Promise<void> {
  if (kind === 'LANDLORD_SETUP') {
    await env.DB.prepare("UPDATE auth_invitations SET state = 'CANCELLED' WHERE workspace_id = ? AND kind = 'LANDLORD_SETUP' AND state IN ('PENDING', 'PROVISIONING')")
      .bind(workspaceId(env)).run()
    return
  }
  if (tenantId) {
    await env.DB.prepare("UPDATE auth_invitations SET state = 'CANCELLED' WHERE workspace_id = ? AND kind = ? AND tenant_id = ? AND state IN ('PENDING', 'PROVISIONING')")
      .bind(workspaceId(env), kind, tenantId).run()
  } else if (targetUserId) {
    await env.DB.prepare("UPDATE auth_invitations SET state = 'CANCELLED' WHERE workspace_id = ? AND kind = ? AND target_user_id = ? AND state IN ('PENDING', 'PROVISIONING')")
      .bind(workspaceId(env), kind, targetUserId).run()
  }
}

async function issueInvitation(env: WorkerEnv, input: {
  kind: InvitationRow['kind']
  tenantId?: string | null
  targetUserId?: string | null
  authUserId?: string | null
  bhmsUserId?: string | null
  createdBy: string
  ttlMs: number
}): Promise<{ id: string; token: string; expiresAt: string }> {
  const id = crypto.randomUUID()
  const token = randomToken(32)
  const tokenDigest = await digest(env, token)
  const expiresAt = plusMs(input.ttlMs)
  await env.DB.prepare(
    `INSERT INTO auth_invitations
     (id, workspace_id, kind, tenant_id, target_user_id, token_digest, state, expires_at, auth_user_id, bhms_user_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
  ).bind(
    id, workspaceId(env), input.kind, input.tenantId ?? null, input.targetUserId ?? null, tokenDigest, expiresAt,
    input.authUserId ?? null, input.bhmsUserId ?? null, input.createdBy, nowIso(),
  ).run()
  return { id, token, expiresAt }
}

async function claimInvitation(env: WorkerEnv, token: string): Promise<InvitationRow & { lease_owner: string }> {
  const tokenDigest = await digest(env, token)
  const leaseOwner = crypto.randomUUID()
  const now = nowIso()
  const select = 'id, workspace_id, kind, tenant_id, target_user_id, state, expires_at, auth_user_id, bhms_user_id'
  let row = await env.DB.prepare(
    `UPDATE auth_invitations SET state = 'PROVISIONING', claimed_at = ?, lease_owner = ?, lease_expires_at = ?
     WHERE token_digest = ? AND state = 'PENDING' AND expires_at > ?
     RETURNING ${select}`,
  ).bind(now, leaseOwner, plusMs(LEASE_MS), tokenDigest, now).first<InvitationRow>()
  if (!row) {
    row = await env.DB.prepare(
      `UPDATE auth_invitations SET state = 'PROVISIONING', claimed_at = ?, lease_owner = ?, lease_expires_at = ?
       WHERE token_digest = ? AND state = 'PROVISIONING' AND lease_expires_at < ?
       RETURNING ${select}`,
    ).bind(now, leaseOwner, plusMs(LEASE_MS), tokenDigest, now).first<InvitationRow>()
  }
  if (!row) {
    const existing = await env.DB.prepare('SELECT state, expires_at FROM auth_invitations WHERE token_digest = ?').bind(tokenDigest)
      .first<{ state: string; expires_at: string }>()
    if (existing?.state === 'PENDING' && Date.parse(existing.expires_at) <= Date.now()) {
      await env.DB.prepare("UPDATE auth_invitations SET state = 'EXPIRED' WHERE token_digest = ? AND state = 'PENDING'").bind(tokenDigest).run()
      throw new ApiError(410, 'INVITATION_EXPIRED', 'This invitation has expired.')
    }
    if (existing?.state === 'CONSUMED') throw new ApiError(409, 'INVITATION_USED', 'This invitation has already been used.')
    if (existing?.state === 'CANCELLED' || existing?.state === 'EXPIRED') throw new ApiError(410, 'INVITATION_EXPIRED', 'This invitation is no longer available.')
    throw new ApiError(409, 'INVITATION_BUSY', 'This invitation is already being processed. Try again shortly.')
  }
  return { ...row, lease_owner: leaseOwner }
}

async function accountRow(env: WorkerEnv, userId: string): Promise<AccountRow | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.status, u.email_verified, m.role, t.tenant_id, t.access_expires_at
     FROM users u JOIN workspace_memberships m ON m.user_id = u.id
     LEFT JOIN tenant_account_links t ON t.user_id = u.id
     WHERE m.workspace_id = ? AND u.id = ?`,
  ).bind(workspaceId(env), userId).first<AccountRow>()
}

async function ownerExists(env: WorkerEnv): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 AS found FROM workspace_memberships WHERE workspace_id = ? AND role = 'OWNER'")
    .bind(workspaceId(env)).first())
}

async function currentAuth(request: Request, env: WorkerEnv) {
  return authenticateRequest(request, env)
}

async function handleOperatorSetup(request: Request, env: WorkerEnv): Promise<Response> {
  requireOperator(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  if (await ownerExists(env)) throw new ApiError(409, 'LANDLORD_ALREADY_SETUP', 'The landlord account is already configured.')
  await ensureWorkspace(env)
  await cancelPending(env, 'LANDLORD_SETUP')
  const invite = await issueInvitation(env, {
    kind: 'LANDLORD_SETUP', authUserId: crypto.randomUUID(), bhmsUserId: crypto.randomUUID(), createdBy: 'operator', ttlMs: SETUP_TTL_MS,
  })
  await audit(env, {
    request, actorType: 'OPERATOR', action: 'LANDLORD_SETUP_INVITATION_CREATED', entityType: 'AUTH_INVITATION', entityId: invite.id,
  })
  return withCookies({ setupUrl: invitationUrl(request, env, 'LANDLORD_SETUP', invite.token), expiresAt: invite.expiresAt }, 201, [], requestId(request))
}

async function handleOperatorLandlordRecovery(request: Request, env: WorkerEnv): Promise<Response> {
  requireOperator(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const owner = await env.DB.prepare(
    `SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id = u.id
     WHERE m.workspace_id = ? AND m.role = 'OWNER'`,
  ).bind(workspaceId(env)).first<{ id: string }>()
  if (!owner) throw new ApiError(404, 'LANDLORD_NOT_FOUND', 'The landlord account was not found.')
  await cancelPending(env, 'LANDLORD_RECOVERY', null, owner.id)
  const invite = await issueInvitation(env, {
    kind: 'LANDLORD_RECOVERY', targetUserId: owner.id, createdBy: 'operator', ttlMs: RECOVERY_TTL_MS,
  })
  await audit(env, {
    request, actorType: 'OPERATOR', action: 'LANDLORD_RECOVERY_CREATED', entityType: 'AUTH_INVITATION', entityId: invite.id,
    metadata: { userId: owner.id },
  })
  return withCookies({ recoveryUrl: invitationUrl(request, env, 'LANDLORD_RECOVERY', invite.token), expiresAt: invite.expiresAt }, 201, [], requestId(request))
}

async function handleAccept(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const body = await readJson(request)
  const token = text(body.token, 'token', 32, 256)
  const chosenEmail = email(body.email)
  const chosenPassword = password(body.password)
  const invitation = await claimInvitation(env, token)
  if (invitation.kind !== 'LANDLORD_SETUP' && invitation.kind !== 'TENANT') {
    throw new ApiError(409, 'INVITATION_KIND_MISMATCH', 'This is not an account setup invitation.')
  }
  if (!invitation.auth_user_id || !invitation.bhms_user_id) throw new ApiError(409, 'INVITATION_INVALID', 'The invitation is incomplete.')
  let displayName = 'Landlord'
  let tenantId: string | null = null
  if (invitation.kind === 'TENANT') {
    if (!invitation.tenant_id) throw new ApiError(409, 'INVITATION_INVALID', 'The tenant invitation is incomplete.')
    const tenant = await tenantFromState(env, invitation.tenant_id)
    if (tenant.status !== 'ACTIVE') throw new ApiError(409, 'TENANT_NOT_ACTIVE', 'This tenant record is not active.')
    displayName = tenant.name
    tenantId = tenant.id
  } else if (await ownerExists(env)) {
    throw new ApiError(409, 'LANDLORD_ALREADY_SETUP', 'The landlord account is already configured.')
  }

  const created = await createSupabaseUser(env, {
    id: invitation.auth_user_id, email: chosenEmail, password: chosenPassword,
    bhmsUserId: invitation.bhms_user_id, invitationId: invitation.id, displayName, forwardedIp: clientIp(request),
  })
  let user = created.status === 200 || created.status === 201 ? supabaseUser(created.data) : null
  if (!user && [400, 409, 422].includes(created.status)) {
    const existing = await getSupabaseUser(env, invitation.auth_user_id, clientIp(request))
    const candidate = existing.status === 200 ? supabaseUser(existing.data) : null
    if (
      candidate?.id === invitation.auth_user_id &&
      candidate.email?.toLowerCase() === chosenEmail &&
      candidate.app_metadata?.bhms_invitation_id === invitation.id &&
      candidate.app_metadata?.bhms_user_id === invitation.bhms_user_id
    ) {
      const check = await signInWithPassword(env, chosenEmail, chosenPassword, clientIp(request))
      if (check.status !== 200) throw new ApiError(409, 'PROVISIONING_CONFLICT', 'This invitation was already used with a different password.')
      user = candidate
    } else {
      throw new ApiError(409, 'IDENTITY_CONFLICT', 'This email is already associated with another account. Contact the operator.')
    }
  }
  if (!user) {
    if (created.status === 429) throw new ApiError(429, 'AUTH_RATE_LIMITED', 'Too many account creation attempts. Try again later.')
    if (created.status >= 500) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.')
    throw new ApiError(409, 'PROVISIONING_FAILED', 'The authentication account could not be created safely.')
  }
  if (user.id !== invitation.auth_user_id || user.app_metadata?.bhms_invitation_id !== invitation.id) {
    throw new ApiError(409, 'IDENTITY_CONFLICT', 'The authentication identity could not be verified.')
  }

  const createdAt = nowIso()
  const statements = [
    env.DB.prepare(
      `INSERT INTO users (id, email, display_name, status, created_at, auth_user_id, email_verified, session_invalid_after)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?, 0, ?)`,
    ).bind(invitation.bhms_user_id, chosenEmail, displayName, createdAt, invitation.auth_user_id, createdAt),
    env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
      .bind(workspaceId(env), invitation.bhms_user_id, invitation.kind === 'LANDLORD_SETUP' ? 'OWNER' : 'TENANT', createdAt),
  ]
  if (tenantId) {
    statements.push(env.DB.prepare('INSERT INTO tenant_account_links (tenant_id, workspace_id, user_id, access_expires_at, created_at) VALUES (?, ?, ?, NULL, ?)')
      .bind(tenantId, workspaceId(env), invitation.bhms_user_id, createdAt))
  }
  try {
    await env.DB.batch(statements)
  } catch (error) {
    await env.DB.prepare("UPDATE auth_invitations SET last_error = ? WHERE id = ? AND state = 'PROVISIONING'")
      .bind(error instanceof Error ? error.message.slice(0, 200) : 'provisioning_failed', invitation.id).run()
    throw new ApiError(409, 'PROVISIONING_FAILED', 'The account could not be linked safely. Retry the invitation or contact the operator.')
  }

  await audit(env, {
    request, actorType: 'SYSTEM', actorId: null,
    action: invitation.kind === 'LANDLORD_SETUP' ? 'LANDLORD_PROVISIONED' : 'TENANT_ACCOUNT_CREATED',
    entityType: 'USER', entityId: invitation.bhms_user_id, metadata: { tenantId },
  })
  const login = await signInWithPassword(env, chosenEmail, chosenPassword, clientIp(request))
  const tokens = login.status === 200 ? tokenPair(login.data) : null
  if (!tokens) return withCookies({ provisioned: true, authenticated: false, loginRequired: true }, 201, [], requestId(request))
  const claims = await verifySupabaseJwt(tokens.access_token, env)
  const actor = await resolveActor(env, claims)
  const csrf = randomToken(32)
  const cookies = await sessionCookieHeaders(env, tokens, csrf)
  return withCookies({
    provisioned: true, authenticated: true, role: actor.role, email: actor.email, emailVerified: actor.emailVerified, aal: aalLabel(actor.aal), tenantId: actor.tenantId ?? null,
    mfaRequired: (actor.role === 'OWNER' || actor.role === 'ADMIN') && actor.aal !== 2, csrfToken: csrf,
  }, 201, cookies, requestId(request))
}

async function handleSignIn(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const body = await readJson(request)
  const chosenEmail = email(body.email)
  const chosenPassword = password(body.password)
  const result = await signInWithPassword(env, chosenEmail, chosenPassword, clientIp(request))
  if (result.status !== 200) throw authFailure(result)
  const tokens = tokenPair(result.data)
  if (!tokens) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.')
  const claims = await verifySupabaseJwt(tokens.access_token, env)
  const actor = await resolveActor(env, claims)
  const csrf = randomToken(32)
  const cookies = await sessionCookieHeaders(env, tokens, csrf)
  await audit(env, {
    request, actorType: actor.role === 'OWNER' || actor.role === 'ADMIN' ? 'OWNER' : 'TENANT', actorId: actor.id,
    action: 'SIGN_IN', entityType: 'USER', entityId: actor.id, metadata: { aal: actor.aal },
  })
  return withCookies({
    authenticated: true, role: actor.role, email: actor.email, emailVerified: actor.emailVerified,
    aal: actor.aal, tenantId: actor.tenantId ?? null,
    mfaRequired: (actor.role === 'OWNER' || actor.role === 'ADMIN') && actor.aal !== 2, csrfToken: csrf,
  }, 200, cookies, requestId(request))
}

async function handleSession(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.')
  const auth = await currentAuth(request, env)
  const names = authCookieNames(env)
  const csrf = readCookie(request, names.csrf) ?? ''
  return withCookies({
    authenticated: true, role: auth.actor.role, email: auth.actor.email, emailVerified: auth.actor.emailVerified, aal: aalLabel(auth.actor.aal), tenantId: auth.actor.tenantId ?? null,
    mfaRequired: (auth.actor.role === 'OWNER' || auth.actor.role === 'ADMIN') && auth.actor.aal !== 2, csrfToken: csrf,
  }, 200, auth.setCookies, requestId(request))
}

async function handleRefresh(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const names = authCookieNames(env)
  const sealed = readCookie(request, names.session)
  if (!sealed) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in is required.')
  const existing = await openTokens(env, sealed)
  if (!existing) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid session is required.')
  const result = await refreshSupabaseSession(env, existing.refresh_token, clientIp(request))
  const tokens = result.status === 200 ? tokenPair(result.data) : null
  if (!tokens) {
    const error = authFailure(result)
    const cookies = result.status >= 500 ? [] : clearAuthCookieHeaders(env)
    return withCookies({ error: { code: error.code, message: error.message } }, error.status, cookies, requestId(request))
  }
  const claims = await verifySupabaseJwt(tokens.access_token, env)
  const actor = await resolveActor(env, claims)
  const csrf = randomToken(32)
  const cookies = await sessionCookieHeaders(env, tokens, csrf)
  return withCookies({
    authenticated: true, refreshed: true, role: actor.role, email: actor.email,
    emailVerified: actor.emailVerified, aal: actor.aal, tenantId: actor.tenantId ?? null,
    mfaRequired: (actor.role === 'OWNER' || actor.role === 'ADMIN') && actor.aal !== 2, csrfToken: csrf,
  }, 200, cookies, requestId(request))
}

async function handleSignOut(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const auth = await currentAuth(request, env)
  let provider = 'revoked'
  try {
    const result = await signOutSupabase(env, auth.tokens.access_token, clientIp(request))
    if (result.status >= 500) provider = 'pending'
  } catch {
    provider = 'pending'
  }
  await audit(env, {
    request, actorType: auth.actor.role === 'OWNER' || auth.actor.role === 'ADMIN' ? 'OWNER' : 'TENANT', actorId: auth.actor.id,
    action: 'SIGN_OUT', entityType: 'USER', entityId: auth.actor.id, metadata: { provider },
  })
  return withCookies({ signedOut: true, provider }, 200, clearAuthCookieHeaders(env), requestId(request))
}

async function handleMfaEnroll(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor, false)
  if (auth.actor.aal === 2) throw new ApiError(409, 'ALREADY_AAL2', 'This session already has MFA assurance.')
  const result = await enrollTotp(env, auth.tokens.access_token, 'Halili BH', clientIp(request))
  if (result.status !== 200) throw new ApiError(503, 'MFA_UNAVAILABLE', 'MFA enrollment could not be started.')
  return withCookies(result.data, 200, [], requestId(request))
}

async function handleMfaChallenge(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor, false)
  const body = await readJson(request)
  const factorId = text(body.factorId, 'factorId', 16, 64)
  const result = await challengeTotp(env, auth.tokens.access_token, factorId, clientIp(request))
  if (result.status !== 200) throw new ApiError(401, 'MFA_CHALLENGE_FAILED', 'MFA challenge could not be created.')
  return json(result.data, {}, requestId(request))
}

async function handleMfaVerify(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor, false)
  const body = await readJson(request)
  const factorId = text(body.factorId, 'factorId', 16, 64)
  const challengeId = text(body.challengeId, 'challengeId', 16, 64)
  const code = text(body.code, 'code', 6, 10)
  const result = await verifyTotp(env, auth.tokens.access_token, factorId, challengeId, code, clientIp(request))
  const tokens = result.status === 200 ? tokenPair(result.data) : null
  if (!tokens) {
    if (result.status === 429) throw new ApiError(429, 'AUTH_RATE_LIMITED', 'Too many verification attempts. Try again later.')
    throw new ApiError(401, 'MFA_FAILED', 'The authenticator code was not accepted.')
  }
  const claims = await verifySupabaseJwt(tokens.access_token, env)
  if (claims.sub !== auth.actor.authUserId || claims.session_id !== auth.claims.session_id || claims.aal !== 'aal2') {
    throw new ApiError(401, 'MFA_FAILED', 'The verified session is invalid.')
  }
  const csrf = randomToken(32)
  const cookies = await sessionCookieHeaders(env, tokens, csrf)
  await audit(env, {
    request, actorType: 'OWNER', actorId: auth.actor.id, action: 'MFA_VERIFIED', entityType: 'USER',
    entityId: auth.actor.id, metadata: { method: 'totp' },
  })
  return withCookies({ authenticated: true, role: auth.actor.role, email: auth.actor.email, emailVerified: auth.actor.emailVerified, aal: 'aal2', tenantId: auth.actor.tenantId ?? null, mfaRequired: false, csrfToken: csrf }, 200, cookies, requestId(request))
}

async function handleTenantInvitation(request: Request, env: WorkerEnv, tenantId: string): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor)
  const tenant = await tenantFromState(env, tenantId)
  if (tenant.status !== 'ACTIVE') throw new ApiError(409, 'TENANT_NOT_ACTIVE', 'This tenant is not active.')
  const existing = await env.DB.prepare('SELECT user_id FROM tenant_account_links WHERE tenant_id = ? AND workspace_id = ?')
    .bind(tenantId, workspaceId(env)).first<{ user_id: string }>()
  if (existing) throw new ApiError(409, 'TENANT_ALREADY_LINKED', 'This tenant already has an account.')
  await cancelPending(env, 'TENANT', tenantId, null)
  const invite = await issueInvitation(env, {
    kind: 'TENANT', tenantId, authUserId: crypto.randomUUID(), bhmsUserId: crypto.randomUUID(), createdBy: auth.actor.id, ttlMs: TENANT_TTL_MS,
  })
  await audit(env, {
    request, actorType: 'OWNER', actorId: auth.actor.id, action: 'TENANT_INVITATION_CREATED', entityType: 'AUTH_INVITATION',
    entityId: invite.id, metadata: { tenantId },
  })
  return withCookies({ invitationId: invite.id, inviteUrl: invitationUrl(request, env, 'TENANT', invite.token), expiresAt: invite.expiresAt }, 201, [], requestId(request))
}

async function handleCancelInvitation(request: Request, env: WorkerEnv, invitationId: string): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'DELETE' && request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use DELETE.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor)
  const result = await env.DB.prepare("UPDATE auth_invitations SET state = 'CANCELLED' WHERE id = ? AND workspace_id = ? AND state = 'PENDING'")
    .bind(invitationId, workspaceId(env)).run()
  if (!result.meta.changes) throw new ApiError(409, 'INVITATION_NOT_CANCELLABLE', 'Only a pending invitation can be cancelled.')
  await audit(env, {
    request, actorType: 'OWNER', actorId: auth.actor.id, action: 'INVITATION_CANCELLED', entityType: 'AUTH_INVITATION', entityId: invitationId,
  })
  return json({ cancelled: true }, {}, requestId(request))
}

async function handleInvitationStatus(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const body = await readJson(request)
  const token = text(body.token, 'token', 32, 256)
  const tokenDigest = await digest(env, token)
  const invite = await env.DB.prepare('SELECT kind, state, expires_at FROM auth_invitations WHERE token_digest = ?')
    .bind(tokenDigest).first<{ kind: string; state: string; expires_at: string }>()
  if (!invite) throw new ApiError(404, 'INVITATION_INVALID', 'This invitation is not valid.')
  if (invite.state === 'CONSUMED') throw new ApiError(410, 'INVITATION_USED', 'This invitation has already been used.')
  if (invite.state === 'CANCELLED' || invite.state === 'EXPIRED' || (invite.state === 'PENDING' && Date.parse(invite.expires_at) <= Date.now())) {
    throw new ApiError(410, 'INVITATION_EXPIRED', 'This invitation has expired.')
  }
  if (invite.state !== 'PENDING' && invite.state !== 'PROVISIONING') throw new ApiError(409, 'INVITATION_INVALID', 'This invitation is not available.')
  return json({ valid: true, kind: invite.kind, state: invite.state, expiresAt: invite.expires_at }, {}, requestId(request))
}

async function handleMfaStatus(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor, false)
  if (!auth.actor.authUserId) throw new ApiError(403, 'FORBIDDEN', 'This account has no authentication identity.')
  const result = await listSupabaseFactors(env, auth.actor.authUserId, clientIp(request))
  if (result.status !== 200) throw new ApiError(503, 'MFA_UNAVAILABLE', 'Authenticator status is unavailable. Try again shortly.')
  const factors = Array.isArray(result.data) ? result.data as { id?: string; friendly_name?: string; status?: string; factor_type?: string }[] : []
  return json({ enrolled: factors.some(factor => factor.status === 'verified'), factors: factors.map(factor => ({ id: factor.id, friendlyName: factor.friendly_name, status: factor.status, factorType: factor.factor_type })) }, {}, requestId(request))
}

async function handleAccounts(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor)
  const users = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.status, u.email_verified, m.role, t.tenant_id, t.access_expires_at
     FROM users u JOIN workspace_memberships m ON m.user_id = u.id
     LEFT JOIN tenant_account_links t ON t.user_id = u.id
     WHERE m.workspace_id = ? ORDER BY u.created_at`,
  ).bind(workspaceId(env)).all<AccountRow>()
  const invitations = await env.DB.prepare(
    `SELECT id, kind, tenant_id, target_user_id, state, expires_at, created_at FROM auth_invitations
     WHERE workspace_id = ? AND state IN ('PENDING', 'PROVISIONING') ORDER BY created_at DESC`,
  ).bind(workspaceId(env)).all()
  return json({ accounts: users.results, invitations: invitations.results }, {}, requestId(request))
}

async function handleAccountAction(request: Request, env: WorkerEnv, userId: string, action: 'suspend' | 'reactivate' | 'recovery'): Promise<Response> {
  requireSameOrigin(request, env)
  requireCsrf(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const auth = await currentAuth(request, env)
  requireAdministrator(auth.actor)
  requireRecentAuth(auth.claims)
  if (userId === auth.actor.id) throw new ApiError(409, 'CANNOT_MODIFY_SELF', 'The landlord cannot perform this action on their own account here.')
  const target = await accountRow(env, userId)
  if (!target) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'The account was not found.')
  const targetUser = await env.DB.prepare('SELECT auth_user_id FROM users WHERE id = ?').bind(userId).first<{ auth_user_id: string | null }>()
  if (!targetUser?.auth_user_id) throw new ApiError(409, 'ACCOUNT_NOT_LINKED', 'This account has no Supabase identity.')

  if (action === 'recovery') {
    await cancelPending(env, 'TENANT_RECOVERY', target.tenant_id, userId)
    await cancelPending(env, 'LANDLORD_RECOVERY', null, userId)
    const kind = target.role === 'OWNER' || target.role === 'ADMIN' ? 'LANDLORD_RECOVERY' : 'TENANT_RECOVERY'
    const invite = await issueInvitation(env, {
      kind, tenantId: target.tenant_id, targetUserId: userId, createdBy: auth.actor.id, ttlMs: RECOVERY_TTL_MS,
    })
    await audit(env, {
      request, actorType: 'OWNER', actorId: auth.actor.id, action: 'ACCOUNT_RECOVERY_CREATED', entityType: 'AUTH_INVITATION',
      entityId: invite.id, metadata: { userId },
    })
    return withCookies({ recoveryUrl: invitationUrl(request, env, kind, invite.token), expiresAt: invite.expiresAt }, 201, [], requestId(request))
  }

  const nextStatus = action === 'suspend' ? 'DISABLED' : 'ACTIVE'
  const at = action === 'reactivate' ? new Date(Date.now() + 1000).toISOString() : nowIso()
  await env.DB.prepare('UPDATE users SET status = ?, session_invalid_after = ? WHERE id = ? AND auth_user_id = ?')
    .bind(nextStatus, at, userId, targetUser.auth_user_id).run()
  if (action === 'reactivate') {
    await env.DB.prepare('UPDATE tenant_account_links SET access_expires_at = NULL WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId(env), userId).run()
  }
  try {
    await updateSupabaseUser(env, targetUser.auth_user_id, { ban_duration: action === 'suspend' ? '8760h' : 'none' }, clientIp(request))
  } catch {
    // D1 state still denies/permits access; provider reconciliation can be retried by the operator.
  }
  await audit(env, {
    request, actorType: 'OWNER', actorId: auth.actor.id, action: action === 'suspend' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
    entityType: 'USER', entityId: userId,
  })
  return json({ userId, status: nextStatus }, {}, requestId(request))
}

async function handleRecovery(request: Request, env: WorkerEnv): Promise<Response> {
  requireSameOrigin(request, env)
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.')
  const body = await readJson(request)
  const token = text(body.token, 'token', 32, 256)
  const newPassword = password(body.newPassword ?? body.password)
  const invitation = await claimInvitation(env, token)
  if (invitation.kind !== 'TENANT_RECOVERY' && invitation.kind !== 'LANDLORD_RECOVERY') {
    throw new ApiError(409, 'INVITATION_KIND_MISMATCH', 'This is not an account recovery link.')
  }
  if (!invitation.target_user_id) throw new ApiError(409, 'INVITATION_INVALID', 'The recovery invitation is incomplete.')
  const user = await env.DB.prepare('SELECT id, auth_user_id, email FROM users WHERE id = ?').bind(invitation.target_user_id)
    .first<{ id: string; auth_user_id: string | null; email: string }>()
  if (!user?.auth_user_id) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'The account was not found.')
  const invalidation = new Date(Date.now() + 1000).toISOString()
  await env.DB.prepare('UPDATE users SET session_invalid_after = ?, status = \'ACTIVE\' WHERE id = ?').bind(invalidation, user.id).run()
  const removed = await deleteSupabaseUser(env, user.auth_user_id, clientIp(request))
  if (removed.status !== 200 && removed.status !== 204 && removed.status !== 404) {
    throw new ApiError(503, 'RECOVERY_FAILED', 'The previous authentication identity could not be retired. Try again.')
  }
  const created = await createSupabaseUser(env, {
    id: user.auth_user_id, email: user.email, password: newPassword, bhmsUserId: user.id, invitationId: invitation.id,
    forwardedIp: clientIp(request),
  })
  if (created.status !== 200 && created.status !== 201) throw new ApiError(503, 'RECOVERY_FAILED', 'The new authentication identity could not be created. Try again.')
  await env.DB.prepare("UPDATE auth_invitations SET state = 'CONSUMED', consumed_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND state = 'PROVISIONING'")
    .bind(nowIso(), invitation.id).run()
  await audit(env, {
    request, actorType: 'SYSTEM', actorId: user.id, action: 'ACCOUNT_RECOVERED', entityType: 'USER', entityId: user.id,
    metadata: { kind: invitation.kind },
  })
  return json({ recovered: true, authenticated: false, sessionsRevoked: true }, {}, requestId(request))
}

export async function handleAuthRequest(request: Request, env: WorkerEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '')
  if (!path.startsWith('/auth/')) return null
  try {
    if (path === '/auth/operator/setup-invitation') return await handleOperatorSetup(request, env)
    if (path === '/auth/operator/landlord-recovery') return await handleOperatorLandlordRecovery(request, env)
    if (path === '/auth/invitation-status') return await handleInvitationStatus(request, env)
    if (path === '/auth/mfa/status') return await handleMfaStatus(request, env)
    if (path === '/auth/accept') return await handleAccept(request, env)
    if (path === '/auth/sign-in') return await handleSignIn(request, env)
    if (path === '/auth/session') return await handleSession(request, env)
    if (path === '/auth/refresh') return await handleRefresh(request, env)
    if (path === '/auth/sign-out') return await handleSignOut(request, env)
    if (path === '/auth/mfa/enroll') return await handleMfaEnroll(request, env)
    if (path === '/auth/mfa/challenge') return await handleMfaChallenge(request, env)
    if (path === '/auth/mfa/verify') return await handleMfaVerify(request, env)
    if (path === '/auth/recover') return await handleRecovery(request, env)
    if (path === '/auth/accounts') return await handleAccounts(request, env)
    const tenantMatch = path.match(/^\/auth\/tenants\/([^/]+)\/invitation$/)
    if (tenantMatch?.[1]) return await handleTenantInvitation(request, env, decodeURIComponent(tenantMatch[1]))
    const invitationMatch = path.match(/^\/auth\/invitations\/([^/]+)$/)
    if (invitationMatch?.[1]) return await handleCancelInvitation(request, env, decodeURIComponent(invitationMatch[1]))
    const accountMatch = path.match(/^\/auth\/accounts\/([^/]+)\/(suspend|reactivate|recovery)$/)
    if (accountMatch?.[1] && accountMatch[2]) {
      return await handleAccountAction(request, env, decodeURIComponent(accountMatch[1]), accountMatch[2] as 'suspend' | 'reactivate' | 'recovery')
    }
    throw new ApiError(404, 'NOT_FOUND', 'The authentication route was not found.')
  } catch (error) {
    return errorResponse(error, requestId(request))
  }
}
