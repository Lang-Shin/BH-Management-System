# Phase 1A foundation notes

## Initial repository inspection

Before implementation, the working directory was `C:\Users\User\Documents\Github\BH-Management-System`.

- Git repository: yes; working tree clean; latest commit `fd1bcce` (`Initial commit`).
- Existing files: `.git/` and a two-line `README.md` describing the project vision.
- No application, `package.json`, lockfile, TypeScript/Vite configuration, source directories, CSS configuration, installed project dependencies, or scripts existed.
- No applicable `AGENTS.md` was found.
- Environment: Windows, PowerShell, Node 24.19.0, npm 11.17.0.

The application was initialized directly in the repository. The original README introduction was preserved and expanded. No pre-existing application or unrelated files were replaced.

## Architecture decisions

### Keep state small and explicit

`PrototypeAppState` contains tenants, rooms, dated assignments, meters/readings/rates, billing periods, category charges, payments, explicit allocations, tenant credits, receipt snapshots, and audit events. The existing internal `PrototypeData` payload name aliases this state. Monetary values use integer centavos, date-only values use ISO strings, and status/method fields use literal unions. There is no `any` in application code. See [domain foundation notes](domain-foundation.md) for relationships and confirmed billing requirements.

Context with `useReducer` is sufficient for a 30-tenant demonstration. State-changing actions are limited to tenant notes, empty-room maintenance, and reset. Search terms, filters, dialog selections, and navigation state are ephemeral component state rather than persisted domain data.

`domain/calculations/summary.ts` derives dated occupied/available/under-repair room counts, category balances/statuses, credit remaining, and collection totals from shared records. One or more current tenants make a room occupied regardless of bed count. Date-sensitive calculations take an explicit ISO reporting date. Charges billed for a period, payments allocated to those charges, and cash received during that period’s dates remain distinct measures, presented in plain English. No financial transition actions exist. An occupied room cannot be set to maintenance; the reducer enforces this even if a future UI dispatches an invalid action.

### Feature ownership and dependency direction

- `features/<module>/` owns that module’s pages and local UI state. Add module-specific components beside the page as they grow; shared primitives stay in `components/`.
- `app/router/` owns route composition and navigation metadata. The sidebar and header read the same destination labels.
- `app/state/` owns the action union, context, and reducer. `hooks/use-prototype.ts` provides typed state access.
- `app/providers/` composes dependencies and handles the repository lifecycle.
- `domain/` owns models, pure business calculations, and runtime validation. It has no React, application-state, or fixture dependencies.
- `data/fixtures/` owns fictional records. `data/repositories/` owns persistence.
- `styles/globals.css` owns shared light-theme tokens, base typography, focus indicators, and reduced-motion support.

Feature pages depend on the state hook and domain functions; the provider depends on a repository interface. ESLint prevents domain imports from UI/application/data layers and prevents feature pages from importing repositories. No empty feature subdirectories or placeholder service layers were added.

### Treat localStorage as untrusted input

`data/repositories/local-storage-repository.ts` owns browser storage access and the storage key. `data/repositories/prototype-storage.ts` owns the schema version and a pure, non-throwing snapshot parser. It delegates runtime validation to `domain/validation/prototype-data.ts`, which checks field shapes, literal values, dates, unique IDs, references, assignment overlap, occupied-room repair restrictions, and payment totals. Bed counts are informational and are no longer a tenant-count restriction. The adapter validates before writing as well as on load, preserving the last saved value when a proposed state is invalid. The single type assertion follows explicit field validation; no unchecked JSON is exposed to components.

Invalid data falls back to fixtures without automatically overwriting the original saved value. Reset explicitly permits replacing it. Both reads and writes catch storage exceptions. This is prototype persistence, not a production data store. The expanded model uses schema version 2 under the retained `bhms:prototype:v1` key. Version 1 and other incompatible envelopes show the recovery message and are not automatically migrated or overwritten.

`PrototypeRepository` exposes asynchronous `load()` and `save(data)` methods. Loading returns a typed snapshot, optional warning, and permission to persist; saving returns an optional warning. The localStorage adapter implements this interface now. The provider shows a loading state while awaiting hydration, handles rejected loads with a recoverable error screen, and serializes saves so older snapshots cannot finish after newer ones. Failed saves preserve the in-memory session and display a warning. Cleanup guards prevent stale promise results from updating an unmounted provider. React Strict Mode remains enabled. No artificial loading delays or mock network calls are used.

The repository instance is selected in `app/providers/app-providers.tsx` and remains stable for the provider’s lifetime. A future API-backed implementation can be injected there without changing feature pages or domain functions. That adapter will still require deliberate server validation, authorization, and concurrency rules; the snapshot interface establishes a frontend seam rather than implementing a production API.

### Reusable layout, bounded module scope

`AdminShell` owns navigation, header, storage warning, and the main content outlet. The six small modules are eagerly imported to avoid first-navigation loading flashes. A pathname-keyed content wrapper enters with a 360ms ease-out fade, 14px rise, 0.98 scale, and 2px blur, while the header page title slides in separately; the sidebar, header, main landmark, and shared provider stay mounted. Reduced motion disables both animations. Unknown paths render a useful return-to-dashboard action. The root rendering error boundary handles unexpected rendering errors with a reload action.

