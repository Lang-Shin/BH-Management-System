import type { ReactNode } from 'react'
import { Heading, Text } from '@radix-ui/themes'
import { AnimatedNumber } from './animated-number'

/** The single h1 of a page, with an optional description and primary actions. */
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header">
    <div className="page-header-text">
      <Heading as="h1" size="7" weight="bold" trim="start">{title}</Heading>
      {description && <Text as="p" size="2" color="gray" mt="1">{description}</Text>}
    </div>
    {action && <div className="page-header-actions">{action}</div>}
  </div>
}

/** A titled block of a page. Renders an h2. */
export function Section({ id, title, description, action, children }: { id?: string; title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <section aria-labelledby={id} className="section">
    <div className="section-head">
      <div style={{ minWidth: 0 }}>
        <Heading as="h2" id={id} size="4" weight="bold">{title}</Heading>
        {description && <Text as="p" size="2" color="gray">{description}</Text>}
      </div>
      {action}
    </div>
    {children}
  </section>
}

export interface StatItem { label: string; value: string | number; detail?: ReactNode; tone?: 'danger' }

/** Key figures as one quiet strip. Each figure is a labelled group. */
export function StatStrip({ label, items }: { label: string; items: StatItem[] }) {
  return <section aria-label={label} className="stat-strip">
    {items.map(item => <div key={item.label} role="group" aria-label={item.label} data-tone={item.tone} className="stat">
      <Text as="p" size="2" color="gray" weight="medium">{item.label}</Text>
      <p className="stat-value"><AnimatedNumber value={item.value} /></p>
      {item.detail && <Text as="p" size="1" color="gray" mt="1">{item.detail}</Text>}
    </div>)}
  </section>
}

export function PreviewNotice({ children }: { children: ReactNode }) {
  return <Text as="p" size="2" color="gray" mb="5" style={{ maxWidth: '48rem' }}><Text weight="bold" color="gray" highContrast>Sample records.</Text> {children}</Text>
}
