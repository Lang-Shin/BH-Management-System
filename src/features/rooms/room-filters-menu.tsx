import { CalendarClock, Check, ChevronDown, DoorOpen, KeyRound, ListFilter, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { RoomOccupancy } from '@/domain/calculations/summary'

export type RoomFilter = 'ALL' | RoomOccupancy

const filters: { value: Exclude<RoomFilter, 'ALL'>; label: string; icon: typeof ListFilter; tone: string }[] = [
  { value: 'OCCUPIED', label: 'Occupied', icon: KeyRound, tone: 'occupied' },
  { value: 'RESERVED', label: 'Reserved', icon: CalendarClock, tone: 'reserved' },
  { value: 'AVAILABLE', label: 'Available', icon: DoorOpen, tone: 'available' },
  { value: 'UNDER_REPAIR', label: 'Under repair', icon: Wrench, tone: 'repair' },
]

export function RoomFiltersMenu({ value, onChange }: { value: RoomFilter; onChange: (value: RoomFilter) => void }) {
  const selectedLabel = value === 'ALL' ? 'All rooms' : filters.find(item => item.value === value)?.label ?? 'All rooms'
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="billing-menu-trigger" aria-label={`Filters: ${selectedLabel}`}>
        <ListFilter aria-hidden="true" />
        Filters
        <ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" collisionPadding={12} className="billing-menu billing-filter-menu room-filter-menu">
      <DropdownMenuLabel>Filters</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem checked={value === 'ALL'} indicator={false} onCheckedChange={() => onChange('ALL')}>
        <span className="billing-filter-status-icon" data-status="all"><ListFilter aria-hidden="true" /></span>
        <span>SHOW ALL</span>
        {value === 'ALL' && <Check className="ml-auto size-4 text-[var(--tint)]" aria-hidden="true" />}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      {filters.map(({ value: option, label, icon: Icon, tone }) => <DropdownMenuCheckboxItem key={option} checked={value === option} indicator={false} onCheckedChange={() => onChange(option)}>
        <span className="billing-filter-status-icon" data-status={tone}><Icon aria-hidden="true" /></span>
        <span>{label}</span>
        {value === option && <Check className="ml-auto size-4 text-[var(--tint)]" aria-hidden="true" />}
      </DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
