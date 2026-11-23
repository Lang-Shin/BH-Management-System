// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import { calendarBillingPeriods } from '@/domain/calculations/billing-periods'
import { selectBillingRent } from '@/domain/calculations/billing-rent'
import { buildRoomPaymentQuote } from '@/domain/calculations/room-payment'
import { selectBillingRooms } from '@/features/billing/billing-room-status'
import type { CollectibleItem, CollectionInput } from '@/domain/calculations/payment-collection'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import { pendingPaymentPeriods } from '@/features/dashboard/pending-payment-groups'

const root = process.cwd()
const src = path.join(root, 'src')

let worker: Miniflare
let workerScript: string

beforeAll(async () => {
  const buildResult = await build({
    entryPoints: [path.join(src, 'worker/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [{
      name: 'bhms-alias',
      setup(context) {
        context.onResolve({ filter: /^@\// }, args => {
          const target = path.join(src, args.path.slice(2))
          const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find(candidate => existsSync(candidate))
          if (!resolved) return { errors: [{ text: `Cannot resolve ${args.path}` }] }
          return { path: resolved }
        })
      },
    }],
  })
  workerScript = buildResult.outputFiles[0]!.text
  worker = new Miniflare({
    modules: true,
    script: workerScript,
    compatibilityDate: '2025-07-18',
    d1Databases: { DB: 'bhms-test-db' },
    bindings: {
      ENVIRONMENT: 'development',
      WORKSPACE_ID: 'test-workspace',
      APP_TIMEZONE: 'Asia/Manila',
      ALLOW_IMPORT_APPLY: 'false',
      ALLOW_TEST_RESET: 'true',
    },
  })
  const db = await worker.getD1Database('DB')
  const migrations = path.join(root, 'migrations')
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrations, file), 'utf8')
      .split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('PRAGMA'))
      .join('\n')
    const triggerPattern = /CREATE\s+TRIGGER[\s\S]*?END;/gi
    const triggers = [...sql.matchAll(triggerPattern)].map(match => match[0])
    const tables = sql.replace(triggerPattern, '')
    for (const statement of tables.split(';').map(item => item.trim()).filter(Boolean)) {
      await db.prepare(statement).run()
    }
    for (const trigger of triggers) {
      await db.prepare(trigger).run()
    }
  }
}, 60_000)

afterAll(async () => {
  await worker?.dispose()
})

async function request(pathname: string, init?: RequestInit, origin = 'http://localhost') {
  return worker.dispatchFetch(`${origin}${pathname}`, init as never)
}

async function jsonRequest(pathname: string, method: string, body: unknown, headers: Record<string, string> = {}, origin = 'http://localhost') {
  return request(pathname, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, origin)
}

async function bootstrap() {
  const response = await request('/api/v1/bootstrap')
  expect(response.status).toBe(200)
  return await response.json() as {
    data: ReturnType<typeof createDemoData>
    revision: number
    serverDate: string
  }
}

