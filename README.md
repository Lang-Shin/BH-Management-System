# BH-Management-System
A web-based Boarding House Management System for managing tenants, rooms, monthly billing, rent and utility payments, digital receipts, and financial reports.

## Phase 1 · Interactive admin prototype foundation

### Actual room numbering

Fresh demo data now uses **Public CR: rooms `1`–`8` (₱3,500/month)**, **Private CR: `01`, `03`, `04`, `05`, `06`, `07` (₱4,000/month)**, and **Private CR + Aircon: `02` (₱5,000/month)**. Room `2` and room `02` have distinct permanent IDs. Rates still use effective-dated categories. Tenant/financial examples remain fictional.

The storage envelope is now **version 17**. Valid saved version 7–16 datasets are retained without relabeling rooms or rewriting transactions. Version 13 added protected initial meter readings; versions 14–16 add tenant room-change requests, landlord decisions, billing-review flags, tenant status timelines, reservations, and explicit short-stay advance refunds; version 17 adds anniversary rental periods, first-period advance applications, prepayments, and financial review cases. Existing readings and financial records are kept as recorded. Automatic conversion from 101–115 requires an owner-approved correspondence. An explicit sample-record restore replaces the dataset rather than migrating it. See [room configuration](docs/room-configuration.md), [move-in billing](docs/move-in-billing.md), [meter initialization](docs/meter-initialization.md), and [room change requests](docs/room-change-requests.md).

Phase 1 remains a **localStorage demonstration**. Phase 2 adds an optional **Cloudflare Workers + D1 server-authoritative adapter**, anniversary rent, first-period advance settlement, and multi-period rent prepayment foundations. The production build uses the API adapter; local demo mode remains available when `VITE_BHMS_API_BASE_URL` is unset. Production authentication, full legacy-ledger normalization, tenant self-service, and deployment are not complete.

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
| `/tenants` | Search, persisted add/edit/delete, safe room transfers, move-out/archive, profiles, assignment history, tenant/account statuses, and demo notes |
| `/rooms` | Occupied, available, and under-repair rooms; monthly rental-rate categories and clickable cards; occupancy filters; Room Details with tenants, beds, washing-machine subscription, meter summary, Save Changes, and Cancel |
| `/billing` | Billing: choose a month; category cells show unpaid amounts for Rent/Water/Washing, Forest Green PAID dot badges, NOT YET PAID for Electricity, AWAITING READING when the current meter reading is missing, NO BILL for other missing categories, or DID NOT AVAIL when a room skipped optional washing; the room-level Status retains its styled Paid/PARTLY PAID/NOT YET PAID indicators; **Calculate payment** records a new room payment; **Billing Rates** provides prospective rent, electricity, water, and washing rate editing with review and history |
| `/payments` | Transaction workspace with Transactions and Correction History tabs, room/receipt search, billing-month/date and status filters, pagination, See Transaction details, authorized Edit Payment corrections, advance credit, sample receipt snapshots, and receipt-detail dialogs; no payment creation |
| `/reports` | Monthly totals, a five-column room report with all-period pending-payment dialogs and room-summary CSV, billing policies, audit log, backup/recovery placeholders |

