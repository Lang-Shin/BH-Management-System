# Authentication backend

BHMS uses Supabase Auth as the authentication provider and Cloudflare D1 as the authoritative business and authorization database. The browser talks only to the same-origin Cloudflare Worker. No Supabase privileged key is sent to the browser.

## Worker configuration

Set these as Worker secrets (never in `VITE_*` variables):

| Name | Purpose |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Server-only Supabase secret key |
| `AUTH_OPERATOR_TOKEN` | 32+ random bytes for one-off landlord setup/recovery |
| `COOKIE_ENCRYPTION_KEY` | 32+ random bytes for encrypted session cookies |
| `INVITE_TOKEN_PEPPER` | 32+ random bytes for invitation digests |
| `AUDIT_PEPPER` | 32+ random bytes for hashed audit IPs |

Optional:

- `AUTH_APP_URL` — exact frontend origin used in invitation links.
- `AUTH_COOKIE_SECURE=false` — local HTTP only; production always forces Secure `__Host-` cookies.
- `BHMS_DEV_TOKEN` — local development only, never production.

Supabase settings should remain: email/password enabled, public signup disabled, anonymous sign-in disabled, TOTP enabled, asymmetric ES256 signing, refresh rotation enabled, IP Address Forwarding enabled.

## First landlord setup

There is no default password and no permanent developer account.

1. Ensure the Worker is configured with the secrets above.
2. Create a single-use setup link with the operator token. Do not log the token or the returned URL.

```powershell
$headers = @{
  'x-bhms-operator' = $env:AUTH_OPERATOR_TOKEN
  'content-type' = 'application/json'
}
$setup = Invoke-RestMethod -Method Post `
  -Uri "$env:BHMS_API_URL/api/v1/auth/operator/setup-invitation" `
  -Headers $headers -Body '{}'
$setup.setupUrl
```

3. Open the link at `/accept?token=...`, choose the landlord email and password, then enroll TOTP. Administrative routes stay unavailable until AAL2.
4. The setup endpoint and invitation stop working after the single owner exists.

## Tenant accounts

Landlord-session endpoints:

- `POST /api/v1/auth/tenants/:tenantId/invitation` — create/reissue a 24-hour single-use invite.
- `DELETE /api/v1/auth/invitations/:invitationId` — cancel a pending invite.
- `GET /api/v1/auth/accounts` — account status and tenant association.
- `POST /api/v1/auth/accounts/:userId/suspend` — disable access and ban Supabase sign-in.
- `POST /api/v1/auth/accounts/:userId/reactivate` — restore access; forces fresh login.
- `POST /api/v1/auth/accounts/:userId/recovery` — one-hour single-use tenant recovery link.

The tenant chooses their own email and password. Their D1 email is stored as unverified. Invitation tokens are stored only as HMAC digests.

## Recovery

Tenant recovery is landlord-assisted. Landlord recovery is operator-assisted:

```powershell
$headers = @{
  'x-bhms-operator' = $env:AUTH_OPERATOR_TOKEN
  'content-type' = 'application/json'
}
$recovery = Invoke-RestMethod -Method Post `
  -Uri "$env:BHMS_API_URL/api/v1/auth/operator/landlord-recovery" `
  -Headers $headers -Body '{}'
$recovery.recoveryUrl
```

Recovery deletes and recreates the Supabase identity, which invalidates old refresh tokens and MFA factors. D1 preserves the stable BHMS user, tenant, and financial associations. The landlord must re-enroll TOTP. Old access tokens are rejected immediately through the D1 session invalidation cutoff.

## Backups and availability

- D1 remains the authoritative business database. Use D1 Time Travel plus a manual export weekly and before major updates.
- Encrypt exported files and store them off the primary account.
- Test restoration into a disposable D1 database before relying on a backup.
- Preserve the existing financial export feature.
- Supabase Free auth backups are not available. If Supabase auth identities are lost, recreate each identity with the same stable BHMS mapping; users must reset passwords and the landlord must re-enroll TOTP.
- If the Supabase project pauses, authentication requests return a distinct unavailable error. Restore it from the Supabase Dashboard; do not enable a demo bypass or keep-alive traffic.
- Essential application security events are stored in `security_audit_events`. Provider logs remain subject to Supabase Free retention.

## Frontend integration contract

- `src/features/auth/auth-api.ts` contains the typed fetch client and CSRF handling.
- `src/app/providers/auth.tsx` contains the session provider.
- `src/features/auth/require-auth.tsx` contains role/MFA gate foundations.
- Administrator bootstrap remains `GET /api/v1/bootstrap`; tenant bootstrap is `GET /api/v1/tenant/bootstrap`.

The polished sign-in, MFA, invitation, and recovery screens are Phase 3.2C work. Until those screens are wired, unauthenticated clients receive 401/403 from the API and cannot read workspace data.
