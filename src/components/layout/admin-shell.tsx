import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Building2, Menu, RotateCcw, FlaskConical, CircleAlert, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/shared/states'
import { navigation } from '@/app/router/navigation'

function Brand() {
  return <div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white"><Building2 className="size-6" aria-hidden="true" /></div><div className="min-w-0"><p className="text-lg font-bold tracking-tight">BHMS</p><p className="mt-1 text-sm leading-snug text-muted-foreground">Boarding House Management System</p></div></div>
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return <div className="flex h-full flex-col px-5 py-7">
    <Brand />
    <div className="mt-9 rounded-xl border bg-muted/60 px-3 py-3"><p className="text-sm font-semibold">Maple House</p><p className="mt-1 text-xs text-muted-foreground">Fictional demo property</p></div>
    <p className="mt-8 mb-3 px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Workspace</p>
    <nav aria-label="Main navigation" className="space-y-1.5">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => cn('flex min-h-11 items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors', isActive ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-primary')}><Icon className="size-[18px]" aria-hidden="true" />{label}</NavLink>)}</nav>
    <div className="mt-auto pt-8"><div className="rounded-xl bg-accent p-4"><FlaskConical className="mb-2 size-5 text-primary" aria-hidden="true" /><p className="text-sm font-semibold">Prototype workspace</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Explore fictional records and share feedback on the proposed features.</p></div><p className="mt-5 text-center text-xs text-muted-foreground">Admin prototype · Phase 1</p></div>
  </div>
}

export function AdminShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const { dispatch, storageWarning } = usePrototype()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef(location.pathname)
  const active = navigation.find(item => item.to === location.pathname)

  useEffect(() => {
    document.title = `${active?.label ?? 'Page not found'} · BHMS prototype`
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus()
      window.scrollTo(0, 0)
      previousPath.current = location.pathname
    }
  }, [location.pathname, active?.label])

  return <div className="min-h-dvh">
    <a href="#main-content" className="sr-only fixed top-3 left-3 z-50 rounded-md bg-primary p-3 text-white focus:not-sr-only">Skip to content</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r bg-card lg:block"><SidebarContent /></aside>
    <div className="min-w-0 lg:pl-64">
      <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur-sm sm:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu /></Button></SheetTrigger><SheetContent side="left" className="w-72 max-w-[90vw] gap-0 overflow-y-auto p-0"><SheetHeader className="sr-only"><SheetTitle>Admin navigation</SheetTitle><SheetDescription>Navigate between BHMS modules.</SheetDescription></SheetHeader><SidebarContent onNavigate={() => setMenuOpen(false)} /></SheetContent></Sheet>
          <div className="min-w-0"><p className="truncate text-sm text-muted-foreground"><span className="hidden sm:inline">Workspace <span aria-hidden="true" className="px-2">/</span> </span><span className="text-foreground">{active?.label ?? 'Not found'}</span></p><p className="mt-1 hidden text-xs text-muted-foreground sm:block">BHMS · Demo workspace</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3"><Badge variant="outline" className="hidden gap-1.5 border-primary/20 bg-accent py-1.5 text-primary sm:inline-flex"><FlaskConical className="size-3" aria-hidden="true" />Prototype</Badge>
          <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogTrigger asChild><Button variant="ghost" size="sm" aria-label="Reset demo"><RotateCcw /><span className="hidden md:inline">Reset demo</span></Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Reset the demo workspace?</DialogTitle><DialogDescription>This replaces saved demo notes and room status changes with the original fictional sample data.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button onClick={() => { dispatch({ type: 'demo/reset' }); setResetOpen(false); setNotice('Demo workspace reset to the original sample data.'); }}>Reset demo</Button></DialogFooter></DialogContent></Dialog>
          <div className="flex items-center gap-2"><span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-semibold" aria-hidden="true">DA</span><span className="sr-only xl:not-sr-only xl:text-sm">Demo administrator<span className="sr-only"> · Display only, no authentication</span></span></div>
        </div>
      </header>
      <div className="border-b border-amber-200/70 bg-amber-50 px-4 py-2.5 text-center text-xs leading-relaxed text-amber-950 sm:px-8"><span className="font-semibold">Demo workspace</span> · Fictional data only · Sample period: November 2026 · Changes stay in this browser.</div>
      <main id="main-content" ref={mainRef} tabIndex={-1} className="mx-auto max-w-[1600px] p-4 outline-none sm:p-8 lg:p-9">
        <div role="status" className="sr-only">{notice}</div>
        {storageWarning && <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p>{storageWarning}</p></div>}
        <Suspense fallback={<LoadingState />}><Outlet /></Suspense>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground"><p>Boarding House Management System · Prototype</p><NavLink to="/dashboard" className="flex min-h-11 items-center gap-1 hover:text-primary">Demo overview <ArrowUpRight className="size-4" aria-hidden="true" /></NavLink></footer>
      </main>
    </div>
  </div>
}
