import { describe, expect, it } from 'vitest'
import { paymentAmountCents } from '@/features/billing/payment-total'

describe('payment amount input', () => {
  it('keeps peso calculations exact in centavos', () => {
    expect(paymentAmountCents('0.10')! + paymentAmountCents('0.20')!).toBe(30)
    expect(paymentAmountCents('3500.50')).toBe(350050)
    expect(paymentAmountCents('.5')).toBe(50)
    expect(paymentAmountCents('')).toBe(0)
  })

  it.each(['-1', '1.999', 'abc', '1e3', '1,000', '999999999999999999999'])('rejects an invalid or unsafe amount: %s', value => {
    expect(paymentAmountCents(value)).toBeNull()
  })
})
