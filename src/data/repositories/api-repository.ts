import type { PrototypeAction } from '@/app/state/actions'
import type { CollectibleItem, RentPrepaymentCatalog } from '@/domain/calculations/payment-collection'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { refreshAuthSession } from '@/features/auth/auth-api'
import type { PrototypeCommandResult, PrototypeRepository, PrototypeSnapshot } from './prototype-repository'

export class ApiRepositoryError extends Error {
  status: number
  code: string
  retryable: boolean

  constructor(message: string, status = 0, code = 'NETWORK_ERROR') {
    super(message)
    this.name = 'ApiRepositoryError'
    this.status = status
    this.code = code
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
  }
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_BHMS_API_BASE_URL
  return typeof configured === 'string' && configured.trim() ? configured.replace(/\/$/, '') : '/api/v1'
}

function csrfToken(): string {
  if (typeof document === 'undefined') return ''
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === '__Host-bhms_csrf' || name === 'bhms_csrf') return rest.join('=')
  }
  return ''
}

async function request(path: string, init: RequestInit, retried = false): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (init.method && init.method !== 'GET') {
    const csrf = csrfToken()
    if (csrf) headers.set('x-bhms-csrf', csrf)
  }
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init, headers, credentials: 'same-origin', signal: controller.signal,
    })
  } catch (error) {
    throw new ApiRepositoryError(error instanceof DOMException && error.name === 'AbortError'
      ? 'The server took too long to respond. Retry when the connection is stable.'
      : 'The server could not be reached. Your saved records were not changed.')
  } finally {
    clearTimeout(timeout)
  }
  let body: unknown = null
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try { body = await response.json() } catch { body = null }
  }
  if (response.status === 401 && !retried && !path.startsWith('/auth/')) {
    try {
      await refreshAuthSession()
      return request(path, init, true)
    } catch {
      window.dispatchEvent(new Event('bhms:auth-expired'))
    }
  }
  if (!response.ok) {
    const envelope = body && typeof body === 'object' ? body as { error?: { code?: unknown; message?: unknown } } : null
    const message = typeof envelope?.error?.message === 'string' ? envelope.error.message : `The server rejected the request (${response.status}).`
    const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'REQUEST_FAILED'
    throw new ApiRepositoryError(message, response.status, code)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiRepositoryError('The server returned an unreadable response.', response.status, 'INVALID_RESPONSE')
  }
  return body as Record<string, unknown>
}

function snapshotFromBootstrap(body: Record<string, unknown>): PrototypeSnapshot {
  if (!isPrototypeData(body.data)) throw new ApiRepositoryError('The server returned invalid workspace records.', 200, 'INVALID_STATE')
  const capabilities = body.capabilities && typeof body.capabilities === 'object' ? body.capabilities as Record<string, unknown> : {}
  return {
    data: body.data,
    warning: null,
    canPersist: true,
    revision: typeof body.revision === 'number' ? body.revision : undefined,
    serverDate: typeof body.serverDate === 'string' ? body.serverDate : undefined,
    capabilities: { clearAllRecords: capabilities.clearAllRecords === true },
  }
}

function commandResult(body: Record<string, unknown>): PrototypeCommandResult {
  if (!isPrototypeData(body.data) || typeof body.revision !== 'number') {
    throw new ApiRepositoryError('The server returned an invalid command result.', 200, 'INVALID_STATE')
  }
  return { data: body.data, revision: body.revision, replayed: body.replayed === true }
}

export function createApiRepository(): PrototypeRepository {
  return {
    mode: 'server',
    async load() {
      return snapshotFromBootstrap(await request('/bootstrap', { method: 'GET' }))
    },
    async save() {
      return 'Server mode saves through commands. No raw browser snapshot was written.'
    },
    async command(action: PrototypeAction, idempotencyKey = crypto.randomUUID()) {
      return commandResult(await request('/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ action }),
      }))
    },
    async clearAllRecords(expectedRevision) {
      return commandResult(await request('/admin/clear-records', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ confirmation: 'RESET', expectedRevision }),
      }))
    },
  }
}

export async function fetchCollectionCatalog(roomId: string, readings: Record<string, number>): Promise<{ items: CollectibleItem[]; serverDate: string }> {
  const body = await request('/payments/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId, readings }),
  })
  if (!Array.isArray(body.items) || typeof body.serverDate !== 'string') throw new ApiRepositoryError('The server returned an invalid payment catalog.', 200, 'INVALID_QUOTE')
  return { items: body.items as CollectibleItem[], serverDate: body.serverDate }
}

export async function fetchRentPrepaymentCatalog(input: {
  roomId: string
  cycleId: string
  startSequence: number
  periodCount: number
}): Promise<RentPrepaymentCatalog & { serverDate: string }> {
  const body = await request('/payments/rent-range-quote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!Array.isArray(body.items) || typeof body.serverDate !== 'string'
    || !(body.reason === null || typeof body.reason === 'string')) {
    throw new ApiRepositoryError('The server returned an invalid rent prepayment quote.', 200, 'INVALID_QUOTE')
  }
  return {
    quote: body.quote as RentPrepaymentCatalog['quote'],
    items: body.items as CollectibleItem[],
    reason: body.reason as string | null,
    serverDate: body.serverDate,
  }
}

export interface RentPrepaymentQuoteLine {
  sequence: number
  rentalPeriodId: string
  rentObligationId: string
  startDate: string
  endDateExclusive: string
  dueDate: string
  amountCents: number
  paidCents: number
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'
  coveredByAdvance: boolean
  existing: boolean
}

export interface RentPrepaymentQuote {
  cycleId: string
  roomId: string
  rateId: string
  rateCents: number
  rateLockedOn: string
  periods: RentPrepaymentQuoteLine[]
  totalCents: number
}

export async function fetchRentPrepaymentQuote(cycleId: string, periodCount: number): Promise<RentPrepaymentQuote> {
  const body = await request('/rent/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cycleId, periodCount }),
  })
  if (!body.quote || typeof body.quote !== 'object') throw new ApiRepositoryError('The server returned no rent quote.', 200, 'INVALID_RESPONSE')
  return body.quote as RentPrepaymentQuote
}

export async function recordRentPrepayment(input: {
  cycleId: string
  periodCount: number
  paidOn?: string
  idempotencyKey?: string
}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': input.idempotencyKey ?? crypto.randomUUID(),
  }
  return request('/rent/prepayments', {
    method: 'POST', headers,
    body: JSON.stringify({ cycleId: input.cycleId, periodCount: input.periodCount, ...(input.paidOn ? { paidOn: input.paidOn } : {}) }),
  })
}

export function configuredApiRepository(): PrototypeRepository | null {
  try {
    const configured = import.meta.env.VITE_BHMS_API_BASE_URL
    return typeof configured === 'string' && configured.trim() ? createApiRepository() : null
  } catch {
    return null
  }
}
