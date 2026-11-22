-- BHMS Phase 2 foundation. The versioned workspace snapshot remains the compatibility read model
-- during the staged migration; Phase 2 rent and ledger records are mirrored transactionally into
-- normalized tables in the same D1 batch. Legacy financial history is never relabelled here.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  dataset_kind TEXT NOT NULL DEFAULT 'DEMO' CHECK (dataset_kind IN ('DEMO', 'REAL')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS workspace_state (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'VIEWER', 'TENANT')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS tenant_account_links (
  tenant_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  actor_source TEXT NOT NULL CHECK (actor_source IN ('DEV', 'ACCESS')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS audit_events_workspace_time_idx ON audit_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events(workspace_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRY_RUN', 'APPLIED', 'REJECTED')),
  conflicts_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS occupancy_cycles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  room_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  rent_schedule TEXT NOT NULL CHECK (rent_schedule IN ('ANNIVERSARY', 'LEGACY_CALENDAR')),
  rent_anchor_date TEXT,
  rent_anchor_day INTEGER CHECK (rent_anchor_day BETWEEN 1 AND 31),
  cycle_origin TEXT NOT NULL CHECK (cycle_origin IN ('NEW_MOVE_IN', 'TRANSFER', 'LEGACY', 'SAME_DAY_REPLACEMENT')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (rent_schedule <> 'ANNIVERSARY' OR (rent_anchor_date IS NOT NULL AND rent_anchor_day IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS occupancy_cycles_one_active_room_idx
  ON occupancy_cycles(workspace_id, room_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS rental_periods (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  occupancy_cycle_id TEXT NOT NULL REFERENCES occupancy_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  start_date TEXT NOT NULL,
  end_date_exclusive TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  origin TEXT NOT NULL CHECK (origin IN ('ANNIVERSARY', 'LEGACY_CALENDAR')),
  CHECK (start_date < end_date_exclusive),
  UNIQUE (occupancy_cycle_id, sequence_no),
  UNIQUE (occupancy_cycle_id, start_date)
) STRICT;

CREATE TABLE IF NOT EXISTS rent_obligations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  occupancy_cycle_id TEXT NOT NULL REFERENCES occupancy_cycles(id) ON DELETE CASCADE,
  rental_period_id TEXT NOT NULL UNIQUE REFERENCES rental_periods(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  rate_id TEXT NOT NULL,
  rate_effective_from TEXT NOT NULL,
  rate_snapshot_cents INTEGER NOT NULL CHECK (rate_snapshot_cents > 0 AND rate_snapshot_cents = amount_cents),
  issued_on TEXT NOT NULL,
  due_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('REGULAR', 'MOVE_IN_ADVANCE', 'PREPAYMENT', 'LEGACY_CALENDAR')),
  state TEXT NOT NULL CHECK (state IN ('ISSUED', 'VOIDED')),
  correction_json TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS rent_obligations_workspace_room_idx ON rent_obligations(workspace_id, room_id, issued_on);

CREATE TABLE IF NOT EXISTS advance_applications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  occupancy_cycle_id TEXT NOT NULL REFERENCES occupancy_cycles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  advance_charge_id TEXT NOT NULL,
  source_payment_id TEXT NOT NULL,
  rent_obligation_id TEXT NOT NULL UNIQUE REFERENCES rent_obligations(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  applied_on TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'REVERSED')),
  reversal_audit_event_id TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS advance_applications_one_active_cycle_idx
  ON advance_applications(workspace_id, occupancy_cycle_id) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS rent_prepayments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL,
  occupancy_cycle_id TEXT NOT NULL REFERENCES occupancy_cycles(id) ON DELETE RESTRICT,
  room_id TEXT NOT NULL,
  period_count INTEGER NOT NULL CHECK (period_count >= 1),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  rate_cents INTEGER NOT NULL CHECK (rate_cents > 0),
  rate_locked_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK (review_state IN ('NONE', 'TRANSFER_REVIEW'))
) STRICT;

CREATE TABLE IF NOT EXISTS rent_prepayment_periods (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  rent_prepayment_id TEXT NOT NULL REFERENCES rent_prepayments(id) ON DELETE CASCADE,
  rental_period_id TEXT NOT NULL REFERENCES rental_periods(id) ON DELETE RESTRICT,
  PRIMARY KEY (rent_prepayment_id, rental_period_id)
) STRICT;

CREATE TABLE IF NOT EXISTS financial_review_cases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('TRANSFER_RENT_DIFFERENCE', 'TRANSFER_PREPAID_RENT', 'LEGACY_ADVANCE_UNALLOCATED', 'ADVANCE_APPLICATION_REVIEW')),
  room_id TEXT NOT NULL,
  occupancy_cycle_id TEXT,
  tenant_id TEXT,
  rental_period_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS financial_review_cases_open_idx
  ON financial_review_cases(workspace_id, status, created_at);

CREATE TABLE IF NOT EXISTS security_deposit_holdings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  tenant_id TEXT,
  origin_cycle_id TEXT NOT NULL,
  origin_room_id TEXT NOT NULL,
  original_amount_cents INTEGER NOT NULL CHECK (original_amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'REFUNDED', 'FORFEITED', 'REVIEW')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS workspace_state_touch
AFTER UPDATE OF data_json ON workspace_state
BEGIN
  SELECT 1;
END;


