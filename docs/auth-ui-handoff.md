# Phase 3.2C-A — authentication UI handoff

## Scope and baseline

- Baseline: `ade5a69`, clean before this task (owner committed Phase 3.2B).
- Completed: reusable design foundation, unified functional sign-in, safe route boundaries.
- Stop here: remaining pages and full regression belong to DeepSeek Phase 3.2C-B.
- No backend/migration/financial changes, remote resources, or privileged credentials used.

## Components and design

`src/features/auth/auth-components.tsx` + `auth.css`:

- `AuthLayout`: responsive page, HALILI BH brand, theme toggle, desktop introduction, footer.
- `AuthBranding`: existing Luckiest Guy brand font and Lucide Building2.
- `AuthCard`: heading/description/content/footer. Use one card per page (`auth-title` heading ID).
- `AuthField`: labelled Input, hint/error association, ref support; use `type="email"` for email.
- `AuthPasswordField`: show/hide button, current-password by default.
- `AuthPasswordConfirmation`: new-password autocomplete; caller validates matching values.
- `AuthCodeField`: text input with numeric keyboard, six-digit pattern, one-time-code autocomplete. Caller controls value/validation.
- `AuthSubmit`: submit/loading/disabled action with stable minimum height; use existing Button `variant="outline"` for secondary actions.
- `AuthMessage`: error alert or success status.
- `AuthProgress`: ordered steps with `aria-current="step"`; current index is zero-based.

Use existing app tokens (`--label`, `--label-2`, input/border/focus/status variables) and font assets. Auth light canvas is Oat Milk `#EEE5D4`; structure/button is Forest Green `#1D4A35`; Tomato `#F2462E` is a small accent. Dark surfaces follow the existing `.dark` AppearanceProvider. Auth styles are scoped to `auth-*`; do not change financial/layout styles. Mobile uses one card; desktop (768px+) adds the simple text panel. No external images or new dependencies.

```tsx
<AuthLayout>
  <AuthCard title="Choose your password" description="Complete your invitation.">
    <form className="auth-form" onSubmit={submit}>
      <AuthField label="Email address" type="email" autoComplete="username" required />
      <AuthPasswordField label="New password" autoComplete="new-password" required />
      <AuthPasswordConfirmation required />
      <AuthCodeField hint="Enter the six-digit authenticator code." />
      {error && <AuthMessage>{error}</AuthMessage>}
      <AuthSubmit pending={pending}>Continue</AuthSubmit>
    </form>
  </AuthCard>
</AuthLayout>
```

## Sign-in implementation

`src/features/auth/sign-in-page.tsx` at `/sign-in` uses the existing `AuthProvider.signIn(email,password)` → Worker BFF API. Required/email-format validation, Enter submit, first-invalid-field focus, password visibility, live errors, email retention, password clearing after requests, loading and a synchronous duplicate-submit lock are implemented. No public registration, role choice, social login, remember-me, or password persistence.

`auth-destination.ts` uses server-returned role/AAL, not form input:

- OWNER/ADMIN + AAL2 → `/dashboard`.
- OWNER/ADMIN + AAL1 or `mfaRequired` → `/auth/mfa` (restricted placeholder).
- TENANT → `/tenant` (restricted placeholder until scoped adapter is wired).
- Unclassified role → `/auth/restricted`.

No arbitrary return URL is accepted. Authenticated sessions on sign-in redirect via this helper. `RequireAuth` now sends unauthenticated users to sign-in and checks AAL2 independently of `mfaRequired`.

## Important provider boundary

Phase 3.2B mounted `PrototypeProvider` around every page; a failed admin bootstrap prevented sign-in from rendering. This is fixed:

- `app-providers.tsx` keeps AuthProvider, AppearanceProvider and BrowserRouter around public auth pages.
- Development local-storage mode retains its existing PrototypeProvider.
- In server mode, `app/providers/workspace-boundary.tsx` mounts the administrator API repository only **inside** the successful administrator RequireAuth guard.
- Tenant server routes intentionally render a restricted auth page instead of mounting the administrator snapshot provider.
- Existing tests/local demo with no enabled AuthProvider retain their existing provider behavior.

