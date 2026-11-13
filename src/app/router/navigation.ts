import { ChartNoAxesCombined, DoorOpen, LayoutDashboard, ReceiptText, Users, Wallet } from 'lucide-react'

export const navigation = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tenants', label: 'Tenants', icon: Users },
  { to: '/rooms', label: 'Rooms', icon: DoorOpen },
  { to: '/billing', label: 'Billing', icon: ReceiptText },
  { to: '/payments', label: 'Payments & Receipts', icon: Wallet },
  { to: '/reports', label: 'Reports & Settings', icon: ChartNoAxesCombined },
]
