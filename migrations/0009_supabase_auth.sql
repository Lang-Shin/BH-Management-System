-- Supabase authentication mapping. Existing financial records and tenant IDs are untouched.
ALTER TABLE users ADD COLUMN auth_user_id TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN session_invalid_after TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_uq ON users(auth_user_id) WHERE auth_user_id IS NOT NULL;

ALTER TABLE tenant_account_links ADD COLUMN access_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_memberships_one_owner_idx
  ON workspace_memberships(workspace_id) WHERE role = 'OWNER';

CREATE TABLE IF NOT EXISTS auth_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('LANDLORD_SETUP', 'TENANT', 'TENANT_RECOVERY', 'LANDLORD_RECOVERY')),
  tenant_id TEXT,
  target_user_id TEXT,
  token_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'PROVISIONING', 'CONSUMED', 'CANCELLED', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  consumed_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  auth_user_id TEXT,
  bhms_user_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_error TEXT,
  CHECK (
    (kind = 'LANDLORD_SETUP' AND tenant_id IS NULL AND target_user_id IS NULL AND auth_user_id IS NOT NULL AND bhms_user_id IS NOT NULL)
    OR (kind = 'TENANT' AND tenant_id IS NOT NULL AND target_user_id IS NULL AND auth_user_id IS NOT NULL AND bhms_user_id IS NOT NULL)
    OR (kind = 'TENANT_RECOVERY' AND tenant_id IS NOT NULL AND target_user_id IS NOT NULL)
    OR (kind = 'LANDLORD_RECOVERY' AND tenant_id IS NULL AND target_user_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS auth_invitations_state_idx ON auth_invitations(workspace_id, state, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS auth_invitations_one_pending_setup_idx
  ON auth_invitations(workspace_id) WHERE kind = 'LANDLORD_SETUP' AND state IN ('PENDING', 'PROVISIONING');
CREATE UNIQUE INDEX IF NOT EXISTS auth_invitations_one_pending_tenant_idx
  ON auth_invitations(workspace_id, tenant_id) WHERE kind = 'TENANT' AND state IN ('PENDING', 'PROVISIONING');
CREATE UNIQUE INDEX IF NOT EXISTS auth_invitations_one_pending_recovery_idx
  ON auth_invitations(target_user_id) WHERE kind IN ('TENANT_RECOVERY', 'LANDLORD_RECOVERY') AND state IN ('PENDING', 'PROVISIONING');

CREATE TABLE IF NOT EXISTS security_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('OPERATOR', 'OWNER', 'TENANT', 'SYSTEM')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  ip_hash TEXT,
  request_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS security_audit_events_workspace_idx
  ON security_audit_events(workspace_id, created_at DESC);

-- The Supabase identity is created before the D1 mapping. This trigger makes the final D1
-- batch conditional: a mapped auth user can only be inserted while its invitation is claimed.
CREATE TRIGGER IF NOT EXISTS auth_invitation_consumed_on_user_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.auth_user_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'auth_invitation_not_claimed')
  WHERE NOT EXISTS (
    SELECT 1 FROM auth_invitations
    WHERE auth_user_id = NEW.auth_user_id
      AND bhms_user_id = NEW.id
      AND state = 'PROVISIONING'
  );

  UPDATE auth_invitations
  SET state = 'CONSUMED',
      consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE auth_user_id = NEW.auth_user_id
    AND bhms_user_id = NEW.id
    AND state = 'PROVISIONING';
END;


