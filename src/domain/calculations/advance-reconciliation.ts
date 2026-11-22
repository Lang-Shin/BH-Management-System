import type { AdvanceApplication, PrototypeAppState } from '@/domain/types/models'
import { ensureFirstRentalPeriod, openFinancialReviewCase } from './rent-schedule'
import { rentObligationCashPaidCents, rentObligationForPeriod, rentalPeriodsForCycle } from './rental-periods'

export interface AdvanceApplicationRepair {
  cycleId: string
  roomId: string
  applicationId: string
  rentObligationId: string
  sourcePaymentId: string
  amountCents: number
}

export interface AdvanceReconciliationResult {
  data: PrototypeAppState
  repaired: AdvanceApplicationRepair[]
}

/**
 * Repairs historical move-in records where the advance cash was recorded but the non-cash
 * application to the first anniversary rent obligation is missing. It never creates cash,
 * changes a deposit, overwrites a reversed application, or guesses between multiple payers.
 */
export function repairMissingAdvanceApplications(data: PrototypeAppState, asOf: string): AdvanceReconciliationResult {
  let next = data
  const repaired: AdvanceApplicationRepair[] = []

  for (const obligation of data.moveInObligations) {
    const cycle = next.occupancyCycles.find(item => item.id === obligation.occupancyCycleId)
    const advance = next.charges.find(item => item.id === obligation.advanceChargeId)
    if (!cycle || !advance) continue

    const ensured = ensureFirstRentalPeriod(next, cycle, 'MOVE_IN_ADVANCE')
    const firstPeriod = rentalPeriodsForCycle(ensured, cycle.id).find(period => period.sequence === 1)
    const firstRent = firstPeriod ? rentObligationForPeriod(ensured, firstPeriod.id) : undefined
    if (!firstPeriod || !firstRent) continue
    next = ensured

    const existingApplication = next.advanceApplications.find(application => application.occupancyCycleId === cycle.id)
    if (existingApplication) {
      if (existingApplication.state === 'ACTIVE'
        && (existingApplication.rentObligationId !== firstRent.id || existingApplication.amountCents !== firstRent.amountCents)) {
        next = openFinancialReviewCase(next, {
          type: 'ADVANCE_APPLICATION_REVIEW', roomId: obligation.roomId, occupancyCycleId: cycle.id,
          tenantId: advance.tenantId, rentalPeriodId: firstPeriod.id, asOf,
          note: 'The active advance application does not fully settle the first anniversary rent. Review is required before changing it.',
        })
      }
      continue
    }

    const recordedPayments = new Map(next.payments
      .filter(payment => payment.state === 'RECORDED' && payment.paidOn <= asOf)
      .map(payment => [payment.id, payment]))
    const allocations = next.paymentAllocations.filter(allocation => allocation.chargeId === advance.id
      && allocation.state === 'ACTIVE'
      && allocation.allocatedOn <= asOf
      && recordedPayments.has(allocation.paymentId))
    const advancePaidCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    if (advancePaidCents < obligation.advanceRequiredCents) continue

    const sourcePaymentIds = [...new Set(allocations.map(allocation => allocation.paymentId))]
    if (sourcePaymentIds.length !== 1) {
      next = openFinancialReviewCase(next, {
        type: 'ADVANCE_APPLICATION_REVIEW', roomId: obligation.roomId, occupancyCycleId: cycle.id,
        tenantId: advance.tenantId, rentalPeriodId: firstPeriod.id, asOf,
        note: 'A paid move-in advance has multiple source payments. No automatic first-rent application was posted.',
      })
      continue
    }

    const sourcePaymentId = sourcePaymentIds[0]!
    const payment = recordedPayments.get(sourcePaymentId)!
    const firstRentCashPaidCents = rentObligationCashPaidCents(next, firstRent.id, asOf)
    if (firstRentCashPaidCents > 0) {
      next = openFinancialReviewCase(next, {
        type: 'ADVANCE_APPLICATION_REVIEW', roomId: obligation.roomId, occupancyCycleId: cycle.id,
        tenantId: advance.tenantId, rentalPeriodId: firstPeriod.id, asOf,
        note: 'The first anniversary rent already has cash payment. The paid advance was not applied automatically.',
      })
      continue
    }
    if (firstRent.amountCents !== obligation.advanceRequiredCents || advancePaidCents !== firstRent.amountCents) {
      next = openFinancialReviewCase(next, {
        type: 'ADVANCE_APPLICATION_REVIEW', roomId: obligation.roomId, occupancyCycleId: cycle.id,
        tenantId: advance.tenantId, rentalPeriodId: firstPeriod.id, asOf,
        note: 'The paid advance and first anniversary rent differ. No automatic application was posted.',
      })
      continue
    }

    const application: AdvanceApplication = {
      id: `advance-application-${cycle.id}`,
      occupancyCycleId: cycle.id,
      roomId: obligation.roomId,
      advanceChargeId: advance.id,
      sourcePaymentId,
      rentObligationId: firstRent.id,
      amountCents: advancePaidCents,
      appliedOn: payment.paidOn,
      state: 'ACTIVE',
      reversalAuditEventId: null,
    }
    const auditId = `audit-advance-repair-${cycle.id}`
    next = {
      ...next,
      advanceApplications: [...next.advanceApplications, application],
      auditEvents: [...next.auditEvents, {
        id: auditId, actorId: 'system-reconciliation', occurredOn: payment.paidOn, action: 'ADVANCE_APPLIED',
        entityType: 'ADVANCE_APPLICATION', entityId: application.id,
        reason: `Repaired the missing advance application that settles the first anniversary rent for Room ${next.rooms.find(room => room.id === obligation.roomId)?.name ?? obligation.roomId}.`,
        beforeSnapshot: JSON.stringify({ advanceChargeId: advance.id, firstRentObligationId: firstRent.id, firstRentCashPaidCents }),
        afterSnapshot: JSON.stringify(application),
      }],
    }
    repaired.push({
      cycleId: cycle.id, roomId: obligation.roomId, applicationId: application.id,
      rentObligationId: firstRent.id, sourcePaymentId, amountCents: advancePaidCents,
    })
  }

  return { data: next, repaired }
}
