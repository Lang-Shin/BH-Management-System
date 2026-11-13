import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Building2, Menu, CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { usePrototype } from '@/hooks/use-prototype'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/shared/states'
import { navigation } from '@/app/router/navigation'

function Brand() {
  return <div className="flex items-center gap-3"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white"><Building2 className="size-7" aria-hidden="true" /></div><div className="min-w-0"><p className="text-xl font-bold tracking-tight">Halili BH</p><p className="text-sm text-muted-foreground">BHMS</p></div></div>
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return <div className="flex h-full flex-col px-5 py-7">
    <Brand />
    <p className="mt-9 mb-3 px-3 text-sm font-medium text-muted-foreground">Menu</p>
    <nav aria-label="Main navigation" className="space-y-2">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => cn('flex min-h-14 items-center gap-3 rounded-xl px-3 py-3 text-base font-semibold transition-colors', isActive ? 'bg-primary text-white' : 'text-foreground hover:bg-accent hover:text-primary')}><Icon className="size-5 shrink-0" aria-hidden="true" />{label}</NavLink>)}</nav>
  </div>
}

export function AdminShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { storageWarning } = usePrototype()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef(location.pathname)
  const active = navigation.find(item => item.to === location.pathname)

  useEffect(() => {
    document.title = `${active?.label ?? 'Page not found'} · Halili BH`
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus()
      window.scrollTo(0, 0)
      previousPath.current = location.pathname
    }
  }, [location.pathname, active?.label])

  return <div className="min-h-dvh">
    <a href="#main-content" className="sr-only fixed top-3 left-3 z-50 rounded-md bg-primary p-3 text-white focus:not-sr-only">Skip to content</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 overflow-y-auto border-r bg-card lg:block"><SidebarContent /></aside>
    <div className="min-w-0 lg:pl-72">
      <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b bg-card px-4 sm:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><Button variant="outline" className="lg:hidden" aria-label="Open menu"><Menu />Menu</Button></SheetTrigger><SheetContent side="left" className="w-80 max-w-[95vw] gap-0 overflow-y-auto p-0"><SheetHeader className="sr-only"><SheetTitle>Main menu</SheetTitle><SheetDescription>Choose Home, Tenants, Rooms, Bills, Payments, or Reports and Settings.</SheetDescription></SheetHeader><SidebarContent onNavigate={() => setMenuOpen(false)} /></SheetContent></Sheet>
          <div className="min-w-0"><p className="truncate text-base font-semibold">{active?.label ?? 'Page not found'}</p><p className="text-sm text-muted-foreground lg:hidden">Halili BH</p></div>
        </div>
        <p className="hidden shrink-0 text-sm text-muted-foreground sm:block">Sample records</p>
      </header>
      <main id="main-content" ref={mainRef} tabIndex={-1} className="mx-auto max-w-[1600px] p-4 outline-none sm:p-8 lg:p-9">
        {storageWarning && <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-base text-amber-950"><CircleAlert className="mt-0.5 size-6 shrink-0" aria-hidden="true" /><div><p>{storageWarning}</p><NavLink to="/reports" className="mt-3 inline-flex min-h-12 items-center font-semibold underline">Open Reports &amp; Settings</NavLink></div></div>}
        <Suspense fallback={<LoadingState />}><Outlet /></Suspense>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground"><p>Halili BH · BHMS</p><NavLink to="/dashboard" className="flex min-h-12 items-center font-medium hover:text-primary">Back to Home</NavLink></footer>
      </main>
    </div>
  </div>
}
