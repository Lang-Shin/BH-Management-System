import { createEmptyData } from '@/data/fixtures/empty'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import type { PrototypeAction } from '@/app/state/actions'
import type { PrototypeAppState } from '@/domain/types/models'
import type { Actor } from './env'
import { ApiError, sha256 } from './http'
import { withServerDate } from './validation'
import { businessDate } from './date'
import { ensureRegularRentPeriodsThrough } from '@/domain/calculations/rent-schedule'
import { ensureBillingPeriodsThrough } from '@/domain/calculations/billing-periods'
import { repairMissingAdvanceApplications } from '@/domain/calculations/advance-reconciliation'
import { ensureInitialRateBaseline } from '@/domain/calculations/rate-baseline'
import { prepareCollection, prepareRentPrepaymentCollection } from '@/domain/calculations/payment-collection'
import type { CollectionInput, CollectionResult } from '@/domain/calculations/payment-collection'

export interface CommandOutcome {
  data: PrototypeAppState
  revision: number
  replayed: boolean
}

interface StateRow {
  data_json: string
  revision: number
}

interface IdempotencyRow {
  request_hash: string
  response_json: string
}

export class D1StateRepository {
  private readonly db: D1Database
  private readonly workspaceId: string
  private readonly timezone: string

  constructor(db: D1Database, workspaceId: string, timezone: string) {
    this.db = db
    this.workspaceId = workspaceId
    this.timezone = timezone
  }

