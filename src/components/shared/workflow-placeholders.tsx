import { Text } from '@radix-ui/themes'
import './shared-parts.css'

export function WorkflowPlaceholders({ title = 'More tools', items }: { title?: string; items: { title: string; description: string }[] }) {
  return <details className="disclosure">
    <summary>{title}<Text size="1" color="gray" weight="regular">Coming later</Text></summary>
    <div className="disclosure-body">
      <Text as="p" size="2" color="gray">These tools are not available yet.</Text>
      <dl style={{ display: 'grid', gap: 16, margin: '16px 0 0' }}>{items.map(item => <div key={item.title}><dt><Text size="2" weight="bold">{item.title}</Text></dt><dd style={{ margin: '4px 0 0' }}><Text size="2" color="gray">{item.description}</Text></dd></div>)}</dl>
    </div>
  </details>
}