- Fixed desktop sidebar and accessible mobile/tablet navigation drawer.
- Light iOS-inspired details: frosted header/dialog surfaces, luminous rounded inner cards with layered shadows, softer controls, button press feedback, and segmented room filters. Solid surface fallbacks support reduced transparency.
- Responsive cards and horizontally scrollable data tables.
- Dashboard analytics include a room-occupancy doughnut and a bill-status stacked bar, with counts and percentage legends from the current summary data. Charts animate on each Dashboard visit and respect reduced motion.
- Billing includes a room-status doughnut matching the table’s PAID, PARTLY PAID, and NOT YET PAID counts for the selected month. It draws smoothly from zero over 1.2 seconds with no start delay when revealed, replays when the month changes, and respects reduced motion. It counts rooms rather than amounts or individual charges.
- Billing has a **Filters** menu between the chart and room table, aligned above the table’s right edge. It offers SHOW ALL, PAID, PARTLY PAID, and NOT YET PAID with matching icons. The filtered table animates on change, SHOW ALL clears the filter, and changing the month resets it.
- Rooms cards are keyboard-accessible buttons. Add Room creates a persisted room with a supported rate, bed count, type, and status; Add and Edit omit the floor control. Room Details shows rate, occupancy, tenants, beds, washing-machine subscription, and read-only meter history, and provides Edit Room and a confirmed Delete Room action. Edit keeps stable room IDs and does not rewrite tenant assignments or historical bills. Delete is blocked when assignments, bills, payments, receipts, meter history, credits, or outstanding balances remain. Washing changes save only after confirmation and affect future applicable periods; issued bills and payments remain historical. Meter corrections are intentionally unavailable outside Billing’s authorized workflow. The Room Details dialog has a hidden scrollbar while retaining scrolling.
- Dashboard and Reports & Settings Pending Payments dialogs are view-only. Billing is the only payment-entry page; the shared dialog never renders or invokes a payment callback outside that authorized calculator.
- The Billing calculator targets the selected billing period, disables already-paid categories, and never charges rent more than once per room. A room with bills owned by different tenants records the confirmed total as one payment and receipt per payer so the existing tenant-owned financial model remains traceable.
- **Billing Rates** appears below the Billing tables as four iOS-inspired cards for rent categories, electricity, water, and washing. Each opens an edit-and-review workflow for the next billing period. Rent keeps stable room-category IDs and actual room counts; electricity, water, and washing preserve their existing units. Rate changes are prospective, scheduled changes do not replace the active rate early, and historical bills, receipts, payments, and settled meter readings keep their original snapshots.
- Payments & Receipts now provides the transaction workspace: **Transactions** and **Correction History** tabs, room/receipt search, billing-month/date and status filters, pagination, and rows-per-page control. The table uses Receipt Number, Room, Date Paid, Amount Paid, Status, and Transaction columns without a separate table action. **See Transaction** opens the shared details dialog; eligible transactions expose **Edit Payment** there. **Edit Payment** is limited to categories already present in the selected transaction, requires a reason, supports electricity-reading correction at the historical applied rate, and completes in one review. A refund requires the landlord to confirm the money was returned; an additional payment requires confirmation that the money was received; an incorrect recorded amount can be corrected without inventing a refund; equal totals need no settlement confirmation. Saving voids the original payment, reverses its allocations, supersedes the original receipt, creates a revised receipt with a new number, and appends audit events. Simple edits are blocked when a later settled meter interval depends on the reading. Billing retains only payment calculation and billing controls; Dashboard and Reports remain read-only.
- Dashboard’s **See All Transactions** opens a read-only Transaction History dialog backed by the same payment records. Selecting a transaction reuses the shared Transaction Details dialog; individual recent-payment rows use it directly.
- The Payments workspace keeps allocation breakdowns out of the wide table. Each row’s **See Transaction** button opens the shared dialog with room, date, amount, status, receipt, payer, actual allocated categories, electricity interval details, unallocated advances, and any correction summary. Payment Method is intentionally hidden from this dialog while remaining in the underlying records. Dashboard uses the same read-only details dialog. Correction History lists revised receipts, rooms, correction dates, original/corrected amounts, completed settlement status, and access to correction details. Older saved pending statuses are preserved and clearly marked as legacy rather than silently converted. Dialogs fade and rise on open, animate closed, restore focus, support Escape, and respect reduced motion.
- Reports’ **Room financial summary** shows Room, Total billed, Total paid, Pending payment, and Payment status. Totals and status describe the selected report month, while **View Details** opens the shared Pending Payments dialog across all unpaid billing periods. A room shows **NONE** only when every applicable bill across all periods is settled and no electricity is awaiting a reading; unresolved electricity keeps **View Details** available and appears as **Amount pending calculation** without a fabricated peso balance. The room CSV includes an unresolved-electricity count plus its financial and charge-ID columns.
- Numeric totals, balances, counts, percentages, and electricity quantities outside tables count up from zero over 1.2 seconds across all six pages. Table values show their final numbers immediately. Animated values start when revealed (including expanded details) and on page revisits or value changes. Formatting, final accessible text, and printed values remain exact; reduced motion shows final values immediately.
- A header notification bell summarizes the current sample records: bills past due, bills due within seven days of the fixed sample date, rooms under repair, and held advance credit. Items link to the related page, unread state is saved separately under `bhms:notifications:v1`, and restoring sample records clears it. These are informational sample alerts; no push or email reminders are sent.
- Top header, active-route links, document titles, keyboard focus styles, skip link, dialogs, and status announcements.
- Eagerly loaded admin modules avoid route-loading flashes; route content enters with a smooth 360ms fade, 14px rise, subtle scale and blur while the header title slides in and the shell stays mounted. Reduced-motion users receive no route animation. Shared loading/empty/error UI and the unknown-route fallback remain available.
- **Restore sample records** is under **Reports & Settings → More settings and sample records**. It requires confirmation and replaces only the sample dataset.
- Branding: **Halili BH**, with **BHMS** below the logo text. The interface self-hosts the variable **Nunito** font for consistent rendering on every device, with system fallbacks. Tomato-red containers use dark espresso **Lilita One** labels, also self-hosted. No authentication is implemented.
- Oat Milk (`#EEE5D4`), Forest Green (`#1D4A35`), and Tomato Red (`#F2462E`) follow a 60–30–10 visual hierarchy: warm surfaces, forest sidebar/headings, and tomato action accents. Compact typography, comfortable controls, and stacked phone records are retained. See the [landlord UI notes](docs/landlord-ui.md) and [TASK 1A.1 redesign report](docs/task-1a-1-report.md).

