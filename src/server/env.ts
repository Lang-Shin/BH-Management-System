export interface WorkerEnv {
  DB: D1Database
  ASSETS?: Fetcher
  ENVIRONMENT?: 'development' | 'staging' | 'production'
  WORKSPACE_ID?: string
  APP_TIMEZONE?: string
  ACCESS_AUD?: string
  ACCESS_TEAM_DOMAIN?: string
  BHMS_DEV_TOKEN?: string
  ALLOW_IMPORT_APPLY?: string
  ALLOW_TEST_RESET?: string
}

export interface Actor {
  id: string
  email: string | null
  source: 'DEV' | 'ACCESS'
}
