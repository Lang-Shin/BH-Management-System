import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function StatusBadge({ status }: { status: string }) {
  const style = ['Paid', 'Available', 'Active', 'Clear', 'Current tenant', 'Fully paid'].includes(status) ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : ['Overdue', 'Late payment'].includes(status) ? 'bg-rose-50 text-rose-800 border-rose-200'
    : ['Moved out', 'Full', 'Not applicable', 'Occupied', 'No bill'].includes(status) ? 'bg-muted text-foreground border-border'
    : 'bg-amber-50 text-amber-900 border-amber-200'
  return <Badge variant="outline" className={cn('max-w-full gap-1.5 whitespace-normal text-center font-medium', style)}><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{status}</Badge>
}