Do not restore the global workspace provider or feed administrator bootstrap data into tenant screens.

## Existing API contracts (reuse; do not rebuild)

`src/features/auth/auth-api.ts` already provides `signIn`, `getAuthSession`, `refreshAuthSession`, `signOut`, `acceptInvitation`, `recoverAccount`, `enrollMfa`, `challengeMfa`, `verifyMfa`, `getTenantBootstrap`, account/invitation management. `AuthSession` carries role, AAL, tenantId, mfaRequired, csrfToken. Tokens remain in HttpOnly cookies; existing client handles CSRF. Privileged Supabase credentials never belong in frontend code.

`app/providers/auth.tsx` already offers session/status/error, signIn/signOut/refresh and setSession. Sign-in uses it without changing provider contracts. Logout/backend behavior was not rebuilt.

## Pending routes/pages — secure placeholders only

`auth-pending-page.tsx` provides generic messages and sign-out/back navigation, not completed flows:

| Route | Work for 3.2C-B |
| --- | --- |
| `/auth/mfa` | Actual enrollment QR/secret presentation, challenge and verify; only release admin guard after verified AAL2 session |
| `/accept?token=…` | Landlord setup / tenant invitation registration and password confirmation |
| `/forgot-password` | Currently functional contact-landlord/operator instructions; build recovery UX as appropriate |
| `/reset-password?token=…` | Single-use recovery form |
| `/tenant` | Replace server-only placeholder with the scoped tenant data adapter/provider |
| `/auth/restricted` | Default-deny unsupported roles; retain restriction |

Also pending: account-management UI, role-aware post-sign-out navigation refinements, session-expiry/refresh orchestration, complete tenant bootstrap typing (current interface omits extra financial projection fields), and production browser verification. Existing tenant pages still use prototype selectors; never reconnect them through full `/bootstrap` for tenant users.

Additional authenticators are optional. No trusted-device exemptions, custom MFA backup codes or unsupported password rules were added. Invitation/recovery tokens must not be logged, persisted casually, or copied into analytics.

## Verification completed

- Focused tests: **3 files / 21 passed** (11 new sign-in/foundation tests, 3 existing auth API tests, 7 workspace-switch regression tests).
- ESLint and TypeScript checks passed.
- Frontend production build passed; existing >500kB chunk warning remains.
- Lightweight headless Chrome: 320/390/768/1280 × light/dark = **8 states**; no horizontal overflow/clipped controls, 48px inputs, contained visibility buttons, no page errors. Browser also exercised required errors, password toggle, Enter submit, email retention/password clearing, and forgot-password navigation.
- Theme/contrast visually reviewed using existing text-safe tokens; no formal accessibility audit claimed. Focus rings inherit existing controls; keyboard/error-focus behavior is tested.
- Browser authentication was **mocked** (401); successful routing is covered by mocked API/provider tests. No actual hosted auth test performed.
- Evidence: `%LOCALAPPDATA%\Temp\opencode\bhms-auth-ui-evidence\` (eight screenshots, error screenshot, `results.json`). Browser/server processes were closed by a bounded supervisor.
- Full 661-test regression suite intentionally not run in this task. DeepSeek must run it after the remaining functionality.

## Continue efficiently

1. Read these files and backend `docs/authentication.md`; preserve completed sign-in and styles.
2. Implement pending forms with these primitives and existing APIs. Keep public auth pages independent of workspace loading.
3. Wire server-authoritative AAL2 and tenant-scoped data; do not use demo persona storage as identity.
4. Add focused tests for new flows; then run full regression, builds, and comprehensive responsive/browser security checks in 3.2C-B.
5. Integrated hosted Worker CPU verification is still a pre-production requirement. Do not create remote resources without owner authorization.
