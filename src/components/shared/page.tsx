import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
    <div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{description}</p></div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
}

export function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: LucideIcon }) {
  return <Card className="gap-0 py-5 shadow-none"><CardContent>
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-medium">{label}</h2><span className="shrink-0 rounded-lg bg-accent p-2.5 text-primary"><Icon className="size-5" aria-hidden="true" /></span></div>
    <p className="mt-4 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p>
  </CardContent></Card>
}

export function PreviewNotice({ children }: { children: ReactNode }) {
  return <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground"><strong className="font-semibold text-foreground">Sample records.</strong> {children}</p>
}
