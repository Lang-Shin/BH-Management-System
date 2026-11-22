import type { ElectricityMeter, MeterReading, PrototypeAppState } from '@/domain/types/models'
import { isIsoDate } from '@/domain/validation/date'
import { meterInitializationStatus } from './meter-baseline'

export interface MeterInitializationInput {
  roomId: string
  readingMilliKwh: number
  readOn: string
  sourceNote: string
  initializedOn: string
}
export type MeterInitializationError = 'ROOM_NOT_FOUND' | 'NOT_ELIGIBLE' | 'INVALID_READING' | 'INVALID_DATE' | 'INVALID_SOURCE'
export function prepareMeterInitialization(data: PrototypeAppState, input: MeterInitializationInput):
  | { ok: true; data: PrototypeAppState; meter: ElectricityMeter; reading: MeterReading }
  | { ok: false; reason: MeterInitializationError } {
  const room = data.rooms.find(item => item.id === input.roomId)
  if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' }
  const setup = meterInitializationStatus(data, room.id)
  if (setup.state !== 'ELIGIBLE') return { ok: false, reason: 'NOT_ELIGIBLE' }
  if (!Number.isSafeInteger(input.readingMilliKwh) || input.readingMilliKwh < 0) return { ok: false, reason: 'INVALID_READING' }
  if (!isIsoDate(input.readOn) || !isIsoDate(input.initializedOn) || input.readOn > input.initializedOn) return { ok: false, reason: 'INVALID_DATE' }
  if (typeof input.sourceNote !== 'string' || input.sourceNote.trim().length > 500) return { ok: false, reason: 'INVALID_SOURCE' }
  const meter: ElectricityMeter = setup.meter ?? {
    id: `meter-${room.id}`, roomId: room.id, label: `Room ${room.name} meter`, serialNumber: null, ownership: 'UNCONFIRMED',
  }
  const reading: MeterReading = {
    id: `reading-${meter.id}-initial`, meterId: meter.id, readOn: input.readOn, readingMilliKwh: input.readingMilliKwh,
    status: 'INITIAL', confirmedBy: null, correction: null, sourceNote: input.sourceNote.trim(), initializedOn: input.initializedOn,
  }
  if (data.meterReadings.some(item => item.id === reading.id)) return { ok: false, reason: 'NOT_ELIGIBLE' }
  return { ok: true, meter, reading, data: {
    ...data,
    electricityMeters: setup.meter ? data.electricityMeters : [...data.electricityMeters, meter],
    meterReadings: [...data.meterReadings, reading],
    auditEvents: [...data.auditEvents, {
      id: `audit-${reading.id}`, actorId: 'demo-admin', occurredOn: input.initializedOn, action: 'METER_INITIALIZED',
      entityType: 'METER_READING', entityId: reading.id, reason: 'Verified administrative initial reading; no bill or payment created.',
      beforeSnapshot: null, afterSnapshot: JSON.stringify({ roomId: room.id, meterId: meter.id, reading }),
    }],
  } }
}
