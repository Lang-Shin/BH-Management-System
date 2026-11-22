import type { Actor, WorkerEnv } from './env'
import { ApiError } from './http'

interface AccessClaims {
  aud?: string | string[]
  exp?: number
  nbf?: number
  iss?: string
  email?: string
  sub?: string
}

interface AccessJwtHeader {
  alg?: string
  kid?: string
}

let cachedJwks: { url: string; expiresAt: number; keys: JsonWebKey[] } | null = null

function decodePart(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodePart(value))) as T
}

function normalizedTeamDomain(teamDomain: string): string {
  const trimmed = teamDomain.replace(/\/$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

async function jwks(teamDomain: string): Promise<JsonWebKey[]> {
  const url = `${normalizedTeamDomain(teamDomain)}/cdn-cgi/access/certs`
  if (cachedJwks && cachedJwks.url === url && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Cloudflare Access keys could not be loaded.')
  const body = await response.json() as { keys?: JsonWebKey[] }
  if (!Array.isArray(body.keys)) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Cloudflare Access returned no signing keys.')
  cachedJwks = { url, expiresAt: Date.now() + 5 * 60_000, keys: body.keys }
  return body.keys
}

async function verifyAccessJwt(token: string, env: WorkerEnv): Promise<AccessClaims> {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Access verification is not configured.')
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid Access token is required.')
  const header = decodeJson<AccessJwtHeader>(encodedHeader)
  const claims = decodeJson<AccessClaims>(encodedPayload)
  if (header.alg !== 'RS256' || !header.kid) throw new ApiError(401, 'UNAUTHENTICATED', 'Unsupported Access token.')
  const keys = await jwks(env.ACCESS_TEAM_DOMAIN)
  const jwk = keys.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid)
  if (!jwk) throw new ApiError(401, 'UNAUTHENTICATED', 'Access signing key was not found.')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`))
  if (!valid) throw new ApiError(401, 'UNAUTHENTICATED', 'Access token signature is invalid.')
  const now = Math.floor(Date.now() / 1000)
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(env.ACCESS_AUD)) throw new ApiError(401, 'UNAUTHENTICATED', 'Access token audience is invalid.')
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new ApiError(401, 'UNAUTHENTICATED', 'Access token has expired.')
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) throw new ApiError(401, 'UNAUTHENTICATED', 'Access token is not valid yet.')
  return claims
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

/**
 * Development is allowed only on loopback. Every non-local request requires either a verified
 * Cloudflare Access JWT or an explicitly configured development token.
 */
export async function requireIdentity(request: Request, env: WorkerEnv): Promise<Actor> {
  const url = new URL(request.url)
  if (env.ENVIRONMENT === 'development' && isLoopback(url.hostname)) {
    return { id: 'local-dev', email: 'local-dev@example.invalid', source: 'DEV' }
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  const authorization = request.headers.get('Authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const accessToken = assertion ?? bearer
  if (accessToken && env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN) {
    const claims = await verifyAccessJwt(accessToken, env)
    const id = claims.email ?? claims.sub
    if (!id) throw new ApiError(401, 'UNAUTHENTICATED', 'Access token has no identity.')
    return { id, email: claims.email ?? null, source: 'ACCESS' }
  }
  if (env.BHMS_DEV_TOKEN && bearer && secureEqual(bearer, env.BHMS_DEV_TOKEN) && env.ENVIRONMENT !== 'production') {
    return { id: 'dev-token', email: null, source: 'DEV' }
  }
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Financial APIs are disabled until Cloudflare Access is configured.')
  }
  throw new ApiError(401, 'UNAUTHENTICATED', 'A valid Cloudflare Access identity is required.')
}
