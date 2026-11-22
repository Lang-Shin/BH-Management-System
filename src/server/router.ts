import { parsePrototypeSnapshot, STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { quoteRentPrepayment } from '@/domain/calculations/rent-schedule'
import type { PrototypeAppState } from '@/domain/types/models'
import { requireIdentity } from './auth'
import { assertTimeZone, businessDate } from './date'
import { D1StateRepository } from './d1-state-repository'
import type { WorkerEnv } from './env'
import { ApiError, errorResponse, json, readJson, requestId, sha256 } from './http'
import { parseAction, parseImportBody, parseRentQuoteBody } from './validation'

const API_PREFIX = '/api/v1'

function repository(env: WorkerEnv): D1StateRepository {
  return new D1StateRepository(env.DB, env.WORKSPACE_ID ?? 'demo-workspace', assertTimeZone(env.APP_TIMEZONE))
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get('Idempotency-Key')
  if (!value) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header for this command.')
  return value
}

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const requestKey = requestId(request)
  try {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'bhms-api', time: new Date().toISOString() }, {}, requestKey)
    }
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (env.ASSETS) return env.ASSETS.fetch(request)
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' }, requestId: requestKey }, { status: 404 }, requestKey)
    }
    const actor = await requireIdentity(request, env)
    const repo = repository(env)
    const timezone = assertTimeZone(env.APP_TIMEZONE)
    const serverDate = businessDate(new Date(), timezone)
    const route = url.pathname.slice(API_PREFIX.length)

    if (route === '/bootstrap' && request.method === 'GET') {
      await repo.ensureSeed(env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'staging')
      const state = await repo.load()
      return json({
        data: state.data, revision: state.revision, serverDate, timezone,
        workspaceId: env.WORKSPACE_ID ?? 'demo-workspace',
        schemaVersion: STORAGE_SCHEMA_VERSION,
        capabilities: {
          anniversaryRent: true,
          advanceFirstRent: true,
          rentPrepaymentQuote: true,
          rentPrepaymentCommand: true,
          importDryRun: true,
          importApplyGated: env.ALLOW_IMPORT_APPLY === 'true',
        },
      }, {}, requestKey)
    }

    if (route === '/commands' && request.method === 'POST') {
      const body = await readJson(request)
      const action = parseAction(body.action)
      const outcome = await repo.command(action, actor, idempotencyKey(request), requestKey, serverDate)
      return json({ ...outcome, requestId: requestKey }, {}, requestKey)
    }

    if (route === '/rent/quote' && request.method === 'POST') {
      const input = parseRentQuoteBody(await readJson(request))
      const state = await repo.load()
      const quote = quoteRentPrepayment(state.data, { ...input, asOf: serverDate })
      if (!quote.ok) throw new ApiError(422, 'RENT_QUOTE_REJECTED', quote.reason, quote)
      return json({ quote: quote.quote, serverDate, revision: state.revision, requestId: requestKey }, {}, requestKey)
    }

    if (route === '/rent/prepayments' && request.method === 'POST') {
      const body = await readJson(request)
      const input = parseRentQuoteBody(body)
      const paidOn = typeof body.paidOn === 'string' ? body.paidOn : serverDate
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new ApiError(400, 'INVALID_PAYMENT_DATE', 'Use an ISO date for the payment date.')
      const outcome = await repo.command(
        { type: 'rent/prepaymentRecorded', cycleId: input.cycleId, periodCount: input.periodCount, paidOn },
        actor, idempotencyKey(request), requestKey, serverDate,
      )
      const prepayment = [...outcome.data.rentPrepayments]
        .filter(item => item.occupancyCycleId === input.cycleId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null
      const payment = prepayment ? outcome.data.payments.find(item => item.id === prepayment.paymentId) ?? null : null
      const receipt = payment ? outcome.data.receipts.find(item => item.paymentId === payment.id) ?? null : null
      return json({ ...outcome, prepayment, payment, receipt, requestId: requestKey }, { status: 201 }, requestKey)
    }

    if (route === '/rent/periods' && request.method === 'GET') {
      const cycleId = url.searchParams.get('cycleId')
      if (!cycleId) throw new ApiError(400, 'INVALID_QUERY', 'Provide a cycleId.')
      const state = await repo.load()
      const cycle = state.data.occupancyCycles.find(item => item.id === cycleId)
      if (!cycle) throw new ApiError(404, 'CYCLE_NOT_FOUND', 'The occupancy cycle was not found.')
      return json({
        cycle,
        periods: state.data.rentalPeriods.filter(period => period.occupancyCycleId === cycleId).sort((a, b) => a.sequence - b.sequence),
        obligations: state.data.rentObligations.filter(obligation => obligation.occupancyCycleId === cycleId),
        advanceApplications: state.data.advanceApplications.filter(application => application.occupancyCycleId === cycleId),
        revision: state.revision,
      }, {}, requestKey)
    }

    if (route === '/move-in/obligations' && request.method === 'GET') {
      const state = await repo.load()
      const roomId = url.searchParams.get('roomId')
      return json({
        obligations: state.data.moveInObligations.filter(obligation => !roomId || obligation.roomId === roomId),
        revision: state.revision,
      }, {}, requestKey)
    }

    if (route === '/financial-review-cases' && request.method === 'GET') {
      const state = await repo.load()
      const status = url.searchParams.get('status')
      return json({
        cases: state.data.financialReviewCases.filter(review => !status || review.status === status),
        revision: state.revision,
      }, {}, requestKey)
    }

    if (route === '/imports/dry-run' && request.method === 'POST') {
      const snapshot = parseImportBody(await readJson(request))
      const parsed = parsePrototypeSnapshot(snapshot)
      if (!parsed.ok) {
        const result = { ok: false, reason: parsed.reason, blocking: true, conflicts: [{ code: parsed.reason, message: 'The snapshot cannot be imported.' }] }
        await repo.recordDryRun(actor, await sha256(snapshot), result)
        return json(result, {}, requestKey)
      }
      const current = await repo.load()
      const conflicts = dryRunConflicts(parsed.data, current.revision)
      const result = {
        ok: conflicts.every(conflict => !conflict.blocking),
        requiresExplicitApproval: true,
        targetRevision: current.revision,
        summary: {
          tenants: parsed.data.tenants.length,
          rooms: parsed.data.rooms.length,
          cycles: parsed.data.occupancyCycles.length,
          anniversaryCycles: parsed.data.occupancyCycles.filter(cycle => cycle.rentSchedule === 'ANNIVERSARY').length,
          legacyCycles: parsed.data.occupancyCycles.filter(cycle => cycle.rentSchedule === 'LEGACY_CALENDAR').length,
          legacyCalendarRentCharges: parsed.data.charges.filter(charge => charge.category === 'RENT').length,
          advanceApplications: parsed.data.advanceApplications.length,
          unallocatedLegacyAdvances: parsed.data.financialReviewCases.filter(review => review.type === 'LEGACY_ADVANCE_UNALLOCATED').length,
        },
        conflicts,
      }
      await repo.recordDryRun(actor, await sha256(snapshot), result)
      return json(result, {}, requestKey)
    }

    if (route === '/admin/imports/apply' && request.method === 'POST') {
      if (env.ALLOW_IMPORT_APPLY !== 'true') throw new ApiError(423, 'IMPORT_APPLY_LOCKED', 'Import apply is disabled. A dry run and explicit owner approval are required.')
      const body = await readJson(request)
      if (body.confirm !== 'APPLY_IMPORT') throw new ApiError(400, 'IMPORT_CONFIRMATION_REQUIRED', 'Explicit import confirmation is required.')
      const snapshot = parseImportBody(body)
      const parsed = parsePrototypeSnapshot(snapshot)
      if (!parsed.ok) throw new ApiError(422, 'IMPORT_INVALID', parsed.reason)
      const current = await repo.load()
      const expectedRevision = Number(body.expectedRevision)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
        throw new ApiError(409, 'STATE_CONFLICT', 'The workspace changed since the dry run. Run the dry run again.')
      }
      const conflicts = dryRunConflicts(parsed.data, current.revision)
      if (conflicts.some(conflict => conflict.blocking)) throw new ApiError(422, 'IMPORT_BLOCKED', 'Resolve blocking conflicts before import.', conflicts)
      const sourceHash = await sha256(snapshot)
      const applied = await repo.replaceFromImport(parsed.data, actor, requestKey, sourceHash)
      return json({ ok: true, revision: applied.revision, sourceHash }, {}, requestKey)
    }

    throw new ApiError(404, 'NOT_FOUND', 'The API route was not found.')
  } catch (error) {
    return errorResponse(error, requestKey)
  }
}

