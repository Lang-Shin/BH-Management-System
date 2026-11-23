-- Reject a stale batch before any state, receipt, allocation, or projection write is performed.
DROP TRIGGER IF EXISTS workspace_operations_revision_guard;
CREATE TRIGGER workspace_operations_revision_guard
BEFORE INSERT ON workspace_operations
FOR EACH ROW
WHEN NEW.expected_revision IS NOT NULL
  AND COALESCE((SELECT revision FROM workspace_state WHERE workspace_id = NEW.workspace_id), -1) <> NEW.expected_revision
BEGIN
  SELECT RAISE(ABORT, 'workspace revision changed');
END;
