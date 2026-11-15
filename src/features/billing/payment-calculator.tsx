import { useState } from 'react'
import { ArrowUpRight, Calculator, Check, Droplets, House, WashingMachine, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { formatMoney } from '@/lib/format'
import { paymentAmountCents } from './payment-total'

const items = [
  { key: 'rent', label: 'Rent', icon: House },
  { key: 'electricity', label: 'Electricity', icon: Zap },
  { key: 'water', label: 'Water', icon: Droplets },
  { key: 'washing', label: 'Washing machine', icon: WashingMachine },
] as const
const emptyAmounts = { rent: '', electricity: '', water: '', washing: '' }

export function PaymentCalculator({ periodLabel }: { periodLabel: string }) {
  const { data } = usePrototype()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'calculator' | 'success'>('calculator')
  const [tenantId, setTenantId] = useState('')
  const [amounts, setAmounts] = useState(emptyAmounts)
  const parsed = items.map(item => paymentAmountCents(amounts[item.key]))
  const valid = parsed.every(value => value !== null)
  const sum = parsed.reduce<number>((total, value) => total + (value ?? 0), 0)
  const total = valid && Number.isSafeInteger(sum) ? sum : null
  const tenant = data.tenants.find(item => item.id === tenantId)
  const canFinish = Boolean(tenant && total !== null && total > 0)

  function changeOpen(next: boolean) {
    if (next) {
      setStep('calculator')
      setTenantId('')
      setAmounts(emptyAmounts)
    }
    setOpen(next)
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <button type="button" className="payment-launcher">
        <span className="payment-launcher-icon"><Calculator aria-hidden="true" /></span>
        <span className="text-left"><span className="block font-bold">Calculate payment</span><span className="block text-xs opacity-85">Rent + utilities, added for you</span></span>
        <ArrowUpRight className="ml-2 size-5 shrink-0" aria-hidden="true" />
      </button>
    </DialogTrigger>
    <DialogContent className="payment-calculator" aria-describedby="payment-calculator-description">
      {step === 'calculator' ? <form onSubmit={event => { event.preventDefault(); if (canFinish) setStep('success') }}>
        <div className="payment-calculator-heading">
          <span className="payment-eyebrow">PAYMENT STUDIO · PHP</span>
          <DialogTitle className="mt-2 text-2xl">Let’s total it up.</DialogTitle>
          <DialogDescription id="payment-calculator-description" className="mt-2">Choose a tenant and enter what they will pay. Blank items count as zero.</DialogDescription>
          <p className="mt-2 text-xs text-muted-foreground">{periodLabel} · Prototype calculator, no payment is saved.</p>
        </div>
        <div className="payment-calculator-body">
          <label htmlFor="payment-tenant" className="mb-2 block text-sm font-semibold">Paying tenant</label>
          <select id="payment-tenant" value={tenantId} onChange={event => { setTenantId(event.target.value); setAmounts(emptyAmounts) }} className="payment-tenant-select">
            <option value="">Choose a tenant</option>
            {data.tenants.filter(item => item.status === 'ACTIVE').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <fieldset className="payment-input-group">
            <legend className="sr-only">Amounts to pay in pesos</legend>
            {items.map(({ key, label, icon: Icon }) => {
              const invalid = paymentAmountCents(amounts[key]) === null
              return <div key={key} className="payment-input-row">
                <label htmlFor={`payment-${key}`} className="flex min-w-0 items-center gap-3 text-sm font-semibold"><span className="payment-category-icon"><Icon className="size-[18px]" aria-hidden="true" /></span>{label}</label>
                <div className="payment-amount-field"><span aria-hidden="true">₱</span><input id={`payment-${key}`} type="text" inputMode="decimal" maxLength={14} placeholder="0.00" aria-label={`${label} payment in pesos`} aria-invalid={invalid} aria-describedby={invalid ? 'payment-amount-error' : undefined} value={amounts[key]} onChange={event => setAmounts(current => ({ ...current, [key]: event.target.value }))} /></div>
              </div>
            })}
          </fieldset>
          {total === null && <p id="payment-amount-error" role="alert" className="mt-3 text-sm text-destructive">Enter positive amounts with up to two decimal places, for example 3500.50.</p>}
          <p className="mt-3 text-xs text-muted-foreground">Enter payment amounts, not meter readings. Changing the tenant clears these amounts.</p>
        </div>
        <div className="payment-total-panel">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-sm opacity-85">Total to pay</p><output aria-label="Total to pay" aria-live="polite" aria-atomic="true" className="payment-total-value">{total === null ? '—' : formatMoney(total)}</output></div>
            <span className="payment-total-tag">{items.filter(item => (paymentAmountCents(amounts[item.key]) ?? 0) > 0).length} of 4 items</span>
          </div>
          <div className="mt-5 flex gap-3"><DialogClose asChild><Button type="button" variant="ghost" className="payment-cancel">Cancel</Button></DialogClose><Button type="submit" className="flex-1" disabled={!canFinish}>Done <Check className="size-4" aria-hidden="true" /></Button></div>
          {!tenantId && <p className="mt-3 text-xs opacity-85">Choose a tenant and enter an amount to continue.</p>}
        </div>
      </form> : <div className="payment-success">
        <span className="payment-success-icon"><Check className="size-8" aria-hidden="true" /></span>
        <span className="payment-eyebrow mt-5">ALL ADDED UP</span>
        <DialogTitle className="mt-2 text-2xl">Paid successfully</DialogTitle>
        <DialogDescription id="payment-calculator-description" className="mt-2">Sample confirmation for {tenant?.name}. No payment was saved or applied to a bill.</DialogDescription>
        <p className="payment-success-amount">{formatMoney(total ?? 0)}</p>
        <Button autoFocus className="mt-5 w-full" onClick={() => changeOpen(false)}>Got it</Button>
      </div>}
    </DialogContent>
  </Dialog>
}
