-- Preserve prepaid rent review for tenant early departures without automatic refunds or transfers.
CREATE TABLE financial_review_cases_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('TRANSFER_RENT_DIFFERENCE', 'TRANSFER_PREPAID_RENT', 'PREPAID_RENT_EARLY_DEPARTURE', 'LEGACY_ADVANCE_UNALLOCATED', 'ADVANCE_APPLICATION_REVIEW')),
  room_id TEXT NOT NULL,
  occupancy_cycle_id TEXT,
  tenant_id TEXT,
  rental_period_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

INSERT INTO financial_review_cases_v2
  (id, workspace_id, type, room_id, occupancy_cycle_id, tenant_id, rental_period_id, status, note, created_at, resolved_at)
SELECT id, workspace_id, type, room_id, occupancy_cycle_id, tenant_id, rental_period_id, status, note, created_at, resolved_at
FROM financial_review_cases;

DROP TABLE financial_review_cases;

ALTER TABLE financial_review_cases_v2 RENAME TO financial_review_cases;

CREATE INDEX financial_review_cases_open_idx
  ON financial_review_cases(workspace_id, status, created_at);