### Demo data and persistence

Financial summaries group distinct charges by their historical room context; they do not create shared charges or imply joint tenant liability. Rent uses its recorded assignment. Utilities use the billed period’s single room context; ambiguous or missing historical attribution appears as **Room needs review** and stays in totals. Expand charge/payment details to see original tenants, payers, periods and IDs. Multi-room payments stay single transactions with allocation breakdowns, and unallocated money is not applied bill income. Reports and the room CSV use the same room-finance selector. See [TASK 1A.4 findings and verification](docs/task-1a-4-report.md).

The app is branded **Halili BH**. Its demonstration records are fictional: **10 tenants** (7 active, 3 moved out), **15 rooms**, 2 sample billing periods, **35 finalized category charges**, **10 meter readings**, **2 cumulative electricity obligations awaiting readings**, 14 payments, explicit allocations, an advance credit, and 14 sample receipt references. Rooms use rental-rate categories: **8 at ₱3,500**, **6 at ₱4,000**, and **1 at ₱5,000**. Emails use `example.com`; phone strings are deliberately non-dialable demo numbers, and addresses use fictional Demo City locations. The snapshot is **November 13, 2026**, and amounts use **PHP with two decimal places**.

**Rate mock scenario:** Rooms are categorized only by their monthly rental rate: **RATE_3500** (8 rooms at ₱3,500), **RATE_4000** (6 rooms at ₱4,000), and **RATE_5000** (1 room at ₱5,000). Rent is charged once per occupied room per billing period from that room’s rate, not once per tenant, and every rent bill is all-or-nothing. Issued charges and assignment agreements retain their historical rate snapshots. Rooms hold at most two active tenants. Water is PHP 100 per tenant and washing is an optional PHP 100 per room. Electricity is cumulative: the landlord enters the current room-meter reading only when the tenant pays, and the bill covers everything since the previous settled reading at PHP 13.00/kWh. Room 101 demonstrates normal monthly settlement: 300 → 312 kWh (₱156), then 312 → 325 kWh (₱169), both paid. Room 102 has all known November rent, water, and washing settled but electricity still awaits a reading. Room 103 is fully settled for November. Room 104 skipped October electricity; its last settled reading is 300 kWh, so paying November electricity with 325 kWh bills the full 25 kWh once (₱325) with no fabricated October charge. Room 105 is vacant now but retains two moved-out occupants and a fully settled October bill.

Occupancy is **room-based, not bed-based**, with a **maximum of two active tenants per room**. The sample starts with **4 occupied / 15 rooms**, **10 available**, and **1 under repair**: Room 101 has one tenant; Rooms 102, 103, and 104 have two each; Room 105 is vacant; Room 106 is under repair; Rooms 107–115 are vacant. A room rented by one person is occupied even if it has unused capacity. Only an empty room that is not under repair is available. Bed counts are reference information and do not limit rental records or determine availability. Changing an empty room’s repair status updates the shared room totals without removing history. Notes are limited to 500 characters.

