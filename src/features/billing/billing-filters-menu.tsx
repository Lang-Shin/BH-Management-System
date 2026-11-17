import { Button, DropdownMenu } from '@radix-ui/themes'
import { ChevronDown } from 'lucide-react'
import type { BillingRoomStatus } from './billing-room-status'

const statuses: BillingRoomStatus[] = ['PAID', 'PARTLY PAID', 'NOT YET PAID']

export function BillingFiltersMenu({ value, onChange }: { value: BillingRoomStatus | null; onChange: (value: BillingRoomStatus | null) => void }) {
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger>
      <Button variant="soft" color="gray" aria-label={value ? `Filters: ${value}` : 'Filters'}>{value ? `Filters: ${value}` : 'Filters'}<ChevronDown size={16} aria-hidden="true" /></Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" color="gray">
      <DropdownMenu.Label>Filters</DropdownMenu.Label>
      <DropdownMenu.CheckboxItem checked={value === null} onCheckedChange={() => onChange(null)}>SHOW ALL</DropdownMenu.CheckboxItem>
      <DropdownMenu.Separator />
      {statuses.map(status => <DropdownMenu.CheckboxItem key={status} checked={value === status} onCheckedChange={() => onChange(value === status ? null : status)}>{status}</DropdownMenu.CheckboxItem>)}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
}
