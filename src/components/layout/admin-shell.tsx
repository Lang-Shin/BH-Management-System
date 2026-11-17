import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button, Callout, Dialog, Flex, IconButton, Text, VisuallyHidden } from '@radix-ui/themes'
import { CircleAlert, LogOut, Menu, Moon, Sun } from 'lucide-react'
import { useAppearance } from '@/app/providers/appearance'
import { usePrototype } from '@/hooks/use-prototype'
import { navigation } from '@/app/router/navigation'
import { NotificationCenter } from '@/components/layout/notification-center'

function Brand() {
  return <div className="sidebar-brand"><span className="brand-name">Halili BH</span><Text size="1" color="gray">Boarding house management</Text></div>
}

function SidebarContent({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <div className="sidebar">
    <Brand />
    <nav aria-label="Main navigation" className="sidebar-nav">
      {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className="sidebar-link"><Icon aria-hidden="true" /><span>{label}</span></NavLink>)}
    </nav>
    <div className="sidebar-foot">
      <button type="button" className="sidebar-link" onClick={onLogout}><LogOut aria-hidden="true" /><span>Log out</span></button>
    </div>
  </div>
}

export function AdminShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { storageWarning } = usePrototype()
  const { appearance, toggle: toggleAppearance } = useAppearance()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const logoutTrigger = useRef<HTMLButtonElement | null>(null)
  const previousPath = useRef(location.pathname)
  const active = navigation.find(item => item.to === location.pathname)

  useEffect(() => {
    document.title = `Halili BH · ${active?.label ?? 'Page not found'}`
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus()
      window.scrollTo(0, 0)
      previousPath.current = location.pathname
    }
  }, [location.pathname, active?.label])

  return <div>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="shell-sidebar"><SidebarContent onLogout={event => { logoutTrigger.current = event.currentTarget; setLogoutOpen(true) }} /></aside>
    <div className="shell-body">
      <header className="topbar">
        <div className="topbar-context">
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger><IconButton className="topbar-menu" variant="soft" color="gray" aria-label="Open menu"><Menu size={18} /></IconButton></Dialog.Trigger>
            <Dialog.Content className="nav-drawer" aria-describedby={undefined}>
              <VisuallyHidden><Dialog.Title>Main menu</Dialog.Title></VisuallyHidden>
              <SidebarContent onNavigate={() => setMenuOpen(false)} onLogout={event => { logoutTrigger.current = event.currentTarget; setMenuOpen(false); setLogoutOpen(true) }} />
            </Dialog.Content>
          </Dialog.Root>
          <Text size="2" color="gray" weight="medium" className="num">{active?.label ?? 'Page not found'}</Text>
        </div>
        <Flex align="center" gap="2">
          <IconButton variant="ghost" color="gray" size="3" aria-label={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleAppearance}>
            {appearance === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          </IconButton>
          <NotificationCenter />
        </Flex>
      </header>
      <main id="main-content" ref={mainRef} tabIndex={-1} className="content">
        {storageWarning && <Callout.Root color="amber" role="alert" mb="5"><Callout.Icon><CircleAlert size={18} aria-hidden="true" /></Callout.Icon><Callout.Text>{storageWarning} <NavLink to="/reports">Open Reports &amp; Settings</NavLink></Callout.Text></Callout.Root>}
        <div key={location.pathname} className="route-content"><Outlet /></div>
      </main>
    </div>
    <Dialog.Root open={logoutOpen} onOpenChange={setLogoutOpen}>
      <Dialog.Content maxWidth="26rem" onCloseAutoFocus={event => {
        event.preventDefault()
        const trigger = logoutTrigger.current?.isConnected ? logoutTrigger.current : document.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')
        trigger?.focus()
      }}>
        <Dialog.Title size="4">Log out of BHMS?</Dialog.Title>
        <Dialog.Description size="2" color="gray">Signing out is not available in this sample yet. Your saved sample records will stay in this browser.</Dialog.Description>
        <Flex justify="end" mt="4"><Button onClick={() => setLogoutOpen(false)}>Got it</Button></Flex>
      </Dialog.Content>
    </Dialog.Root>
  </div>
}