State is shared through React Context and `useReducer`, and persisted in `localStorage` under the existing key **`bhms:prototype:v1`**, now with **schema version 17** in its envelope. Supported older snapshots are migrated deterministically, preserving saved rooms, tenants, bills, payments, receipts, readings, and corrections. Older schema-version snapshots are preserved and show a recovery message; use **Restore sample records** in Reports & Settings to explicitly replace them. Fixture updates do not silently change an already-saved browser snapshot, so the same explicit restore is required to preview revised mock rates and occupancy. A reusable snapshot parser rejects malformed JSON, unsupported versions, and invalid records. Runtime validation checks shapes, references, currency precision, occupancy, charge/payment allocation limits, credits, receipts, and correction links. Validation also runs before saving: invalid state cannot replace the last valid saved snapshot. Storage failures preserve the current in-memory session and show a warning.

**November sample totals:** PHP 15,225.00 billed, PHP 11,525.00 explicitly applied to those charges, and PHP 3,700.00 known outstanding, plus **2 electricity obligations awaiting readings**. PHP 20,111.00 was received during November, including PHP 8,086.00 against October charges and PHP 500.00 in unapplied advance credit. October finalized bills are PHP 19,142.00 billed / PHP 8,086.00 applied / PHP 11,056.00 known outstanding. These are distinct measures derived from the same shared records; uncalculated electricity is excluded from billed and outstanding money.

The mock electricity rate is **PHP 13.00/kWh** across the sample rate history. Each occupied room has its own fictional meter and readings, so the confirmed Room 101 examples are **300 → 312 kWh × PHP 13.00 = PHP 156.00** and **312 → 325 kWh × PHP 13.00 = PHP 169.00**. Issued charges preserve their readings and applied rate. Rooms 102 and 104 have no current electricity reading, so no charge or peso balance is invented; Billing and Pending Payments show **AWAITING READING** / **Amount pending calculation**. The landlord can enter the current reading in Billing or Pending Payments, preview the cumulative amount, cancel without saving, or explicitly confirm the payment. Confirmation atomically adds the reading, charge, payment, allocation, and receipt in the prototype snapshot, advances the settled baseline, and prevents the same meter interval from being billed twice. A Billing correction can replace an incorrect reading, but only before a later settled interval depends on it. Corrections retain the original voided records, add a revised receipt, and record the reason, money handling, and audit trail rather than rewriting history. Billing-cycle policy, meter ownership, shared-room allocation, fractional-consumption rounding, and production-level concurrency guarantees remain unconfirmed. See [domain foundation notes](docs/domain-foundation.md).

Use fictional information only. The localStorage demo remains single-browser and single-workspace. The optional Worker/D1 adapter is server-authoritative but still lacks production tenant authentication, multi-user UI, payment integration, and a complete accounting engine. Multiple tabs in local demo mode use their own in-memory state and the last successful storage write wins.

### Phase 2 backend foundation

The optional backend lives in `src/worker` and `src/server`, with D1 migrations in `migrations/`.

```sh
npm run db:migrate:local   # apply versioned migrations to local D1
npm run dev:worker         # Worker + D1 + built assets on 127.0.0.1:8787
npm run dev:server         # Vite with /api proxied to the local Worker
```

The production build uses `/api/v1` through `.env.production`. Local `npm run dev` continues to use the localStorage demonstration unless an API base URL is configured.

- `GET /health` is the unauthenticated liveness endpoint. Financial routes live under `/api/v1` and require Cloudflare Access outside loopback development.
- `GET /api/v1/bootstrap` returns the authoritative workspace state and revision.
- `POST /api/v1/commands` accepts the typed action union with an `Idempotency-Key`.
- `POST /api/v1/rent/quote` and `POST /api/v1/rent/prepayments` implement current-rate-locked multi-period prepayment.
- `GET /api/v1/rent/periods?cycleId=` exposes anniversary periods and rent obligations.
- `POST /api/v1/imports/dry-run` validates a localStorage snapshot without changing the workspace. `/api/v1/admin/imports/apply` stays locked unless `ALLOW_IMPORT_APPLY=true` and an explicit confirmation is supplied.
- Wrangler uses `workers_dev: false` and does not configure a public deployment. Configure `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` before any non-local use. `BHMS_DEV_TOKEN` is only for non-loopback development and is refused in production.
- Existing demo/localStorage records are never rewritten automatically. Legacy cycles remain calendar-based until the room becomes vacant; paid legacy advances are surfaced for owner review.
- The Worker stores the versioned workspace snapshot as the compatibility read model and mirrors Phase 2 occupancy, rent, advance-application, prepayment, deposit-holding, and review records into normalized D1 tables in the same batch. Full normalization of legacy utility/payment tables remains Phase 2 follow-up work.

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
