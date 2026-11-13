import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function StatusBadge({ status }: { status: string }) {
  const style = status === 'Paid' || status === 'Available' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : status === 'Overdue' ? 'bg-rose-50 text-rose-800 border-rose-200'
    : 'bg-amber-50 text-amber-900 border-amber-200'
  return <Badge variant="outline" className={cn('gap-1.5 font-medium', style)}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{status}</Badge>
}
