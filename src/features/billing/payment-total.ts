/** Parse a typed PHP amount into integer centavos without floating-point rounding. */
export function paymentAmountCents(value: string): number | null {
  if (value === '') return 0
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return null
  const [whole = '', fraction = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}
