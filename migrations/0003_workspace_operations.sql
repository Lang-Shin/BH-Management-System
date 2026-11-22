-- Durable operation lock/audit for destructive test-workspace maintenance.
CREATE TABLE IF NOT EXISTS workspace_operations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  expected_revision INTEGER,
  request_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_operations_one_running_idx
  ON workspace_operations(workspace_id, operation) WHERE status = 'RUNNING';

CREATE TRIGGER IF NOT EXISTS workspace_operations_revision_guard
BEFORE INSERT ON workspace_operations
FOR EACH ROW
WHEN NEW.operation = 'CLEAR_RECORDS'
  AND NEW.expected_revision IS NOT NULL
  AND (SELECT revision FROM workspace_state WHERE workspace_id = NEW.workspace_id) <> NEW.expected_revision
BEGIN
  SELECT RAISE(ABORT, 'workspace revision changed');
END;
