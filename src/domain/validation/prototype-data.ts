import type { PrototypeData } from '@/domain/types/models'

type RecordValue = Record<string, unknown>
export const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= 500
const isId = (value: unknown): value is string => isText(value) && value.length > 0
const isMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

/** Validate untrusted browser storage before it reaches the typed application. */
export function isPrototypeData(value: unknown): value is PrototypeData {
  if (!isRecord(value)) return false
  const { rooms, tenants, invoices, payments } = value
  if (!Array.isArray(rooms) || !Array.isArray(tenants) || !Array.isArray(invoices) || !Array.isArray(payments)) return false
  if ([rooms, tenants, invoices, payments].some(items => items.length > 1000)) return false
  if (!rooms.every((r: unknown) => isRecord(r) && isId(r.id) && isId(r.name)
    && Number.isInteger(r.floor) && typeof r.floor === 'number' && r.floor > 0
    && typeof r.capacity === 'number' && Number.isInteger(r.capacity) && r.capacity > 0
    && isMoney(r.monthlyRateCents) && (r.status === 'available' || r.status === 'maintenance'))) return false
  if (!tenants.every((t: unknown) => isRecord(t) && isId(t.id) && isId(t.name)
    && isText(t.email) && isId(t.roomId) && isDate(t.moveInDate) && isText(t.notes))) return false
  if (!invoices.every((i: unknown) => isRecord(i) && isId(i.id) && isId(i.tenantId)
    && typeof i.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(i.period)
    && isDate(i.dueDate) && isMoney(i.rentCents) && isMoney(i.utilitiesCents))) return false
  if (!payments.every((p: unknown) => isRecord(p) && isId(p.id) && isId(p.invoiceId)
    && isMoney(p.amountCents) && isDate(p.paidOn) && (p.method === 'cash' || p.method === 'bank-transfer'))) return false

  // The field checks above narrow records at runtime; relationships are checked next.
  const data = value as unknown as PrototypeData
  if ([data.rooms, data.tenants, data.invoices, data.payments]
    .some(items => new Set(items.map(item => item.id)).size !== items.length)) return false
  if (!data.tenants.every(t => data.rooms.some(r => r.id === t.roomId && r.status === 'available'))) return false
  if (!data.rooms.every(r => data.tenants.filter(t => t.roomId === r.id).length <= r.capacity)) return false
  if (!data.invoices.every(i => data.tenants.some(t => t.id === i.tenantId))) return false
  if (!data.payments.every(p => data.invoices.some(i => i.id === p.invoiceId))) return false
  return data.invoices.every(i => data.payments.filter(p => p.invoiceId === i.id)
    .reduce((sum, p) => sum + p.amountCents, 0) <= i.rentCents + i.utilitiesCents)
}
