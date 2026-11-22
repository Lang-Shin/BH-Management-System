# Tenant room change requests

Tenants submit a room-change request from **My Room**. Landlord approval is required; submission never changes the assignment.

## Request lifecycle

`PENDING ? APPROVED | REJECTED | CANCELLED`

- One pending request per tenant.
- Target must be a different existing room, not under repair, and have capacity on the requested date.
- A request does not reserve a room.
- Requests do not create bills, payments, receipts, credits, or occupancy changes.
- Requests and decisions retain history and are never deleted.

Landlord approval revalidates capacity and the current assignment, records the approved effective date, closes the old assignment the day before, creates a new assignment, and uses the existing occupancy reconciliation. Requested date is retained separately from the landlord-approved date.

## Financial review

Submission and approval show outstanding balance, held advance credit, rent difference, any deposit top-up proposal, and mid-period billing review. Approval requires acknowledgment when review is needed. Nothing is posted automatically: no advance application, deposit adjustment, refund, or income recognition. No proration rule is introduced.

## Schema and Phase 2

Schema v14 adds `roomChangeRequests`; older supported snapshots receive an empty queue. The current browser implementation uses the shared reducer and repository. A future backend must enforce tenant ownership, landlord authorization, room capacity, idempotency, concurrency, and decision transitions server-side.