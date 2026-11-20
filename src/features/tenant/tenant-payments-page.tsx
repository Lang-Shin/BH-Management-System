import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'

/** Layout-phase placeholder; tenant receipt viewing arrives in a later phase. */
export default function TenantPayments() {
  return <>
    <PageHeader title="My Payments & Receipts" description="Recorded payments and receipts for your stay will appear here." />
    <EmptyState title="Tenant receipts are coming soon" description="This phase builds the tenant workspace layout. Receipt viewing arrives in a later phase, while the landlord workspace continues to manage billing for now." />
  </>
}
