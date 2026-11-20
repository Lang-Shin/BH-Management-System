import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAppearance } from '@/app/providers/appearance'
import { AnimatedPageTitle } from '@/components/shared/animated-page-title'
import { tenantNavigation } from '@/app/router/navigation'
import { DemoTenantSelector } from '@/features/tenant/demo-tenant-selector'
import { LogoutDialog, SidebarContent } from './sidebar'

/** Minimal tenant workspace shell: same layout language as the admin shell, but only tenant routes. */
export function TenantShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { appearance, toggle: toggleAppearance } = useAppearance()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const logoutTrigger = useRef<HTMLButtonElement | null>(null)
  const previousPath = useRef(location.pathname)
  const active = tenantNavigation.find(item => item.to === location.pathname)

  useEffect(() => {
    document.title = `Halili BH · ${active?.label ?? 'Tenant Workspace'}`
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus()
      window.scrollTo(0, 0)
      previousPath.current = location.pathname
    }
  }, [location.pathname, active?.label])

  const openLogout = (event: MouseEvent<HTMLButtonElement>) => { logoutTrigger.current = event.currentTarget; setLogoutOpen(true) }

  return <div className="min-h-dvh">
    <a href="#main-content" className="sr-only fixed top-3 left-3 z-50 rounded-md bg-primary p-3 text-white focus:not-sr-only">Skip to content</a>
    <aside className="shell-sidebar fixed inset-y-3 left-3 z-30 hidden w-60 overflow-y-auto lg:block"><SidebarContent navItems={tenantNavigation} topContent={<DemoTenantSelector />} onLogout={openLogout} /></aside>
    <div className="min-w-0 lg:pl-[16.5rem]">
      <header className="workspace-glass-header sticky top-2 z-20 mx-2 mt-2 flex min-h-16 items-center justify-between gap-3 rounded-[22px] px-3 sm:mx-4 sm:px-5 lg:top-3 lg:mt-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu"><Menu /></Button></SheetTrigger><SheetContent side="left" className="sidebar-surface inset-y-2 left-2 h-auto w-72 max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto rounded-[26px] p-0"><SheetHeader className="sr-only"><SheetTitle>Main menu</SheetTitle><SheetDescription>Choose Overview, My Payments &amp; Receipts, or My Room.</SheetDescription></SheetHeader><SidebarContent navItems={tenantNavigation} topContent={<DemoTenantSelector />} onNavigate={() => setMenuOpen(false)} onLogout={event => { logoutTrigger.current = event.currentTarget; setMenuOpen(false); setLogoutOpen(true) }} /></SheetContent></Sheet>
          <div className="min-w-0"><p className="brand-name text-[1rem] text-muted-foreground lg:hidden">Halili BH</p><AnimatedPageTitle key={location.pathname} text={active?.label ?? 'Tenant Workspace'} /></div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="appearance-toggle" aria-label={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); toggleAppearance({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) }}>
            {appearance === 'dark' ? <Sun className="size-[22px]" aria-hidden="true" /> : <Moon className="size-[22px]" aria-hidden="true" />}
          </Button>
        </div>
      </header>
      <div className="bhms-ambient-glow">
      <main id="main-content" ref={mainRef} tabIndex={-1} className="min-h-[calc(100dvh-6rem)] min-w-0 px-1 py-4 outline-none sm:px-2 sm:py-6 lg:px-3">
        <div key={location.pathname} className="route-content"><Outlet /></div>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground"><p className="text-[1rem]"><span className="brand-name">Halili BH</span> · <span className="brand-acronym">BHMS</span></p></footer>
      </main>
      </div>
    </div>
    <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} triggerRef={logoutTrigger} />
  </div>
}
