-- Allow multiple collections against the same obligation while preventing duplicate targets
-- within one collection. This supports partial rent payments and later prepayment balances.
CREATE TABLE cash_collection_allocations_v2 (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES cash_collections(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  target_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('RENT', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE')),
  original_period_id TEXT NOT NULL,
  original_period_label TEXT NOT NULL,
  original_due_date TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  UNIQUE (workspace_id, collection_id, target_id)
) STRICT;

INSERT INTO cash_collection_allocations_v2
  (id, collection_id, workspace_id, target_id, category, original_period_id, original_period_label, original_due_date, amount_cents)
SELECT id, collection_id, workspace_id, target_id, category, original_period_id, original_period_label, original_due_date, amount_cents
FROM cash_collection_allocations;

DROP TABLE cash_collection_allocations;

ALTER TABLE cash_collection_allocations_v2 RENAME TO cash_collection_allocations;

CREATE INDEX cash_collection_allocations_target_idx
  ON cash_collection_allocations(workspace_id, target_id);
