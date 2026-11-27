// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Miniflare } from 'miniflare3'
import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()
let worker: Miniflare

function statements(sql: string): string[] {
  const withoutTriggers = sql.replace(/CREATE\s+TRIGGER[\s\S]*?END;/gi, '')
  return withoutTriggers.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('PRAGMA')).join('\n')
    .split(';').map(item => item.trim()).filter(Boolean)
}

function triggers(sql: string): string[] {
  return [...sql.matchAll(/CREATE\s+TRIGGER[\s\S]*?END;/gi)].map(match => match[0])
}

async function apply(db: D1Database, file: string): Promise<void> {
  const sql = readFileSync(path.join(root, 'migrations', file), 'utf8')
  for (const statement of statements(sql)) await db.prepare(statement).run()
  for (const trigger of triggers(sql)) await db.prepare(trigger).run()
}

beforeAll(async () => {
  worker = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2025-07-18',
    d1Databases: { DB: 'bhms-auth-upgrade-db' },
  })
}, 30_000)

afterAll(async () => { await worker?.dispose() })

describe('additive authentication migration', () => {
  it('preserves existing identity and tenant rows while adding auth columns', async () => {
    const db = await worker.getD1Database('DB')
    for (const file of readdirSync(path.join(root, 'migrations')).filter(name => /^000[1-8]_.*\.sql$/.test(name)).sort()) {
      await apply(db, file)
    }
    const now = new Date().toISOString()
    await db.prepare("INSERT INTO workspaces (id, name, timezone, dataset_kind, created_at) VALUES ('ws_upgrade', 'BH', 'Asia/Manila', 'REAL', ?)").bind(now).run()
    await db.prepare("INSERT INTO users (id, email, display_name, status, created_at) VALUES ('legacy-user', 'legacy@example.invalid', 'Legacy', 'ACTIVE', ?)").bind(now).run()
    await db.prepare("INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ('ws_upgrade', 'legacy-user', 'TENANT', ?)").bind(now).run()
    await db.prepare("INSERT INTO tenant_account_links (tenant_id, workspace_id, user_id, created_at) VALUES ('tenant-legacy', 'ws_upgrade', 'legacy-user', ?)").bind(now).run()

    await apply(db, '0009_supabase_auth.sql')
    const existing = await db.prepare("SELECT id, email, status, auth_user_id, email_verified, session_invalid_after FROM users WHERE id = 'legacy-user'").first<Record<string, unknown>>()
    expect(existing).toMatchObject({ id: 'legacy-user', email: 'legacy@example.invalid', status: 'ACTIVE', auth_user_id: null, email_verified: 0 })
    const link = await db.prepare("SELECT tenant_id, user_id, access_expires_at FROM tenant_account_links WHERE tenant_id = 'tenant-legacy'").first<Record<string, unknown>>()
    expect(link).toMatchObject({ tenant_id: 'tenant-legacy', user_id: 'legacy-user', access_expires_at: null })

    const authUserId = '11111111-1111-4111-8111-111111111111'
    const bhmsUserId = '22222222-2222-4222-8222-222222222222'
    await db.prepare(`INSERT INTO auth_invitations
      (id, workspace_id, kind, tenant_id, token_digest, state, expires_at, auth_user_id, bhms_user_id, created_by, created_at)
      VALUES ('invite-upgrade', 'ws_upgrade', 'TENANT', 'tenant-legacy', 'digest-upgrade', 'PROVISIONING', ?, ?, ?, 'operator', ?)`)
      .bind(new Date(Date.now() + 60_000).toISOString(), authUserId, bhmsUserId, now).run()
    await expect(db.prepare(`INSERT INTO users (id, email, display_name, status, auth_user_id, email_verified, session_invalid_after, created_at)
      VALUES (?, 'unclaimed@example.invalid', 'Unclaimed', 'ACTIVE', ?, 0, ?, ?)`)
      .bind(bhmsUserId, '33333333-3333-4333-8333-333333333333', now, now).run()).rejects.toThrow(/auth_invitation_not_claimed/)
  })
})
