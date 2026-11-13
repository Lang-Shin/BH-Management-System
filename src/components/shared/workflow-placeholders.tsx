import { Badge } from '@/components/ui/badge'

export function WorkflowPlaceholders({ title = 'Planned workflows', items }: { title?: string; items: { title: string; description: string }[] }) {
  return <section className="mt-7 rounded-xl border border-dashed bg-card p-5 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center gap-3"><h2 className="font-semibold">{title}</h2><Badge variant="secondary">Prototype placeholders · Not implemented</Badge></div>
    <dl className="grid gap-5 md:grid-cols-2">{items.map(item => <div key={item.title}><dt className="text-sm font-semibold">{item.title}</dt><dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</dd></div>)}</dl>
  </section>
}
