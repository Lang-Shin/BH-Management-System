export interface WorkerEnv {
  DB: D1Database
  ASSETS?: Fetcher
  ENVIRONMENT?: 'development' | 'staging' | 'production'
  WORKSPACE_ID?: string
  APP_TIMEZONE?: string
  ALLOW_IMPORT_APPLY?: string
  ALLOW_TEST_RESET?: string

  /** Supabase project origin, for example https://project-ref.supabase.co. */
  SUPABASE_URL?: string
  /** Server-only Supabase secret key. Never expose to the frontend. */
  SUPABASE_SECRET_KEY?: string
  /** Server-only token for one-off landlord setup and recovery operations. */
  AUTH_OPERATOR_TOKEN?: string
  COOKIE_ENCRYPTION_KEY?: string
  INVITE_TOKEN_PEPPER?: string
  AUDIT_PEPPER?: string
  /** Optional canonical frontend origin for invitation links. */
  AUTH_APP_URL?: string
  /** Local-only HTTP override. Production always uses Secure __Host cookies. */
  AUTH_COOKIE_SECURE?: string
  /** Explicitly enabled only for local development; never production. */
  BHMS_DEV_TOKEN?: string
}

export type AppRole = 'OWNER' | 'ADMIN' | 'VIEWER' | 'TENANT'

export interface Actor {
  id: string
  email: string | null
  emailVerified: boolean
  /** Legacy financial-audit source; non-dev authenticated users are recorded as ACCESS. */
  source: 'DEV' | 'ACCESS'
  role: AppRole
  aal: 1 | 2
  authUserId?: string
  tenantId?: string | null
  authMethod?: 'SUPABASE' | 'DEV'
}
