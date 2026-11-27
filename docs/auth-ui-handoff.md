# Phase 3.2C — authentication UI handoff

## Scope and baseline

- Baseline: `ade5a69`, clean before Phase 3.2C. The owner committed the 3.2C-A work as `bcf1c77` and `ffc8ccb`; the remaining 3.2C-B changes are uncommitted on top of `ffc8ccb`.
- Completed: reusable auth UI, unified sign-in, landlord setup, MFA, recovery, account security, tenant invitations/account status, scoped tenant workspace with room-change requests, session refresh/sign-out, and explicit demo-mode isolation.
- No new migration, paid service, remote resource, privileged credential, or financial-rule change.
- Stop before Phase 3.3. Do not deploy, create cloud resources, commit, or push without owner instruction.

## Completed routes and screens

| Route | Status |
| --- | --- |
| `/sign-in` | Functional email/password sign-in; desktop typewriter intro; role/AAL destination |
| `/accept?token=…` | Landlord setup and tenant invitation acceptance; token removed from URL |
| `/auth/mfa` | TOTP enrollment QR/manual key and AAL1 challenge verification |
| `/forgot-password` | Landlord/operator-assisted recovery guidance |
| `/reset-password?token=…` | Single-use recovery password reset |
| `/account-security` | Email, verification, role, MFA, and session-assurance status |
| `/auth/restricted` | Default-deny fallback for unsupported roles/sessions |
| `/dashboard` | Administrator workspace; OWNER/ADMIN + AAL2 only |
| `/tenant` | Existing tenant UI mounted with filtered, tenant-scoped data |
| `/tenants/…` | Tenant details include account/invitation management for authorized admins |

Sign-in validates required/email format, focuses the first invalid field, supports Enter submit, retains email/clears password after a request, prevents duplicate submission, and never accepts an arbitrary return URL. Destinations come from the server session:

- OWNER/ADMIN + AAL2 → `/dashboard`.
- OWNER/ADMIN + AAL1 or `mfaRequired` → `/auth/mfa`.
- TENANT → `/tenant`.
- Unclassified role or unsupported state → `/auth/restricted`.

Authenticated sessions on public auth pages are redirected through the same helper. `RequireAuth` independently enforces authentication, role, and administrative AAL2.

## Components and design

`src/features/auth/auth-components.tsx` + `auth.css`:

- `AuthLayout`: responsive page, HALILI BH brand, theme toggle, desktop introduction, footer.
- `AuthBranding`, `AuthCard`, `AuthField`, `AuthPasswordField`, `AuthPasswordConfirmation`, `AuthCodeField`, `AuthSubmit`, `AuthMessage`, `AuthProgress`.
- `AuthTypewriter`: desktop-only “A place to call home” type/hold/delete loop; reduced-motion shows the completed phrase.
- Existing app tokens and fonts are reused. Auth light canvas is Oat Milk `#EEE5D4`; structure/button is Forest Green `#1D4A35`; Tomato `#F2462E` is a small accent. Auth styles are scoped to `auth-*`; financial/layout styles are unchanged.
- Mobile uses one card; desktop (768px+) adds the text panel. No external images. The local MFA QR uses `qrcode.react@4.2.0`.

Do not restore a global workspace provider around public auth pages.

## MFA, acceptance, and recovery

- Setup/invitation tokens are validated before rendering the form. Invite tokens are removed from the URL after acceptance and are never logged or persisted.
- Passwords require confirmation and are never stored or prefilled. Tenant acceptance uses the link supplied by the landlord; no public registration. The current link-only invitation does not carry a preassigned email, so the tenant chooses their own account email unless the backend contract changes.
- MFA enrollment displays a locally generated QR and the manual setup key with copy support. Challenge accepts exactly six digits; paste input is filtered and tested.
- Recovery pages use the existing single-use backend flow. Secondary actions sign out or return safely.
- Additional authenticators, trusted-device exemptions, custom MFA backup codes, and unsupported password rules were not added.

## Account management

`src/features/tenants/tenant-account-access.tsx` appears in tenant details for authorized administrators:

- Shows account status, invited/account email, verification, MFA state, access expiry, and pending invitation status/expiry.
- Generate/regenerate/cancel a 24-hour single-use invitation; copy or share the returned link.
- Generate a one-hour single-use recovery link.
- Suspend and reactivate with confirmation; both force reauthentication.
- Shows “no account”, pending invitation, access expired, and reactivate-eligible states.

Invitation/recovery links are sensitive: never log them, send them to analytics, or persist them outside the intended action.

## Provider boundaries

