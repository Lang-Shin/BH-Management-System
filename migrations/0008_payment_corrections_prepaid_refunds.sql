-- Normalized, append-friendly projections for audited payment corrections and prepaid-rent refunds.
CREATE TABLE IF NOT EXISTS payment_corrections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  original_payment_id TEXT NOT NULL,
  corrected_payment_id TEXT NOT NULL,
  original_receipt_id TEXT NOT NULL,
  corrected_receipt_id TEXT NOT NULL,
  corrected_at TEXT NOT NULL,
  corrected_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  original_amount_cents INTEGER NOT NULL CHECK (original_amount_cents >= 0),
  corrected_amount_cents INTEGER NOT NULL CHECK (corrected_amount_cents >= 0),
  difference_cents INTEGER NOT NULL,
  settlement_status TEXT NOT NULL,
  settlement_amount_cents INTEGER NOT NULL CHECK (settlement_amount_cents >= 0),
  original_categories_json TEXT NOT NULL CHECK (json_valid(original_categories_json)),
  corrected_categories_json TEXT NOT NULL CHECK (json_valid(corrected_categories_json)),
  audit_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, corrected_payment_id),
  UNIQUE (workspace_id, original_payment_id)
) STRICT;

CREATE INDEX IF NOT EXISTS payment_corrections_workspace_date_idx
  ON payment_corrections(workspace_id, corrected_at DESC);

CREATE TABLE IF NOT EXISTS prepaid_rent_refunds (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'COMPLETED', 'REVERSED')),
  tenant_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  occupancy_cycle_id TEXT NOT NULL,
  move_out_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  refunded_on TEXT,
  completed_by TEXT,
  reversed_at TEXT,
  reversed_by TEXT,
  reversal_reason TEXT,
  entitlement_review_required INTEGER NOT NULL CHECK (entitlement_review_required IN (0, 1)),
  audit_event_id TEXT NOT NULL,
  last_audit_event_id TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS prepaid_rent_refunds_workspace_date_idx
  ON prepaid_rent_refunds(workspace_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS prepaid_rent_refund_allocations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  prepaid_rent_refund_id TEXT NOT NULL REFERENCES prepaid_rent_refunds(id) ON DELETE CASCADE,
  payment_allocation_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  receipt_id TEXT,
  rent_obligation_id TEXT NOT NULL,
  rental_period_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (prepaid_rent_refund_id, payment_allocation_id)
) STRICT;
