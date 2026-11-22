import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, CircleAlert, ArrowUp, Moon, Sun, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { usePrototype } from '@/hooks/use-prototype'
import { navigation } from '@/app/router/navigation'
import { AnimatedPageTitle } from '@/components/shared/animated-page-title'
import { NotificationCenter } from '@/components/layout/notification-center'
import { useAppearance } from '@/app/providers/appearance'
import { LogoutDialog, SidebarContent } from './sidebar'

export function AdminShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { storageWarning, pendingCommands, commandError, retryCommand, refreshFromServer } = usePrototype()
  const { appearance, toggle: toggleAppearance } = useAppearance()
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
    <aside className="shell-sidebar fixed inset-y-3 left-3 z-30 hidden w-60 overflow-y-auto lg:block"><SidebarContent navItems={navigation} onLogout={event => { logoutTrigger.current = event.currentTarget; setLogoutOpen(true) }} /></aside>
    <div className="min-w-0 lg:pl-[16.5rem]">
      <header className="workspace-glass-header sticky top-2 z-20 mx-2 mt-2 flex min-h-16 items-center justify-between gap-3 rounded-[22px] px-3 sm:mx-4 sm:px-5 lg:top-3 lg:mt-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu"><Menu /></Button></SheetTrigger><SheetContent side="left" className="sidebar-surface inset-y-2 left-2 h-auto w-72 max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto rounded-[26px] p-0"><SheetHeader className="sr-only"><SheetTitle>Main menu</SheetTitle><SheetDescription>Choose Dashboard, Tenants, Rooms, Billing, Payments, or Reports and Settings.</SheetDescription></SheetHeader><SidebarContent navItems={navigation} onNavigate={() => setMenuOpen(false)} onLogout={event => { logoutTrigger.current = event.currentTarget; setMenuOpen(false); setLogoutOpen(true) }} /></SheetContent></Sheet>
          <div className="min-w-0"><p className="brand-name text-[1rem] text-muted-foreground lg:hidden">Halili BH</p><AnimatedPageTitle key={location.pathname} text={active?.label ?? 'Page not found'} /></div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="appearance-toggle" aria-label={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); toggleAppearance({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) }}>
            {appearance === 'dark' ? <Sun className="size-[22px]" aria-hidden="true" /> : <Moon className="size-[22px]" aria-hidden="true" />}
          </Button>
          <NotificationCenter />
        </div>
      </header>
      <div className="bhms-ambient-glow">
      <main id="main-content" ref={mainRef} tabIndex={-1} className="min-h-[calc(100dvh-6rem)] min-w-0 px-1 py-4 outline-none sm:px-2 sm:py-6 lg:px-3">
        {storageWarning && <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-base text-amber-950"><CircleAlert className="mt-0.5 size-6 shrink-0" aria-hidden="true" /><div><p>{storageWarning}</p><NavLink to="/reports" className="mt-3 inline-flex min-h-12 items-center font-semibold underline">Open Reports &amp; Settings</NavLink></div></div>}
        {commandError && <div role="alert" className="mb-6 flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-base text-rose-800"><CircleAlert className="mt-0.5 size-6 shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1"><p>{commandError}</p><p className="mt-1 text-sm">The last server change was not accepted. Retry safely or refresh the authoritative records.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={retryCommand}>Retry safely</Button><Button type="button" variant="outline" onClick={refreshFromServer}><RefreshCw aria-hidden="true" />Refresh records</Button></div></div></div>}
        {pendingCommands > 0 && !commandError && <p role="status" className="mb-6 rounded-lg border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">Saving {pendingCommands === 1 ? 'one change' : `${pendingCommands} changes`} to the server…</p>}
        <div key={location.pathname} className="route-content"><Outlet /></div>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground"><p className="text-[1rem]"><span className="brand-name">Halili BH</span> · <span className="brand-acronym">BHMS</span></p>{location.pathname === '/dashboard' ? <button type="button" className="back-to-top-arrow" aria-label="Back to top" title="Back to top" onClick={() => {
          mainRef.current?.focus({ preventScroll: true })
          window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }}><ArrowUp aria-hidden="true" /></button> : <NavLink to="/dashboard" className="dashboard-return flex min-h-12 items-center font-medium"><span>Back to Dashboard</span></NavLink>}</footer>
      </main>
      </div>
    </div>
    <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} triggerRef={logoutTrigger} />
  </div>
}
