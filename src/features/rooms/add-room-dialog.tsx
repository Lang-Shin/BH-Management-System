import { useRef, useState, type FormEvent } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { validateRoomDraft, type RoomDraft, type RoomDraftErrors } from '@/domain/calculations/room-management'
import { activeRoomRentRate, ROOM_RATE_CATEGORY_IDS } from '@/domain/calculations/billing-rates'
import { roomCategoryLabel } from '@/lib/room-rates'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import type { RoomCategoryId } from '@/domain/types/models'

const fieldClass = 'h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function AddRoomDialog({ onSaved }: { onSaved?: (message: string) => void }) {
  const { data, dispatch } = usePrototype()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [categoryId, setCategoryId] = useState<RoomCategoryId>('RATE_3500')
  const [kind, setKind] = useState<RoomDraft['kind']>('PRIVATE')
  const [status, setStatus] = useState<RoomDraft['status']>('available')
  const [errors, setErrors] = useState<RoomDraftErrors>({})
  const [savedName, setSavedName] = useState('')
  const submitting = useRef(false)

  function reset() {
    setStep('form')
    setName('')
    setCapacity('1')
    setCategoryId('RATE_3500')
    setKind('PRIVATE')
    setStatus('available')
    setErrors({})
    setSavedName('')
    submitting.current = false
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) reset()
    setOpen(nextOpen)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const draft: RoomDraft = { name, capacity: capacity.trim() === '' ? null : Number(capacity), categoryId, kind, status }
    const nextErrors = validateRoomDraft(data, draft, { asOf: DEMO_DATE })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    submitting.current = true
    dispatch({ type: 'room/created', draft })
    setSavedName(name.trim())
    setStep('success')
    onSaved?.(`Room ${name.trim()} was added.`)
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button><Plus aria-hidden="true" />Add room</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      {step === 'form'
        ? <>
            <DialogHeader className="pr-6"><DialogTitle>Add a room</DialogTitle><DialogDescription>Add a room to this prototype. The room is saved in the shared records and will appear in the room list.</DialogDescription></DialogHeader>
            <form className="grid gap-5" noValidate onSubmit={submit}>
              <div className="grid gap-2">
                <label htmlFor="add-room-name" className="text-sm font-semibold">Room number or name</label>
                <Input id="add-room-name" value={name} onChange={event => { setName(event.target.value); setErrors({}) }} placeholder="For example: 107" maxLength={80} autoComplete="off" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'add-room-name-error' : undefined} className="h-12 bg-card" />
                {errors.name && <p id="add-room-name-error" role="alert" className="text-sm text-destructive">{errors.name}</p>}
              </div>
              <div className="grid gap-2">
                <label htmlFor="add-room-beds" className="text-sm font-semibold">Number of beds</label>
                <Input id="add-room-beds" type="number" min={1} step={1} value={capacity} onChange={event => { setCapacity(event.target.value); setErrors({}) }} aria-describedby={errors.capacity ? 'add-room-beds-error' : 'add-room-beds-help'} aria-invalid={Boolean(errors.capacity)} className="h-12 bg-card" />
                <p id="add-room-beds-help" className="text-sm text-muted-foreground">Bed counts are for reference only and do not determine room availability.</p>
                {errors.capacity && <p id="add-room-beds-error" role="alert" className="text-sm text-destructive">{errors.capacity}</p>}
              </div>
              <div className="grid gap-2">
                <label htmlFor="add-room-rate" className="text-sm font-semibold">Monthly rental rate</label>
                <select id="add-room-rate" value={categoryId} onChange={event => { setCategoryId(event.target.value as RoomCategoryId); setErrors({}) }} aria-invalid={Boolean(errors.categoryId)} className={fieldClass}>
                  {ROOM_RATE_CATEGORY_IDS.map(id => {
                    const rate = activeRoomRentRate(data, id, DEMO_DATE)
                    return <option key={id} value={id}>{roomCategoryLabel(id)} · {rate ? formatMoney(rate.monthlyRentCents) : 'Rate needs review'}/month</option>
                  })}
                </select>
                {errors.categoryId && <p role="alert" className="text-sm text-destructive">{errors.categoryId}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="add-room-type" className="text-sm font-semibold">Room type</label>
                  <select id="add-room-type" value={kind} onChange={event => { setKind(event.target.value as RoomDraft['kind']); setErrors({}) }} className={fieldClass}>
                    <option value="PRIVATE">Private</option>
                    <option value="SHARED">Shared</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="add-room-status" className="text-sm font-semibold">Room status</label>
                  <select id="add-room-status" value={status} onChange={event => { setStatus(event.target.value as RoomDraft['status']); setErrors({}) }} className={fieldClass}>
                    <option value="available">Available</option>
                    <option value="maintenance">Under repair</option>
                  </select>
                </div>
              </div>
              {errors.kind && <p role="alert" className="text-sm text-destructive">{errors.kind}</p>}
              {errors.status && <p role="alert" className="text-sm text-destructive">{errors.status}</p>}
              {errors.general && <p role="alert" className="text-sm text-destructive">{errors.general}</p>}
              <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit"><Plus aria-hidden="true" />Add room</Button></DialogFooter>
            </form>
          </>
        : <>
            <DialogHeader className="items-start">
              <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent text-primary"><Check className="size-6" aria-hidden="true" /></span>
              <DialogTitle>Room added successfully</DialogTitle>
              <DialogDescription className="text-base leading-relaxed" role="status">Room {savedName} was added and saved to the room list. Assign tenants separately when the room is ready.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></DialogFooter>
          </>}
    </DialogContent>
  </Dialog>
}
