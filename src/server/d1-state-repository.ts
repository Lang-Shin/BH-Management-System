import { createDemoData } from '@/data/fixtures/demo'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import type { PrototypeAction } from '@/app/state/actions'
import type { PrototypeAppState } from '@/domain/types/models'
import type { Actor } from './env'
import { ApiError, sha256 } from './http'
import { withServerDate } from './validation'

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
    const data = createDemoData()
    await this.db.batch([
      this.db.prepare('INSERT OR IGNORE INTO workspaces (id, name, timezone, dataset_kind, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(this.workspaceId, 'Halili BH', this.timezone, 'DEMO', new Date().toISOString()),
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

  async command(rawAction: PrototypeAction, actor: Actor, idempotencyKey: string, requestId: string, serverDate: string): Promise<CommandOutcome> {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header with 8 to 200 characters.')
    }
    const action = withServerDate(rawAction, serverDate)
    const hash = await sha256(JSON.stringify(action))
    const existing = await this.idempotency(idempotencyKey)
    if (existing) {
      if (existing.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for another command.')
      const response = JSON.parse(existing.response_json) as { data: PrototypeAppState; revision: number }
      if (!isPrototypeData(response.data)) throw new ApiError(500, 'STATE_INVALID', 'The stored idempotent response is invalid.')
      return { ...response, replayed: true }
    }

    const current = await this.load()
    const next = prototypeReducer(current.data, action)
    if (next === current.data) {
      if (action.type === 'occupancy/dateChanged' || action.type === 'demo/reset') {
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
    ]

    try {
      const results = await this.db.batch(statements)
      const stateResult = results[0]
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
