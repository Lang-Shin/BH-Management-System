import { Component, type ErrorInfo, type ReactNode } from 'react'
import { CircleAlert, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function EmptyState({ title = 'No results found', description = 'Try another search or clear your filters.', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="status"><SearchX className="size-9 text-muted-foreground" aria-hidden="true" /><h2 className="font-semibold">{title}</h2><p className="max-w-sm text-sm text-muted-foreground">{description}</p>{action}</div>
}

export function LoadingState() {
  return <div role="status" aria-label="Opening records" className="space-y-6"><p className="text-base font-medium">Please wait, opening your records…</p><Skeleton className="h-5 w-3/4" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36" />)}</div><Skeleton className="h-72 w-full" /></div>
}

export function ErrorState({ title = 'This page could not be opened', description = 'Please try opening the page again. Your saved records have not been changed.', onRetry }: { title?: string; description?: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-xl border bg-card px-6 py-14 text-center"><CircleAlert className="mx-auto mb-4 size-9 text-destructive" aria-hidden="true" /><h1 className="text-2xl font-semibold">{title}</h1><p className="mx-auto my-5 max-w-md text-base text-muted-foreground">{description}</p><Button onClick={onRetry}>Try again</Button></div>
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('BHMS rendering error', error, info.componentStack) }
  render() { return this.state.failed ? <ErrorState onRetry={() => window.location.reload()} /> : this.props.children }
}
