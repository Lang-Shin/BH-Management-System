import type { ElectricityBillObligation, PrototypeAppState } from '@/domain/types/models'
import { electricityBaseline, metersForRoom } from './meter-baseline'

/** Read-only pending intervals for explicitly initialized meters; never invents a peso amount. */
export function electricityObligations(data: PrototypeAppState, asOf: string): ElectricityBillObligation[] {
  const persisted = data.electricityBillObligations.filter(item => item.createdAt <= asOf)
  const projected: ElectricityBillObligation[] = []
  for (const meter of data.electricityMeters) {
    if (!meter.roomId || metersForRoom(data, meter.roomId).length !== 1) continue
    const initial = data.meterReadings.find(reading => reading.meterId === meter.id && reading.status === 'INITIAL')
    const baseline = electricityBaseline(data, meter.id)
    if (!initial || !baseline || initial.readOn > asOf || (baseline.status === 'CONFIRMED' && baseline.readOn >= asOf)) continue
    for (const period of data.billingPeriods) {
      if (period.startDate > asOf || period.endDate < baseline.readOn) continue
      if (persisted.some(item => item.meterId === meter.id && item.billingPeriodId === period.id)
        || data.charges.some(charge => charge.category === 'ELECTRICITY' && charge.state === 'ISSUED'
          && charge.electricity.meterId === meter.id && charge.billingPeriodId === period.id)) continue
      const through = period.endDate < asOf ? period.endDate : asOf
      const from = period.startDate > initial.readOn ? period.startDate : initial.readOn
      const assignment = data.roomAssignments.filter(item => item.roomId === meter.roomId && item.startDate <= through
        && (item.endDate === null || item.endDate >= from))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))[0]
      if (!assignment) continue
      projected.push({
        id: `electricity-pending-${period.id}-${meter.roomId}`, roomId: meter.roomId, tenantId: assignment.tenantId,
        billingPeriodId: period.id, meterId: meter.id, previousReadingId: baseline.id,
        createdAt: [from, assignment.startDate].sort().at(-1)!, dueDate: period.endDate >= asOf ? period.endDate : asOf,
        state: 'AWAITING_READING',
      })
    }
  }
  return [...persisted, ...projected]
}
