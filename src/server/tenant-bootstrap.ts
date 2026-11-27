import { STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'
import { selectMoveInObligations } from '@/domain/calculations/move-in'
import { selectRentCycleReport } from '@/domain/calculations/rent-reporting'
import type { PrototypeAppState } from '@/domain/types/models'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import { tenantRoomBilling } from '@/features/tenant/tenant-room-billing'
import { ApiError } from './http'

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
    revision, serverDate, timezone, workspaceId,
    role: 'TENANT' as const, tenantId, schemaVersion: STORAGE_SCHEMA_VERSION,
  }
}
