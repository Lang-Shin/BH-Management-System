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

`PrototypeData` contains rooms, tenants, invoices, and payments. Monetary values use integer centavos, date-only values use ISO strings, and status/method fields use literal unions. There is no `any` in application code.

Context with `useReducer` is sufficient for a 30-tenant demonstration. State-changing actions are limited to tenant notes, empty-room maintenance, and reset. Search terms, filters, dialog selections, and navigation state are ephemeral component state rather than persisted domain data.

`domain/calculations/summary.ts` derives usable capacity, occupancy, invoice balances, and collection totals from shared records. Date-sensitive calculations take an explicit ISO reporting date, keeping domain logic independent of demo fixtures and the system clock. Avoid storing duplicated totals or maintaining an unrelated set of dashboard figures. An occupied room cannot be set to maintenance; the reducer enforces this even if a future UI dispatches an invalid action.

### Feature ownership and dependency direction

- `features/<module>/` owns that module’s pages and local UI state. Add module-specific components beside the page as they grow; shared primitives stay in `components/`.
- `app/router/` owns lazy route composition and navigation metadata. The sidebar and header read the same destination labels.
- `app/state/` owns the action union, context, and reducer. `hooks/use-prototype.ts` provides typed state access.
- `app/providers/` composes dependencies and handles the repository lifecycle.
- `domain/` owns models, pure business calculations, and runtime validation. It has no React, application-state, or fixture dependencies.
- `data/fixtures/` owns fictional records. `data/repositories/` owns persistence.
- `styles/globals.css` owns shared light-theme tokens, base typography, focus indicators, and reduced-motion support.

Feature pages depend on the state hook and domain functions; the provider depends on a repository interface. ESLint prevents domain imports from UI/application/data layers and prevents feature pages from importing repositories. No empty feature subdirectories or placeholder service layers were added.

### Treat localStorage as untrusted input

`data/repositories/local-storage-repository.ts` owns storage access, the storage key, and version envelope. It delegates runtime validation to `domain/validation/prototype-data.ts`, which checks field shapes, literal values, dates, unique IDs, references, room capacity, and payment totals before restoring a saved snapshot. The single type assertion follows explicit field validation; no unchecked JSON is exposed to components.

Invalid data falls back to fixtures without automatically overwriting the original saved value. Reset explicitly permits replacing it. Both reads and writes catch storage exceptions. This is prototype persistence, not a production data store. Version 1 does not migrate other versions; incompatible versions show the recovery message.

`PrototypeRepository` exposes asynchronous `load()` and `save(data)` methods. Loading returns a typed snapshot, optional warning, and permission to persist; saving returns an optional warning. The localStorage adapter implements this interface now. The provider shows a loading state while awaiting hydration, handles rejected loads with a recoverable error screen, and serializes saves so older snapshots cannot finish after newer ones. Failed saves preserve the in-memory session and display a warning. Cleanup guards prevent stale promise results from updating an unmounted provider. React Strict Mode remains enabled. No artificial loading delays or mock network calls are used.

The repository instance is selected in `app/providers/app-providers.tsx` and remains stable for the provider’s lifetime. A future API-backed implementation can be injected there without changing feature pages or domain functions. That adapter will still require deliberate server validation, authorization, and concurrency rules; the snapshot interface establishes a frontend seam rather than implementing a production API.

### Reusable layout, bounded module scope

`AdminShell` owns navigation, header, demo notice, storage warning, and the main content outlet. The six modules are lazy loaded; a Suspense boundary inside the shell shows the shared loading state while preserving navigation. Unknown paths render a useful return-home action. The root rendering error boundary handles unexpected rendering and lazy-import failures with a reload action.

Shared page, table, empty, loading, error, status-badge, and statistic components establish patterns for later modules. Tables have captions, header scopes, focusable scrolling regions, and contained horizontal overflow. The navigation drawer and dialogs use shadcn/Radix keyboard handling and focus management. Route changes update the document title and move focus to main content.