describe('Worker and D1 integration', () => {
  it('returns the backend health response rather than the SPA', async () => {
    const response = await request('/health')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', service: 'bhms-api' })
  })

  it('seeds a validated empty workspace and rejects non-local unauthenticated access', async () => {
    const seeded = await bootstrap()
    expect(seeded.data.tenants).toEqual([])
    expect(seeded.data.rooms).toHaveLength(15)
    expect(seeded.data.billingPeriods.length).toBeGreaterThan(0)
    expect(seeded.revision).toBe(1)

    const rejected = await request('/api/v1/bootstrap', undefined, 'https://public.example.com')
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toMatchObject({ error: { code: 'AUTH_NOT_CONFIGURED' } })
  })

  it('enforces the approved due-date policy in the D1 schema', async () => {
    await bootstrap()
    const db = await worker.getD1Database('DB')
    await db.prepare(`INSERT INTO occupancy_cycles
      (id, workspace_id, room_id, started_at, ended_at, status, rent_schedule, rent_anchor_date, rent_anchor_day,
       cycle_origin, created_at, updated_at)
      VALUES ('cycle-guard', 'test-workspace', 'room-1', '2026-01-01', NULL, 'ACTIVE', 'ANNIVERSARY',
       '2026-01-01', 1, 'NEW_MOVE_IN', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run()
    await expect(db.prepare(`INSERT INTO rental_periods
      (id, workspace_id, occupancy_cycle_id, room_id, sequence_no, start_date, end_date_exclusive, due_date, status, origin)
      VALUES ('guard-bad-period', 'test-workspace', 'cycle-guard', 'room-1', 99, '2026-01-01', '2026-02-01', '2026-01-02', 'OPEN', 'ANNIVERSARY')`).run())
      .rejects.toThrow(/rent due date must equal period start date/)

    await db.prepare(`INSERT INTO rental_periods
      (id, workspace_id, occupancy_cycle_id, room_id, sequence_no, start_date, end_date_exclusive, due_date, status, origin)
      VALUES ('guard-good-period', 'test-workspace', 'cycle-guard', 'room-1', 98, '2026-01-01', '2026-02-01', '2026-01-01', 'OPEN', 'ANNIVERSARY')`).run()
    await expect(db.prepare(`INSERT INTO rent_obligations
      (id, workspace_id, occupancy_cycle_id, rental_period_id, room_id, amount_cents, rate_id, rate_effective_from,
       rate_snapshot_cents, issued_on, due_date, source, state)
      VALUES ('guard-bad-obligation', 'test-workspace', 'cycle-guard', 'guard-good-period', 'room-1', 100000,
       'rate-test', '2026-01-01', 100000, '2026-01-01', '2026-01-02', 'REGULAR', 'ISSUED')`).run())
      .rejects.toThrow(/rent obligation due date must equal rental period start date/)
    await db.prepare("DELETE FROM rental_periods WHERE id = 'guard-good-period'").run()
    await db.prepare("DELETE FROM occupancy_cycles WHERE id = 'cycle-guard'").run()
  })

  it('settles the first anniversary period from the paid advance without duplicate cash', async () => {
    const seeded = await bootstrap()
    const createResponse = await jsonRequest('/api/v1/commands', 'POST', {
      action: {
        type: 'tenant/created',
        draft: {
          name: 'Worker Test Tenant', email: 'worker@example.com', phone: '+63 900 555 0199',
          address: '4 Test Street, Demo City', roomId: 'room-9', moveInDate: seeded.serverDate, notes: '',
        },
      },
    }, { 'idempotency-key': 'worker-create-tenant-0001' })
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json() as { data: ReturnType<typeof createDemoData>; revision: number }
    const tenant = created.data.tenants.find(item => item.name === 'Worker Test Tenant')!
    const assignment = created.data.roomAssignments.find(item => item.tenantId === tenant.id)!
    const cycle = created.data.occupancyCycles.find(item => item.roomId === assignment.roomId && item.status === 'ACTIVE')!
    expect(cycle).toMatchObject({ rentSchedule: 'ANNIVERSARY', rentAnchorDate: seeded.serverDate, rentAnchorDay: Number(seeded.serverDate.slice(8, 10)) })
    const obligation = created.data.moveInObligations.find(item => item.occupancyCycleId === cycle.id)!
    const firstPeriod = created.data.rentalPeriods.find(item => item.occupancyCycleId === cycle.id)!
    const firstRent = created.data.rentObligations.find(item => item.occupancyCycleId === cycle.id)!
    expect(firstPeriod.dueDate).toBe(firstPeriod.startDate)
    expect(firstRent.dueDate).toBe(firstPeriod.startDate)
    expect(created.data.rentalPeriods.filter(item => item.occupancyCycleId === cycle.id)).toHaveLength(1)
    expect(created.data.rentObligations.filter(item => item.occupancyCycleId === cycle.id)).toHaveLength(1)

    const paymentBody = {
      action: { type: 'moveIn/paymentRecorded', obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: seeded.serverDate },
    }
    const paymentResponse = await jsonRequest('/api/v1/commands', 'POST', paymentBody, { 'idempotency-key': 'worker-move-in-payment-0001' })
    expect(paymentResponse.status).toBe(200)
    const paid = await paymentResponse.json() as { data: ReturnType<typeof createDemoData>; revision: number }
    expect(paid.data.advanceApplications).toHaveLength(1)
    expect(paid.data.advanceApplications[0]).toMatchObject({
      occupancyCycleId: cycle.id, amountCents: 400_000, state: 'ACTIVE', sourcePaymentId: expect.stringMatching(/^payment-move-in-/),
    })
    expect(paid.data.payments.filter(item => item.id.startsWith('payment-move-in-'))).toHaveLength(1)
    expect(paid.data.payments.filter(item => item.id.startsWith('payment-move-in-'))[0]!.amountCents).toBe(800_000)
    expect(paid.data.receipts.filter(item => item.paymentId === paid.data.payments.find(payment => payment.id.startsWith('payment-move-in-'))!.id)).toHaveLength(1)

    const period = calendarBillingPeriods(paid.data, seeded.serverDate)
      .find(item => item.startDate <= seeded.serverDate && item.endDate >= seeded.serverDate)!
    const rentLine = selectBillingRent(paid.data, assignment.roomId, period, seeded.serverDate)
    expect(rentLine).toMatchObject({
      source: 'ANNIVERSARY', billedCents: 400_000, paidCents: 400_000,
      outstandingCents: 0, advanceAppliedCents: 400_000, cashPaidCents: 0, status: 'PAID',
    })
    const quote = buildRoomPaymentQuote(paid.data, {
      roomId: assignment.roomId, periodId: period.id, selected: ['RENT'],
      electricityReadingMilliKwh: null, asOf: seeded.serverDate,
    })
    expect(quote.options.find(option => option.category === 'RENT')).toMatchObject({ state: 'PAID', amountCents: 0 })
    expect(quote.selected).toEqual([])

    const replay = await jsonRequest('/api/v1/commands', 'POST', paymentBody, { 'idempotency-key': 'worker-move-in-payment-0001' })
    expect(replay.status).toBe(200)
    const replayed = await replay.json() as { replayed: boolean; revision: number }
    expect(replayed).toMatchObject({ replayed: true, revision: paid.revision })

    const duplicate = await jsonRequest('/api/v1/commands', 'POST', paymentBody, { 'idempotency-key': 'worker-move-in-payment-duplicate-0001' })
    expect(duplicate.status).toBe(422)

    const db = await worker.getD1Database('DB')
    const applicationCount = await db.prepare('SELECT COUNT(*) AS count FROM advance_applications WHERE workspace_id = ?').bind('test-workspace').first<{ count: number }>()
    expect(applicationCount?.count).toBe(1)
    const rentCount = await db.prepare('SELECT COUNT(*) AS count FROM rent_obligations WHERE workspace_id = ?').bind('test-workspace').first<{ count: number }>()
    expect(rentCount?.count).toBe(1)

    const broken = { ...paid.data, advanceApplications: [], auditEvents: paid.data.auditEvents.filter(event => event.entityType !== 'ADVANCE_APPLICATION') }
    await db.prepare('UPDATE workspace_state SET data_json = ? WHERE workspace_id = ?')
      .bind(JSON.stringify(broken), 'test-workspace').run()
    const repaired = await bootstrap()
    expect(repaired.data.advanceApplications).toHaveLength(1)
    expect(repaired.data.advanceApplications[0]).toMatchObject({
      occupancyCycleId: cycle.id, rentObligationId: firstRent.id, sourcePaymentId: paid.data.advanceApplications[0]!.sourcePaymentId,
    })
    expect(repaired.data.auditEvents.some(event => event.id === `audit-advance-repair-${cycle.id}`)).toBe(true)
    expect(repaired.data.payments.filter(item => item.id.startsWith('payment-move-in-'))).toHaveLength(1)
    const repairedApplicationCount = await db.prepare('SELECT COUNT(*) AS count FROM advance_applications WHERE workspace_id = ?').bind('test-workspace').first<{ count: number }>()
    expect(repairedApplicationCount?.count).toBe(1)
    const repairAuditCount = await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE workspace_id = ? AND action = 'ADVANCE_APPLIED' AND actor_id = 'system-reconciliation'")
      .bind('test-workspace').first<{ count: number }>()
    expect(repairAuditCount?.count).toBe(1)
  }, 30_000)

  it('persists first-month water independently while electricity remains awaiting', async () => {
    const before = await bootstrap()
    const createResponse = await jsonRequest('/api/v1/commands', 'POST', {
      action: {
        type: 'tenant/created',
        draft: {
          name: 'Utility Worker Tenant', email: 'utility.worker@example.com', phone: '+63 900 555 0198',
          address: '7 Utility Street, Demo City', roomId: 'room-7', moveInDate: '2026-07-06', notes: '',
        },
      },
    }, { 'idempotency-key': 'worker-utility-tenant-0001' })
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json() as { data: ReturnType<typeof createDemoData>; revision: number }
    const utilityTenant = created.data.tenants.find(tenant => tenant.name === 'Utility Worker Tenant')!
    const cycle = created.data.occupancyCycles.find(item => item.roomId === 'room-7' && item.status === 'ACTIVE')!
    const obligation = created.data.moveInObligations.find(item => item.occupancyCycleId === cycle.id)!
    const moveInPayment = await jsonRequest('/api/v1/commands', 'POST', {
      action: { type: 'moveIn/paymentRecorded', obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-07-06' },
    }, { 'idempotency-key': 'worker-utility-move-in-0001' })
    expect(moveInPayment.status).toBe(200)
    const paid = await moveInPayment.json() as { data: ReturnType<typeof createDemoData>; revision: number }

    const period = paid.data.billingPeriods.find(item => item.startDate === '2026-07-01')!
    const quote = buildRoomPaymentQuote(paid.data, {
      roomId: 'room-7', periodId: period.id, selected: ['WATER'],
      electricityReadingMilliKwh: null, asOf: before.serverDate,
    })
    expect(quote.options.find(option => option.category === 'RENT')).toMatchObject({ state: 'PAID', amountCents: 0 })
    expect(quote.options.find(option => option.category === 'WATER')).toMatchObject({ state: 'SELECTABLE', amountCents: 10_000 })
    expect(quote.options.find(option => option.category === 'ELECTRICITY')).toMatchObject({ state: 'AWAITING_READING', amountCents: null })
    expect(quote.options.find(option => option.category === 'WASHING_MACHINE')?.state).toBe('UNAVAILABLE')
    expect(selectBillingRooms(paid.data, period.id, before.serverDate, false).find(item => item.context.roomId === 'room-7')).toMatchObject({
      billingStatus: 'PARTLY PAID', unresolved: 1, outstanding: 10_000,
    })

    const waterBody = {
      action: { type: 'room/paymentConfirmed', roomId: 'room-7', periodId: period.id, selected: ['WATER'], electricityReadingMilliKwh: null, asOf: before.serverDate },
    }
    const waterResponse = await jsonRequest('/api/v1/commands', 'POST', waterBody, { 'idempotency-key': 'worker-utility-water-0001' })
    expect(waterResponse.status).toBe(200)
    const watered = await waterResponse.json() as { data: ReturnType<typeof createDemoData>; revision: number }
    expect(watered.data.charges.filter(charge => charge.category === 'WATER' && charge.tenantId === utilityTenant.id)).toHaveLength(1)
    expect(watered.data.charges.filter(charge => charge.category === 'WASHING_MACHINE' && charge.tenantId === utilityTenant.id)).toHaveLength(0)
    expect(watered.data.charges.some(charge => charge.category === 'ELECTRICITY')).toBe(false)
    expect(selectBillingRooms(watered.data, period.id, before.serverDate, false).find(item => item.context.roomId === 'room-7')).toMatchObject({
      billingStatus: 'PARTLY PAID', unresolved: 1, outstanding: 0,
    })

    const replay = await jsonRequest('/api/v1/commands', 'POST', waterBody, { 'idempotency-key': 'worker-utility-water-0001' })
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, revision: watered.revision })
    const duplicate = await jsonRequest('/api/v1/commands', 'POST', waterBody, { 'idempotency-key': 'worker-utility-water-duplicate-0001' })
    expect(duplicate.status).toBe(422)
    const refreshed = await bootstrap()
    expect(refreshed.data.charges.filter(charge => charge.category === 'WATER' && charge.tenantId === utilityTenant.id)).toHaveLength(1)
    expect(refreshed.data.payments.filter(payment => payment.id.includes('payment-room-')).length).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('quotes and records one multi-period prepayment excluding the advance-covered period', async () => {
    const state = await bootstrap()
    const cycle = state.data.occupancyCycles.find(item => item.rentSchedule === 'ANNIVERSARY' && item.status === 'ACTIVE')
    if (!cycle) throw new Error('Anniversary cycle missing from integration setup')
    const quoteResponse = await jsonRequest('/api/v1/rent/quote', 'POST', { cycleId: cycle.id, periodCount: 2 })
    expect(quoteResponse.status).toBe(200)
    const quote = await quoteResponse.json() as { quote: { periods: { sequence: number; amountCents: number; startDate: string; dueDate: string }[]; totalCents: number; rateCents: number } }
    expect(quote.quote.periods.map(period => period.sequence)).toEqual([2, 3])
    expect(quote.quote.periods.every(period => period.dueDate === period.startDate)).toBe(true)
    expect(quote.quote.totalCents).toBe(800_000)
    expect(quote.quote.rateCents).toBe(400_000)

    const prepayResponse = await jsonRequest('/api/v1/rent/prepayments', 'POST', {
      cycleId: cycle.id, periodCount: 2, paidOn: state.serverDate,
    }, { 'idempotency-key': 'worker-rent-prepayment-0001' })
    if (prepayResponse.status !== 201) throw new Error(await prepayResponse.clone().text())
    expect(prepayResponse.status).toBe(201)
    const prepaid = await prepayResponse.json() as {
      prepayment: { id: string; periodCount: number; totalCents: number; rentalPeriodIds: string[] }
      payment: { id: string; amountCents: number }
      receipt: { id: string; amountCents: number }
      data: ReturnType<typeof createDemoData>
    }
    expect(prepaid.prepayment).toMatchObject({ periodCount: 2, totalCents: 800_000 })
    expect(prepaid.payment).toMatchObject({ amountCents: 800_000 })
    expect(prepaid.receipt).toMatchObject({ amountCents: 800_000 })
    expect(prepaid.data.paymentAllocations.filter(allocation => allocation.paymentId === prepaid.payment.id)).toHaveLength(2)
    expect(prepaid.data.rentPrepayments.filter(item => item.occupancyCycleId === cycle.id)).toHaveLength(1)

    const repeat = await jsonRequest('/api/v1/rent/prepayments', 'POST', {
      cycleId: cycle.id, periodCount: 2, paidOn: state.serverDate,
    }, { 'idempotency-key': 'worker-rent-prepayment-0001' })
    expect(repeat.status).toBe(201)
    const repeated = await repeat.json() as { replayed: boolean; revision: number; payment: { id: string } }
    expect(repeated.replayed).toBe(true)
    expect(repeated.payment.id).toBe(prepaid.payment.id)
  }, 30_000)

  it('rolls back a move-in payment when its advance application projection fails', async () => {
    const db = await worker.getD1Database('DB')
    const before = await bootstrap()
    const createResponse = await jsonRequest('/api/v1/commands', 'POST', {
      action: {
        type: 'tenant/created',
        draft: {
          name: 'Advance Rollback Tenant', email: 'advance.rollback@example.com', phone: '+63 900 555 0187',
          address: '2 Rollback Street, Demo City', roomId: 'room-2', moveInDate: before.serverDate, notes: '',
        },
      },
    }, { 'idempotency-key': 'worker-advance-rollback-tenant-0001' })
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json() as { data: ReturnType<typeof createDemoData>; revision: number }
    const tenant = created.data.tenants.find(item => item.name === 'Advance Rollback Tenant')!
    const cycle = created.data.occupancyCycles.find(item => item.roomId === 'room-2' && item.status === 'ACTIVE')!
    const obligation = created.data.moveInObligations.find(item => item.occupancyCycleId === cycle.id)!
    const paymentCount = created.data.payments.length
    const applicationCount = created.data.advanceApplications.length
    const revisionBeforePayment = created.revision

    await db.prepare(`CREATE TRIGGER fail_advance_application_projection BEFORE INSERT ON advance_applications
      BEGIN SELECT RAISE(ABORT, 'forced advance application failure'); END`).run()
    try {
      const failed = await jsonRequest('/api/v1/commands', 'POST', {
        action: {
          type: 'moveIn/paymentRecorded', obligationId: obligation.id,
          categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: before.serverDate,
        },
      }, { 'idempotency-key': 'worker-advance-rollback-payment-0001' })
      expect(failed.status).toBe(409)
      expect(await failed.json()).toMatchObject({ error: { code: 'STATE_CONFLICT' } })
    } finally {
      await db.prepare('DROP TRIGGER IF EXISTS fail_advance_application_projection').run()
    }

    const after = await bootstrap()
    expect(after.revision).toBe(revisionBeforePayment)
    expect(after.data.payments).toHaveLength(paymentCount)
    expect(after.data.advanceApplications).toHaveLength(applicationCount)
    expect(after.data.payments.some(payment => payment.occupancyCycleId === cycle.id)).toBe(false)
    expect(after.data.advanceApplications.some(application => application.occupancyCycleId === cycle.id)).toBe(false)
    const firstRent = after.data.rentObligations.find(item => item.occupancyCycleId === cycle.id)!
    const view = selectBillingRent(after.data, 'room-2', calendarBillingPeriods(after.data, before.serverDate)
      .find(item => item.startDate <= before.serverDate && item.endDate >= before.serverDate)!, before.serverDate)
    expect(view.billedCents).toBe(firstRent.amountCents)
    expect(view.outstandingCents).toBe(firstRent.amountCents)
    expect(tenant.id).toBeTruthy()
  }, 30_000)

  it('rolls back the state, audit, and idempotency writes when a projection insert fails', async () => {
    const db = await worker.getD1Database('DB')
    const before = await bootstrap()
    await db.prepare(`CREATE TRIGGER fail_rent_projection BEFORE INSERT ON rent_obligations
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END`).run()
    try {
      const failed = await jsonRequest('/api/v1/commands', 'POST', {
        action: {
          type: 'tenant/created', asOf: before.serverDate,
          draft: {
            name: 'Rollback Tenant', email: 'rollback@example.com', phone: '+63 900 555 0188',
            address: '8 Rollback Street, Demo City', roomId: 'room-8', moveInDate: before.serverDate, notes: '',
          },
        },
      }, { 'idempotency-key': 'worker-rollback-command-0001' })
      expect(failed.status).toBe(409)
      expect(await failed.json()).toMatchObject({ error: { code: 'STATE_CONFLICT' } })
    } finally {
      await db.prepare('DROP TRIGGER IF EXISTS fail_rent_projection').run()
    }
    const after = await bootstrap()
    expect(after.revision).toBe(before.revision)
    expect(after.data.tenants.some(tenant => tenant.name === 'Rollback Tenant')).toBe(false)
    const idempotency = await db.prepare('SELECT COUNT(*) AS count FROM idempotency_keys WHERE idempotency_key = ?')
      .bind('worker-rollback-command-0001').first<{ count: number }>()
    expect(idempotency?.count).toBe(0)
  }, 30_000)

  it('reports import conflicts without changing the workspace and leaves rejected commands atomic', async () => {
    const before = await bootstrap()
    const snapshot = JSON.stringify({ version: 17, data: createDemoData() })
    const dryRun = await jsonRequest('/api/v1/imports/dry-run', 'POST', { snapshot })
    expect(dryRun.status).toBe(200)
    const report = await dryRun.json() as { requiresExplicitApproval: boolean; targetRevision: number; conflicts: { blocking: boolean }[] }
    expect(report.requiresExplicitApproval).toBe(true)
    expect(report.targetRevision).toBe(before.revision)

    const apply = await jsonRequest('/api/v1/admin/imports/apply', 'POST', {
      snapshot, confirm: 'APPLY_IMPORT', expectedRevision: before.revision,
    })
    expect(apply.status).toBe(423)

    const noEffect = await jsonRequest('/api/v1/commands', 'POST', {
      action: {
        type: 'tenant/updated', tenantId: 'tenant-missing',
        draft: { name: 'Missing Tenant', email: '', phone: '', address: '', roomId: null, moveInDate: '2026-11-01', notes: '' },
      },
    }, { 'idempotency-key': 'worker-noop-command-0001' })
    expect(noEffect.status).toBe(422)

    const after = await bootstrap()
    expect(after.revision).toBe(before.revision)
    expect(after.data).toEqual(before.data)
  }, 30_000)

  it('collects historical rent and utilities atomically with concurrent, stale, retry, and rollback protection', async () => {
    const initial = await bootstrap()
    const reset = await jsonRequest('/api/v1/admin/clear-records', 'POST', { confirmation: 'RESET', expectedRevision: initial.revision }, { 'idempotency-key': 'collection-test-reset-0001' })
    expect(reset.status).toBe(200)
    const createdResponse = await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'tenant/created', draft: {
      name: 'July Historical Tenant', email: 'july.worker@example.com', phone: '', address: '', notes: '', roomId: 'room-2', moveInDate: '2026-07-06',
    } } }, { 'idempotency-key': 'collection-create-tenant-0001' })
    expect(createdResponse.status).toBe(200)
    const created = await bootstrap()
    const moveIn = created.data.moveInObligations.find(item => item.roomId === 'room-2')!
    expect((await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'moveIn/paymentRecorded', obligationId: moveIn.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-07-06' } }, { 'idempotency-key': 'collection-move-in-0001' })).status).toBe(200)
    const db = await worker.getD1Database('DB')
    const seeded = await bootstrap()
    const tenant = seeded.data.tenants.find(item => item.name === 'July Historical Tenant')!
    // Explicitly issued historical washing is evidence of usage; the current flag alone is not.
    seeded.data.charges.push({ id: 'issued-august-washing', tenantId: tenant.id, billingPeriodId: 'period-2026-08',
      category: 'WASHING_MACHINE', amountCents: 10_000, description: 'Verified August washing', entryMethod: 'MANUAL',
      issuedOn: '2026-08-31', dueDate: '2026-08-31', state: 'ISSUED', correction: null })
    await db.prepare('UPDATE workspace_state SET data_json = ? WHERE workspace_id = ?').bind(JSON.stringify(seeded.data), 'test-workspace').run()
    const quoteResponse = await jsonRequest('/api/v1/payments/quote', 'POST', { roomId: 'room-2', readings: {} })
    expect(quoteResponse.status).toBe(200)
    const quote = await quoteResponse.json() as { items: CollectibleItem[]; serverDate: string }
    const rent = quote.items.find(item => item.category === 'RENT' && item.dueDate === '2026-08-06')!
    expect(rent).toMatchObject({ amountCents: 350_000, status: 'OVERDUE' })
    expect(quote.items.some(item => item.category === 'RENT' && item.dueDate === '2026-07-06')).toBe(false)
    const water = quote.items.find(item => item.category === 'WATER' && item.periodId === 'period-2026-08')!
    const washing = quote.items.find(item => item.id === 'issued-august-washing')!
    const input: CollectionInput = { transactionId: 'historical-collection-0001', roomId: 'room-2', readings: {}, selections: [rent, water, washing], collectedOn: quote.serverDate }
    const stale = await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'payment/collected', input: { ...input, selections: [{ ...rent, amountCents: 1 }] } } }, { 'idempotency-key': 'historical-stale-0001' })
    expect(stale.status).toBe(422)
    const race = await Promise.all(['race-one', 'race-two'].map(transactionId => jsonRequest('/api/v1/commands', 'POST', {
      action: { type: 'payment/collected', input: { ...input, transactionId } },
    }, { 'idempotency-key': `historical-${transactionId}-0001` })))
    expect(race.filter(response => response.status === 200)).toHaveLength(1)
    expect(race.filter(response => response.status === 409 || response.status === 422)).toHaveLength(1)
    const winnerIndex = race.findIndex(response => response.status === 200)
    const winnerId = winnerIndex === 0 ? 'race-one' : 'race-two'
    const winnerInput = { ...input, transactionId: winnerId }
    const result = await race[winnerIndex]!.json() as { data: ReturnType<typeof createDemoData>; revision: number }
    const payment = result.data.payments.find(item => item.id === `payment-collection-${winnerId}`)!
    expect(payment).toMatchObject({ amountCents: 370_000, paidOn: quote.serverDate })
    expect(result.data.receipts.find(item => item.paymentId === payment.id)?.allocationIds).toHaveLength(3)
    expect(result.data.rentObligations.find(item => item.id === rent.id)?.dueDate).toBe('2026-08-06')
    expect(rentObligationPaidCents(result.data, rent.id, quote.serverDate)).toBe(350_000)
    expect(result.data.rentObligations.filter(item => item.dueDate >= '2026-09-01').every(item => rentObligationPaidCents(result.data, item.id, quote.serverDate) === 0)).toBe(true)
    const replay = await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'payment/collected', input: winnerInput } }, { 'idempotency-key': `historical-${winnerId}-0001` })
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, revision: result.revision })
    const collectionCount = await db.prepare('SELECT COUNT(*) AS count FROM cash_collections').first<{ count: number }>()
    const allocationCount = await db.prepare('SELECT COUNT(*) AS count FROM cash_collection_allocations').first<{ count: number }>()
    expect(collectionCount?.count).toBe(1)
    expect(allocationCount?.count).toBe(3)
    const refreshed = await bootstrap()
    const pendingRoom = selectRoomFinance(refreshed.data, quote.serverDate).find(item => item.context.roomId === 'room-2')!
    expect(pendingPaymentPeriods(refreshed.data, pendingRoom.charges, quote.serverDate, 'room-2').flatMap(period => period.bills).flatMap(bill => bill.charges).some(charge => charge.id === rent.id)).toBe(false)

    const nextQuote = await jsonRequest('/api/v1/payments/quote', 'POST', { roomId: 'room-2', readings: {} })
    const nextItems = (await nextQuote.json() as { items: CollectibleItem[] }).items
    const september = nextItems.find(item => item.category === 'RENT' && item.dueDate === '2026-09-06')!
    const rollbackInput = { ...input, transactionId: 'rollback-collection', selections: [september] }
    await db.prepare("CREATE TRIGGER fail_collection_allocation BEFORE INSERT ON cash_collection_allocations BEGIN SELECT RAISE(ABORT, 'forced allocation failure'); END").run()
    try {
      const failed = await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'payment/collected', input: rollbackInput } }, { 'idempotency-key': 'rollback-collection-0001' })
      expect(failed.status).toBe(409)
    } finally { await db.prepare('DROP TRIGGER fail_collection_allocation').run() }
    const afterFailure = await bootstrap()
    expect(afterFailure.revision).toBe(refreshed.revision)
    expect(afterFailure.data.payments).toHaveLength(refreshed.data.payments.length)
    expect((await db.prepare("SELECT COUNT(*) AS count FROM cash_collections WHERE id = 'rollback-collection'").first<{ count: number }>())?.count).toBe(0)
    const retry = await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'payment/collected', input: rollbackInput } }, { 'idempotency-key': 'rollback-collection-0001' })
    expect(retry.status).toBe(200)
  }, 30_000)

  it('clears all records atomically while preserving room configuration and rejecting sample restoration', async () => {
    const before = await bootstrap()
    expect(before.data.tenants.length).toBeGreaterThan(0)

    const roomResponse = await jsonRequest('/api/v1/commands', 'POST', {
      action: {
        type: 'room/created',
        draft: { name: 'TEST-ROOM', capacity: 1, categoryId: 'RATE_5000', kind: 'PRIVATE', status: 'available' },
      },
    }, { 'idempotency-key': 'worker-reset-room-0001' })
    expect(roomResponse.status).toBe(200)
    const configured = await bootstrap()
    const customRoom = configured.data.rooms.find(room => room.name === 'TEST-ROOM')
    expect(customRoom).toBeDefined()

    const stale = await jsonRequest('/api/v1/admin/clear-records', 'POST', {
      confirmation: 'RESET', expectedRevision: before.revision,
    }, { 'idempotency-key': 'worker-reset-stale-0001' })
    expect(stale.status).toBe(409)

    const missingConfirmation = await jsonRequest('/api/v1/admin/clear-records', 'POST', {
      confirmation: 'CLEAR', expectedRevision: configured.revision,
    }, { 'idempotency-key': 'worker-reset-confirmation-0001' })
    expect(missingConfirmation.status).toBe(400)

    const sampleRestore = await jsonRequest('/api/v1/commands', 'POST', { action: { type: 'demo/reset' } },
      { 'idempotency-key': 'worker-sample-restore-0001' })
    expect(sampleRestore.status).toBe(400)

    const response = await jsonRequest('/api/v1/admin/clear-records', 'POST', {
      confirmation: 'RESET', expectedRevision: configured.revision,
    }, { 'idempotency-key': 'worker-reset-0001' })
    expect(response.status).toBe(200)
    const cleared = await response.json() as {
      data: ReturnType<typeof createDemoData>; revision: number
    }
    expect(cleared.revision).toBe(configured.revision + 1)
    expect(cleared.data.tenants).toEqual([])
    expect(cleared.data.payments).toEqual([])
    expect(cleared.data.charges).toEqual([])
    expect(cleared.data.rentObligations).toEqual([])
    expect(cleared.data.rooms.map(room => room.id)).toEqual(configured.data.rooms.map(room => room.id))
    expect(cleared.data.rooms.some(room => room.name === 'TEST-ROOM')).toBe(true)
    expect(cleared.data.roomRentRates).toEqual(configured.data.roomRentRates)
    expect(cleared.data.moveInPolicy).toEqual(configured.data.moveInPolicy)
    expect(cleared.data.auditEvents).toHaveLength(1)
    expect(cleared.data.auditEvents[0]).toMatchObject({ action: 'WORKSPACE_RESET', entityId: 'test-workspace' })

    const replay = await jsonRequest('/api/v1/admin/clear-records', 'POST', {
      confirmation: 'RESET', expectedRevision: configured.revision,
    }, { 'idempotency-key': 'worker-reset-0001' })
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ revision: cleared.revision, data: { tenants: [] } })
    const after = await bootstrap()
    expect(after.revision).toBe(cleared.revision)
    expect(after.data.rooms.some(room => room.name === 'TEST-ROOM')).toBe(true)
  }, 30_000)
})
