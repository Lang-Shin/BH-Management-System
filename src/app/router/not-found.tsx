import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'

export function NotFound() {
  return <EmptyState title="This page could not be found" description="Go back to Dashboard and choose a page from the menu." action={<Button asChild><Link to="/dashboard">Back to Dashboard</Link></Button>} />
}