The application uses its full name, **Boarding House Management System**, alongside **BHMS**. The demo administrator label explicitly describes a display-only identity. Primary navigation, regular buttons, and dialog/drawer close controls provide 44px touch targets. Supporting text uses a minimum 12px size, with 14px text for primary reading content. The desktop sidebar scrolls on shorter viewports, and long header destinations truncate within the available mobile space. The palette is neutral with one restrained green accent; status colors communicate state. No charts, gradients, or decorative illustrations were introduced.

Tailwind 4 uses its Vite plugin and CSS-first theme. There is no Tailwind 3 configuration. shadcn/ui components are generated local source, with `cn` imports pointing to the project's own `lib/utils.ts`. Root and app TypeScript aliases match Vite and `components.json` so future component additions resolve under `src/`.

### Intentional demonstration assumptions

- Six destinations are Dashboard, Tenants, Rooms, Billing, Payments & Receipts, and Reports & Settings. Existing `/payments` and `/reports` URLs remain stable. Receipt generation is described as future scope; settings show read-only demo defaults rather than introducing configuration workflows.
- Fictional property name: Maple House; display currency: PHP.
- Fixed sample date: November 13, 2026, keeping overdue/upcoming examples deterministic.
- Each bed has a sample monthly rent of PHP 3,500, and invoices contain a sample PHP 450 utility amount. No utility-allocation policy has been implemented.
- Sample totals: PHP 86,900 billed, PHP 71,100 collected, and PHP 15,800 outstanding. Two invoices are overdue; two are upcoming.
- “Collection rate” means sample amount collected divided by sample amount billed. It is not profit or a financial statement.

These assumptions should be confirmed with the landlord before designing complete workflows.

## Verification

Completed on the implementation environment:

- `npm run build`: passed, including strict TypeScript compilation and production bundling.
- `npm run lint`: passed with zero warnings.
- `npm test`: **17 tests passed** across three suites, covering state/persistence, application navigation, reporting-date rules, asynchronous repository injection, serialized saves, and load/save failure handling.
- `npm audit --omit=dev`: zero runtime dependency vulnerabilities at implementation time.
- Full dependency audit reported 10 moderate development-tooling advisories related to transitive `minimatch` versions in ESLint/typescript-eslint. No forced major-version updates or unverified overrides were applied. Recheck these when updating tooling.
- Headless Chromium smoke test at widths **320, 390, 768, 1366, and 1920 pixels**: all six routes rendered with no page-level horizontal overflow. Mobile/tablet drawer navigation passed.
- Real-browser tenant-note save/reload and room-status updates reflected across routes; no uncaught browser errors were observed. Desktop and mobile screenshots were inspected.
- Short-height desktop sidebar scrolling, 44px mobile navigation targets, active-route indicators, and Escape-key drawer dismissal passed browser checks.
- Automated axe WCAG A/AA scans found no violations on all six routes at 320px and 1366px. This is an automated check, not a claim of complete accessibility conformance.

The browser smoke test and axe scans used temporary Playwright tooling outside the repository; the repeatable committed test suite uses Vitest/React Testing Library. Real device and screen-reader acceptance testing remains appropriate before a client demonstration or deployment.

## Continue from this foundation

1. Demonstrate navigation, room occupancy, tenant notes, and reset.
2. Gather feedback on module priorities, room/bed assignments, currency, rent schedules, utility allocation, and receipt requirements.
3. Confirm scope and compensation before expanding the prototype into production workflows.
4. Add approved features under `features/<module>/`, using typed reducer actions and pure domain calculations. Add meaningful tests for the new business rules.
5. When a production backend is approved, implement `PrototypeRepository` with an API adapter and inject it through `app/providers/app-providers.tsx`. Deliberately design authentication, authorization, validation, and server-side transaction rules.

For a future static deployment using BrowserRouter, configure the host to serve `index.html` for application paths such as `/tenants`. Vite's local dev and preview servers already support these deep links.
