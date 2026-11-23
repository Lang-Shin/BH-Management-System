import type { BillingPeriod, ElectricityBillObligation, MeterReading, PrototypeAppState } from '@/domain/types/models'
import type { RoomAssignment } from '@/domain/types/models'
import { electricityBaseline, metersForRoom } from './meter-baseline'
import { unresolvedElectricity } from './summary'

export interface PendingElectricityObligation {
  obligation: ElectricityBillObligation
  baseline: MeterReading | null
  isVirtual: true
}

function assignmentsForRoomPeriod(data: PrototypeAppState, roomId: string, period: BillingPeriod): RoomAssignment[] {
  return data.roomAssignments.filter(assignment => assignment.roomId === roomId
    && assignment.startDate <= period.endDate
    && (assignment.endDate === null || assignment.endDate >= period.startDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
}

/** A room/month has electricity pending when it is occupied, has no issued electricity charge,
 * and no persisted awaiting-reading obligation. A known meter baseline makes it calculable;
 * otherwise the UI can still explain that verification is required. */
export function pendingElectricityForRoom(
  data: PrototypeAppState,
  roomId: string,
  period: BillingPeriod,
  asOf: string,
): PendingElectricityObligation | null {
  const assignments = assignmentsForRoomPeriod(data, roomId, period)
  if (assignments.length === 0) return null
  if (unresolvedElectricity(data, asOf, period.id, roomId).length > 0) return null

  const tenantIds = new Set(assignments.map(assignment => assignment.tenantId))
  const hasIssuedCharge = data.charges.some(charge => charge.category === 'ELECTRICITY'
    && charge.billingPeriodId === period.id
    && charge.state === 'ISSUED'
    && charge.issuedOn <= asOf
    && tenantIds.has(charge.tenantId))
  if (hasIssuedCharge) return null

  const meter = metersForRoom(data, roomId)[0]
  const meterId = meter?.id ?? `meter-${roomId}`
  const baseline = electricityBaseline(data, meterId)
  if (baseline?.status === 'CONFIRMED' && baseline.readOn >= asOf) return null
  if (baseline?.status === 'CONFIRMED' && baseline.readOn > period.endDate) return null
  const dueDate = period.endDate >= asOf ? period.endDate : asOf
  return {
    baseline,
    isVirtual: true,
    obligation: {
      id: `electricity-pending-${period.id}-${roomId}`,
      roomId,
      tenantId: assignments[0]!.tenantId,
      billingPeriodId: period.id,
      meterId,
      previousReadingId: baseline?.id ?? `pending-baseline-${roomId}`,
      createdAt: asOf,
      dueDate,
      state: 'AWAITING_READING',
    },
  }
}
