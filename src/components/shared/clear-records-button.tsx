import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { clearReadIds } from '@/features/notifications/read-state'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'

export function ClearRecordsButton() {
  const { clearAllRecords, canClearRecords, pendingCommands } = usePrototype()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function changeOpen(next: boolean) {
    if (clearing) return
    setOpen(next)
    if (!next) {
      setConfirmation('')
      setError('')
    }
  }

  async function confirm() {
    if (clearing || confirmation !== 'RESET' || pendingCommands > 0) return
    setClearing(true)
    setError('')
    const warning = await clearAllRecords()
    setClearing(false)
    if (warning) {
      setError(`Records were not cleared. ${warning}`)
      return
    }
    try { window.localStorage.removeItem(TENANT_DEMO_STORAGE_KEY) } catch { /* Preference cleanup is optional. */ }
    clearReadIds()
    setConfirmation('')
    setOpen(false)
    setNotice('All tenant and financial records were cleared. Room configuration was preserved.')
  }

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!canClearRecords} title={canClearRecords ? undefined : 'Clearing records is disabled for this workspace'}>
          <Trash2 aria-hidden="true" />Clear All Records
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="pr-6">
          <DialogTitle>Clear all records?</DialogTitle>
          <DialogDescription>This permanently removes tenants, occupancy and rental history, advances, deposits, payments, allocations, receipts, utilities, meter readings, corrections, review cases, reservations, and transfer requests. Rooms, room IDs, room types, rental rates, and application settings remain.</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-destructive/30 bg-rose-50 p-3 text-sm text-rose-800">This is a development/test-workspace reset. It cannot be undone and does not restore sample records.</p>
        <label className="block text-sm font-semibold">Type <strong>RESET</strong> to confirm
          <input
            className="mt-2 min-h-12 w-full rounded-lg border bg-card px-3"
            value={confirmation}
            onChange={event => { setConfirmation(event.target.value); setError('') }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(confirmation && confirmation !== 'RESET')}
          />
        </label>
        {pendingCommands > 0 && <p className="text-sm text-muted-foreground">Wait for {pendingCommands} pending change{pendingCommands === 1 ? '' : 's'} to finish before clearing.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={clearing}>Cancel</Button></DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={clearing || confirmation !== 'RESET' || pendingCommands > 0}>
            {clearing ? 'Clearing…' : 'Clear All Records'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <p role="status" className="mt-3 text-sm text-[var(--tint)]">{notice}</p>
  </>
}
