import { Badge } from '@radix-ui/themes'
import { AlertCircle, CheckCircle2, Clock, MinusCircle, type LucideIcon } from 'lucide-react'

type Tone = 'success' | 'danger' | 'neutral' | 'warning'

const success = ['Paid', 'Available', 'Active', 'Clear', 'Current tenant', 'Fully paid', 'Recorded']
const danger = ['Overdue', 'Late payment', 'Unpaid', 'Not yet paid', 'Outstanding']
const neutral = ['Moved out', 'Full', 'Not applicable', 'Occupied', 'No bill', 'No bills']
const icons: Record<Exclude<Tone, 'danger'>, LucideIcon> = { success: CheckCircle2, neutral: MinusCircle, warning: Clock }

function toneOf(status: string): Tone {
  return success.includes(status) ? 'success' : danger.includes(status) ? 'danger' : neutral.includes(status) ? 'neutral' : 'warning'
}

/**
 * Quiet by default: icon plus text. Only money that is owed or late gets a filled badge,
 * so the one thing that needs action is the one thing that stands out.
 */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = toneOf(status)
  if (tone === 'danger') return <Badge color="red" variant="soft" size="2"><AlertCircle size={14} aria-hidden="true" />{label ?? status}</Badge>
  const Icon = icons[tone]
  return <span className="status" data-tone={tone}><Icon aria-hidden="true" />{label ?? status}</span>
}
