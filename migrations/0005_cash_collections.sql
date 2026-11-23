-- Append-only itemized cash transactions alongside the validated compatibility snapshot.
CREATE TABLE cash_collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  payment_id TEXT NOT NULL UNIQUE,
  receipt_id TEXT NOT NULL UNIQUE,
  receipt_number TEXT NOT NULL,
  room_id TEXT NOT NULL,
  collected_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  items_json TEXT NOT NULL CHECK (json_valid(items_json)),
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, receipt_number)
) STRICT;
CREATE TABLE cash_collection_allocations (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES cash_collections(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  target_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('RENT', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE')),
  original_period_id TEXT NOT NULL,
  original_period_label TEXT NOT NULL,
  original_due_date TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  UNIQUE (workspace_id, target_id)
) STRICT;
CREATE INDEX cash_collections_workspace_date_idx ON cash_collections(workspace_id, collected_on);
