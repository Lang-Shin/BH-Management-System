import type { ElectricityMeter, MeterReading, PrototypeAppState } from '@/domain/types/models'

export function metersForRoom(data: PrototypeAppState, roomId: string): ElectricityMeter[] {
  const conventionalId = `meter-${roomId}`
  return data.electricityMeters.filter(meter => meter.roomId === roomId || meter.id === conventionalId)
}

export function latestSettledReading(data: PrototypeAppState, meterId: string): MeterReading | null {
  return [...data.meterReadings].filter(reading => reading.meterId === meterId && reading.status === 'CONFIRMED')
    .sort((a, b) => b.readOn.localeCompare(a.readOn) || b.id.localeCompare(a.id))[0] ?? null
}

/** A real settled reading takes precedence; an administrative initial reading is only a fallback. */
export function electricityBaseline(data: PrototypeAppState, meterId: string): MeterReading | null {
  return latestSettledReading(data, meterId)
    ?? data.meterReadings.find(reading => reading.meterId === meterId && reading.status === 'INITIAL') ?? null
}

export type MeterSetupState = 'ELIGIBLE' | 'INITIALIZED' | 'HAS_HISTORY' | 'REQUIRES_REVIEW'
export function meterInitializationStatus(data: PrototypeAppState, roomId: string): {
  state: MeterSetupState; meter: ElectricityMeter | null; message: string
} {
  if (!data.rooms.some(room => room.id === roomId)) return { state: 'REQUIRES_REVIEW', meter: null, message: 'The room no longer exists.' }
  const meters = metersForRoom(data, roomId)
  const meter = meters[0] ?? null
  const meterId = meter?.id ?? `meter-${roomId}`
  const roomObligations = data.electricityBillObligations.filter(item => item.roomId === roomId)
  const historicalMeterIds = data.charges.flatMap(charge => {
    if (charge.category !== 'ELECTRICITY') return []
    const period = data.billingPeriods.find(item => item.id === charge.billingPeriodId)
    if (!period) return []
    return data.roomAssignments.some(assignment => assignment.roomId === roomId && assignment.tenantId === charge.tenantId
      && assignment.startDate <= period.endDate && (assignment.endDate === null || assignment.endDate >= period.startDate))
      ? [charge.electricity.meterId] : []
  })
  const conflictingLink = meters.length > 1 || (meter?.roomId !== undefined && meter.roomId !== roomId)
    || roomObligations.some(item => item.meterId !== meterId)
    || historicalMeterIds.some(id => id !== meterId)
  const readings = data.meterReadings.filter(reading => reading.meterId === meterId)
  const initial = readings.filter(reading => reading.status === 'INITIAL')
  if (conflictingLink || initial.length > 1 || (!meter && (readings.length > 0 || roomObligations.length > 0))) {
    return { state: 'REQUIRES_REVIEW', meter, message: 'Meter associations or legacy history are ambiguous. Review them before initialization; no records will be overwritten.' }
  }
  if (latestSettledReading(data, meterId)) {
    return { state: 'HAS_HISTORY', meter, message: 'Settled reading history is protected. Use the authorized payment-correction workflow; initialization cannot edit or replace it.' }
  }
  const referenced = data.charges.some(charge => charge.category === 'ELECTRICITY' && charge.electricity.meterId === meterId)
    || roomObligations.length > 0
  if (initial.length === 1 && meter?.roomId === roomId && initial[0]?.initializedOn !== undefined) {
    if (readings.some(reading => reading.status !== 'INITIAL')) {
      return { state: 'REQUIRES_REVIEW', meter, message: 'Additional legacy readings require review. Initialization is unavailable.' }
    }
    return { state: 'INITIALIZED', meter, message: 'An initial reading is already saved. It is a billing baseline, not a paid electricity transaction.' }
  }
  if (readings.length > 0 || referenced || (meter !== null && meter.roomId === undefined)) {
    return { state: 'REQUIRES_REVIEW', meter, message: 'Legacy meter records or financial references require review. Initialization cannot replace or infer historical readings.' }
  }
  return { state: 'ELIGIBLE', meter, message: 'No initial or settled reading exists. A verified previous reading may be entered once.' }
}