  async ensureSeed(allowSeed: boolean): Promise<void> {
    const current = await this.db.prepare('SELECT revision FROM workspace_state WHERE workspace_id = ?')
      .bind(this.workspaceId).first<{ revision: number }>()
    if (current) return
    if (!allowSeed) throw new ApiError(503, 'WORKSPACE_NOT_INITIALIZED', 'This workspace has no imported data yet.')
    const data = createEmptyData(businessDate())
    await this.db.batch([
      this.db.prepare('INSERT OR IGNORE INTO workspaces (id, name, timezone, dataset_kind, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(this.workspaceId, 'Halili BH', this.timezone, 'REAL', new Date().toISOString()),
      this.db.prepare('INSERT OR IGNORE INTO workspace_state (workspace_id, revision, data_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)')
        .bind(this.workspaceId, 1, JSON.stringify(data), new Date().toISOString(), 'system-seed'),
      ...this.projectionStatements(data),
    ])
  }

  async load(): Promise<{ data: PrototypeAppState; revision: number }> {
    const row = await this.db.prepare('SELECT data_json, revision FROM workspace_state WHERE workspace_id = ?')
      .bind(this.workspaceId).first<StateRow>()
    if (!row) throw new ApiError(404, 'WORKSPACE_NOT_INITIALIZED', 'This workspace has no state yet.')
    let data: unknown
    try {
      data = JSON.parse(row.data_json)
    } catch {
      throw new ApiError(500, 'STATE_CORRUPT', 'The workspace state is not readable.')
    }
    if (!isPrototypeData(data)) throw new ApiError(500, 'STATE_INVALID', 'The workspace state failed validation.')
    return { data, revision: row.revision }
  }

  async maintain(serverDate: string): Promise<{ data: PrototypeAppState; revision: number }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.load()
      let next = ensureInitialRateBaseline(current.data)
      next = ensureBillingPeriodsThrough(next, serverDate)
      const repaired = repairMissingAdvanceApplications(next, serverDate)
      next = ensureRegularRentPeriodsThrough(repaired.data, serverDate)
      if (JSON.stringify(next) === JSON.stringify(current.data)) return current
      const revision = current.revision + 1
      const now = new Date().toISOString()
      const periodsChanged = JSON.stringify(next) !== JSON.stringify(repaired.data)
      if (periodsChanged) {
        next = {
          ...next,
          auditEvents: [...next.auditEvents, {
            id: `audit-periods-${revision}-${now}`, actorId: 'system-maintenance', occurredOn: serverDate,
            action: 'RENT_PERIODS_ENSURED', entityType: 'PROTOTYPE', entityId: this.workspaceId,
            reason: 'Materialized due anniversary rent periods and calendar billing months.',
            beforeSnapshot: JSON.stringify({ revision: current.revision }), afterSnapshot: JSON.stringify({ revision }),
          }],
        }
      }
      const operationId = `maintain-${revision}-${crypto.randomUUID()}`
      const statements = [
        this.db.prepare("INSERT INTO workspace_operations (id, workspace_id, operation, status, expected_revision, request_id, started_at) VALUES (?, ?, 'MAINTENANCE', 'RUNNING', ?, ?, ?)")
          .bind(operationId, this.workspaceId, current.revision, `maintain-${revision}`, now),
        this.db.prepare('UPDATE workspace_state SET revision = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND revision = ?')
          .bind(revision, JSON.stringify(next), now, 'system-maintenance', this.workspaceId, current.revision),
        ...this.projectionStatements(next),
      ]
      if (repaired.repaired.length > 0) {
        statements.push(this.db.prepare(`INSERT INTO audit_events
          (id, workspace_id, actor_id, actor_source, action, entity_type, entity_id, reason, occurred_on, request_id, idempotency_key, before_json, after_json, created_at)
          VALUES (?, ?, ?, 'DEV', 'ADVANCE_APPLIED', 'WORKSPACE_STATE', ?, ?, ?, ?, NULL, ?, ?, ?)`)
          .bind(`server-advance-repair-${revision}`, this.workspaceId, 'system-reconciliation', this.workspaceId,
            `Repaired ${repaired.repaired.length} missing move-in advance application${repaired.repaired.length === 1 ? '' : 's'}.`,
            serverDate, `maintenance-${revision}`, JSON.stringify({ revision: current.revision }),
            JSON.stringify({ revision, repaired: repaired.repaired }), now))
      }
      statements.push(this.db.prepare("UPDATE workspace_operations SET status = 'COMPLETED', completed_at = ? WHERE id = ?").bind(now, operationId))
      const results = await this.db.batch(statements)
      if (results[1]?.meta.changes === 1) return { data: next, revision }
    }
    return this.load()
  }

  async command(rawAction: PrototypeAction, actor: Actor, idempotencyKey: string, requestId: string, serverDate: string): Promise<CommandOutcome> {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header with 8 to 200 characters.')
    }
    const action = withServerDate(rawAction, serverDate)
    const hash = await sha256(JSON.stringify(rawAction))
    const existing = await this.idempotency(idempotencyKey)
    if (existing) {
      if (existing.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for another command.')
      const response = JSON.parse(existing.response_json) as { data: PrototypeAppState; revision: number }
      if (!isPrototypeData(response.data)) throw new ApiError(500, 'STATE_INVALID', 'The stored idempotent response is invalid.')
      return { ...response, replayed: true }
    }

    if (rawAction.type === 'payment/collected' && rawAction.input.collectedOn !== serverDate) {
      throw new ApiError(409, 'COLLECTION_DATE_CHANGED', 'The Manila business date changed. Refresh the catalog and review the actual collection date again.')
    }

    const current = await this.load()
    let collection: { input: CollectionInput; result: Extract<CollectionResult, { ok: true }> } | null = null
    if (action.type === 'payment/collected') {
      const prepared = prepareCollection(current.data, action.input)
      if (!prepared.ok) throw new ApiError(422, prepared.reason, 'The selected obligations changed or cannot be collected. Refresh the payment catalog and review again.')
      collection = { input: action.input, result: prepared }
    } else if (action.type === 'rent/prepaymentRecorded') {
      const prepared = prepareRentPrepaymentCollection(current.data, {
        cycleId: action.cycleId, periodCount: action.periodCount, collectedOn: action.paidOn,
      })
      if (!prepared.ok) throw new ApiError(422, prepared.reason, 'The rent prepayment range cannot be collected. Refresh and review again.')
      collection = prepared.prepared
    }
    const next = collection ? collection.result.data : prototypeReducer(current.data, action)
    if ((action.type === 'payment/collected' || action.type === 'rent/prepaymentRecorded') && next !== current.data) {
      const priorAuditIds = new Set(current.data.auditEvents.map(event => event.id))
      next.auditEvents = next.auditEvents.map(event =>
        !priorAuditIds.has(event.id) && event.actorId === 'landlord' ? { ...event, actorId: actor.id } : event)
    }
    if (next === current.data) {
      if (action.type === 'occupancy/dateChanged') {
        return { data: current.data, revision: current.revision, replayed: false }
      }
      throw new ApiError(422, 'COMMAND_REJECTED', 'The command was rejected or had no effect. Refresh and review the current records.')
    }
    if (!isPrototypeData(next)) throw new ApiError(422, 'COMMAND_INVALID_RESULT', 'The command would produce invalid records and was not saved.')
    const revision = current.revision + 1
    const responseJson = JSON.stringify({ data: next, revision })
    const now = new Date().toISOString()
    const auditId = `server-audit-${requestId}`
    const statements = [
      this.db.prepare("INSERT INTO workspace_operations (id, workspace_id, operation, status, expected_revision, request_id, started_at) VALUES (?, ?, 'COMMAND', 'RUNNING', ?, ?, ?)")
        .bind(`command-${requestId}`, this.workspaceId, current.revision, requestId, now),
      this.db.prepare('UPDATE workspace_state SET revision = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND revision = ?')
        .bind(revision, JSON.stringify(next), now, actor.id, this.workspaceId, current.revision),
      this.db.prepare(`INSERT INTO idempotency_keys
        (workspace_id, idempotency_key, request_hash, operation, response_json, created_at, request_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(this.workspaceId, idempotencyKey, hash, action.type, responseJson, now, requestId),
      this.db.prepare(`INSERT INTO audit_events
        (id, workspace_id, actor_id, actor_source, action, entity_type, entity_id, reason, occurred_on, request_id, idempotency_key, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(auditId, this.workspaceId, actor.id, actor.source, action.type, 'WORKSPACE_COMMAND', action.type,
          `Server command ${action.type}`, serverDate, requestId, idempotencyKey,
          JSON.stringify({ revision: current.revision }), JSON.stringify({ revision }), now),
      ...this.projectionStatements(next),
      this.db.prepare("UPDATE workspace_operations SET status = 'COMPLETED', completed_at = ? WHERE id = ?")
        .bind(now, `command-${requestId}`),
    ]
    if (collection) {
      const receipt = next.receipts.find(item => item.id === collection!.result.receiptId)!
      statements.push(this.db.prepare(`INSERT INTO cash_collections
        (id, workspace_id, payment_id, receipt_id, receipt_number, room_id, collected_on, amount_cents, idempotency_key, actor_id, items_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(collection.input.transactionId, this.workspaceId, collection.result.paymentId, receipt.id, receipt.receiptNumber,
          collection.input.roomId, collection.input.collectedOn, collection.result.totalCents, idempotencyKey, actor.id,
          JSON.stringify(collection.result.items.map(item => ({ id: item.charge?.id ?? item.id, category: item.category, periodId: item.periodId, periodLabel: item.periodLabel, dueDate: item.dueDate, amountCents: item.amountCents })))))
      for (const item of collection.result.items) {
        statements.push(this.db.prepare(`INSERT INTO cash_collection_allocations
          (id, collection_id, workspace_id, target_id, category, original_period_id, original_period_label, original_due_date, amount_cents)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(`collection-allocation-${collection.input.transactionId}-${item.id}`, collection.input.transactionId, this.workspaceId,
            item.charge?.id ?? item.id, item.category, item.periodId, item.periodLabel, item.dueDate, item.amountCents))
      }
    }

    try {
      const results = await this.db.batch(statements)
      const stateResult = results[1]
      if (!stateResult || stateResult.meta.changes !== 1) {
        throw new ApiError(409, 'STATE_CONFLICT', 'The workspace changed while this command was being saved. Refresh and retry.')
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      const raced = await this.idempotency(idempotencyKey)
      if (raced?.request_hash === hash) {
        const response = JSON.parse(raced.response_json) as { data: PrototypeAppState; revision: number }
        return { ...response, replayed: true }
      }
      if (raced) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for another command.')
      throw new ApiError(409, 'STATE_CONFLICT', 'The workspace changed while this command was being saved. Refresh and retry.')
    }
    return { data: next, revision, replayed: false }
  }

  async clearAllRecords(actor: Actor, requestId: string, expectedRevision: number, serverDate: string, idempotencyKey: string): Promise<{ data: PrototypeAppState; revision: number }> {
    const hash = await sha256(`clear-records:${expectedRevision}`)
    const existing = await this.idempotency(idempotencyKey)
    if (existing) {
      if (existing.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for another operation.')
      const response = JSON.parse(existing.response_json) as { data: PrototypeAppState; revision: number }
      if (!isPrototypeData(response.data)) throw new ApiError(500, 'STATE_INVALID', 'The stored idempotent response is invalid.')
      return response
    }
    const current = await this.load()
    if (current.revision !== expectedRevision) throw new ApiError(409, 'STATE_CONFLICT', 'The workspace changed before the reset. Refresh and try again.')
    const revision = current.revision + 1
    const now = new Date().toISOString()
    const empty = createEmptyData(serverDate, current.data)
    const auditId = `server-reset-${requestId}`
    const operationId = `reset-${requestId}`
    const responseJson = JSON.stringify({ data: empty, revision })
    const before = {
      revision: current.revision,
      tenants: current.data.tenants.length,
      assignments: current.data.roomAssignments.length,
      charges: current.data.charges.length,
      payments: current.data.payments.length,
      receipts: current.data.receipts.length,
    }
    empty.auditEvents = [{
      id: `workspace-reset-${requestId}`, actorId: actor.id, occurredOn: serverDate, action: 'WORKSPACE_RESET',
      entityType: 'PROTOTYPE', entityId: this.workspaceId,
      reason: 'Test workspace records cleared by an authorized administrator. Room configuration was preserved.',
      beforeSnapshot: JSON.stringify(before), afterSnapshot: JSON.stringify({ revision, tenants: 0, payments: 0 }),
    }]
    const statements = [
      this.db.prepare(`INSERT INTO workspace_operations
        (id, workspace_id, operation, status, expected_revision, request_id, started_at)
        VALUES (?, ?, 'CLEAR_RECORDS', 'RUNNING', ?, ?, ?)`)
        .bind(operationId, this.workspaceId, expectedRevision, requestId, now),
      this.db.prepare('UPDATE workspace_state SET revision = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND revision = ?')
        .bind(revision, JSON.stringify(empty), now, actor.id, this.workspaceId, current.revision),
      this.db.prepare('DELETE FROM cash_collection_allocations WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM cash_collections WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare(`INSERT INTO idempotency_keys
        (workspace_id, idempotency_key, request_hash, operation, response_json, created_at, request_id)
        VALUES (?, ?, ?, 'CLEAR_RECORDS', ?, ?, ?)`)
        .bind(this.workspaceId, idempotencyKey, hash, responseJson, now, requestId),
      this.db.prepare(`INSERT INTO audit_events
        (id, workspace_id, actor_id, actor_source, action, entity_type, entity_id, reason, occurred_on, request_id, idempotency_key, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(auditId, this.workspaceId, actor.id, actor.source, 'WORKSPACE_RESET', 'WORKSPACE_STATE', this.workspaceId,
          'Test workspace records cleared by an authorized administrator.', serverDate, requestId, null,
          JSON.stringify(before), JSON.stringify({ revision }), now),
      ...this.projectionStatements(empty),
      this.db.prepare("UPDATE workspace_operations SET status = 'COMPLETED', completed_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), operationId),
    ]
    try {
      const results = await this.db.batch(statements)
      if (!results[1] || results[1].meta.changes !== 1) throw new Error('stale revision')
      return { data: empty, revision }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/workspace revision changed|stale revision/i.test(message)) throw new ApiError(409, 'STATE_CONFLICT', 'The workspace changed before the reset. Refresh and try again.')
      if (/workspace_operations/i.test(message) && /UNIQUE|constraint/i.test(message)) throw new ApiError(409, 'RESET_IN_PROGRESS', 'Another reset is already running.')
      throw new ApiError(500, 'RESET_FAILED', 'The test workspace could not be cleared.')
    }
  }

  async replaceFromImport(data: PrototypeAppState, actor: Actor, requestId: string, sourceHash: string): Promise<{ revision: number }> {
    if (!isPrototypeData(data)) throw new ApiError(422, 'IMPORT_INVALID', 'The imported snapshot failed validation.')
    const current = await this.load()
    const revision = current.revision + 1
    const now = new Date().toISOString()
    const auditId = `server-import-${requestId}`
    const statements = [
      this.db.prepare('UPDATE workspace_state SET revision = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND revision = ?')
        .bind(revision, JSON.stringify(data), now, actor.id, this.workspaceId, current.revision),
      this.db.prepare(`INSERT INTO audit_events
        (id, workspace_id, actor_id, actor_source, action, entity_type, entity_id, reason, occurred_on, request_id, idempotency_key, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(auditId, this.workspaceId, actor.id, actor.source, 'IMPORT_APPLIED', 'WORKSPACE_STATE', sourceHash,
          'Owner-approved localStorage import', now.slice(0, 10), requestId, null,
          JSON.stringify({ revision: current.revision }), JSON.stringify({ revision, sourceHash }), now),
      ...this.projectionStatements(data),
    ]
    const results = await this.db.batch(statements)
    if (!results[0] || results[0].meta.changes !== 1) throw new ApiError(409, 'STATE_CONFLICT', 'The workspace changed before the import was saved.')
    return { revision }
  }

  async recordDryRun(actor: Actor, sourceHash: string, conflicts: unknown): Promise<void> {
    await this.db.prepare(`INSERT INTO import_runs (id, workspace_id, source_hash, status, conflicts_json, created_by, created_at)
      VALUES (?, ?, ?, 'DRY_RUN', ?, ?, ?)`)
      .bind(`import-dry-run-${crypto.randomUUID()}`, this.workspaceId, sourceHash, JSON.stringify(conflicts), actor.id, new Date().toISOString())
      .run()
  }

  private async idempotency(key: string): Promise<IdempotencyRow | null> {
    return this.db.prepare('SELECT request_hash, response_json FROM idempotency_keys WHERE workspace_id = ? AND idempotency_key = ?')
      .bind(this.workspaceId, key).first<IdempotencyRow>()
  }

  private projectionStatements(data: PrototypeAppState): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM rent_prepayment_periods WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM rent_prepayments WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM financial_review_cases WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM advance_applications WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM rent_obligations WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM rental_periods WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM security_deposit_holdings WHERE workspace_id = ?').bind(this.workspaceId),
      this.db.prepare('DELETE FROM occupancy_cycles WHERE workspace_id = ?').bind(this.workspaceId),
    ]
    for (const cycle of data.occupancyCycles) {
      statements.push(this.db.prepare(`INSERT INTO occupancy_cycles
        (id, workspace_id, room_id, started_at, ended_at, status, rent_schedule, rent_anchor_date, rent_anchor_day, cycle_origin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(cycle.id, this.workspaceId, cycle.roomId, cycle.startedAt, cycle.endedAt, cycle.status,
          cycle.rentSchedule, cycle.rentAnchorDate, cycle.rentAnchorDay, cycle.cycleOrigin, cycle.createdAt, cycle.updatedAt))
    }
    for (const period of data.rentalPeriods) {
      statements.push(this.db.prepare(`INSERT INTO rental_periods
        (id, workspace_id, occupancy_cycle_id, room_id, sequence_no, start_date, end_date_exclusive, due_date, status, origin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(period.id, this.workspaceId, period.occupancyCycleId, period.roomId, period.sequence, period.startDate,
          period.endDateExclusive, period.dueDate, period.status, period.origin))
    }
    for (const obligation of data.rentObligations) {
      statements.push(this.db.prepare(`INSERT INTO rent_obligations
        (id, workspace_id, occupancy_cycle_id, rental_period_id, room_id, amount_cents, rate_id, rate_effective_from,
         rate_snapshot_cents, issued_on, due_date, source, state, correction_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(obligation.id, this.workspaceId, obligation.occupancyCycleId, obligation.rentalPeriodId, obligation.roomId,
          obligation.amountCents, obligation.rateId, obligation.rateEffectiveFrom, obligation.rateSnapshotCents,
          obligation.issuedOn, obligation.dueDate, obligation.source, obligation.state,
          obligation.correction ? JSON.stringify(obligation.correction) : null))
    }
    for (const application of data.advanceApplications) {
      statements.push(this.db.prepare(`INSERT INTO advance_applications
        (id, workspace_id, occupancy_cycle_id, room_id, advance_charge_id, source_payment_id, rent_obligation_id,
         amount_cents, applied_on, state, reversal_audit_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(application.id, this.workspaceId, application.occupancyCycleId, application.roomId, application.advanceChargeId,
          application.sourcePaymentId, application.rentObligationId, application.amountCents, application.appliedOn,
          application.state, application.reversalAuditEventId))
    }
    for (const prepayment of data.rentPrepayments) {
      statements.push(this.db.prepare(`INSERT INTO rent_prepayments
        (id, workspace_id, payment_id, occupancy_cycle_id, room_id, period_count, total_cents, rate_cents, rate_locked_on, created_at, review_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(prepayment.id, this.workspaceId, prepayment.paymentId, prepayment.occupancyCycleId, prepayment.roomId,
          prepayment.periodCount, prepayment.totalCents, prepayment.rateCents, prepayment.rateLockedOn, prepayment.createdAt, prepayment.reviewState))
      for (const periodId of prepayment.rentalPeriodIds) {
        statements.push(this.db.prepare('INSERT INTO rent_prepayment_periods (workspace_id, rent_prepayment_id, rental_period_id) VALUES (?, ?, ?)')
          .bind(this.workspaceId, prepayment.id, periodId))
      }
    }
    for (const review of data.financialReviewCases) {
      statements.push(this.db.prepare(`INSERT INTO financial_review_cases
        (id, workspace_id, type, room_id, occupancy_cycle_id, tenant_id, rental_period_id, status, note, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(review.id, this.workspaceId, review.type, review.roomId, review.occupancyCycleId, review.tenantId,
          review.rentalPeriodId, review.status, review.note, review.createdAt, review.resolvedAt))
    }
    for (const obligation of data.moveInObligations) {
      const depositCharge = data.charges.find(charge => charge.id === obligation.depositChargeId)
      if (!depositCharge || depositCharge.category !== 'SECURITY_DEPOSIT') continue
      statements.push(this.db.prepare(`INSERT INTO security_deposit_holdings
        (id, workspace_id, tenant_id, origin_cycle_id, origin_room_id, original_amount_cents, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'HELD', ?)`)
        .bind(`deposit-holding-${obligation.id}`, this.workspaceId, depositCharge.tenantId, obligation.occupancyCycleId,
          obligation.roomId, obligation.depositRequiredCents, obligation.createdAt))
    }
    return statements
  }
}
