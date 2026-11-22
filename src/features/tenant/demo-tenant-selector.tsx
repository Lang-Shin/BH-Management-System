import { useId } from 'react'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { useTenantDemo } from '@/app/providers/tenant-demo'
import { activeAssignments } from '@/domain/calculations/summary'

const statusLabel = (status: 'ACTIVE' | 'MOVED_OUT') => status === 'ACTIVE' ? 'Active' : 'Moved out'

/** Clearly labeled prototype-only selector; it never creates accounts or changes tenant records. */
export function DemoTenantSelector() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const { tenantId, selectTenant } = useTenantDemo()
  const selectId = useId()
  const assignments = activeAssignments(data, occupancyDate)
  const selected = data.tenants.find(item => item.id === tenantId) ?? null
  const selectedAssignment = selected ? assignments.find(item => item.tenantId === selected.id) : undefined
  const selectedRoom = selectedAssignment ? data.rooms.find(item => item.id === selectedAssignment.roomId) : undefined

  return <div className="mt-6 rounded-[16px] border bg-card/70 p-3 shadow-[inset_0_1px_0_#ffffff40]">
    <label htmlFor={selectId} className="block px-1 pb-2 text-xs font-semibold text-muted-foreground">Preview tenant</label>
    <select id={selectId} value={tenantId} onChange={event => selectTenant(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {data.tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
    </select>
    <p className="mt-2 truncate px-1 text-sm font-semibold">{selected?.name ?? 'No tenant selected'}</p>
    <p className="mt-1 flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
      <span>{selectedRoom ? `Room ${selectedRoom.name}` : 'No current room'}</span>
      {selected && <StatusBadge status={statusLabel(selected.status)} />}
    </p>
  </div>
}
