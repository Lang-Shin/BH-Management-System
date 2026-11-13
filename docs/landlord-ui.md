# Halili BH · Simple landlord interface

## Goal

Make day-to-day information easy to read and understand for a landlord with little experience using software. Use respectful, plain English, a quiet light theme, larger text, and direct actions. Keep Halili BH branding and the rounded **Nunito** variable font, self-hosted through `@fontsource-variable/nunito` so every device renders the same typeface. System rounded/sans fonts remain the fallback if the font asset fails.

## Everyday screens

- Navigation uses **Dashboard**, **Tenants**, **Rooms**, **Billing**, **Payments & Receipts**, and **Reports & Settings**. The Dashboard page is titled **Overview**. Existing route URLs are unchanged.
- TASK 1A.1 uses a compact 15px body, 14px supporting text, and 13px small labels. Regular buttons and navigation links are at least 48px high. The owner-selected palette uses 60% Oat Milk (`#EEE5D4`), 30% Forest Green (`#1D4A35`), and 10% Tomato Red (`#F2462E`) as a visual hierarchy, rather than exact pixel quotas: warm backgrounds and lightly tinted containers, forest navigation/headings, and tomato action accents. Owner approval of the denser typography remains pending.
- The header has a visible **Menu** button on phones. The sample reset tool and demo administrator avatar are removed from the daily header.
- Phone tables become stacked, labeled records, so a tenant’s details can be read without swiping sideways. There is one semantic table and one set of controls rather than duplicated desktop/mobile forms.
- Less-used details, electricity history, receipt lists, and future tools are collapsed behind descriptive labels.
- Unfinished tools still say **Coming later** and have no fake action buttons.
- The displayed financial records remain samples; the real property name is not described as fictional.

## Plain-language labels

| Former wording | Current wording |
| --- | --- |
| Applied to November charges | Already paid |
| November outstanding | Still to pay |
| Issued charges | Total bills / Rent and bills |
| Cash received in November | Money received |
| Explicit allocations | What was paid |
| Unapplied tenant credit | Advance payments / Money kept for a future bill |
| Billing status matrix | Who has paid? |
| Not applicable | No bill |
| Partially paid | Partly paid |
| Admin audit log | Record of changes |
| Reset demo | Restore sample records |

Amounts have not changed. “Already paid” is money used to pay bills for the chosen month. “Money received” includes payments for older bills and advance payments, so the totals can differ. The Dashboard includes a short expandable explanation rather than hiding this distinction.

## Whole-room occupancy

`roomOccupancy()` and `selectRoomSummary()` are the common source for the Dashboard, Rooms, and room filters.

- **Occupied:** at least one tenant currently rents the room.
- **Available:** no current tenant and the room is not under repair.
- **Under repair:** an empty room temporarily unavailable for rental.
- The three counts add up to the total rooms.
- An occupied three-bed room with one tenant is not an available room.
- Bed counts are room information only. They neither determine availability nor impose an assumed headcount/payment rule.
- Past assignments are retained and stop affecting the current count after their end date.
- Financial charge amounts, rent agreements, allocations, and billing rules are not recalculated by this change.

The current sample reads **4 occupied / 6 rooms · 1 available · 1 under repair**. A test also covers the requested example of **6 occupied / 10 rooms · 4 available**. No assumed real Halili BH room inventory was added.

## Restoring sample records

Open **Reports & Settings → More settings and sample records → Restore sample records**. The confirmation explains that saved notes and room changes will be replaced. **Keep my changes** cancels; **Yes, restore records** confirms. Recovery messages link to settings and automatically open this section when saved sample data cannot be read.

The storage key and version-2 record shape are unchanged. No migration or automatic reset is performed. localStorage is still only prototype persistence, not secure financial storage or backup.

## Verification

Focused automated checks cover room counts, one tenant in a three-bed room, bed-count changes not affecting availability, the six-of-ten-room example, occupied-room exclusion from the Available filter, simple labels, navigation, note persistence, and safe restore in settings. Existing financial consistency tests continue to run.

Browser checks exercise all six routes at 320, 390, 768, 1366, and 1920px; phone records have no internal sideways overflow. They also cover persisted room changes, phone note editing, month selection, electricity details, restore cancellation/confirmation, and mobile menu dismissal. Automated axe scans run on all six pages at 320px and 1366px. Representative desktop/mobile screenshots are inspected separately from build success.

Owner/landlord visual acceptance remains pending; these checks do not substitute for feedback from the person who will use the application.

Historical checks for the earlier landlord-focused revision (current redesign verification is in [TASK 1A.1](task-1a-1-report.md)):

- `npm run build`: passed, including strict TypeScript compilation.
- `npm run lint`: passed with zero warnings.
- `npm test`: 72 tests passed across six files.
- `git diff --check`: passed with no whitespace errors (Git reported normal LF/CRLF notices).
- Chromium checks passed against both the development server and the final production build served locally with Vite preview.
- All six routes were checked at five widths, including refresh, active navigation, and the larger menu controls. No page-level or phone-record horizontal overflow was observed.
- Sample notes and room repair changes survived refresh; restore cancellation and confirmation worked from settings; unrelated browser storage was preserved.
- Automated WCAG A/AA scans found no violations on the six pages at 320px and 1366px. No console/runtime errors were observed. Representative desktop/mobile screenshots were inspected.
