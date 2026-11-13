import type { PrototypeData } from '@/domain/types/models'

export const DEMO_DATE = '2026-11-13'
export const DEMO_PERIOD = '2026-11'

const names = [
  'Alex Rivera', 'Sam Navarro', 'Jamie Santos', 'Morgan Cruz',
  'Taylor Reyes', 'Jordan Flores', 'Casey Ramos', 'Riley Garcia',
  'Avery Lim', 'Quinn Mendoza', 'Parker Diaz', 'Skyler Tan',
  'Drew Castillo', 'Cameron Lee', 'Finley Torres', 'Reese Aquino',
  'Rowan Velasco', 'Charlie Ong', 'Emery Dela Cruz', 'Sage Bautista',
  'Robin Mercado', 'Blair Santiago',
]

/** A factory prevents reset actions and tests from sharing mutable fixtures. */
export function createDemoData(): PrototypeData {
  const rooms = Array.from({ length: 10 }, (_, index) => ({
    id: `room-${index + 1}`,
    name: `${index < 5 ? '1' : '2'}0${(index % 5) + 1}`,
    floor: index < 5 ? 1 : 2,
    capacity: 3,
    monthlyRateCents: 350_000,
    status: index === 9 ? 'maintenance' as const : 'available' as const,
  }))
  const tenants = names.map((name, index) => ({
    id: `tenant-${index + 1}`,
    name,
    email: `resident${index + 1}@example.com`,
    roomId: `room-${Math.floor(index / 3) + 1}`,
    moveInDate: `2026-0${(index % 8) + 1}-01`,
    notes: '',
  }))
  const invoices = tenants.map((tenant, index) => ({
    id: `DEMO-INV-${String(index + 1).padStart(3, '0')}`,
    tenantId: tenant.id,
    period: DEMO_PERIOD,
    dueDate: index < 20 ? '2026-11-05' : '2026-11-20',
    rentCents: 350_000,
    utilitiesCents: 45_000,
  }))
  const payments = invoices.slice(0, 18).map((invoice, index) => ({
    id: `DEMO-PAY-${String(index + 1).padStart(3, '0')}`,
    invoiceId: invoice.id,
    amountCents: invoice.rentCents + invoice.utilitiesCents,
    paidOn: `2026-11-${String((index % 5) + 1).padStart(2, '0')}`,
    method: index % 2 === 0 ? 'cash' as const : 'bank-transfer' as const,
  }))
  return { rooms, tenants, invoices, payments }
}
