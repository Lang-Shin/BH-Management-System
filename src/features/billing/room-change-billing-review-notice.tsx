import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/hooks/use-prototype'
import { useDismissedNotices } from '@/hooks/use-dismissed-notices'
import { approvedRoomChangeBillingReviews } from '@/domain/calculations/room-change-requests'
import { formatDate } from '@/lib/format'
import type { RoomChangeRequest } from '@/domain/types/models'

export function RoomChangeBillingReviewNotice({ periodId }: { periodId: string }) {
  const { data } = usePrototype()
  const { dismiss, isDismissed } = useDismissedNotices()
  const [showDismissed, setShowDismissed] = useState(false)
  const reviews = approvedRoomChangeBillingReviews(data, periodId)
  if (reviews.length === 0) return null

  const keyFor = (review: RoomChangeRequest) => `billing-room-change:${periodId}:${review.id}`
  const visible = reviews.filter(review => !isDismissed(keyFor(review)))
  const dismissed = reviews.filter(review => isDismissed(keyFor(review)))
  const displayed = showDismissed ? reviews : visible

  if (visible.length === 0 && !showDismissed) {
    return <div className="mb-4"><Button type="button" variant="outline" size="sm" onClick={() => setShowDismissed(true)}>View transfer notes ({dismissed.length})</Button></div>
  }

  return <div className="room-change-billing-review" role="note">
    <div className="flex items-start justify-between gap-3">
      <div>
        <strong>Room change billing review</strong>
        <p>{displayed.length === 1 ? 'One approved mid-period transfer affects' : `${displayed.length} approved mid-period transfers affect`} this billing period. Review room rent manually; no proration or duplicate rent was generated automatically.</p>
      </div>
      {dismissed.length > 0 && <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => setShowDismissed(current => !current)}>{showDismissed ? 'Hide dismissed notes' : `View dismissed (${dismissed.length})`}</Button>}
    </div>
    <ul>{displayed.map(request => {
      const tenantName = data.tenants.find(tenant => tenant.id === request.tenantId)?.name ?? 'Tenant'
      const wasDismissed = isDismissed(keyFor(request))
      return <li key={request.id} className="room-change-review-item">
        <span>{tenantName}: Room {data.rooms.find(room => room.id === request.currentRoomId)?.name ?? '-'} → Room {data.rooms.find(room => room.id === request.requestedRoomId)?.name ?? '-'}{request.approvedStartDate ? `, effective ${formatDate(request.approvedStartDate)}` : ''}</span>
        {wasDismissed
          ? <span className="room-change-review-dismissed">Dismissed</span>
          : <Button type="button" variant="ghost" size="sm" className="shrink-0" aria-label={`Dismiss transfer note for ${tenantName}`} onClick={() => dismiss(keyFor(request))}><X aria-hidden="true" />Dismiss</Button>}
      </li>
    })}</ul>
  </div>
}
