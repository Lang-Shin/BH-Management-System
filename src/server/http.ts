export class ApiError extends Error {
  status: number
  code: string
  details: unknown

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function json(data: unknown, init: ResponseInit = {}, requestId?: string): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  if (requestId) headers.set('x-request-id', requestId)
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return json({ error: { code: error.code, message: error.message, details: error.details }, requestId }, { status: error.status }, requestId)
  }
  return json({
    error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', details: null },
    requestId,
  }, { status: 500 }, requestId)
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.')
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 2_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.')
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new ApiError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_BODY', 'The request body must be a JSON object.')
  }
  return value as Record<string, unknown>
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function requestId(request: Request): string {
  return request.headers.get('cf-ray') ?? crypto.randomUUID()
}
