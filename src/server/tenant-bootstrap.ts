import { STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'
import { selectMoveInObligations } from '@/domain/calculations/move-in'
import { selectRentCycleReport } from '@/domain/calculations/rent-reporting'
import type { PrototypeAppState, Tenant } from '@/domain/types/models'
import { tenantHasCycleAccess, tenantOccupiedRoomAt } from '@/domain/calculations/tenant-access'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import { tenantRoomBilling } from '@/features/tenant/tenant-room-billing'
import { ApiError } from './http'

function authorizedTenantState(data: PrototypeAppState, tenantId: string): PrototypeAppState {
  const own = data.tenants.find(item => item.id === tenantId)
  if (!own) throw new ApiError(404, 'TENANT_NOT_FOUND', 'The tenant record was not found.')
  const ownAssignments = data.roomAssignments.filter(item => item.tenantId === tenantId)
  const roomIds = new Set(ownAssignments.map(item => item.roomId))
  const currentRoomIds = new Set(ownAssignments.filter(item => item.endDate === null).map(item => item.roomId))
  const roommateAssignments = data.roomAssignments.filter(item => item.tenantId !== tenantId && currentRoomIds.has(item.roomId) && item.endDate === null)
  const roommateIds = new Set(roommateAssignments.map(item => item.tenantId))
  const sanitize = (tenant: Tenant): Tenant => ({ id: tenant.id, name: tenant.name, email: '', phone: '', address: '', notes: '', status: tenant.status })
  const tenants = data.tenants.filter(item => item.id === tenantId || roommateIds.has(item.id)).map(item => item.id === tenantId ? item : sanitize(item))
  const cycles = data.occupancyCycles.filter(cycle => roomIds.has(cycle.roomId))
  const cycleIds = new Set(cycles.map(cycle => cycle.id))
  const rentalPeriods = data.rentalPeriods.filter(period => cycleIds.has(period.occupancyCycleId))
  const periodIds = new Set(rentalPeriods.map(period => period.id))
  const ownPayment = (payment: typeof data.payments[number]) => payment.tenantId === tenantId
  const sharedPayment = (payment: typeof data.payments[number]) => {
    if (payment.scope !== 'ROOM') return false
    const cycle = payment.occupancyCycleId ? cycles.find(item => item.id === payment.occupancyCycleId) : undefined
    if (cycle && tenantHasCycleAccess(data, tenantId, cycle, payment.paidOn)) return true
    return Boolean(payment.roomId && tenantOccupiedRoomAt(data, tenantId, payment.roomId, payment.paidOn))
  }
  const payments = data.payments.filter(payment => ownPayment(payment) || sharedPayment(payment))
  const paymentIds = new Set(payments.map(payment => payment.id))
  const allocations = data.paymentAllocations.filter(allocation => paymentIds.has(allocation.paymentId))
  const receiptPaymentIds = new Set(payments.map(payment => payment.id))
  const receipts = data.receipts.filter(receipt => receiptPaymentIds.has(receipt.paymentId))
  const authorizedMoveInIds = new Set(data.moveInObligations.filter(item => roomIds.has(item.roomId)).map(item => item.id))
  const charges = data.charges.filter(charge => {
    if (charge.tenantId === tenantId) return true
    if (!charge.roomId || !roomIds.has(charge.roomId)) return false
    if (charge.category === 'RENT' || charge.category === 'ELECTRICITY' || charge.category === 'WASHING_MACHINE') return true
    if (charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT') return authorizedMoveInIds.has(charge.moveInObligationId)
    return false
  })
  const meters = data.electricityMeters.filter(meter => meter.roomId !== undefined && roomIds.has(meter.roomId))
  const meterIds = new Set(meters.map(meter => meter.id))
  const correctionPaymentIds = new Set([...paymentIds, ...receipts.map(receipt => receipt.paymentId)])
  return {
    ...data,
    tenants, rooms: data.rooms.filter(room => roomIds.has(room.id)),
    roomAssignments: [...ownAssignments, ...roommateAssignments],
    electricityMeters: meters,
    meterReadings: data.meterReadings.filter(reading => meterIds.has(reading.meterId)),
    electricityBillObligations: data.electricityBillObligations.filter(item => roomIds.has(item.roomId)),
    billingPeriods: data.billingPeriods,
    charges, payments, paymentAllocations: allocations,
    tenantCredits: data.tenantCredits.filter(item => item.tenantId === tenantId),
    receipts,
    paymentCorrections: data.paymentCorrections.filter(item => correctionPaymentIds.has(item.originalPaymentId) || correctionPaymentIds.has(item.correctedPaymentId)),
    auditEvents: [],
    occupancyCycles: cycles,
    moveInObligations: data.moveInObligations.filter(item => roomIds.has(item.roomId)),
    roomChangeRequests: data.roomChangeRequests.filter(item => item.tenantId === tenantId),
    advanceRefunds: data.advanceRefunds.filter(item => item.tenantId === tenantId),
    rentalPeriods,
    rentObligations: data.rentObligations.filter(item => periodIds.has(item.rentalPeriodId)),
    advanceApplications: data.advanceApplications.filter(item => cycleIds.has(item.occupancyCycleId)),
    rentPrepayments: data.rentPrepayments.filter(item => cycleIds.has(item.occupancyCycleId)),
    prepaidRentRefunds: (data.prepaidRentRefunds ?? []).filter(item => item.tenantId === tenantId),
    financialReviewCases: [],
  }
}

export function buildTenantBootstrap(
  data: PrototypeAppState,
  revision: number,
  tenantId: string,
  serverDate: string,
  timezone: string,
  workspaceId: string,
) {
  const tenant = data.tenants.find(item => item.id === tenantId)
  if (!tenant) throw new ApiError(404, 'TENANT_NOT_FOUND', 'The tenant record was not found.')
  const assignment = data.roomAssignments
    .filter(item => item.tenantId === tenantId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null
  const activeAssignment = assignment?.endDate === null ? assignment : null
  const room = activeAssignment ? data.rooms.find(item => item.id === activeAssignment.roomId) ?? null : null
  const currentPeriod = data.billingPeriods.find(item => item.startDate <= serverDate && item.endDate >= serverDate)
    ?? data.billingPeriods.at(-1) ?? null
  const cycle = room ? data.occupancyCycles.find(item => item.roomId === room.id && item.status === 'ACTIVE') ?? null : null
  const roommateIds = room
    ? data.roomAssignments
      .filter(item => item.roomId === room.id && item.endDate === null && item.tenantId !== tenantId)
      .map(item => item.tenantId)
    : []
  const roommates = data.tenants
    .filter(item => roommateIds.includes(item.id))
    .map(item => ({ id: item.id, name: item.name }))
  const moveInView = room ? selectMoveInObligations(data, serverDate, room.id).find(item => item.cycle.status === 'ACTIVE') ?? null : null
  const receipts = selectTenantReceipts(data, tenantId).receipts.map(view => ({
    receipt: {
      id: view.receipt.id, receiptNumber: view.receipt.receiptNumber, issuedOn: view.receipt.issuedOn,
      state: view.receipt.state, revision: view.receipt.revision, amountCents: view.receipt.amountCents,
    },
    payment: { paidOn: view.payment.paidOn, method: view.payment.method, state: view.payment.state },
    periods: view.periods.map(period => ({ id: period.id, label: period.label })),
    rentPeriods: view.rentPeriods,
    rooms: { label: view.rooms.label, note: view.rooms.note },
    categories: view.categories,
    unallocatedCents: view.unallocatedCents,
    otherTenantNames: view.otherTenantNames,
    depositDisposition: view.depositDisposition,
    effective: view.effective,
  }))
  const refunds = (data.prepaidRentRefunds ?? [])
    .filter(refund => refund.tenantId === tenantId)
    .map(refund => ({
      id: refund.id, roomId: refund.roomId, moveOutDate: refund.moveOutDate, amountCents: refund.amountCents,
      status: refund.status, refundedOn: refund.refundedOn,
    }))

  return {
    data: {
      tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
      room: room ? {
        id: room.id, name: room.name, floor: room.floor, kind: room.kind, capacity: room.capacity,
        washingMachineEnabled: room.washingMachineEnabled,
      } : null,
      assignment: activeAssignment ? { id: activeAssignment.id, startDate: activeAssignment.startDate, endDate: activeAssignment.endDate } : null,
      roommates,
      cycleId: cycle?.id ?? null,
      billingPeriods: data.billingPeriods.map(item => ({ id: item.id, label: item.label, startDate: item.startDate, endDate: item.endDate, status: item.status })),
      billing: room && currentPeriod ? tenantRoomBilling(data, tenantId, room.id, currentPeriod.id, serverDate) : null,
      currentPeriod: currentPeriod ? { id: currentPeriod.id, label: currentPeriod.label, startDate: currentPeriod.startDate, endDate: currentPeriod.endDate } : null,
      moveIn: moveInView ? {
        roomId: moveInView.room.id,
        advanceRequiredCents: moveInView.obligation.advanceRequiredCents,
        advancePaidCents: moveInView.advancePaidCents,
        advanceRemainingCents: moveInView.advanceRemainingCents,
        depositRequiredCents: moveInView.obligation.depositRequiredCents,
        depositPaidCents: moveInView.depositPaidCents,
        depositRemainingCents: moveInView.depositRemainingCents,
        depositDisposition: moveInView.obligation.depositDisposition,
        advanceStatus: moveInView.advanceStatus,
        depositStatus: moveInView.depositStatus,
        firstRentStatus: moveInView.firstRentObligation?.state === 'ISSUED' ? 'ISSUED' : 'PENDING',
      } : null,
      rentCoverage: cycle ? selectRentCycleReport(data, cycle.id, serverDate) : null,
      receipts,
      refunds,
    },
    state: authorizedTenantState(data, tenantId),
    revision, serverDate, timezone, workspaceId,
    role: 'TENANT' as const, tenantId, schemaVersion: STORAGE_SCHEMA_VERSION,
  }
}
