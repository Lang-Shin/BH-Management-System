import { Check, ChevronDown, CircleDashed, Clock3, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { BillingRoomStatus } from './billing-room-status'

const statuses: BillingRoomStatus[] = ['PAID', 'PARTLY PAID', 'NOT PAID']

function StatusIcon({ status }: { status: BillingRoomStatus }) {
  const Icon = status === 'PAID' ? Check : status === 'PARTLY PAID' ? CircleDashed : Clock3
  return <span className="billing-filter-status-icon" data-status={status === 'PAID' ? 'paid' : status === 'PARTLY PAID' ? 'partial' : 'unpaid'}><Icon aria-hidden="true" /></span>
}

export function BillingFiltersMenu({ value, onChange }: { value: BillingRoomStatus | null; onChange: (value: BillingRoomStatus | null) => void }) {
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="billing-menu-trigger" aria-label={value ? `Filters: ${value}` : 'Filters'}>Filters<ChevronDown aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="billing-menu billing-filter-menu">
      <DropdownMenuLabel>Filters</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem checked={value === null} indicator={false} onCheckedChange={() => onChange(null)}>
        <span className="billing-filter-status-icon" data-status="all"><ListFilter aria-hidden="true" /></span>
        <span>SHOW ALL</span>
        {value === null && <Check className="ml-auto size-4 text-primary" aria-hidden="true" />}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      {statuses.map(status => <DropdownMenuCheckboxItem key={status} checked={value === status} indicator={false} onCheckedChange={() => onChange(value === status ? null : status)}>
        <StatusIcon status={status} />
        <span>{status}</span>
        {value === status && <Check className="ml-auto size-4 text-primary" aria-hidden="true" />}
      </DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
