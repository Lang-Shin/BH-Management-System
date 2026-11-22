# Initial electricity readings

Use **Rooms → Room details → Electricity meter → Initial meter reading setup**. Each dialog starts locked. Activate/Deactivate only changes that room's temporary UI state; it does not control electricity billing and is not stored in the financial snapshot.

## Eligibility and persistence

- A room with no meter history can receive one initial reading, with its reading date and optional source note (500 characters).
- Readings are non-negative integer milli-kWh, displayed with up to three decimal places. The reading date must be valid and no later than the current prototype business date.
- New meters have an explicit stable room ID. An unknown physical serial number is left null; the UI shows the stable system meter ID instead.
- A settled reading prevents initialization. Ambiguous legacy links, drafts, orphan readings, conflicting meters, and financial references require review.
- Saving uses the existing repository before announcing success. It creates a meter if needed, one `INITIAL` reading, and an audit event. It creates no charge, payment, receipt, or persisted electricity obligation.
- Existing legacy `CONFIRMED` readings are never rewritten. UI history distinguishes initial, settled, superseded, draft, and legacy readings.

## Billing integration

`electricityBaseline` returns the latest confirmed settled reading, otherwise the initial reading. The existing electricity engine still computes consumption and centavos. For initialized meters only, the shared pending-electricity selector can project an awaiting-reading interval for an occupied room and applicable existing billing period. No amount is invented. Confirmation saves the actual reading, charge, allocation, room payment, and receipt through the existing service.

An initial reading and first payment may share a date; payments after an actual settled reading retain the existing later-date rule. A preview does not advance history. Issued unpaid charges and correction/reversal history are retained independently of setup mode.

Tenants see awaiting-reading status after setup, without a fictional receipt or PAID status. Following real payment, authorized roommates see the paid electricity category and the same shared receipt.

Schema v13 accepts v12 records unchanged. Older supported migrations remain in place. Restore Sample Records remains an explicit confirmed replacement. The prototype still uses the fixed sample business date; meter replacement and baseline-history edits require a separate authorized workflow and are not implemented by initialization.