interface ImportConflict {
  code: string
  message: string
  blocking: boolean
}

function dryRunConflicts(imported: PrototypeAppState, currentRevision: number): ImportConflict[] {
  if (!isPrototypeData(imported)) return [{ code: 'INVALID_STATE', message: 'The snapshot failed validation.', blocking: true }]
  const conflicts: ImportConflict[] = []
  const importedTenantIds = new Set(imported.tenants.map(tenant => tenant.id))
  const importedRoomIds = new Set(imported.rooms.map(room => room.id))
  for (const assignment of imported.roomAssignments) {
    if (!importedTenantIds.has(assignment.tenantId)) conflicts.push({ code: 'MISSING_TENANT', message: `Assignment ${assignment.id} references a missing tenant.`, blocking: true })
    if (!importedRoomIds.has(assignment.roomId)) conflicts.push({ code: 'MISSING_ROOM', message: `Assignment ${assignment.id} references a missing room.`, blocking: true })
  }
  if (new Set(imported.occupancyCycles.filter(cycle => cycle.status === 'ACTIVE').map(cycle => cycle.roomId)).size
    !== imported.occupancyCycles.filter(cycle => cycle.status === 'ACTIVE').length) {
    conflicts.push({ code: 'MULTIPLE_ACTIVE_CYCLES', message: 'A room has more than one active occupancy cycle.', blocking: true })
  }
  if (imported.occupancyCycles.some(cycle => cycle.rentSchedule === 'LEGACY_CALENDAR')) {
    conflicts.push({ code: 'LEGACY_CYCLES_PRESERVED', message: 'Legacy cycles remain on calendar billing until vacancy; they will not be converted automatically.', blocking: false })
  }
  const legacyRent = imported.charges.filter(charge => charge.category === 'RENT').length
  if (legacyRent > 0) conflicts.push({ code: 'LEGACY_RENT_PRESERVED', message: `${legacyRent} historical rent charge(s) remain calendar-based and unchanged.`, blocking: false })
  const legacyAdvances = imported.financialReviewCases.filter(review => review.type === 'LEGACY_ADVANCE_UNALLOCATED').length
  if (legacyAdvances > 0) conflicts.push({ code: 'LEGACY_ADVANCE_REVIEW', message: `${legacyAdvances} paid advance(s) require owner review before any application.`, blocking: false })
  conflicts.push({ code: 'REPLACES_WORKSPACE_STATE', message: `The import will replace workspace revision ${currentRevision}; a backup is required and apply stays disabled unless explicitly enabled.`, blocking: false })
  return conflicts
}
