/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()
const src = path.join(root, 'src')
let worker: Miniflare

beforeAll(async () => {
  const buildResult = await build({
    entryPoints: [path.join(src, 'worker/index.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [{
      name: 'bhms-alias',
      setup(context) {
        context.onResolve({ filter: /^@\// }, args => {
          const target = path.join(src, args.path.slice(2))
          const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find(candidate => existsSync(candidate))
          return resolved ? { path: resolved } : { errors: [{ text: `Cannot resolve ${args.path}` }] }
        })
      },
    }],
  })
  worker = new Miniflare({
    modules: true, script: buildResult.outputFiles[0]!.text, compatibilityDate: '2025-07-18',
    d1Databases: { DB: 'bhms-corrections-test-db' },
    bindings: { ENVIRONMENT: 'development', WORKSPACE_ID: 'corrections-workspace', APP_TIMEZONE: 'Asia/Manila', ALLOW_IMPORT_APPLY: 'false', ALLOW_TEST_RESET: 'true' },
  })
  const db = await worker.getD1Database('DB')
  const migrations = path.join(root, 'migrations')
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrations, file), 'utf8').split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('PRAGMA')).join('\n')
    const triggerPattern = /CREATE\s+TRIGGER[\s\S]*?END;/gi
    const triggers = [...sql.matchAll(triggerPattern)].map(match => match[0])
    const tables = sql.replace(triggerPattern, '')
    for (const statement of tables.split(';').map(item => item.trim()).filter(Boolean)) await db.prepare(statement).run()
    for (const trigger of triggers) await db.prepare(trigger).run()
  }
}, 60_000)

afterAll(async () => { await worker?.dispose() })

async function request(pathname: string, init?: RequestInit) { return worker.dispatchFetch(`http://localhost${pathname}`, init as never) }
async function jsonRequest(pathname: string, method: string, body: unknown, key?: string) {
  return request(pathname, { method, headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })
}
async function command(body: unknown, key: string) { return jsonRequest('/api/v1/commands', 'POST', body, key) }
async function bootstrap() {
  const response = await request('/api/v1/bootstrap')
  if (response.status !== 200) throw new Error(await response.text())
  return response.json() as Promise<{ data: any; revision: number; serverDate: string }>
}

async function createTenant(roomId: string, name: string, serverDate: string) {
  const created = await command({ action: { type: 'tenant/created', draft: { name, email: `${name.replace(/\s/g, '.')}@example.com`, phone: '', address: '', notes: '', roomId, moveInDate: serverDate } } }, `create-${name}-${roomId}`)
  if (created.status !== 200) throw new Error(await created.text())
  const state = await bootstrap()
  const tenant = state.data.tenants.find((item: { name: string }) => item.name === name)
  const obligation = state.data.moveInObligations.find((item: { roomId: string }) => item.roomId === roomId)
  const paid = await command({ action: { type: 'moveIn/paymentRecorded', obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: serverDate } }, `move-in-${name}-${roomId}`)
  if (paid.status !== 200) throw new Error(await paid.text())
  return { tenant, obligation, cycle: state.data.occupancyCycles.find((item: any) => item.roomId === roomId && item.status === 'ACTIVE'), state: await bootstrap() }
}

