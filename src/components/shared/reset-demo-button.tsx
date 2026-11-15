import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { clearReadIds } from '@/features/notifications/read-state'

export function ResetDemoButton() {
  const { dispatch } = usePrototype()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  return <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><RotateCcw />Restore sample records</Button></DialogTrigger>
      <DialogContent><DialogHeader className="pr-6"><DialogTitle>Restore the sample records?</DialogTitle><DialogDescription>This brings back the original sample records and removes your saved notes and room changes. The Halili BH name and design will stay the same.</DialogDescription></DialogHeader>
        <DialogFooter><DialogClose asChild><Button variant="outline">Keep my changes</Button></DialogClose><Button onClick={() => { clearReadIds(); dispatch({ type: 'demo/reset' }); setOpen(false); setNotice('The original sample records have been restored.'); }}>Yes, restore records</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <p role="status" className="mt-3 text-sm text-primary">{notice}</p>
  </>
}
