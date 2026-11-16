import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ROOM_RATE_CATEGORIES } from '@/lib/room-rates'

export function AddRoomDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setStep('form')
    setOpen(nextOpen)
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button><Plus aria-hidden="true" />Add room</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      {step === 'form'
        ? <>
            <DialogHeader className="pr-6"><DialogTitle>Add a room</DialogTitle><DialogDescription>Enter sample details to preview the form. Nothing is saved yet.</DialogDescription></DialogHeader>
            <form className="grid gap-5" noValidate onSubmit={event => { event.preventDefault(); setStep('success') }}>
              <div className="grid gap-2">
                <label htmlFor="add-room-name" className="text-sm font-semibold">Room number or name</label>
                <Input id="add-room-name" placeholder="For example: 107" className="h-12 bg-card" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="add-room-floor" className="text-sm font-semibold">Floor</label>
                  <Input id="add-room-floor" type="number" defaultValue={1} className="h-12 bg-card" />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="add-room-beds" className="text-sm font-semibold">Number of beds</label>
                  <Input id="add-room-beds" type="number" defaultValue={1} aria-describedby="add-room-beds-help" className="h-12 bg-card" />
                </div>
              </div>
              <p id="add-room-beds-help" className="-mt-3 text-sm text-muted-foreground">Bed counts are for reference only and do not determine room availability.</p>
              <div className="grid gap-2">
                <label htmlFor="add-room-rate" className="text-sm font-semibold">Monthly rental rate</label>
                <select id="add-room-rate" defaultValue="RATE_3500" className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {ROOM_RATE_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}/month</option>)}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="add-room-type" className="text-sm font-semibold">Room type</label>
                  <select id="add-room-type" defaultValue="PRIVATE" className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <option value="PRIVATE">Private</option>
                    <option value="SHARED">Shared</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="add-room-status" className="text-sm font-semibold">Room status</label>
                  <select id="add-room-status" defaultValue="available" className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <option value="available">Available</option>
                    <option value="maintenance">Under repair</option>
                  </select>
                </div>
              </div>
              <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit"><Plus aria-hidden="true" />Add room</Button></DialogFooter>
            </form>
          </>
        : <>
            <DialogHeader className="items-start">
              <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent text-primary"><Check className="size-6" aria-hidden="true" /></span>
              <DialogTitle>Room added successfully</DialogTitle>
              <DialogDescription className="text-base leading-relaxed" role="status">This is a sample confirmation. No new room was saved to the list.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></DialogFooter>
          </>}
    </DialogContent>
  </Dialog>
}
