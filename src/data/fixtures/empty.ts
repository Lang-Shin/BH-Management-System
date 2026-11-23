import type { PrototypeAppState } from '@/domain/types/models'
import { initialElectricityRates, initialRoomRentRates, initialWashingRates, initialWaterRates } from '@/domain/calculations/billing-rates'
import { calendarBillingPeriods } from '@/domain/calculations/billing-periods'
import { DEFAULT_MOVE_IN_POLICY } from '@/domain/calculations/move-in-policy'
import { civilDateInTimeZone } from '@/lib/business-date'
import { ensureInitialRateBaseline } from '@/domain/calculations/rate-baseline'
import { initialRooms } from '../room-defaults'

/** Real/development startup state: room configuration and rates, but no tenants or financial records. */
export function createEmptyData(asOf = civilDateInTimeZone(), configuration?: PrototypeAppState): PrototypeAppState {
  const base: PrototypeAppState = {
    tenants: [],
    rooms: configuration ? structuredClone(configuration.rooms) : initialRooms(),
    roomAssignments: [],
    electricityMeters: [],
    meterReadings: [],
    electricityBillObligations: [],
    electricityRates: configuration ? structuredClone(configuration.electricityRates) : initialElectricityRates(),
    roomRentRates: configuration ? structuredClone(configuration.roomRentRates) : initialRoomRentRates(),
    waterRates: configuration ? structuredClone(configuration.waterRates) : initialWaterRates(),
    washingRates: configuration ? structuredClone(configuration.washingRates) : initialWashingRates(),
    billingPeriods: [],
    charges: [],
    payments: [],
    paymentAllocations: [],
    tenantCredits: [],
    receipts: [],
    paymentCorrections: [],
    auditEvents: [],
    occupancyCycles: [],
    moveInObligations: [],
    moveInPolicy: configuration ? structuredClone(configuration.moveInPolicy) : { ...DEFAULT_MOVE_IN_POLICY },
    roomChangeRequests: [],
    advanceRefunds: [],
    rentalPeriods: [],
    rentObligations: [],
    advanceApplications: [],
    rentPrepayments: [],
    financialReviewCases: [],
  }
  const withBaseline = ensureInitialRateBaseline(base, { force: true })
  return { ...withBaseline, billingPeriods: calendarBillingPeriods(withBaseline, asOf) }
}
