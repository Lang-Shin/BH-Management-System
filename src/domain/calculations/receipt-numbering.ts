import type { PrototypeAppState } from '@/domain/types/models'

/** Shared receipt numbering so every payment path uses the same collision-safe sequence. */
export function nextReceiptNumbers(data: PrototypeAppState, count: number): string[] {
  const used = new Set(data.receipts.map(receipt => receipt.receiptNumber))
  const numbers: string[] = []
  let sequence = data.receipts.reduce((max, receipt) => {
    const match = /^DEMO-RCT-(\d+)$/.exec(receipt.receiptNumber)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  while (numbers.length < count) {
    const number = `DEMO-RCT-${String(sequence).padStart(3, '0')}`
    if (!used.has(number)) numbers.push(number)
    sequence += 1
  }
  return numbers
}
