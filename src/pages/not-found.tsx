import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'

export function NotFound() {
  return <EmptyState title="This page has no room here" description="The page you requested doesn’t exist in this prototype." action={<Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>} />
}