- `src/app/providers/app-providers.tsx`: real authentication is the default. `AuthProvider`, `AppearanceProvider`, `ErrorBoundary`, and `BrowserRouter` wrap public auth pages without workspace bootstrap.
- `src/app/providers/workspace-boundary.tsx`: mounts the administrator API repository only inside the successful OWNER/ADMIN AAL2 guard.
- `src/app/providers/tenant-workspace.tsx`: loads `/tenant/bootstrap` and mounts the existing tenant UI through a scoped `PrototypeProvider`.
- `src/server/tenant-bootstrap.ts`: filters the prototype state for the authenticated tenant, including roommates, payments, receipts, charges/refunds, audit/admin data, and private fields. Never feed administrator `/bootstrap` data into tenant screens.
- `src/app/providers/tenant-demo.tsx`: demo tenant selection uses the authenticated tenant in real auth.
- `src/features/tenant/tenant-room-change-request.tsx`: authenticated tenants can request or cancel an eligible room change through dedicated tenant endpoints. The landlord still reviews approval; a request never transfers the tenant or changes financial records.
- Demo mode retains the existing fixture room-change flow; real-auth mode uses the server-authorized flow and never trusts client room eligibility.

## Session handling

- `AuthProvider` exposes session/status/error, `signIn`, invitation acceptance, MFA completion, refresh, and sign-out.
- Refresh requests are deduplicated. The API repository refreshes once on a 401 and retries; a second 401 emits auth expiry, clears provider state, and routes to sign-in.
- Sign-out only clears local state after the backend accepts it. A failure remains visible instead of silently presenting a signed-out shell.
- Sign-out and auth expiry use navigation replacement so Back does not return to protected UI.

## Real vs demo mode

Real auth is default:

```powershell
# Terminal 1 (after copying .dev.vars.example and filling local values):
npm run dev:worker

# Terminal 2:
npm run dev
```

Open `http://127.0.0.1:5173/sign-in`. Vite proxies `/api` to `127.0.0.1:8787`. Set `AUTH_APP_URL=http://127.0.0.1:5173` in `.dev.vars` for invitation links.

Explicit local-storage demo:

```powershell
npm run dev:demo
```

Open `http://127.0.0.1:5173/`. Demo mode keeps prototype data and switch behavior, does not enable auth or privileged API access, and is not an authentication bypass. `VITE_BHMS_DEMO_MODE=true` is the equivalent development override. Demo mode is disabled in production builds even if that variable is present; demo/switch controls are hidden with real auth.

The previous automatic dashboard behavior came from `AppProviders` enabling auth only when `VITE_BHMS_API_BASE_URL` was set while `npm run dev` lacked it. Auth is now the default; demo requires explicit opt-in.

## Verification completed

- ESLint and TypeScript checks passed.
- Full suite: **92 files / 689 tests passed**, including the 651-test financial baseline and new auth/workspace tests.
- New/focused coverage includes sign-in/typewriter, acceptance/MFA/recovery, account status, wrong-token-page rejection, tenant bootstrap scoping, tenant room-change requests, refresh retry/expiry, workspace switch regressions, and migration/auth Worker integration.
- Frontend production build passed; existing >500 kB chunk warning remains.
- Worker `wrangler deploy --dry-run` passed (512.91 KiB upload, 99.24 KiB gzip).
- Headless Chrome: 12 auth states (8 sign-in responsive/theme states, 2 acceptance, 2 MFA) with 0 page errors; MFA paste filtering passed.
- Tenant room UI: 3 responsive/theme states at 390 light and 1280 dark, including a submitted pending request; 0 page errors, no horizontal overflow/clipped controls, no demo/admin switch controls. Success and pending status contrast reviewed in dark mode.
- Explicit demo mode browser check passed: `/` opened `/dashboard` and showed the tenant switch; real-auth `/` redirected to sign-in with no switch.
- Production preview smoke passed: `/` landed on `/sign-in`, rendered no demo/switch controls, and produced 0 page errors.
- Lightweight visual checks only; no formal accessibility audit is claimed. Browser auth against a hosted Supabase project was not performed.
- Evidence: `%LOCALAPPDATA%\Temp\opencode\bhms-auth-ui-evidence\`, `%LOCALAPPDATA%\Temp\opencode\bhms-auth-integration-evidence\`, and `%LOCALAPPDATA%\Temp\opencode\bhms-tenant-room-evidence\`.

## Remaining work / risks

- Actual hosted integrated login, invitation, MFA, recovery, tenant scoping, and main-Worker CPU verification remain Phase 3.3.
- Account-access and tenant room-change mutations are covered with mocked clients/local Worker tests; they still need hosted smoke testing.
- Provider Free limits remain accepted risks (project pausing, short audit retention, no managed auth backups). D1 backups remain mandatory.
- The separate P1 notification defect remains: `selectNotifications()` omits anniversary `rentObligations`, so current due/overdue anniversary rent can be missing from the admin bell. Do not fold this into auth work.
- No commit, push, deployment, paid service, or remote resource was created.
