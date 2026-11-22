# Tenant room change requests

Tenants submit a room-change request from **My Room**. Landlord approval is required; submission never changes the assignment.

## Request lifecycle

`PENDING -> APPROVED | REJECTED | CANCELLED | EXPIRED`

- One pending request per tenant.
- Target must be a different existing room, not under repair, and have capacity on the requested date.
- A request does not reserve a room.
- Requests do not create bills, payments, receipts, credits, or occupancy changes.
- Requests and decisions retain history and are never deleted.
- Pending requests expire when the tenant moves out or is directly transferred.
- The tenant sees a status timeline with submission, landlord review, decision, effective date, and any billing-review flag.

Landlord approval revalidates capacity and the current assignment, records the approved effective date, closes the old assignment the day before, creates a new assignment, and uses the existing occupancy reconciliation. Requested date is retained separately from the landlord-approved date. A transfer into an occupied shared room preserves the room's occupancy cycle and does not create another move-in obligation.

## Financial review

Submission and approval show outstanding balance, held advance credit, rent difference, any deposit top-up proposal, and mid-period billing review. Approval requires acknowledgment when review is needed. Nothing is posted automatically: no advance application, deposit adjustment, refund, or income recognition. No proration rule is introduced.

When an approved transfer starts after the first day of a billing period, the request stores that period's ID in `billingReviewPeriodIds`. The Billing page flags the affected period for manual rent review and lists the tenant and effective date. The flag never changes bills on its own.

## Schema and Phase 2

Schema v14 adds `roomChangeRequests`; v15 adds persisted `billingReviewPeriodIds` and derives them for approved v14 requests during migration. The current browser implementation uses the shared reducer and repository. A future backend must enforce tenant ownership, landlord authorization, room capacity, idempotency, concurrency, and decision transitions server-side.

## Effective dates and occupancy

Room occupancy is derived from active room assignments using stable room IDs, not from stored room-status labels. Landlord rooms, tenant selection, and tenant room views share one occupancy date: the later of the sample financial date and the local calendar date. A transfer effective today is visible immediately after approval and after a browser refresh. A future-dated transfer remains scheduled until its effective date; the timeline shows **Scheduled** before that date and **Effective** on or after it. Date-dependent UI refreshes automatically at local midnight and on every reload.

Financial reporting and receipt history remain anchored to the documented sample date so the demonstration totals stay deterministic.

## Reservations and capacity

Pending requests do not reserve a room. Approval creates a future room assignment, which is the reservation record; there is no separate reservation-status field to drift from tenancy data. A room with no current occupants but an approved future assignment displays **Reserved**. An occupied room keeps its current occupants and separately shows its upcoming reservation. Future residents are never counted as current occupants.

Capacity is checked at every overlapping assignment start for the requested interval. Shared rooms reserve only the required slots. Capacity changes, new tenancies, transfers, and approval all use the same check. The room selector excludes rooms that cannot accept the selected date and marks unavailable options in the tenancy form.

Approved future reservations can be explicitly rescheduled or cancelled from the landlord request queue. These workflows recheck capacity, preserve request/audit history, release or move the assignment safely, and do not create or rewrite financial transactions. Effective or already-active transfers are not silently cancelled.
