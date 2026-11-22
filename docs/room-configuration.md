# Actual room configuration and legacy-data preservation

Fresh sample initialization uses these explicit string labels and permanent IDs:

| Rental category | Labels | IDs | Initial monthly rate |
| --- | --- | --- | --- |
| Public CR | `1`–`8` | `room-1`–`room-8` | PHP 3,500 |
| Private CR | `01`, `03`, `04`, `05`, `06`, `07` | `room-9`–`room-14` | PHP 4,000 |
| Private CR + Aircon | `02` | `room-15` | PHP 5,000 |

Labels are strings, not identifiers. Room `2` (`room-2`) and room `02` (`room-15`) are distinct. Rates come from the assigned category's effective-dated schedule; neither leading zeros nor room-label arithmetic determines rent. Existing PRIVATE/SHARED values describe room-sharing arrangements, separately from CR/aircon rental categories.

Tenant names, occupancy, bed counts, repair status, meter readings, bills, and payments remain fictional demonstration scenarios. They are not assertions about actual tenants or actual occupancy. Fresh demo tenants are seeded on rooms 1–5, room 6 demonstrates repair status, and the other rooms are vacant. This seed configuration is not a migration mapping from old rooms 101–115.

## Storage version 17

The key remains `bhms:prototype:v1`. Fresh initialization uses the actual room configuration only when no saved snapshot exists. Valid version 7–16 data keeps its room labels, assignments, bills, payments, receipts, and rate history. Version 14 added tenant room-change requests; version 15 added persisted billing-review period flags to those requests; version 16 adds explicit short-stay advance refunds and the seven-day refund window; version 17 adds anniversary rental periods, first-period advance applications, rent prepayments, and financial review cases. Older versions receive an empty request queue and compatible defaults. No historical readings are reclassified or invented. Saving writes a version 17 envelope; subsequent loads are idempotent. See [move-in billing notes](move-in-billing.md), [meter initialization](meter-initialization.md), and [room change requests](room-change-requests.md).

There is no authoritative correspondence between historical fictional rooms 101–115 and actual rooms. Automatic relabeling is deliberately blocked. Saved room IDs, labels, custom rooms, assignments, agreements, issued bills, payment ownership, allocations, receipts, corrections, rate history, meter identities, and readings remain intact. A Rooms notice calls out numbers matching the previous sample layout; it never performs a conversion.

An owner-approved room-to-room correspondence is required before any future historical-data relabeling. “Restore sample records” is an explicit destructive replacement of the saved fictional dataset, protected by the existing confirmation dialog. It is not migration and was not used to prove migration correctness.

## Verification

Configuration and meter tests cover leading-zero labels, stable references, v7-14 input, v15 round trips, and initial-versus-settled history without changing payment records.

Legacy meters retain the stable-ID lookup convention (`room-N` → `meter-room-N`). Newly initialized meters also store the explicit stable `roomId`. Setup is inside the Rooms details dialog, not a separate management page. Archived reports may retain their original 101–115 terminology.
