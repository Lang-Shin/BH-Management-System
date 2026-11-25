import { RentRateManager } from './rent-rate-manager'
import { UtilityRateManager } from './utility-rate-manager'

type RateCategory = 'RENT' | 'ELECTRICITY' | 'WATER' | 'WASHING_MACHINE'

export function BillingRateDialog({ kind, title, onSaved, onClose }: {
  kind: RateCategory
  title: string
  onSaved: (message: string) => void
  onClose: () => void
}) {
  if (kind === 'RENT') return <RentRateManager onSaved={onSaved} onClose={onClose} />
  return <UtilityRateManager kind={kind} title={title} onSaved={onSaved} onClose={onClose} />
}
