# Room-level move-in advance, first rent, and security deposit

## Rules

- One advance and one security deposit are required per **room occupancy cycle**, not per tenant. Roommates share the room-level obligation.
- The mandatory one-month advance is the rent for the tenant's **first anniversary-based rental period**. A successful advance payment creates a non-cash application to that rent obligation; the first period immediately displays **PAID**.
- Rent is due on the **first day of each anniversary period**. `rental_periods.due_date` and the rent obligation due date equal the period start date. No late fee, grace period, or penalty is applied.
- Business dates use **Asia/Manila**. Rental period ends are exclusive internally.
- The advance and deposit are separate full-category categories. The deposit is never applied to rent, never recognized as rental income automatically, and never added to a destination room's price difference during a transfer.
- Adding a roommate does not create another advance, deposit, rent obligation, or anniversary. The first occupant establishes the cycle anchor; later occupants join it.
- If the first occupant leaves while another remains, the cycle and rent anchor remain. A fully vacant room closes the cycle; a later occupancy starts a new cycle and anchor.
- Transfers into an occupied room preserve the destination room's existing anniversary. Transfers into a vacant room create a new destination cycle at the destination rate without automatically collecting another advance or deposit.
- Advance and deposit payment categories are collected in full; partial category payments are rejected, while legacy partial allocations remain readable.
- A payment correction that removes an advance reverses its first-rent application with an audit event. The first period then returns to unpaid rather than keeping a duplicate cash or rent record.
- Transfers during an already-paid rent period and transfers with future prepaid rent create manual financial-review cases. Settled payments are not modified automatically.
- New obligations store the active policy version. Policy changes do not rewrite historical obligations or charges.

## Policy v3

| Area | Default |
| --- | --- |
| Advance application | `FIRST_MONTH` — settles the first anniversary rent period |
| Rent due date | First day of each anniversary period |
| Deposit terms | `NON_REFUNDABLE` |
| Deposit income recognition | `NOT_RECOGNIZED` |
| Transfer into a more expensive room | Review only; no advance or deposit top-up |
| Transfer into a cheaper room | Manual settlement review |
| Move-out | Manual settlement review; no automatic refund, forfeiture, or income recognition |
| Short-stay refund after advance application | Blocked from automatic refund; owner reconciliation required |

## Multi-month prepayment

- Voluntary prepayment starts from the next unpaid anniversary period and never includes an advance-covered first period.
- One cash payment can cover multiple consecutive periods, with one allocation and one receipt.
- The current rent rate at payment time is locked across newly prepaid periods. Later rate changes do not rewrite those obligations.
- Fully prepaid periods display **PAID** and are excluded from later prepayment quotes and duplicate collection.
- Transfers do not move prepaid rent automatically; affected periods are flagged for review.

## Persistence and migration

The localStorage key remains `bhms:prototype:v1`, with schema **version 17**. Supported older snapshots are migrated non-destructively. Existing occupied rooms receive legacy calendar billing and no invented advances or deposits. Legacy cycles are not converted to anniversary rent until the room becomes vacant. Paid legacy advances that predate first-period application are listed for owner review; no historical payment or receipt is rewritten.

## Verification

Domain and integration tests cover:

- first and second occupants;
- first-period advance settlement;
- advance-application reversal through corrections;
- due dates at period start;
- short-month and leap-year boundaries;
- year-crossing periods;
- multi-period prepayment, current-rate locking, and PAID display;
- duplicate collection prevention and idempotent Worker commands;
- destination anniversary preservation for occupied-room transfers;
- D1 batch rollback and import dry-run safety.

The automatic short-stay refund remains unavailable after first-period application until a separate owner-approved refund/reversal policy is defined.
