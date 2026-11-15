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
| `/billing` | Billing: choose a month; category cells show unpaid amounts for Rent/Water/Washing, Forest Green PAID dot badges, NOT PAID for Electricity, or NO BILL; the room-level Status retains its styled Paid/PARTLY PAID/NOT PAID indicators; check due dates and view electricity details |
| `/payments` | Room-first individual payment transactions with payer/allocation details, individual advance credit, sample receipt snapshots and receipt-detail dialogs |
| `/reports` | Monthly totals, reconciled room reports and room-summary CSV, billing policies, audit log, backup/recovery placeholders |

- Fixed desktop sidebar and accessible mobile/tablet navigation drawer.
- Light iOS-inspired details: frosted header/dialog surfaces, luminous rounded inner cards with layered shadows, softer controls, button press feedback, and segmented room filters. Solid surface fallbacks support reduced transparency.
- Responsive cards and horizontally scrollable data tables.
- Dashboard analytics include a room-occupancy doughnut and a bill-status stacked bar, with counts and percentage legends from the current summary data. Charts animate on each Dashboard visit and respect reduced motion.
- Billing includes a room-status doughnut matching the table’s PAID, PARTLY PAID, and NOT PAID counts for the selected month and unpaid filter. It draws smoothly from zero over 1.2 seconds with no start delay when revealed, replays on month/filter changes, and respects reduced motion. It counts rooms rather than amounts or individual charges.
- Numeric totals, balances, counts, percentages, and electricity quantities outside tables count up from zero over 1.2 seconds across all six pages. Table values show their final numbers immediately. Animated values start when revealed (including expanded details) and on page revisits or value changes. Formatting, final accessible text, and printed values remain exact; reduced motion shows final values immediately.
- A header notification bell summarizes the current sample records: bills past due, bills due within seven days of the fixed sample date, rooms under repair, and held advance credit. Items link to the related page, unread state is saved separately under `bhms:notifications:v1`, and restoring sample records clears it. These are informational sample alerts; no push or email reminders are sent.
- Top header, active-route links, document titles, keyboard focus styles, skip link, dialogs, and status announcements.
- Eagerly loaded admin modules avoid route-loading flashes; route content enters with a smooth 360ms fade, 14px rise, subtle scale and blur while the header title slides in and the shell stays mounted. Reduced-motion users receive no route animation. Shared loading/empty/error UI and the unknown-route fallback remain available.
- **Restore sample records** is under **Reports & Settings → More settings and sample records**. It requires confirmation and replaces only the sample dataset.
- Branding: **Halili BH**, with **BHMS** below the logo text. The interface self-hosts the variable **Nunito** font for consistent rendering on every device, with system fallbacks. Tomato-red containers use dark espresso **Lilita One** labels, also self-hosted. No authentication is implemented.
- Oat Milk (`#EEE5D4`), Forest Green (`#1D4A35`), and Tomato Red (`#F2462E`) follow a 60–30–10 visual hierarchy: warm surfaces, forest sidebar/headings, and tomato action accents. Compact typography, comfortable controls, and stacked phone records are retained. See the [landlord UI notes](docs/landlord-ui.md) and [TASK 1A.1 redesign report](docs/task-1a-1-report.md).

### Demo data and persistence

Financial summaries group distinct charges by their historical room context; they do not create shared charges or imply joint tenant liability. Rent uses its recorded assignment. Utilities use the billed period’s single room context; ambiguous or missing historical attribution appears as **Room needs review** and stays in totals. Expand charge/payment details to see original tenants, payers, periods and IDs. Multi-room payments stay single transactions with allocation breakdowns, and unallocated money is not applied bill income. Reports and the room CSV use the same room-finance selector. See [TASK 1A.4 findings and verification](docs/task-1a-4-report.md).

The app is branded **Halili BH**. Its demonstration records are fictional: **10 tenants** (9 active, 1 moved out), **6 rooms**, 2 sample billing periods, 33 category charges, 13 payments, explicit allocations, an advance credit, and 13 sample receipt references. Emails use `example.com`; phone strings are deliberately non-dialable demo numbers, and addresses use fictional Demo City locations. The snapshot is **November 13, 2026**, and amounts use **PHP with two decimal places**.

**Room-rent mock scenario:** Room 101 has two tenants sharing a PHP 3,500 room rent (PHP 1,750 each). Room 101 has unpaid October and November rent but has paid its October/November water, electricity, and optional washing charges. Room 102 has one tenant paying PHP 3,500; November rent and both October and November water remain unpaid. Room 103 and Room 104 each have three tenants at the existing per-tenant sample rent. Room 103 demonstrates a due-date group where water, electricity, and optional washing are already paid while rent remains unpaid; its Dashboard **Show Bill** dialog therefore lists only Rent as pending.

Occupancy is **room-based, not bed-based**. The sample starts with **4 occupied / 6 rooms**, **1 available**, and **1 under repair**. Room 101 has two beds and two tenants; Room 102 has one tenant; Rooms 103 and 104 have three tenants each. A room rented by one person is occupied even if it has unused beds. Only an empty room that is not under repair is available. Bed counts are reference information and do not limit rental records or determine availability. Changing an empty room’s repair status updates the shared room totals without removing history. Notes are limited to 500 characters.

State is shared through React Context and `useReducer`, and persisted in `localStorage` under the existing key **`bhms:prototype:v1`**, now with **schema version 2** in its envelope. The key is retained so older snapshots are detected rather than silently abandoned. Version 1 snapshots are preserved and show a recovery message; use **Restore sample records** in Reports & Settings to explicitly replace them. A reusable snapshot parser rejects malformed JSON, unsupported versions, and invalid records. Runtime validation checks shapes, references, currency precision, occupancy, charge/payment allocation limits, credits, receipts, and correction links. Validation also runs before saving: invalid state cannot replace the last valid saved snapshot. Storage failures preserve the current in-memory session and show a warning.

**November sample totals:** PHP 29,822.00 billed, PHP 8,222.00 explicitly applied to those charges, and PHP 21,600.00 outstanding. PHP 15,990.00 was received during November, including PHP 7,268.00 against October charges and PHP 500.00 in unapplied advance credit. October sample billed/applied/outstanding is PHP 10,918.00 / PHP 7,268.00 / PHP 3,650.00. These are distinct measures derived from the same shared records.

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
