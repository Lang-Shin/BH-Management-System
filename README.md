# BH-Management-System
A web-based Boarding House Management System for managing tenants, rooms, monthly billing, rent and utility payments, digital receipts, and financial reports.

## Phase 1 · Interactive admin prototype foundation

This repository currently implements a **frontend-only demonstration**, intended to support a conversation with a prospective client. The description above is the long-term project vision. Billing, payments, and reports currently show read-only sample records; complete transaction workflows are future work.

### Run locally

Use Node.js **22.22.2+ within Node 22, 24.15+ within Node 24, or 26+** and npm. Node 24 LTS is recommended; development was verified with Node 24.19.0 / npm 11.17.0. The minimum accounts for the installed test tooling as well as Vite.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally **http://127.0.0.1:5173**). The root URL redirects to `/dashboard`. Keep the same host and port to reuse saved demo changes, since browser storage is origin-specific.

```sh
npm run typecheck   # Strict TypeScript checks
npm run lint        # ESLint, including React hooks rules
npm test            # Vitest + React Testing Library
npm run test:watch  # Interactive test runner
npm run build      # Type checks and optimized Vite build
npm run preview    # Serve the built application locally
```

### What you can demonstrate

| Route | Foundation capability |
| --- | --- |
| `/dashboard` | Linked property overview, occupancy, and sample balances |
| `/tenants` | Search by name/email/room, open a profile, save a demo note |
| `/rooms` | Filter rooms, view occupancy, toggle maintenance on empty rooms |
| `/billing` | Read-only sample invoices with an outstanding-only filter |
| `/payments` | Payments & Receipts: sample register, method totals, and receipt scope |
| `/reports` | Reports & Settings: derived summaries and read-only demo defaults |

- Fixed desktop sidebar and accessible mobile/tablet navigation drawer.
- Responsive cards and horizontally scrollable data tables.
- Top header, active-route links, document titles, keyboard focus styles, skip link, dialogs, and status announcements.
- Lazy-loaded modules with a shared loading skeleton, reusable empty/error UI, rendering error boundary, and unknown-route fallback.
- Header **Reset demo** action restores the fictional dataset after confirmation.
- Application identity: **Boarding House Management System (BHMS)**. The demo administrator is a display label with no authentication.

### Demo data and persistence

**Maple House**, its 22 tenants, 10 three-bed rooms, 22 invoices, and 18 payments are fictional. Emails use `example.com`. The sample snapshot is **November 13, 2026**, and sample amounts use **PHP**. These are demonstration assumptions, not confirmed client requirements.

Initially, one empty room is under maintenance: 30 total beds, 27 usable beds, 22 occupied, and 5 available. Changing an empty room’s status updates occupancy across modules. Notes are limited to 500 characters. Occupied rooms cannot be placed under maintenance.

State is shared through React Context and `useReducer`, and persisted in `localStorage` under **`bhms:prototype:v1`**, with a versioned envelope and runtime validation. Saved notes and room changes survive reloads. Reset replaces only this app’s saved demo state. Unreadable, malformed, or unsupported saved data produces a visible warning and fresh in-memory fixtures; the saved value is preserved until an explicit reset. Storage write failures keep the current session usable and show a warning.

Use fictional information only. This is a single-browser, single-workspace prototype. There is no backend, authentication, multi-user synchronization, production database, payment integration, receipt generation, or accounting engine. Multiple open tabs use their own in-memory state and the last successful storage write wins.

### Technology and organization

- React 19, TypeScript 6 (strict mode), Vite 8.
- Tailwind CSS 4 through `@tailwindcss/vite`; CSS-first theme in `src/styles/globals.css`.
- shadcn/ui New York components, using Radix primitives, committed as local source.
- React Router 7, Lucide React, Context + reducer.
- Vitest 5, React Testing Library, ESLint.

Exact resolved versions are recorded in `package-lock.json`. Use `npm ci` for reproducible installs. Tailwind 4 does not require a legacy Tailwind configuration or PostCSS setup. shadcn aliases and style are recorded in `components.json`.

```text
src/
  app/
    App.tsx             # Providers and route composition
    providers/          # Repository injection, async load/save lifecycle
    router/             # Routes, navigation metadata, unknown-route fallback
    state/              # Context, action union, reducer
  components/
    layout/             # Responsive admin shell, sidebar, header
    shared/             # Page headers, stats, tables, badges, UI states
    ui/                 # Local shadcn/ui components
  features/
    dashboard/          # Dashboard module
    tenants/            # Tenant directory and demo profile dialog
    rooms/              # Room occupancy and maintenance interactions
    billing/            # Sample billing preview
    payments/           # Payments & Receipts preview
    reports/            # Reports & Settings preview
  domain/
    types/              # Strict domain models
    calculations/       # Pure balances, occupancy, and summary calculations
    validation/         # Runtime data validation and relationship rules
  data/
    fixtures/           # Fictional fixture factory and fixed demo date
    repositories/       # Async repository contract and localStorage adapter
  hooks/                # Typed application-state access hook
  lib/                  # Formatting and class-name utilities
  styles/               # Tailwind imports, theme tokens, base styles
  test/                 # Test setup and cross-layer integration tests
  main.tsx              # React root and Strict Mode
```

Feature pages use `usePrototype()` and domain calculations; they do not access repositories or browser storage. The asynchronous repository is injected in `src/app/providers/app-providers.tsx`, providing a single replacement point for a future API adapter. Domain code is independent of React and fixtures; import-boundary rules are checked by ESLint.

See [foundation notes](docs/foundation.md) for the repository inspection, architecture decisions, verification results, and suggested next steps.
