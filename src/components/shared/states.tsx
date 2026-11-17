import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Heading, Skeleton, Text } from '@radix-ui/themes'
import { CircleAlert, SearchX } from 'lucide-react'

export function EmptyState({ title = 'No results found', description = 'Try another search or clear your filters.', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div role="status" className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 24px', textAlign: 'center', borderStyle: 'dashed' }}>
    <SearchX size={22} color="var(--gray-10)" aria-hidden="true" />
    <Heading as="h2" size="3">{title}</Heading>
    <Text as="p" size="2" color="gray" style={{ maxWidth: '24rem' }}>{description}</Text>
    {action}
  </div>
}

export function LoadingState() {
  return <div role="status" aria-label="Opening records" style={{ display: 'grid', gap: 16 }}>
    <Text as="p" size="2" color="gray">Please wait, opening your records…</Text>
    <Skeleton height="20px" width="40%" />
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>{[1, 2, 3, 4].map(i => <Skeleton key={i} height="88px" />)}</div>
    <Skeleton height="288px" />
  </div>
}

export function ErrorState({ title = 'This page could not be opened', description = 'Please try opening the page again. Your saved records have not been changed.', onRetry }: { title?: string; description?: string; onRetry: () => void }) {
  return <div role="alert" className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '56px 24px', textAlign: 'center' }}>
    <CircleAlert size={28} color="var(--red-10)" aria-hidden="true" />
    <Heading as="h1" size="5">{title}</Heading>
    <Text as="p" size="2" color="gray" style={{ maxWidth: '28rem' }}>{description}</Text>
    <Button onClick={onRetry}>Try again</Button>
  </div>
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('BHMS rendering error', error, info.componentStack) }
  render() { return this.state.failed ? <ErrorState onRetry={() => window.location.reload()} /> : this.props.children }
}
