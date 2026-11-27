import { useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { useOptionalAuth } from '@/app/providers/auth'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeftRight, Building2, LogOut } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface SidebarNavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

const TENANT_BASE = '/tenant'

function isTenantWorkspace(pathname: string) {
  return pathname === TENANT_BASE || pathname.startsWith(`${TENANT_BASE}/`)
}

/** Route-based workspace switch: /tenant hosts the tenant routes, everything else is landlord/admin. */
export function WorkspaceSwitchButton({ onNavigate }: { onNavigate?: () => void }) {
  return import.meta.env.DEV ? <WorkspaceSwitchButtonInner onNavigate={onNavigate} /> : null
}

function WorkspaceSwitchButtonInner({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const inTenant = isTenantWorkspace(location.pathname)
  return <button
    type="button"
    className="sidebar-link sidebar-switch flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-sm font-medium"
    onClick={() => {
      onNavigate?.()
      window.scrollTo(0, 0)
      navigate(inTenant ? '/dashboard' : TENANT_BASE)
      requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }))
    }}
  >
    <ArrowLeftRight className="size-[18px] shrink-0" aria-hidden="true" />
    <span>{inTenant ? 'Switch to Landlord UI' : 'Switch to Tenant UI'}</span>
  </button>
}

function Brand() {
  return <div className="flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-tomato shadow-[inset_0_1px_0_#ffffff40]"><Building2 className="size-5" aria-hidden="true" /></div><div className="min-w-0"><p className="brand-name text-2xl tracking-tight">Halili BH</p><p className="brand-acronym text-[1rem] tracking-widest text-muted-foreground">BHMS</p></div></div>
}

export function SidebarContent({ navItems, onNavigate, onLogout, topContent }: { navItems: SidebarNavItem[]; onNavigate?: () => void; onLogout: (event: MouseEvent<HTMLButtonElement>) => void; topContent?: ReactNode }) {
  return <div className="sidebar-surface flex h-full min-h-full flex-col px-3 py-5">
    <Brand />
    {topContent}
    <p className="mt-8 mb-2 px-3 text-xs font-semibold text-muted-foreground">Workspace</p>
    <nav aria-label="Main navigation" className="space-y-0.5">{navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={onNavigate} className="sidebar-link flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm font-medium"><Icon className="size-[18px] shrink-0" aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>
    <div className="mt-auto pt-12">
      <div className="space-y-0.5">
        <WorkspaceSwitchButton onNavigate={onNavigate} />
        <button type="button" className="sidebar-link sidebar-logout flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-sm font-medium" onClick={onLogout}><LogOut className="size-[18px] shrink-0" aria-hidden="true" /><span>Log out</span></button>
      </div>
      <p className="mt-3 border-t px-3 pt-4 text-xs text-muted-foreground">Boarding house management</p>
    </div>
  </div>
}

/** Sign-out is wired to the real authentication API when the app is in server mode. */
export function LogoutDialog({ open, onOpenChange, triggerRef }: { open: boolean; onOpenChange: (open: boolean) => void; triggerRef: RefObject<HTMLButtonElement | null> }) {
  const auth = useOptionalAuth()
  const [pending, setPending] = useState(false)
  const signedIn = auth?.status === 'authenticated'
  const signOut = async () => {
    if (!auth || pending) return
    setPending(true)
    try { await auth.signOut() } finally { setPending(false); onOpenChange(false); window.location.reload() }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md text-center" onCloseAutoFocus={event => {
      event.preventDefault()
      const trigger = triggerRef.current?.isConnected ? triggerRef.current : document.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')
      trigger?.focus()
    }}>
      <DialogHeader className="items-center">
        <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/15 text-[var(--tint)]"><LogOut className="size-6" aria-hidden="true" /></span>
        <DialogTitle>Log out of BHMS?</DialogTitle>
        <DialogDescription className="text-base leading-relaxed">{signedIn ? 'You will be signed out on this device. Your account records stay on the server.' : 'Sign in is not available in this local preview. Your saved records will stay in this browser.'}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="sm:justify-center">{signedIn ? <><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={signOut} disabled={pending}>{pending ? 'Signing out...' : 'Sign out'}</Button></> : <Button onClick={() => onOpenChange(false)}>Got it</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>
}
