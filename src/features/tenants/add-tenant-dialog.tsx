import { useRef, useState, type FormEvent } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { validateTenantDraft, type TenantDraft, type TenantDraftErrors } from '@/domain/calculations/tenant-management'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { TenantFormFields } from './tenant-form-fields'

const emptyTenantForm: TenantDraft = {
  name: '', email: '', phone: '', address: '', roomId: null, moveInDate: DEMO_DATE, notes: '',
}

export function AddTenantDialog({ onSaved }: { onSaved?: (message: string) => void }) {
  const { data, dispatch } = usePrototype()
  const occupancyDate = useOccupancyDate()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [values, setValues] = useState<TenantDraft>(emptyTenantForm)
  const [errors, setErrors] = useState<TenantDraftErrors>({})
  const [savedName, setSavedName] = useState('')
  const submitting = useRef(false)

  function reset() {
    setStep('form')
    setValues(emptyTenantForm)
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
    const nextErrors = validateTenantDraft(data, values, { asOf: occupancyDate })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    submitting.current = true
    dispatch({ type: 'tenant/created', draft: values, asOf: occupancyDate })
    setSavedName(values.name.trim())
    setStep('success')
    onSaved?.(`Tenant ${values.name.trim()} was added.`)
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button><UserPlus />Add tenant</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      {step === 'form'
        ? <>
            <DialogHeader className="pr-6"><DialogTitle>Add a tenant</DialogTitle><DialogDescription>Add a tenant to this prototype. The tenant and any room assignment are saved in the shared records.</DialogDescription></DialogHeader>
            <form className="grid gap-5" noValidate onSubmit={submit}>
              <TenantFormFields idPrefix="add-tenant" values={values} errors={errors} onChange={(field, value) => {
                setValues(current => ({ ...current, [field]: value }))
                setErrors({})
              }} />
              <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit"><UserPlus aria-hidden="true" />Add tenant</Button></DialogFooter>
            </form>
          </>
        : <>
            <DialogHeader className="items-start">
              <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent text-[var(--tint)]"><Check className="size-6" aria-hidden="true" /></span>
              <DialogTitle>Tenant added successfully</DialogTitle>
              <DialogDescription className="text-base leading-relaxed" role="status">Tenant {savedName} was added and saved to the tenant list. Room occupancy reflects any assignment made here.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button autoFocus onClick={() => changeOpen(false)}>Got it</Button></DialogFooter>
          </>}
    </DialogContent>
  </Dialog>
}
