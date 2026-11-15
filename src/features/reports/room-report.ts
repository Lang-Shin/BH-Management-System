import type { PrototypeAppState } from '@/domain/types/models'
import { chargeRoom, selectRoomFinance } from '@/domain/calculations/room-finance'
import { CHARGE_STATUS_LABELS } from '@/lib/labels'

function csvCell(value: string): string {
  // Room names are user data; prevent spreadsheet formulas in text cells.
  const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function roomReportCsv(data: PrototypeAppState, asOf: string, periodId: string): string {
  const period = data.billingPeriods.find(item => item.id === periodId)
  const rows = selectRoomFinance(data, asOf, periodId)
  const header = ['Room', 'Billing period', 'Total billed (PHP)', 'Applied to bills (PHP)', 'Outstanding (PHP)', 'Payment status', 'Attribution', 'Charge IDs']
  return [header, ...rows.map(row => [
    row.context.label, period?.label ?? periodId,
    (row.billed / 100).toFixed(2), (row.paid / 100).toFixed(2), (row.outstanding / 100).toFixed(2),
    CHARGE_STATUS_LABELS[row.status],
    [...new Set(row.charges.map(charge => chargeRoom(data, charge).source))].join('; '),
    row.charges.map(charge => charge.id).join('; '),
  ])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
