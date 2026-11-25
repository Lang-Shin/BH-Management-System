import { describe, expect, it } from 'vitest'
import { createEmptyData } from '@/data/fixtures/empty'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { buildUnifiedCorrectionQuote, prepareUnifiedCorrection } from '@/domain/calculations/transaction-correction'
import { chargePaid } from '@/domain/calculations/summary'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { isPrototypeData } from '@/domain/validation/prototype-data'

const AS_OF = '2026-11-26'
const REPAID_ON = '2026-11-27'

function moveInScenario() {
  let data = createEmptyData(AS_OF)
  data = prototypeReducer(data, {
    type: 'tenant/created', asOf: AS_OF,
    draft: {
      name: 'Room 01 Tenant', email: 'room01@example.com', phone: '', address: '',
      roomId: 'room-9', moveInDate: AS_OF, notes: '',
    },
  })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-9')!
  const paid = prepareMoveInPayment(data, {
    obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: AS_OF,
  })
  if (!paid.ok) throw new Error(paid.reason)
  return { data: paid.data, obligation, payment: paid.payment, receipt: paid.receipt }
}

describe('advance repayment after correction', () => {
  it('re-records a removed advance without duplicating application or audit identities', () => {
    const scenario = moveInScenario()
    const depositAllocation = scenario.data.paymentAllocations.find(allocation =>
      allocation.paymentId === scenario.payment.id && allocation.chargeId === scenario.obligation.depositChargeId)!
    const input = {
      paymentId: scenario.payment.id, reason: 'Advance removed for testing.', correctedAt: AS_OF,
      retainedAllocationIds: [depositAllocation.id],
      expectedReceiptId: scenario.receipt.id, expectedReceiptRevision: scenario.receipt.revision,
      settlementStatus: 'CORRECTED' as const, moneyExchangeConfirmed: false,
    }
    expect(buildUnifiedCorrectionQuote(scenario.data, input)).not.toHaveProperty('quoteError')
    const corrected = prepareUnifiedCorrection(scenario.data, input)
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    expect(isPrototypeData(corrected.data)).toBe(true)
    const reversedApplication = corrected.data.advanceApplications.find(application => application.occupancyCycleId === scenario.obligation.occupancyCycleId)
    expect(reversedApplication?.state).toBe('REVERSED')

    const repaid = prepareMoveInPayment(corrected.data, {
      obligationId: scenario.obligation.id, categories: ['ADVANCE'], paidOn: REPAID_ON,
    })
    expect(repaid.ok).toBe(true)
    if (!repaid.ok) return

    expect(isPrototypeData(repaid.data)).toBe(true)
    const applications = repaid.data.advanceApplications.filter(application => application.occupancyCycleId === scenario.obligation.occupancyCycleId)
    expect(applications).toHaveLength(1)
    expect(applications[0]).toMatchObject({ state: 'ACTIVE', sourcePaymentId: repaid.payment.id, appliedOn: REPAID_ON, reversalAuditEventId: null })
    expect(repaid.data.auditEvents.filter(event => event.id === `audit-advance-${repaid.payment.id}`)).toHaveLength(1)
    expect(repaid.data.auditEvents.some(event => event.action === 'ADVANCE_APPLICATION_REVERSED')).toBe(true)
    expect(chargePaid(repaid.data, scenario.obligation.advanceChargeId, REPAID_ON)).toBe(scenario.obligation.advanceRequiredCents)
    expect(chargePaid(repaid.data, scenario.obligation.depositChargeId, REPAID_ON)).toBe(scenario.obligation.depositRequiredCents)
    expect(rentObligationPaidCents(repaid.data, applications[0]!.rentObligationId, REPAID_ON)).toBe(scenario.obligation.advanceRequiredCents)
  })
})
