import type { PrototypeAction } from '@/app/state/actions'
import { isPrototypeData } from '@/domain/validation/prototype-data'
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
  if (typeof configured !== 'string' || configured.trim() === '') throw new Error('VITE_BHMS_API_BASE_URL is not configured.')
  return configured.replace(/\/$/, '')
}

function devToken(): string | undefined {
  const value = import.meta.env.VITE_BHMS_DEV_TOKEN
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

async function request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  const token = devToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
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
  return {
    data: body.data,
    warning: null,
    canPersist: true,
    revision: typeof body.revision === 'number' ? body.revision : undefined,
    serverDate: typeof body.serverDate === 'string' ? body.serverDate : undefined,
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
