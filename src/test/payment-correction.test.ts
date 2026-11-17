import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { buildPaymentCorrectionQuote, preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { selectSummary } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'

const base = { correctedAt: DEMO_DATE, reason: 'Incorrect bill selected' }

describe('payment correction workflow', () => {
  it('limits editable categories to the selected transaction and removes an incorrect water charge', () => {
    const data = createDemoData()
    const quote = buildPaymentCorrectionQuote(data, { ...base, paymentId: 'payment-1-rent-water-washing', selectedCategories: ['RENT', 'WATER', 'WASHING_MACHINE'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_MONEY_MOVED' })
    expect('quoteError' in quote).toBe(false)
    if ('quoteError' in quote) return
    expect(quote.categories.map(option => option.category)).toEqual(['RENT', 'WATER', 'WASHING_MACHINE'])
    const result = preparePaymentCorrection(data, { ...base, paymentId: 'payment-1-rent-water-washing', selectedCategories: ['RENT', 'WASHING_MACHINE'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_MONEY_MOVED' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.payment.amountCents).toBe(360_000)
    expect(result.receipt).toMatchObject({ revision: 2, supersedesReceiptId: 'receipt-6', amountCents: 360_000 })
    expect(result.correction).toMatchObject({ differenceCents: -10_000, settlementStatus: 'NO_MONEY_MOVED', settlementAmountCents: 0, correctedCategories: ['RENT', 'WASHING_MACHINE'] })
    expect(result.data.payments.find(payment => payment.id === 'payment-1-rent-water-washing')?.state).toBe('VOIDED')
    expect(result.data.receipts.find(receipt => receipt.id === 'receipt-6')?.state).toBe('SUPERSEDED')
    const water = result.data.charges.find(charge => charge.id === 'water-nov-tenant-1')!
    expect(water.category === 'WATER' ? water.amountCents : 0).toBe(10_000)
    expect(result.data.paymentAllocations.filter(allocation => allocation.paymentId === result.payment.id).map(allocation => allocation.chargeId).sort()).toEqual(['rent-nov-room-1', 'washing-nov-room-1'])
    expect(result.data.paymentCorrections).toHaveLength(1)
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received)
  })

  it('recalculates an electricity undercharge and records additional money received', () => {
    const data = createDemoData()
    const result = preparePaymentCorrection(data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: 330_000, settlementStatus: 'ADDITIONAL_RECEIVED' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.payment.amountCents).toBe(23_400)
    expect(result.correction).toMatchObject({ originalAmountCents: 16_900, correctedAmountCents: 23_400, differenceCents: 6_500, settlementStatus: 'ADDITIONAL_RECEIVED', settlementAmountCents: 6_500 })
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received + 6_500)
    const charge = result.data.charges.find(item => item.id === result.data.paymentAllocations.find(allocation => allocation.paymentId === result.payment.id)?.chargeId)
    expect(charge?.category).toBe('ELECTRICITY')
    expect(charge?.amountCents).toBe(23_400)
    expect(charge?.category === 'ELECTRICITY' ? charge.electricity.appliedRateCentsPerKwh : 0).toBe(1_300)
    expect(charge?.category === 'ELECTRICITY' ? charge.electricity.currentReadingMilliKwh : 0).toBe(330_000)
  })

  it('recalculates an electricity overcharge and records a pending refund without counting it as settled', () => {
    const data = createDemoData()
    const result = preparePaymentCorrection(data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: 320_000, settlementStatus: 'REFUND_PENDING' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payment.amountCents).toBe(10_400)
    expect(result.correction).toMatchObject({ differenceCents: -6_500, settlementStatus: 'REFUND_PENDING', settlementAmountCents: 6_500 })
    expect(result.receipt.amountCents).toBe(10_400)
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received)
  })

  it('reduces cash received when a refund is explicitly completed', () => {
    const data = createDemoData()
    const result = preparePaymentCorrection(data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: 320_000, settlementStatus: 'REFUND_COMPLETED' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received - 6_500)
  })

  it('supports a pending additional payment without marking it received', () => {
    const data = createDemoData()
    const result = preparePaymentCorrection(data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: 330_000, settlementStatus: 'ADDITIONAL_PENDING' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payment.amountCents).toBe(16_900)
    expect(result.correction).toMatchObject({ correctedAmountCents: 23_400, differenceCents: 6_500, settlementStatus: 'ADDITIONAL_PENDING', settlementAmountCents: 6_500 })
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received)
    const allocation = result.data.paymentAllocations.find(item => item.paymentId === result.payment.id)!
    expect(allocation.amountCents).toBe(16_900)
    expect(allocation.amountCents).toBeLessThan(23_400)
  })

  it('blocks a simple correction when a later reading depends on the original interval', () => {
    const data = createDemoData()
    const quote = buildPaymentCorrectionQuote(data, { ...base, paymentId: 'payment-oct-1', selectedCategories: ['RENT', 'ELECTRICITY'], correctedElectricityReadingMilliKwh: 315_000, settlementStatus: 'ADDITIONAL_RECEIVED' })
    expect(quote).toEqual({ quoteError: 'LATER_DEPENDENT_READING' })
  })

  it('requires a reason and at least one category', () => {
    const data = createDemoData()
    expect(buildPaymentCorrectionQuote(data, { ...base, reason: '', paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })).toMatchObject({ canReview: false })
    expect(buildPaymentCorrectionQuote(data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: [], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })).toMatchObject({ canReview: false })
    expect(buildPaymentCorrectionQuote(data, { ...base, reason: 'x'.repeat(501), paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })).toMatchObject({ canReview: false, error: 'Keep the correction reason under 500 characters.' })
    expect(preparePaymentCorrection(data, { ...base, reason: '', paymentId: 'payment-1-electricity', selectedCategories: [], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })).toEqual({ ok: false, reason: 'NO_CATEGORIES' })
    expect(preparePaymentCorrection(data, { ...base, reason: 'x'.repeat(501), paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })).toEqual({ ok: false, reason: 'REASON_TOO_LONG' })
  })

  it('does not create duplicate corrections from repeated submission', () => {
    const data = createDemoData()
    const result = preparePaymentCorrection(data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(preparePaymentCorrection(result.data, { ...base, paymentId: 'payment-1-electricity', selectedCategories: ['ELECTRICITY'], correctedElectricityReadingMilliKwh: null, settlementStatus: 'NO_DIFFERENCE' })).toEqual({ ok: false, reason: 'PAYMENT_NOT_FOUND' })
    expect(result.data.paymentCorrections).toHaveLength(1)
  })
})
