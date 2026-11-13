/** Monetary values are integer centavos; all records are fictional. */
export interface Room {
  id: string
  name: string
  floor: number
  capacity: number
  monthlyRateCents: number
  status: 'available' | 'maintenance'
}

export interface Tenant {
  id: string
  name: string
  email: string
  roomId: string
  moveInDate: string
  notes: string
}

export interface Invoice {
  id: string
  tenantId: string
  period: string
  dueDate: string
  rentCents: number
  utilitiesCents: number
}

export interface Payment {
  id: string
  invoiceId: string
  amountCents: number
  paidOn: string
  method: 'cash' | 'bank-transfer'
}

export interface PrototypeData {
  rooms: Room[]
  tenants: Tenant[]
  invoices: Invoice[]
  payments: Payment[]
}

export type PrototypeAction =
  | { type: 'tenant/noteUpdated'; tenantId: string; notes: string }
  | { type: 'room/statusToggled'; roomId: string }
  | { type: 'demo/reset' }
