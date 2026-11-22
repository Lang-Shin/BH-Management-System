// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'

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
    },
  })
  const db = await worker.getD1Database('DB')
  const migrations = path.join(root, 'migrations')
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrations, file), 'utf8')
      .replace(/CREATE TRIGGER[\s\S]*?END;/gi, '')
      .split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('PRAGMA'))
      .join('\n')
    for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) {
      await db.prepare(statement).run()
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

  it('seeds a validated workspace and rejects non-local unauthenticated access', async () => {
    const seeded = await bootstrap()
    expect(seeded.data.tenants.length).toBeGreaterThan(0)
    expect(seeded.revision).toBe(1)

    const rejected = await request('/api/v1/bootstrap', undefined, 'https://public.example.com')
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toMatchObject({ error: { code: 'AUTH_NOT_CONFIGURED' } })
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

    const replay = await jsonRequest('/api/v1/commands', 'POST', paymentBody, { 'idempotency-key': 'worker-move-in-payment-0001' })
    expect(replay.status).toBe(200)
    const replayed = await replay.json() as { replayed: boolean; revision: number }
    expect(replayed).toMatchObject({ replayed: true, revision: paid.revision })

    const db = await worker.getD1Database('DB')
    const applicationCount = await db.prepare('SELECT COUNT(*) AS count FROM advance_applications WHERE workspace_id = ?').bind('test-workspace').first<{ count: number }>()
    expect(applicationCount?.count).toBe(1)
    const rentCount = await db.prepare('SELECT COUNT(*) AS count FROM rent_obligations WHERE workspace_id = ?').bind('test-workspace').first<{ count: number }>()
    expect(rentCount?.count).toBe(1)
  }, 30_000)

  it('quotes and records one multi-period prepayment excluding the advance-covered period', async () => {
    const state = await bootstrap()
    const cycle = state.data.occupancyCycles.find(item => item.rentSchedule === 'ANNIVERSARY' && item.status === 'ACTIVE')
    if (!cycle) throw new Error('Anniversary cycle missing from integration setup')
    const quoteResponse = await jsonRequest('/api/v1/rent/quote', 'POST', { cycleId: cycle.id, periodCount: 2 })
    expect(quoteResponse.status).toBe(200)
    const quote = await quoteResponse.json() as { quote: { periods: { sequence: number; amountCents: number }[]; totalCents: number; rateCents: number } }
    expect(quote.quote.periods.map(period => period.sequence)).toEqual([2, 3])
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
      action: { type: 'room/statusToggled', roomId: 'room-1' },
    }, { 'idempotency-key': 'worker-noop-command-0001' })
    expect(noEffect.status).toBe(422)

    const after = await bootstrap()
    expect(after.revision).toBe(before.revision)
    expect(after.data).toEqual(before.data)
  }, 30_000)
})
