import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Building2, Menu, CircleAlert, ArrowUp, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { navigation } from '@/app/router/navigation'
import { AnimatedPageTitle } from '@/components/shared/animated-page-title'

function Brand() {
  return <div className="flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tomato"><Building2 className="size-5" aria-hidden="true" /></div><div className="min-w-0"><p className="brand-name text-2xl tracking-tight">Halili BH</p><p className="brand-acronym text-[1rem] tracking-widest text-muted-foreground">BHMS</p></div></div>
}

function SidebarContent({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <div className="sidebar-surface flex h-full min-h-full flex-col px-4 py-6">
    <Brand />
    <p className="mt-10 mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Workspace</p>
    <nav aria-label="Main navigation" className="space-y-1">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className="sidebar-link flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold"><Icon className="size-[18px] shrink-0" aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>
    <div className="mt-auto pt-12">
      <button type="button" className="sidebar-link sidebar-logout flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold" onClick={onLogout}><LogOut className="size-[18px] shrink-0" aria-hidden="true" /><span>Log out</span></button>
      <p className="mt-3 border-t px-3 pt-5 text-xs text-muted-foreground">Boarding house management</p>
    </div>
  </div>
}

export function AdminShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { storageWarning } = usePrototype()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const logoutTrigger = useRef<HTMLButtonElement | null>(null)
  const previousPath = useRef(location.pathname)
  const active = navigation.find(item => item.to === location.pathname)

  useEffect(() => {
    document.title = `Halili BH · ${active?.label ?? 'Page not found'} `
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus()
      window.scrollTo(0, 0)
      previousPath.current = location.pathname
    }
  }, [location.pathname, active?.label])

  return <div className="min-h-dvh">
    <a href="#main-content" className="sr-only fixed top-3 left-3 z-50 rounded-md bg-primary p-3 text-white focus:not-sr-only">Skip to content</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 overflow-y-auto bg-sidebar lg:block"><SidebarContent onLogout={event => { logoutTrigger.current = event.currentTarget; setLogoutOpen(true) }} /></aside>
    <div className="min-w-0 lg:pl-60">
      <header className="workspace-glass-header sticky top-0 z-20 flex min-h-18 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu"><Menu /></Button></SheetTrigger><SheetContent side="left" className="sidebar-surface w-72 max-w-[90vw] gap-0 overflow-y-auto p-0"><SheetHeader className="sr-only"><SheetTitle>Main menu</SheetTitle><SheetDescription>Choose Dashboard, Tenants, Rooms, Billing, Payments, or Reports and Settings.</SheetDescription></SheetHeader><SidebarContent onNavigate={() => setMenuOpen(false)} onLogout={event => { logoutTrigger.current = event.currentTarget; setMenuOpen(false); setLogoutOpen(true) }} /></SheetContent></Sheet>
          <div className="min-w-0"><p className="brand-name text-[1rem] text-muted-foreground lg:hidden">Halili BH</p><AnimatedPageTitle key={location.pathname} text={active?.label ?? 'Page not found'} /></div>
        </div>
        <p className="hidden shrink-0 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground sm:block">Sample records</p>
      </header>
      <div className="bhms-ambient-glow">
      <main id="main-content" ref={mainRef} tabIndex={-1} className="min-h-[calc(100dvh-5.5rem)] min-w-0 rounded-2xl border bg-card p-4 outline-none sm:p-6 lg:p-7">
        {storageWarning && <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-base text-amber-950"><CircleAlert className="mt-0.5 size-6 shrink-0" aria-hidden="true" /><div><p>{storageWarning}</p><NavLink to="/reports" className="mt-3 inline-flex min-h-12 items-center font-semibold underline">Open Reports &amp; Settings</NavLink></div></div>}
        <div key={location.pathname} className="route-content"><Outlet /></div>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground"><p className="text-[1rem]"><span className="brand-name">Halili BH</span> · <span className="brand-acronym">BHMS</span></p>{location.pathname === '/dashboard' ? <button type="button" className="back-to-top-arrow" aria-label="Back to top" title="Back to top" onClick={() => {
          mainRef.current?.focus({ preventScroll: true })
          window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }}><ArrowUp aria-hidden="true" /></button> : <NavLink to="/dashboard" className="dashboard-return flex min-h-12 items-center font-medium"><span>Back to Dashboard</span></NavLink>}</footer>
      </main>
      </div>
    </div>
    <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
      <DialogContent className="max-w-md text-center" onCloseAutoFocus={event => {
        event.preventDefault()
        const trigger = logoutTrigger.current?.isConnected ? logoutTrigger.current : document.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')
        trigger?.focus()
      }}>
        <DialogHeader className="items-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent text-primary"><LogOut className="size-6" aria-hidden="true" /></span>
          <DialogTitle>Log out of BHMS?</DialogTitle>
          <DialogDescription className="text-base leading-relaxed">Signing out is not available in this sample yet. Your saved sample records will stay in this browser.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center"><Button onClick={() => setLogoutOpen(false)}>Got it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
