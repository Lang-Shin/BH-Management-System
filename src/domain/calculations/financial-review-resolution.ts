import type { FinancialReviewCase, PrototypeAppState } from '@/domain/types/models'
import { rentObligationPaidCents } from './rental-periods'

export type FinancialReviewResolutionError =
  | 'REVIEW_NOT_FOUND'
  | 'ALREADY_RESOLVED'
  | 'REASON_REQUIRED'
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'FINANCIAL_OPERATION_REQUIRED'

export type FinancialReviewResolutionResult =
  | { ok: true; data: PrototypeAppState; review: FinancialReviewCase }
  | { ok: false; error: FinancialReviewResolutionError; message: string }

export function financialReviewTypeLabel(review: FinancialReviewCase): string {
  switch (review.type) {
    case 'TRANSFER_RENT_DIFFERENCE': return 'Transfer rent difference'
    case 'TRANSFER_PREPAID_RENT': return 'Prepaid source rent'
    case 'PREPAID_RENT_EARLY_DEPARTURE': return 'Early-departure prepaid rent'
    case 'LEGACY_ADVANCE_UNALLOCATED': return 'Unallocated legacy advance'
    case 'ADVANCE_APPLICATION_REVIEW': return 'Advance application review'
  }
}

export function financialReviewResolutionEffect(review: FinancialReviewCase): string {
  switch (review.type) {
    case 'TRANSFER_RENT_DIFFERENCE':
      return 'Resolving confirms that you reviewed the source and destination rent periods and handled any financial effect through an authorized workflow. No proration, transfer, refund, credit, or new charge is posted by this action. Normal rent collection and period generation may resume.'
    case 'TRANSFER_PREPAID_RENT':
      return 'Resolving confirms that you reviewed the prepaid source-room coverage and handled any required treatment through an authorized workflow. No automatic refund, reallocation, or cancellation is posted. Future eligible destination periods may resume.'
    case 'PREPAID_RENT_EARLY_DEPARTURE':
      return 'Resolving confirms that you reviewed the remaining prepaid rent. No automatic refund or transfer is posted; use the existing prepaid-refund workflow for any money movement.'
    case 'LEGACY_ADVANCE_UNALLOCATED':
      return 'Resolving confirms that the legacy advance has been reviewed under the existing workflow. No payment allocation is posted automatically.'
    case 'ADVANCE_APPLICATION_REVIEW':
      return 'Resolving confirms that the advance application was reviewed under the existing workflow. No payment or obligation is changed automatically.'
  }
}

export function financialReviewResolutionBlockers(data: PrototypeAppState, review: FinancialReviewCase, asOf: string): string[] {
  if (review.type === 'TRANSFER_PREPAID_RENT') {
    if (!review.rentalPeriodId) {
      return ['The source prepaid period reference is missing. Review the original transfer records before resolving this case.']
    }
    const obligation = data.rentObligations.find(item => item.rentalPeriodId === review.rentalPeriodId)
    if (obligation && rentObligationPaidCents(data, obligation.id, asOf) > 0) {
      return ['Source prepaid rent is still actively covering a rental period. Complete an authorized refund or another documented financial treatment before resolving this review.']
    }
  }
  if (review.type === 'PREPAID_RENT_EARLY_DEPARTURE' && review.occupancyCycleId) {
    const futurePaid = data.rentalPeriods
      .filter(period => period.occupancyCycleId === review.occupancyCycleId && period.startDate >= review.createdAt)
      .some(period => {
        const obligation = data.rentObligations.find(item => item.rentalPeriodId === period.id)
        return Boolean(obligation && rentObligationPaidCents(data, obligation.id, asOf) > 0)
      })
    if (futurePaid) {
      return ['Future prepaid rent is still allocated. Complete the authorized prepaid-refund workflow before resolving this review.']
    }
  }
  return []
}

export function resolveFinancialReview(
  data: PrototypeAppState,
  input: { reviewId: string; reason: string; acknowledged: boolean; asOf: string },
): FinancialReviewResolutionResult {
  const review = data.financialReviewCases.find(item => item.id === input.reviewId)
  if (!review) return { ok: false, error: 'REVIEW_NOT_FOUND', message: 'This financial review no longer exists.' }
  if (review.status !== 'OPEN') {
    return { ok: false, error: 'ALREADY_RESOLVED', message: 'This financial review was already resolved or dismissed.' }
  }
  if (input.reason.trim().length < 3 || input.reason.trim().length > 500) {
    return { ok: false, error: 'REASON_REQUIRED', message: 'Enter a resolution reason with at least 3 characters.' }
  }
  if (!input.acknowledged) {
    return { ok: false, error: 'ACKNOWLEDGEMENT_REQUIRED', message: 'Confirm that you reviewed the financial treatment before resolving this case.' }
  }
  const blockers = financialReviewResolutionBlockers(data, review, input.asOf)
  if (blockers.length > 0) {
    return { ok: false, error: 'FINANCIAL_OPERATION_REQUIRED', message: blockers.join(' ') }
  }

  const resolved: FinancialReviewCase = {
    ...review,
    status: 'RESOLVED',
    resolvedAt: input.asOf,
    resolvedBy: 'landlord',
    resolutionReason: input.reason.trim(),
  }
  return {
    ok: true,
    review: resolved,
    data: {
      ...data,
      financialReviewCases: data.financialReviewCases.map(item => item.id === review.id ? resolved : item),
      auditEvents: [...data.auditEvents, {
        id: `audit-${review.id}-resolved`,
        actorId: 'landlord',
        occurredOn: input.asOf,
        action: 'FINANCIAL_REVIEW_RESOLVED',
        entityType: 'FINANCIAL_REVIEW_CASE',
        entityId: review.id,
        reason: input.reason.trim(),
        beforeSnapshot: JSON.stringify(review),
        afterSnapshot: JSON.stringify(resolved),
      }],
    },
  }
}
