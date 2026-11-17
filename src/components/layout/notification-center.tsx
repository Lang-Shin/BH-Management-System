import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, IconButton, Popover, Text } from '@radix-ui/themes'
import { Bell, CalendarClock, CheckCheck, CircleAlert, Wallet, Wrench, type LucideIcon } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { selectNotifications, type NotificationKind } from '@/features/notifications/select-notifications'
import { useNotificationReadState } from '@/features/notifications/use-notification-read-state'

const icons: Record<NotificationKind, LucideIcon> = {
  overdue: CircleAlert,
  'due-soon': CalendarClock,
  repair: Wrench,
  credit: Wallet,
}

export function NotificationCenter() {
  const { data } = usePrototype()
  const notifications = selectNotifications(data, DEMO_DATE)
  const { readIds, markRead, markAllRead } = useNotificationReadState()
  const [open, setOpen] = useState(false)
  const unreadCount = notifications.filter(notification => !readIds.includes(notification.id)).length
  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger>
      <IconButton variant="ghost" color="gray" size="3" className="relative" style={{ position: 'relative' }} aria-label={label}>
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 && <span className="bell-dot" aria-hidden="true" />}
      </IconButton>
    </Popover.Trigger>
    <Popover.Content align="end" sideOffset={8} collisionPadding={12} width="22rem" maxWidth="calc(100vw - 2rem)" size="1" style={{ padding: 0 }} aria-labelledby="notifications-heading">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--gray-5)' }}>
        <div>
          <Text as="p" id="notifications-heading" size="2" weight="bold">Notifications</Text>
          <Text as="p" size="1" color="gray">Sample alerts only. No reminders are sent.</Text>
        </div>
        <Button variant="ghost" size="2" aria-disabled={unreadCount === 0} style={unreadCount === 0 ? { opacity: 0.5 } : undefined} onClick={() => { if (unreadCount > 0) markAllRead(notifications.map(notification => notification.id)) }}>Mark all as read</Button>
      </div>
      {notifications.length === 0
        ? <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '40px 24px', textAlign: 'center' }}>
            <CheckCheck size={22} color="var(--accent-11)" aria-hidden="true" />
            <Text as="p" size="2" weight="bold">You’re all caught up</Text>
            <Text as="p" size="2" color="gray">No bills, rooms, or advance payments need attention.</Text>
          </div>
        : <ul className="row-list" style={{ maxHeight: 'min(60dvh, 24rem)', overflowY: 'auto' }}>
            {notifications.map(notification => {
              const unread = !readIds.includes(notification.id)
              const Icon = icons[notification.kind]
              return <li key={notification.id}>
                <Link to={notification.href} data-kind={notification.kind} className="notification-row" onClick={() => { markRead(notification.id); setOpen(false) }}>
                  <Icon aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text as="span" size="2" weight={unread ? 'bold' : 'regular'} style={{ display: 'block' }}>{unread && <span className="sr-only">Unread: </span>}{notification.title}</Text>
                    <Text as="span" size="2" color="gray" style={{ display: 'block' }}>{notification.description}</Text>
                  </span>
                  {unread && <span className="unread-dot" aria-hidden="true" />}
                </Link>
              </li>
            })}
          </ul>}
    </Popover.Content>
  </Popover.Root>
}
