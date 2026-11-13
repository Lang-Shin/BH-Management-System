export function WorkflowPlaceholders({ title = 'More tools', items }: { title?: string; items: { title: string; description: string }[] }) {
  return <details className="mt-8 rounded-xl border bg-card p-5 sm:p-6">
    <summary className="cursor-pointer text-base font-semibold">{title}<span className="ml-3 inline-block text-sm font-normal text-muted-foreground">Coming later</span></summary>
    <p className="mt-4 text-sm text-muted-foreground">These tools are not available yet.</p>
    <dl className="mt-5 grid gap-5 md:grid-cols-2">{items.map(item => <div key={item.title}><dt className="text-base font-semibold">{item.title}</dt><dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</dd></div>)}</dl>
  </details>
}
