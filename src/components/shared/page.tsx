import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
    <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p></div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
}

export function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: LucideIcon }) {
  return <Card className="gap-0 py-5 shadow-none"><CardContent>
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm text-muted-foreground">{label}</h2><span className="rounded-lg bg-accent p-2 text-primary"><Icon className="size-4" aria-hidden="true" /></span></div>
    <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
  </CardContent></Card>
}

export function PreviewNotice({ children }: { children: ReactNode }) {
  return <div className="mb-6 rounded-lg border border-dashed border-primary/30 bg-accent/60 px-4 py-3 text-sm leading-relaxed text-primary"><strong className="font-semibold">Module preview.</strong> {children}</div>
}
