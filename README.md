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
| `/dashboard` | Dashboard (titled Overview): simple money totals, bill payments, recent payments, upcoming bills, and room counts |
| `/tenants` | Search, fictional profiles, assignment history, tenant/account statuses, demo notes |
| `/rooms` | Occupied, available, and under-repair rooms; current tenants; bed counts for information only |
| `/billing` | Billing: choose a month, see who has paid, check due dates, and view electricity details |
| `/payments` | Read-only payment allocations, partial-payment examples, advance credit, sample receipt snapshots |
| `/reports` | Sample monthly collection reports, billing policies, audit log, export/backup/recovery placeholders |

- Fixed desktop sidebar and accessible mobile/tablet navigation drawer.
- Responsive cards and horizontally scrollable data tables.
- Top header, active-route links, document titles, keyboard focus styles, skip link, dialogs, and status announcements.
- Eagerly loaded admin modules avoid route-loading flashes; route content enters with a 200ms fade and 8px rise while the shell stays mounted. Reduced-motion users receive no route animation. Shared loading/empty/error UI and the unknown-route fallback remain available.
- **Restore sample records** is under **Reports & Settings → More settings and sample records**. It requires confirmation and replaces only the sample dataset.
- Branding: **Halili BH**, with **BHMS** below the logo text. The interface self-hosts the variable **Nunito** font for consistent rendering on every device, with system fallbacks. No authentication is implemented.
- Oat Milk (`#EEE5D4`), Forest Green (`#1D4A35`), and Tomato Red (`#F2462E`) follow a 60–30–10 visual hierarchy: warm surfaces, forest sidebar/headings, and tomato action accents. Compact typography, comfortable controls, and stacked phone records are retained. See the [landlord UI notes](docs/landlord-ui.md) and [TASK 1A.1 redesign report](docs/task-1a-1-report.md).

### Demo data and persistence

The app is branded **Halili BH**. Its demonstration records are fictional: **10 tenants** (9 active, 1 moved out), **6 rooms**, 2 sample billing periods, 23 category charges, 10 payments, explicit allocations, an advance credit, and sample receipt references. Emails use `example.com`; phone strings are deliberately non-dialable demo numbers, and addresses use fictional Demo City locations. The snapshot is **November 13, 2026**, and amounts use **PHP with two decimal places**.

Occupancy is **room-based, not bed-based**. The sample starts with **4 occupied / 6 rooms**, **1 available**, and **1 under repair**. A room rented by one person is occupied even if it has three beds. Only an empty room that is not under repair is available. Bed counts are reference information and do not limit rental records or determine availability. Changing an empty room’s repair status updates the shared room totals without removing history. Notes are limited to 500 characters.

State is shared through React Context and `useReducer`, and persisted in `localStorage` under the existing key **`bhms:prototype:v1`**, now with **schema version 2** in its envelope. The key is retained so older snapshots are detected rather than silently abandoned. Version 1 snapshots are preserved and show a recovery message; use **Restore sample records** in Reports & Settings to explicitly replace them. A reusable snapshot parser rejects malformed JSON, unsupported versions, and invalid records. Runtime validation checks shapes, references, currency precision, occupancy, charge/payment allocation limits, credits, receipts, and correction links. Validation also runs before saving: invalid state cannot replace the last valid saved snapshot. Storage failures preserve the current in-memory session and show a warning.

**November sample totals:** PHP 33,086.00 billed, PHP 16,300.00 explicitly applied to those charges, and PHP 16,786.00 outstanding. PHP 20,044.00 was received during November, including PHP 3,244.00 against October charges and PHP 500.00 in unapplied advance credit. These are distinct measures derived from the same shared records.

The confirmed electricity example is represented as **300 → 312 kWh × PHP 13.00 = PHP 156.00**. Issued charges preserve their readings and applied rate. Billing-cycle policy, meter ownership, shared-room allocation, and fractional-consumption rounding remain unconfirmed. Unimplemented workflows are static, explicitly labeled placeholders rather than fake action buttons. See [domain foundation notes](docs/domain-foundation.md).

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

See [foundation notes](docs/foundation.md) for architecture, [landlord UI notes](docs/landlord-ui.md) for the latest wording and room rules, and the archived [TASK 1A final report](docs/task-1a-report.md) for the earlier milestone’s dependency inventory and verification record.
