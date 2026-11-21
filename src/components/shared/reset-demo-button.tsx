import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { clearReadIds } from '@/features/notifications/read-state'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'

export function ResetDemoButton() {
  const { resetToSample } = usePrototype()
  const [open, setOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function changeOpen(next: boolean) {
    if (restoring) return
    setOpen(next)
    if (!next) setError('')
  }

  async function confirm() {
    if (restoring) return
    setRestoring(true)
    setError('')
    const warning = await resetToSample()
    setRestoring(false)
    if (warning) {
      setError(`The sample records could not be restored. ${warning}`)
      return
    }
    try {
      // This selection belongs to the demo dataset; clearing it prevents a stale tenant from being shown.
      window.localStorage.removeItem(TENANT_DEMO_STORAGE_KEY)
    } catch {
      // The reset itself is already persisted; a blocked preference write should not imply failure.
    }
    clearReadIds()
    setOpen(false)
    setNotice('The original sample records have been restored.')
  }

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button variant="outline"><RotateCcw />Restore sample records</Button></DialogTrigger>
      <DialogContent><DialogHeader className="pr-6"><DialogTitle>Restore the sample records?</DialogTitle><DialogDescription>This discards every change you made to this prototype: rooms, tenants, tenancy history, bills, rates, meter readings, payments, corrections, and receipts. The original sample records will be restored. This cannot be undone. The Halili BH name and design will stay the same.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><DialogClose asChild><Button variant="outline" disabled={restoring}>Keep my changes</Button></DialogClose><Button onClick={confirm} disabled={restoring}>{restoring ? 'Restoring…' : 'Yes, restore records'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <p role="status" className="mt-3 text-sm text-[var(--tint)]">{notice}</p>
  </>
}