describe('authoritative Worker/D1 financial corrections and refunds', () => {
  it('validates ids-only checkbox corrections, rolls back failures, and rejects concurrent/stale submissions', async () => {
    const initial = await bootstrap()
    const { cycle } = await createTenant('room-12', 'Checkbox Worker Tenant', initial.serverDate)
    const prepaid = await jsonRequest('/api/v1/rent/prepayments', 'POST', { cycleId: cycle.id, periodCount: 36, paidOn: initial.serverDate }, 'checkbox-worker-prepay-36')
    if (prepaid.status !== 201) throw new Error(await prepaid.text())
    const original = await prepaid.json() as { payment: any; receipt: any; data: any }
    const allocations = original.data.paymentAllocations.filter((item: any) => item.paymentId === original.payment.id && item.state === 'ACTIVE')
    const action = {
      type: 'payment/corrected', paymentId: original.payment.id, selectedCategories: ['RENT'],
      correctedElectricityReadingMilliKwh: null, reason: 'Last period was not actually prepaid.',
      settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false, correctedAt: initial.serverDate,
      retainedAllocationIds: allocations.slice(0, -1).map((item: any) => item.id),
      expectedReceiptId: original.receipt.id, expectedReceiptRevision: original.receipt.revision,
      correctedTotalCents: 1,
    }
    for (const [changes, code] of [
      [{ retainedAllocationIds: ['foreign-payment-allocation'] }, 'INVALID_ALLOCATION'],
      [{ retainedAllocationIds: [allocations[0].id, allocations[0].id] }, 'INVALID_ALLOCATION'],
      [{ expectedReceiptRevision: 999 }, 'STALE_CORRECTION'],
      [{ retainedAllocationIds: allocations.map((item: any) => item.id) }, 'NO_CHANGES'],
    ] as const) {
      const rejected = await command({ action: { ...action, ...changes } }, `checkbox-reject-${code}-${JSON.stringify(changes).length}`)
      expect(rejected.status).toBe(422)
      expect(await rejected.json()).toMatchObject({ error: { code } })
    }
    const malformed = await command({ action: { ...action, lines: [{ targetId: allocations[0].chargeId, category: 'RENT', amountCents: 1 }] } }, 'checkbox-no-client-amounts')
    expect(malformed.status).toBe(400)
    const db = await worker.getD1Database('DB')
    const beforeFailure = await bootstrap()
    await db.prepare("CREATE TRIGGER fail_checkbox_projection BEFORE INSERT ON payment_corrections BEGIN SELECT RAISE(ABORT, 'forced checkbox failure'); END").run()
    try {
      expect((await command({ action }, 'checkbox-rollback-retry')).status).toBe(409)
    } finally {
      await db.prepare('DROP TRIGGER fail_checkbox_projection').run()
    }
    expect((await bootstrap()).revision).toBe(beforeFailure.revision)
    const keys = ['checkbox-rollback-retry', 'checkbox-concurrent-second']
    const raced = await Promise.all(keys.map(key => command({ action }, key)))
    expect(raced.filter(response => response.status === 200)).toHaveLength(1)
    expect(raced.filter(response => response.status === 409 || response.status === 422)).toHaveLength(1)
    const winningIndex = raced.findIndex(response => response.status === 200)
    const result = await raced[winningIndex]!.json() as { data: any; revision: number }
    const correction = result.data.paymentCorrections.find((item: any) => item.originalPaymentId === original.payment.id)
    expect(correction.correctedBy).toBe('local-dev')
    expect(correction.correctedAmountCents).toBe(original.payment.amountCents - allocations.at(-1).amountCents)
    expect(result.data.rentalPeriods).toEqual(original.data.rentalPeriods)
    expect(result.data.rentObligations).toEqual(original.data.rentObligations)
    expect(result.data.receipts.find((receipt: any) => receipt.id === original.receipt.id)?.state).toBe('SUPERSEDED')
    expect(result.data.prepaidRentRefunds ?? []).toEqual([])
    const replay = await command({ action }, keys[winningIndex]!)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ revision: result.revision, replayed: true })
    expect((await db.prepare('SELECT COUNT(*) AS count FROM payment_corrections WHERE original_payment_id = ?').bind(original.payment.id).first<{ count: number }>())?.count).toBe(1)
    const unauthorized = await worker.dispatchFetch('https://public.example.com/api/v1/commands', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'unauthorized-checkbox-test' }, body: JSON.stringify({ action }),
    })
    expect(unauthorized.status).toBe(503)
    expect((await bootstrap()).revision).toBe(result.revision)
  }, 30_000)

  it('corrects a multi-month rent allocation and projects the correction in D1', async () => {
    const initial = await bootstrap()
    const { cycle } = await createTenant('room-10', 'Rent Correction', initial.serverDate)
    const first = await jsonRequest('/api/v1/rent/prepayments', 'POST', { cycleId: cycle.id, periodCount: 3, paidOn: initial.serverDate }, 'rent-correct-a')
    if (first.status !== 201) throw new Error(await first.text())
    const paymentA = (await first.json() as { payment: { id: string } }).payment
    const second = await jsonRequest('/api/v1/rent/prepayments', 'POST', { cycleId: cycle.id, periodCount: 1, paidOn: initial.serverDate }, 'rent-correct-b')
    if (second.status !== 201) throw new Error(await second.text())
    const paymentB = (await second.json() as { payment: { id: string } }).payment
    const reversed = await command({ action: {
      type: 'payment/corrected', paymentId: paymentB.id, selectedCategories: ['RENT'], correctedElectricityReadingMilliKwh: null,
      reason: 'Materialize an unpaid target period', settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false,
      correctedAt: initial.serverDate, reverseAll: true,
    } }, 'reverse-target-period')
    if (reversed.status !== 200) throw new Error(await reversed.text())
    const current = await bootstrap()
    const allocations = current.data.paymentAllocations.filter((allocation: any) => allocation.paymentId === paymentA.id && allocation.state === 'ACTIVE')
    const obligations = current.data.rentObligations.filter((obligation: any) => obligation.occupancyCycleId === cycle.id)
    const period2 = obligations.find((obligation: any) => current.data.rentalPeriods.find((period: any) => period.id === obligation.rentalPeriodId)?.sequence === 2)!
    const period5 = obligations.find((obligation: any) => current.data.rentalPeriods.find((period: any) => period.id === obligation.rentalPeriodId)?.sequence === 5)!
    const period2Allocation = allocations.find((allocation: any) => allocation.chargeId === period2.id)!
    const lines = allocations.map((allocation: any) => ({
      targetId: allocation.chargeId === period2.id ? period5.id : allocation.chargeId,
      category: 'RENT', amountCents: allocation.amountCents, sourceAllocationId: allocation.id,
    }))
    const corrected = await command({ action: {
      type: 'payment/corrected', paymentId: paymentA.id, selectedCategories: ['RENT'], correctedElectricityReadingMilliKwh: null,
      reason: 'September payment was applied to October', settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false,
      correctedAt: initial.serverDate, lines,
    } }, 'correct-rent-allocation-worker')
    if (corrected.status !== 200) throw new Error(await corrected.text())
    const result = await corrected.json() as { data: any; revision: number }
    expect(result.data.payments.find((payment: any) => payment.id === paymentA.id)?.state).toBe('VOIDED')
    expect(result.data.payments.find((payment: any) => payment.correction?.supersedesId === paymentA.id)?.amountCents).toBe(period2Allocation.amountCents * 3)
    const activeTargets = result.data.paymentAllocations.filter((allocation: any) => allocation.state === 'ACTIVE'
      && result.data.payments.find((payment: any) => payment.id === allocation.paymentId)?.correction?.supersedesId === paymentA.id)
      .map((allocation: any) => allocation.chargeId)
    expect(activeTargets).toContain(period5.id)
    expect(activeTargets).not.toContain(period2.id)
    const db = await worker.getD1Database('DB')
    const correction = await db.prepare('SELECT original_payment_id, corrected_amount_cents, settlement_status FROM payment_corrections WHERE original_payment_id = ?').bind(paymentA.id).first<{ original_payment_id: string; corrected_amount_cents: number; settlement_status: string }>()
    expect(correction).toMatchObject({ original_payment_id: paymentA.id, corrected_amount_cents: 1_200_000, settlement_status: 'CORRECTED' })
    expect((await db.prepare('SELECT COUNT(*) AS count FROM prepaid_rent_refunds WHERE workspace_id = ?').bind('corrections-workspace').first<{ count: number }>())?.count).toBe(0)
  }, 30_000)

  it('persists proposed, approved, and completed prepaid refunds atomically in D1', async () => {
    const initial = await bootstrap()
    const { tenant, cycle } = await createTenant('room-13', 'Refund Worker Tenant', initial.serverDate)
    const prepaid = await jsonRequest('/api/v1/rent/prepayments', 'POST', { cycleId: cycle.id, periodCount: 3, paidOn: initial.serverDate }, 'refund-worker-prepay')
    if (prepaid.status !== 201) throw new Error(await prepaid.text())
    const payment = (await prepaid.json() as { payment: { id: string; amountCents: number } }).payment
    const moved = await command({ action: { type: 'tenant/movedOut', tenantId: tenant.id, asOf: initial.serverDate } }, 'refund-worker-moveout')
    if (moved.status !== 200) throw new Error(await moved.text())
    const proposed = await command({ action: { type: 'prepaidRefund/proposed', tenantId: tenant.id, moveOutDate: initial.serverDate, reason: 'Future periods are refundable', asOf: initial.serverDate } }, 'refund-worker-propose')
    if (proposed.status !== 200) throw new Error(await proposed.text())
    const proposal = await proposed.json() as { data: any }
    const refund = proposal.data.prepaidRentRefunds[0]
    expect(refund).toMatchObject({ status: 'PROPOSED', amountCents: payment.amountCents, refundedOn: null })
    const approved = await command({ action: { type: 'prepaidRefund/approved', refundId: refund.id, asOf: initial.serverDate, reason: 'Landlord approved future refund' } }, 'refund-worker-approve')
    if (approved.status !== 200) throw new Error(await approved.text())
    const completed = await command({ action: { type: 'prepaidRefund/completed', refundId: refund.id, refundedOn: initial.serverDate, asOf: initial.serverDate } }, 'refund-worker-complete')
    if (completed.status !== 200) throw new Error(await completed.text())
    const result = await completed.json() as { data: any }
    expect(result.data.prepaidRentRefunds[0]).toMatchObject({ status: 'COMPLETED', amountCents: payment.amountCents, refundedOn: initial.serverDate })
    expect(result.data.payments.find((item: any) => item.id === payment.id)?.amountCents).toBe(payment.amountCents)
    const db = await worker.getD1Database('DB')
    const row = await db.prepare('SELECT status, amount_cents, refunded_on FROM prepaid_rent_refunds WHERE id = ?').bind(refund.id).first<{ status: string; amount_cents: number; refunded_on: string }>()
    expect(row).toMatchObject({ status: 'COMPLETED', amount_cents: payment.amountCents, refunded_on: initial.serverDate })
    expect((await db.prepare('SELECT COUNT(*) AS count FROM prepaid_rent_refund_allocations WHERE prepaid_rent_refund_id = ?').bind(refund.id).first<{ count: number }>())?.count).toBe(3)
    const retry = await command({ action: { type: 'prepaidRefund/proposed', tenantId: tenant.id, moveOutDate: initial.serverDate, reason: 'Duplicate', asOf: initial.serverDate } }, 'refund-worker-duplicate')
    expect(retry.status).toBe(422)
    await expect(retry.json()).resolves.toMatchObject({ error: { code: 'DUPLICATE_REFUND' } })
  }, 30_000)

  it('rolls back correction and refund projections atomically when D1 insertion fails', async () => {
    const db = await worker.getD1Database('DB')
    const initial = await bootstrap()
    const correctionTenant = await createTenant('room-11', 'Correction Rollback Tenant', initial.serverDate)
    const prepaid = await jsonRequest('/api/v1/rent/prepayments', 'POST', { cycleId: correctionTenant.cycle.id, periodCount: 1, paidOn: initial.serverDate }, 'rollback-tenant-prepay')
    if (prepaid.status !== 201) throw new Error(await prepaid.text())
    const targetPayment = (await prepaid.json() as { payment: { id: string } }).payment
    const beforeCorrection = await bootstrap()
    await db.prepare("CREATE TRIGGER fail_payment_correction_projection BEFORE INSERT ON payment_corrections BEGIN SELECT RAISE(ABORT, 'forced correction failure'); END").run()
    const failedCorrection = await command({ action: {
      type: 'payment/corrected', paymentId: targetPayment.id, selectedCategories: ['RENT'], correctedElectricityReadingMilliKwh: null,
      reason: 'Rollback correction projection', settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false,
      correctedAt: initial.serverDate, reverseAll: true,
    } }, 'rollback-correction-command')
    expect(failedCorrection.status).toBe(409)
    await db.prepare('DROP TRIGGER fail_payment_correction_projection').run()
    const afterFailure = await bootstrap()
    expect(afterFailure.revision).toBe(beforeCorrection.revision)
    expect(afterFailure.data.paymentCorrections.some((correction: any) => correction.originalPaymentId === targetPayment.id)).toBe(false)
    const retryCorrection = await command({ action: {
      type: 'payment/corrected', paymentId: targetPayment.id, selectedCategories: ['RENT'], correctedElectricityReadingMilliKwh: null,
      reason: 'Rollback correction projection', settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false,
      correctedAt: initial.serverDate, reverseAll: true,
    } }, 'rollback-correction-command')
    expect(retryCorrection.status).toBe(200)

    const refundTenant = await createTenant('room-14', 'Refund Rollback Tenant', initial.serverDate)
    const refundPrepaid = await jsonRequest('/api/v1/rent/prepayments', 'POST', { cycleId: refundTenant.cycle.id, periodCount: 1, paidOn: initial.serverDate }, 'rollback-refund-prepay')
    if (refundPrepaid.status !== 201) throw new Error(await refundPrepaid.text())
    const moved = await command({ action: { type: 'tenant/movedOut', tenantId: refundTenant.tenant.id, asOf: initial.serverDate } }, 'rollback-refund-moveout')
    if (moved.status !== 200) throw new Error(await moved.text())
    const beforeRefund = await bootstrap()
    await db.prepare("CREATE TRIGGER fail_prepaid_refund_projection BEFORE INSERT ON prepaid_rent_refunds BEGIN SELECT RAISE(ABORT, 'forced refund failure'); END").run()
    const failedRefund = await command({ action: {
      type: 'prepaidRefund/proposed', tenantId: refundTenant.tenant.id, moveOutDate: initial.serverDate,
      reason: 'Rollback refund projection', asOf: initial.serverDate,
    } }, 'rollback-refund-command')
    expect(failedRefund.status).toBe(409)
    await db.prepare('DROP TRIGGER fail_prepaid_refund_projection').run()
    const afterRefundFailure = await bootstrap()
    expect(afterRefundFailure.revision).toBe(beforeRefund.revision)
    expect((afterRefundFailure.data.prepaidRentRefunds ?? []).length).toBe((beforeRefund.data.prepaidRentRefunds ?? []).length)
  }, 30_000)

  it('rejects authenticated tenant, viewer, and disabled accounts at the financial command boundary', async () => {
    const state = await bootstrap()
    const payment = state.data.payments.find((item: any) => item.state === 'RECORDED' && item.amountCents > 0
      && !state.data.paymentCorrections.some((correction: any) => correction.originalPaymentId === item.id)
      && !state.data.prepaidRentRefunds?.some((refund: any) => refund.allocations.some((allocation: any) => allocation.paymentId === item.id)))
    const receipt = state.data.receipts.find((item: any) => item.paymentId === payment.id && item.state === 'ISSUED')
    const action = {
      type: 'payment/corrected', paymentId: payment.id, selectedCategories: ['RENT'],
      correctedElectricityReadingMilliKwh: null, reason: 'Role boundary verification',
      settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false, correctedAt: state.serverDate,
      retainedAllocationIds: [], expectedReceiptId: receipt.id, expectedReceiptRevision: receipt.revision,
    }
    const db = await worker.getD1Database('DB')
    await db.prepare("INSERT INTO users (id, email, display_name, status, created_at) VALUES ('local-dev', 'local-dev@example.invalid', 'Role Test', 'ACTIVE', ?)")
      .bind(state.serverDate).run()
    await db.prepare("INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ('corrections-workspace', 'local-dev', 'TENANT', ?)")
      .bind(state.serverDate).run()
    for (const role of ['TENANT', 'VIEWER']) {
      await db.prepare("UPDATE workspace_memberships SET role = ? WHERE workspace_id = 'corrections-workspace' AND user_id = 'local-dev'").bind(role).run()
      const response = await command({ action }, `checkbox-role-${role}`)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'FINANCIAL_ADMIN_REQUIRED' } })
    }
    await db.prepare("UPDATE workspace_memberships SET role = 'ADMIN' WHERE workspace_id = 'corrections-workspace' AND user_id = 'local-dev'").run()
    await db.prepare("UPDATE users SET status = 'DISABLED' WHERE id = 'local-dev'").run()
    expect((await command({ action }, 'checkbox-disabled-admin')).status).toBe(403)
    expect((await bootstrap()).revision).toBe(state.revision)
    await db.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = 'local-dev'").run()
    const allowed = await command({ action }, 'checkbox-active-admin')
    if (allowed.status !== 200) throw new Error(await allowed.text())
    expect(allowed.status).toBe(200)
    const holding = await db.prepare('SELECT status FROM security_deposit_holdings WHERE origin_cycle_id = ?')
      .bind(payment.occupancyCycleId).first<{ status: string }>()
    expect(holding?.status).toBe('REVIEW')
  }, 30_000)
})
