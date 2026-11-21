# Tenant room overview and receipt presentation

The room-first overview uses the selected demo tenant's current assignment ID relationship. Exact string room labels (including `02`) are never parsed as numbers. Occupant cards contain only the names of current active occupants; previous occupants are excluded. PRIVATE/SHARED occupancy type and CR/aircon rental categories remain separate concepts.

## Monthly room billing

`tenantRoomBilling` groups issued charges using the existing historical `chargeRoom` attribution, and counts only active allocations from recorded payments through the sample date. Superseded receipts are never an input to payment-status calculations. Unallocated advances are not settlement.

- PAID: all issued amounts are settled and no electricity obligation awaits a reading.
- PARTLY PAID: some money is applied, but an issued amount or electricity obligation remains unsettled. Even a partial allocation to a single category qualifies.
- NOT PAID: issued charges exist and no payment has been applied.
- NOT YET BILLED: no issued bills or awaiting-reading obligations.
- PENDING CALCULATION: only an awaiting-reading electricity obligation exists.
- UNAVAILABLE: no current room/period relationship, a selected period outside the room tenancy, or ambiguous room attribution (for example a transfer).

Shared-room billing shows aggregate category totals, without roommate payment dates, receipt numbers, credits, or personal balances. These totals are explicitly labeled room-level and are not a claim of joint or personal liability. The selected tenancy must cover the selected billing period through the sample date; a newly joined tenant cannot infer access to an earlier stay simply from a current room label.

Rent and water amounts are read from issued bills (including their applied rate/tenant-count snapshots), not regenerated using today's room rate or occupant count. Washing appears only if billed/applicable. Missing electricity readings produce pending-calculation text, not invented charges. A removed receipt category can still be outstanding, or paid by a different transaction: only active allocations determine this.

## Digital receipts

The tenant receipt uses the same `TransactionPaidLines` component and transaction-summary styles as the landlord Transaction Details dialog. Only categories in that receipt's allocation snapshot are displayed, including electricity interval/consumption/applied-rate details. Receipt ownership remains `receipt.paymentId → payment.tenantId`; it is never selected by room occupancy.

The earlier inclusion-checkbox display has been replaced by a read-only “What Was Paid” breakdown as requested. Revised receipts remain current, with revision references, reason/date, and the existing cash-settlement wording. Superseded originals retain their original allocation snapshots in receipt history. No schema, repository, migration, cash-reconciliation, or financial mutation logic changed in this task.
