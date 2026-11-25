/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FinancialReviewCase, PrototypeAppState } from '@/domain/types/models'

const root = process.cwd()
const src = path.join(root, 'src')
const workspaceId = 'transfer-review-workspace'
let worker: Miniflare

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
    d1Databases: { DB: 'bhms-transfer-review-test-db' },
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
async function command(reviewId: string, key: string, extra: Record<string, unknown> = {}) {
  return request('/api/v1/commands', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      action: {
        type: 'financialReview/resolved', reviewId,
        reason: 'Reviewed the financial treatment in the authorized workflow.', acknowledged: true, ...extra,
      },
    }),
  })
}
async function bootstrap() {
  const response = await request('/api/v1/bootstrap')
  if (response.status !== 200) throw new Error(await response.text())
  return response.json() as Promise<{ data: PrototypeAppState; revision: number; serverDate: string }>
}
async function seedReview(id: string): Promise<{ review: FinancialReviewCase; data: PrototypeAppState }> {
  const initial = await bootstrap()
  const review: FinancialReviewCase = {
    id, type: 'TRANSFER_RENT_DIFFERENCE', roomId: initial.data.rooms[0]!.id,
    occupancyCycleId: null, tenantId: null, rentalPeriodId: null,
    status: 'OPEN', note: 'Review the source and destination rent periods before collecting rent.',
    createdAt: initial.serverDate, resolvedAt: null,
  }
  const data: PrototypeAppState = {
    ...initial.data,
    financialReviewCases: [...initial.data.financialReviewCases.filter(item => item.id !== id), review],
  }
  const db = await worker.getD1Database('DB')
  await db.prepare('UPDATE workspace_state SET data_json = ? WHERE workspace_id = ?').bind(JSON.stringify(data), workspaceId).run()
  return { review, data }
}

describe('authoritative financial review resolution', () => {
  it('resolves an open review, stamps the administrator, audits D1, and replays idempotently', async () => {
    const { review, data } = await seedReview('review-resolution-1')
    const before = await bootstrap()
    const response = await command(review.id, 'review-resolve-0001')
    expect(response.status).toBe(200)
    const outcome = await response.json() as { data: any; revision: number; replayed: boolean }
    const resolved = outcome.data.financialReviewCases.find((item: any) => item.id === review.id)
    expect(resolved).toMatchObject({
      status: 'RESOLVED', resolvedBy: 'local-dev', resolutionReason: 'Reviewed the financial treatment in the authorized workflow.',
      resolvedAt: before.serverDate,
    })
    expect(outcome.data.payments).toEqual(data.payments)
    expect(outcome.data.charges).toEqual(data.charges)
    expect(outcome.data.receipts).toEqual(data.receipts)
    expect(outcome.data.rentObligations).toEqual(data.rentObligations)

    const replay = await command(review.id, 'review-resolve-0001')
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ replayed: true, revision: outcome.revision })

    const db = await worker.getD1Database('DB')
    const audit = await db.prepare(`SELECT actor_id, action, entity_type, entity_id, reason FROM audit_events
      WHERE workspace_id = ? AND action = 'FINANCIAL_REVIEW_RESOLVED'`).bind(workspaceId)
      .first<{ actor_id: string; action: string; entity_type: string; entity_id: string; reason: string }>()
    expect(audit).toMatchObject({
      actor_id: 'local-dev', action: 'FINANCIAL_REVIEW_RESOLVED',
      entity_type: 'FINANCIAL_REVIEW_CASE', entity_id: review.id,
      reason: 'Reviewed the financial treatment in the authorized workflow.',
    })
    const normalized = await db.prepare('SELECT status, resolved_at FROM financial_review_cases WHERE id = ?')
      .bind(review.id).first<{ status: string; resolved_at: string }>()
    expect(normalized).toMatchObject({ status: 'RESOLVED', resolved_at: before.serverDate })
    expect((await bootstrap()).data.financialReviewCases.find(item => item.id === review.id)?.status).toBe('RESOLVED')
  }, 30_000)

  it('rejects missing, stale, malformed, and unauthorized resolutions', async () => {
    const { review } = await seedReview('review-resolution-2')
    expect((await command('missing-review', 'review-missing-0001')).status).toBe(422)
    expect((await command(review.id, 'review-no-reason-0001', { reason: '' })).status).toBe(400)
    expect((await command(review.id, 'review-no-ack-0001', { acknowledged: false })).status).toBe(422)
    const first = await command(review.id, 'review-resolved-first')
    expect(first.status).toBe(200)
    expect((await command(review.id, 'review-resolved-second')).status).toBe(422)

    const db = await worker.getD1Database('DB')
    await db.prepare("INSERT INTO users (id, email, display_name, status, created_at) VALUES ('local-dev', 'local-dev@example.invalid', 'Local tenant', 'ACTIVE', ?)")
      .bind(new Date().toISOString()).run()
    await db.prepare("INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, 'local-dev', 'TENANT', ?)")
      .bind(workspaceId, new Date().toISOString()).run()
    try {
      const { review: openReview } = await seedReview('review-resolution-auth')
      const denied = await command(openReview.id, 'review-denied-0001')
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({ error: { code: 'FINANCIAL_ADMIN_REQUIRED' } })
    } finally {
      await db.prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = 'local-dev'").bind(workspaceId).run()
      await db.prepare("DELETE FROM users WHERE id = 'local-dev'").run()
    }
  }, 30_000)

  it('protects concurrent resolution and rolls back forced audit failures', async () => {
    const { review } = await seedReview('review-resolution-3')
    const raced = await Promise.all([
      command(review.id, 'review-concurrent-a'),
      command(review.id, 'review-concurrent-b'),
    ])
    expect(raced.filter(response => response.status === 200)).toHaveLength(1)
    expect(raced.filter(response => response.status === 409 || response.status === 422)).toHaveLength(1)

    const { review: rollbackReview } = await seedReview('review-resolution-rollback')
    const before = await bootstrap()
    const db = await worker.getD1Database('DB')
    await db.prepare(`CREATE TRIGGER fail_financial_review_audit BEFORE INSERT ON audit_events
      WHEN NEW.action = 'FINANCIAL_REVIEW_RESOLVED' BEGIN SELECT RAISE(ABORT, 'forced review audit failure'); END`).run()
    try {
      expect((await command(rollbackReview.id, 'review-rollback-0001')).status).toBe(409)
    } finally {
      await db.prepare('DROP TRIGGER fail_financial_review_audit').run()
    }
    const after = await bootstrap()
    expect(after.revision).toBe(before.revision)
    expect(after.data.financialReviewCases.find(item => item.id === rollbackReview.id)?.status).toBe('OPEN')
    expect((await db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE workspace_id = ? AND idempotency_key = 'review-rollback-0001'").bind(workspaceId).first<{ count: number }>())?.count).toBe(0)
  }, 30_000)
})
