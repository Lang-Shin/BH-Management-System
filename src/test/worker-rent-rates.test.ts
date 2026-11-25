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
const workspaceId = 'rent-rates-workspace'

beforeAll(async () => {
  const buildResult = await build({
    entryPoints: [path.join(src, 'worker/index.ts')], bundle: true, write: false, format: 'esm',
    platform: 'browser', target: 'es2022',
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
    d1Databases: { DB: 'bhms-rent-rates-test-db' },
    bindings: {
      ENVIRONMENT: 'development', WORKSPACE_ID: workspaceId, APP_TIMEZONE: 'Asia/Manila',
      ALLOW_IMPORT_APPLY: 'false', ALLOW_TEST_RESET: 'true',
    },
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

async function request(pathname: string, init?: RequestInit) {
  return worker.dispatchFetch(`http://localhost${pathname}`, init as never)
}
async function command(body: unknown, key: string) {
  return request('/api/v1/commands', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
  })
}
async function bootstrap() {
  const response = await request('/api/v1/bootstrap')
  if (response.status !== 200) throw new Error(await response.text())
  return response.json() as Promise<{ data: any; revision: number; serverDate: string }>
}

function rateAction(intent: 'SCHEDULE' | 'EDIT' | 'CANCEL', categoryId: string, extra: Record<string, unknown> = {}) {
  return { action: { type: 'rates/scheduledChange', intent, categoryId, ...extra } }
}

describe('authoritative Worker/D1 scheduled rent rates', () => {
  it('schedules, edits, cancels, audits, persists, and replays idempotently', async () => {
    const initial = await bootstrap()
    expect(initial.data.rooms.filter((room: any) => room.categoryId === 'RATE_3500')).toHaveLength(8)
    const initialCategoryRates = initial.data.roomRentRates
      .filter((rate: any) => rate.categoryId === 'RATE_3500' && !rate.canceledOn && !rate.supersededOn)
      .sort((a: any, b: any) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    expect(initialCategoryRates.length).toBeGreaterThanOrEqual(1)
    expect(initialCategoryRates[0]?.monthlyRentCents).toBe(350_000)

    const scheduledResponse = await command(rateAction('SCHEDULE', 'RATE_3500', { amountCents: 380_000 }), 'rent-rate-schedule-0001')
    expect(scheduledResponse.status).toBe(200)
    const scheduled = await scheduledResponse.json() as { data: any; revision: number; replayed: boolean }
    const pending = scheduled.data.roomRentRates.find((rate: any) => rate.categoryId === 'RATE_3500' && rate.monthlyRentCents === 380_000)
    expect(pending).toMatchObject({ recordedBy: 'local-dev', revision: 1 })
    expect(pending.effectiveFrom > initial.serverDate).toBe(true)
    expect(scheduled.data.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_SCHEDULED', actorId: 'local-dev', entityType: 'RENT_RATE' })

    const replay = await command(rateAction('SCHEDULE', 'RATE_3500', { amountCents: 380_000 }), 'rent-rate-schedule-0001')
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ replayed: true, revision: scheduled.revision })

    const editedResponse = await command(rateAction('EDIT', 'RATE_3500', {
      amountCents: 360_000, reason: 'Reduce the planned increase', expectedRateId: pending.id, expectedRateRevision: pending.revision,
    }), 'rent-rate-edit-0001')
    expect(editedResponse.status).toBe(200)
    const edited = await editedResponse.json() as { data: any; revision: number }
    const replacement = edited.data.roomRentRates.find((rate: any) => rate.categoryId === 'RATE_3500' && rate.monthlyRentCents === 360_000)
    expect(replacement).toMatchObject({ revision: 2, supersedesRateId: pending.id, recordedBy: 'local-dev' })
    expect(edited.data.roomRentRates.find((rate: any) => rate.id === pending.id)).toMatchObject({
      supersededOn: initial.serverDate, supersededReason: 'Reduce the planned increase', supersededBy: 'local-dev',
    })
    expect(edited.data.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_EDITED', actorId: 'local-dev', reason: 'Reduce the planned increase' })

    const stale = await command(rateAction('EDIT', 'RATE_3500', {
      amountCents: 355_000, reason: 'Stale tab', expectedRateId: pending.id, expectedRateRevision: pending.revision,
    }), 'rent-rate-stale-0001')
    expect(stale.status).toBe(422)
    expect((await bootstrap()).revision).toBe(edited.revision)

    const canceledResponse = await command(rateAction('CANCEL', 'RATE_3500', {
      reason: 'No rent increase this year', expectedRateId: replacement.id, expectedRateRevision: replacement.revision,
    }), 'rent-rate-cancel-0001')
    expect(canceledResponse.status).toBe(200)
    const canceled = await canceledResponse.json() as { data: any; revision: number }
    expect(canceled.data.roomRentRates.find((rate: any) => rate.id === replacement.id)).toMatchObject({
      canceledOn: initial.serverDate, cancelReason: 'No rent increase this year', canceledBy: 'local-dev',
    })
    expect(canceled.data.roomRentRates.some((rate: any) => rate.categoryId === 'RATE_3500' && rate.effectiveFrom > initial.serverDate && !rate.canceledOn && !rate.supersededOn)).toBe(false)
    expect(canceled.data.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_CANCELED', actorId: 'local-dev' })

    const db = await worker.getD1Database('DB')
    const auditCounts = await db.prepare(`SELECT action, COUNT(*) AS count FROM audit_events
      WHERE workspace_id = ? AND entity_type = 'RENT_RATE' GROUP BY action ORDER BY action`)
      .bind(workspaceId).all<{ action: string; count: number }>()
    expect(Object.fromEntries(auditCounts.results.map(row => [row.action, row.count]))).toMatchObject({
      RENT_RATE_SCHEDULED: 1, RENT_RATE_EDITED: 1, RENT_RATE_CANCELED: 1,
    })
    const editAudit = await db.prepare(`SELECT actor_id, reason, before_json, after_json FROM audit_events
      WHERE workspace_id = ? AND action = 'RENT_RATE_EDITED'`).bind(workspaceId)
      .first<{ actor_id: string; reason: string; before_json: string; after_json: string }>()
    expect(editAudit).toMatchObject({ actor_id: 'local-dev', reason: 'Reduce the planned increase' })
    expect(editAudit?.before_json).toContain('380000')
    expect(editAudit?.after_json).toContain('360000')
    const persisted = await bootstrap()
    expect(persisted.revision).toBe(canceled.revision)
    expect(persisted.data.roomRentRates.some((rate: any) => rate.canceledOn && rate.cancelReason === 'No rent increase this year')).toBe(true)
  }, 30_000)

  it('rolls back failed audit projections and serializes concurrent edits and cancellations', async () => {
    const before = await bootstrap()
    const db = await worker.getD1Database('DB')
    await db.prepare(`CREATE TRIGGER fail_rent_rate_audit BEFORE INSERT ON audit_events
      WHEN NEW.entity_type = 'RENT_RATE' BEGIN SELECT RAISE(ABORT, 'forced rent rate audit failure'); END`).run()
    try {
      const failed = await command(rateAction('SCHEDULE', 'RATE_4000', { amountCents: 450_000 }), 'rent-rate-rollback-0001')
      expect(failed.status).toBe(409)
    } finally {
      await db.prepare('DROP TRIGGER fail_rent_rate_audit').run()
    }
    const afterFailure = await bootstrap()
    expect(afterFailure.revision).toBe(before.revision)
    expect(afterFailure.data.roomRentRates.some((rate: any) => rate.categoryId === 'RATE_4000' && rate.monthlyRentCents === 450_000)).toBe(false)
    expect((await db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE workspace_id = ? AND idempotency_key = 'rent-rate-rollback-0001'").bind(workspaceId).first<{ count: number }>())?.count).toBe(0)

    const scheduledResponse = await command(rateAction('SCHEDULE', 'RATE_4000', { amountCents: 450_000 }), 'rent-rate-concurrent-schedule')
    expect(scheduledResponse.status).toBe(200)
    const scheduled = await scheduledResponse.json() as { data: any; revision: number }
    const pending = scheduled.data.roomRentRates.find((rate: any) => rate.categoryId === 'RATE_4000' && rate.monthlyRentCents === 450_000)
    const edit = rateAction('EDIT', 'RATE_4000', {
      amountCents: 440_000, reason: 'Concurrent edit', expectedRateId: pending.id, expectedRateRevision: pending.revision,
    })
    const cancel = rateAction('CANCEL', 'RATE_4000', {
      reason: 'Concurrent cancel', expectedRateId: pending.id, expectedRateRevision: pending.revision,
    })
    const raced = await Promise.all([
      command(edit, 'rent-rate-concurrent-edit'),
      command(cancel, 'rent-rate-concurrent-cancel'),
    ])
    expect(raced.filter(response => response.status === 200)).toHaveLength(1)
    expect(raced.filter(response => response.status === 409 || response.status === 422)).toHaveLength(1)
    const final = await bootstrap()
    const eligible = final.data.roomRentRates.filter((rate: any) => rate.categoryId === 'RATE_4000'
      && rate.effectiveFrom > final.serverDate && !rate.canceledOn && !rate.supersededOn)
    expect(eligible.length).toBeLessThanOrEqual(1)
    expect(eligible.every((rate: any) => rate.monthlyRentCents === 440_000)).toBe(true)
    const winner = await (raced.find(response => response.status === 200)!).json() as { revision: number }
    expect(final.revision).toBe(winner.revision)
    const history = final.data.roomRentRates.filter((rate: any) => rate.categoryId === 'RATE_4000' && rate.monthlyRentCents === 450_000)
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history.some((rate: any) => rate.canceledOn || rate.supersededOn)).toBe(true)
  }, 30_000)

  it('rejects rate management by a provisioned tenant identity and requires valid reasons', async () => {
    const db = await worker.getD1Database('DB')
    const created = await bootstrap()
    await db.prepare("INSERT INTO users (id, email, display_name, status, created_at) VALUES ('local-dev', 'local-dev@example.invalid', 'Local tenant', 'ACTIVE', ?)")
      .bind(new Date().toISOString()).run()
    await db.prepare("INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, 'local-dev', 'TENANT', ?)")
      .bind(workspaceId, new Date().toISOString()).run()
    try {
      const rejected = await command(rateAction('SCHEDULE', 'RATE_5000', { amountCents: 520_000 }), 'rent-rate-tenant-denied')
      expect(rejected.status).toBe(403)
      expect(await rejected.json()).toMatchObject({ error: { code: 'FINANCIAL_ADMIN_REQUIRED' } })
      expect((await bootstrap()).revision).toBe(created.revision)
    } finally {
      await db.prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = 'local-dev'").bind(workspaceId).run()
      await db.prepare("DELETE FROM users WHERE id = 'local-dev'").run()
    }

    const missingReason = await command(rateAction('CANCEL', 'RATE_4000', { reason: '' }), 'rent-rate-missing-reason')
    expect(missingReason.status).toBe(400)
    expect(await missingReason.json()).toMatchObject({ error: { code: 'INVALID_COMMAND' } })
    const invalidAmount = await command(rateAction('SCHEDULE', 'RATE_5000', { amountCents: 0 }), 'rent-rate-invalid-amount')
    expect(invalidAmount.status).toBe(400)
    const invalidCategory = await command(rateAction('SCHEDULE', 'RATE_9999', { amountCents: 520_000 }), 'rent-rate-invalid-category')
    expect(invalidCategory.status).toBe(400)
    const legacyRent = await command({
      action: {
        type: 'rates/planned',
        plan: {
          kind: 'RENT', effectiveFrom: '2026-12-01', recordedOn: created.serverDate,
          values: { RATE_3500: 380_000, RATE_4000: 430_000, RATE_5000: 530_000 }, changes: [],
        },
      },
    }, 'rent-rate-legacy-bypass')
    expect(legacyRent.status).toBe(400)
    expect(await legacyRent.json()).toMatchObject({ error: { code: 'INVALID_COMMAND' } })
  }, 30_000)
})
