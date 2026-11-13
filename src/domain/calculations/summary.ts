import type { Invoice, PrototypeData } from '@/domain/types/models'

export function invoiceTotal(invoice: Invoice): number {
  return invoice.rentCents + invoice.utilitiesCents
}

export function invoiceBalance(data: PrototypeData, invoice: Invoice): number {
  const paid = data.payments.filter(payment => payment.invoiceId === invoice.id)
    .reduce((sum, payment) => sum + payment.amountCents, 0)
  return Math.max(0, invoiceTotal(invoice) - paid)
}

export function invoiceStatus(data: PrototypeData, invoice: Invoice, asOf: string): 'Paid' | 'Overdue' | 'Upcoming' {
  if (invoiceBalance(data, invoice) === 0) return 'Paid'
  return invoice.dueDate < asOf ? 'Overdue' : 'Upcoming'
}

export function selectSummary(data: PrototypeData, asOf: string) {
  const capacity = data.rooms.filter(room => room.status === 'available')
    .reduce((total, room) => total + room.capacity, 0)
  const billed = data.invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)
  const outstanding = data.invoices.reduce((sum, invoice) => sum + invoiceBalance(data, invoice), 0)
  return {
    tenants: data.tenants.length,
    capacity,
    availableBeds: capacity - data.tenants.length,
    occupancy: capacity ? Math.round(data.tenants.length / capacity * 100) : 0,
    billed,
    collected: billed - outstanding,
    outstanding,
    overdue: data.invoices.filter(invoice => invoiceStatus(data, invoice, asOf) === 'Overdue').length,
  }
}