Shared page, table, empty, loading, error, status-badge, and statistic components establish patterns for later modules. Tables have captions, header scopes, focusable scrolling regions, and contained horizontal overflow. The navigation drawer and dialogs use shadcn/Radix keyboard handling and focus management. Route changes update the document title and move focus to main content. `lib/format.ts` centralizes PHP formatting and UTC date-only formatting; `domain/validation/date.ts` is shared by formatting and stored-data validation. Invalid dates are labeled instead of silently normalized, and fractional/non-finite/unsafe centavo inputs are rejected by currency formatting.

The current branding is **Halili BH**, with **BHMS** under the name beside the logo. TASK 1A.1 uses self-hosted Nunito with 15px primary text, 14px supporting text, and 13px small labels, plus regular buttons and navigation links at least 48px high. The 240px desktop sidebar scrolls on shorter viewports and becomes an accessible drawer below 1024px. The owner-selected 60–30–10 palette uses Oat Milk (`#EEE5D4`) backgrounds, lighter oat containers, a Forest Green (`#1D4A35`) sidebar and headings, and Tomato Red (`#F2462E`) action accents. Tables have muted headers, separators, hover feedback, and optional right-aligned numeric columns. On phones, rows become stacked, labeled records without duplicating controls; wider tablet tables scroll within their own region. Every status includes text. Advanced details and unfinished tools are collapsed, and sample reset is in Reports & Settings instead of the header.

Tailwind 4 uses its Vite plugin and CSS-first theme. There is no Tailwind 3 configuration. shadcn/ui components are generated local source, with `cn` imports pointing to the project's own `lib/utils.ts`. Root and app TypeScript aliases match Vite and `components.json` so future component additions resolve under `src/`.

### Intentional demonstration assumptions

- Six destinations are Dashboard (titled Overview), Tenants, Rooms, Billing, Payments & Receipts, and Reports & Settings. All route URLs remain stable. Receipt generation is future scope; a labeled sample preview uses existing receipt data. Settings show read-only defaults rather than introducing configuration workflows.
- Property branding: Halili BH. The demonstration tenant and financial records remain fictional; display currency: PHP.
- Fixed sample date: November 13, 2026, keeping overdue/upcoming examples deterministic.
- There are 10 fictional tenants (9 active and 1 moved out), 6 rooms, 2 sample billing periods, 23 category charges, and 10 sample payments. Room totals initially show 4 occupied, 1 available, and 1 under repair. Bed counts do not affect these totals.
- Rent agreements are PHP 3,500 for active sample assignments and PHP 3,000 for the moved-out historical assignment. These are agreed sample amounts, not a permanent monthly/per-bed policy.
- November charges total PHP 33,086.00, with PHP 16,300.00 allocated and PHP 16,786.00 outstanding. November cash received is PHP 20,044.00, including prior-period collections and an unapplied PHP 500.00 advance.
- Water charges and the optional washing machine charge are manual examples. Electricity readings and effective-dated rates are historical fixtures; no meter ownership or shared-room allocation policy has been implemented.
- No collection ratio or financial total is fabricated independently of the shared records.

These assumptions should be confirmed with the landlord before designing complete workflows.

## Verification

Completed on the implementation environment:

- `npm run build`: passed, including strict TypeScript compilation and production bundling.
- `npm run lint`: passed with zero warnings.
- The TASK 1A test run passed 67 tests; the landlord-focused UI revision adds whole-room occupancy and simplified-navigation coverage. Latest results are recorded in [landlord UI notes](landlord-ui.md).
- `npm audit --omit=dev`: zero runtime dependency vulnerabilities at implementation time.
- Full dependency audit reported 10 moderate development-tooling advisories related to transitive `minimatch` versions in ESLint/typescript-eslint. No forced major-version updates or unverified overrides were applied. Recheck these when updating tooling.
- Headless Chromium smoke test at widths **320, 390, 768, 1366, and 1920 pixels**: all six routes rendered with no page-level horizontal overflow. Mobile/tablet drawer navigation passed.
- Real-browser tenant-note save/reload and room-status updates reflected across routes; no uncaught browser errors were observed. Desktop and mobile screenshots were inspected.
- Short-height desktop sidebar scrolling, 44px mobile navigation targets, active-route indicators, and Escape-key drawer dismissal passed browser checks.
- Automated axe WCAG A/AA scans found no violations on all six routes at 320px and 1366px. This is an automated check, not a claim of complete accessibility conformance.

The browser smoke test and axe scans used temporary Playwright tooling outside the repository; the repeatable committed test suite uses Vitest/React Testing Library. Real device and screen-reader acceptance testing remains appropriate before a client demonstration or deployment.

Final required command outcomes, the investigated lazy-route test timeout, exact dependency versions, and the owner-review gate are recorded in the [TASK 1A report](task-1a-report.md). All six routes were also exercised through navigation and refreshed in Chromium against the production build served locally by Vite preview. No deployment was performed.

## Continue from this foundation

1. Demonstrate navigation, room occupancy, tenant notes, and reset.
2. Gather feedback on module priorities, room/bed assignments, currency, rent schedules, utility allocation, and receipt requirements.
3. Confirm scope and compensation before expanding the prototype into production workflows.
4. Add approved features under `features/<module>/`, using typed reducer actions and pure domain calculations. Add meaningful tests for the new business rules.
5. When a production backend is approved, implement `PrototypeRepository` with an API adapter and inject it through `app/providers/app-providers.tsx`. Deliberately design authentication, authorization, validation, and server-side transaction rules.

For a future static deployment using BrowserRouter, configure the host to serve `index.html` for application paths such as `/tenants`. Vite's local dev and preview servers already support these deep links.
