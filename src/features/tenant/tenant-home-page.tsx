import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'

/** Route foundation placeholder for the tenant workspace; real tenant features arrive in a later phase. */
export default function TenantHome() {
  return <>
    <PageHeader title="Tenant Workspace — Coming Soon" description="A dedicated tenant space for viewing bills, payments, and receipts is planned for a future phase of BHMS." />
    <EmptyState title="Nothing here yet" description="Tenant receipts, payments, and room details will arrive with the next phase. Use the switch button in the sidebar to return to the landlord workspace." />
  </>
}
