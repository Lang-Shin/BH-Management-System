import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CalendarClock, CheckCheck, CircleAlert, Wallet, Wrench, type LucideIcon } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { selectNotifications, type NotificationKind } from '@/features/notifications/select-notifications'
import { useNotificationReadState } from '@/features/notifications/use-notification-read-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon" className="notification-bell relative" aria-label={label}>
        <Bell className="size-[22px]" aria-hidden="true" />
        {unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={10} collisionPadding={12} className="notification-panel p-0" aria-labelledby="notifications-heading">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p id="notifications-heading" className="font-semibold">Notifications</p>
          <p className="text-xs text-muted-foreground">From the current sample records</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn('min-h-11 shrink-0 px-2 text-sm', unreadCount === 0 && 'opacity-50')}
          aria-disabled={unreadCount === 0}
          onClick={() => { if (unreadCount > 0) markAllRead(notifications.map(notification => notification.id)) }}
        >
          Mark all as read
        </Button>
      </div>
      {notifications.length === 0
        ? <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="status">
            <span className="rounded-full bg-accent p-3"><CheckCheck className="size-6 text-[var(--tint)]" aria-hidden="true" /></span>
            <p className="font-semibold">You’re all caught up</p>
            <p className="text-sm text-muted-foreground">No bills, rooms, or advance payments need attention.</p>
          </div>
        : <ul className="max-h-[min(60dvh,24rem)] overflow-y-auto p-2">
            {notifications.map(notification => {
              const unread = !readIds.includes(notification.id)
              const Icon = icons[notification.kind]
              return <li key={notification.id}>
                <Link
                  to={notification.href}
                  data-kind={notification.kind}
                  className={cn('notification-item', unread && 'notification-item-unread')}
                  onClick={() => { markRead(notification.id); setOpen(false) }}
                >
                  <span className="notification-item-icon"><Icon className="size-5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{unread && <span className="sr-only">Unread: </span>}{notification.title}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{notification.description}</span>
                  </span>
                  {unread && <span className="notification-unread-dot" aria-hidden="true" />}
                </Link>
              </li>
            })}
          </ul>}
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">Sample alerts only. No reminders are sent.</p>
    </PopoverContent>
  </Popover>
}
