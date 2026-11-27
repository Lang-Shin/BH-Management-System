import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Building2, Check, CircleAlert, Eye, EyeOff, LoaderCircle, Moon, Sun } from 'lucide-react'
import { useAppearance } from '@/app/providers/appearance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import './auth.css'

const TYPE_DELAY_MS = 180
const TYPE_SPEED_MS = 95
const HOLD_COMPLETE_MS = 5_000
const DELETE_SPEED_MS = 55
const EMPTY_PAUSE_MS = 450

export function AuthTypewriter({ text = 'A place to call home' }: { text?: string }) {
  const [visibleText, setVisibleText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let cancelled = false
    const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }
    const restart = () => {
      clearTimer()
      if (cancelled) return
      if (!preference || preference.matches) { setVisibleText(text); return }
      let length = 0
      let erasing = false
      setVisibleText('')
      const step = () => {
        if (cancelled) return
        length += erasing ? -1 : 1
        setVisibleText(text.slice(0, length))
        if (length === text.length) { erasing = true; timer.current = setTimeout(step, HOLD_COMPLETE_MS) }
        else if (length === 0) { erasing = false; timer.current = setTimeout(step, EMPTY_PAUSE_MS) }
        else timer.current = setTimeout(step, erasing ? DELETE_SPEED_MS : TYPE_SPEED_MS)
      }
      if (text.length > 0) timer.current = setTimeout(step, TYPE_DELAY_MS)
    }
    restart()
    preference?.addEventListener('change', restart)
    return () => { cancelled = true; clearTimer(); preference?.removeEventListener('change', restart) }
  }, [text])

  return <p className="auth-eyebrow auth-typewriter"><span className="sr-only">{text}</span><span className="auth-typewriter-frame" aria-hidden="true"><span className="auth-typewriter-reserve">{text}</span><span className="auth-typewriter-live"><span data-typed-eyebrow>{visibleText}</span><span className="auth-typewriter-caret" /></span></span></p>
}

export function AuthBranding() {
  return <div className="auth-brand"><span className="auth-brand-icon"><Building2 aria-hidden="true" /></span><div><p className="brand-name">HALILI BH</p><p className="auth-brand-subtitle">Boarding House Management System</p></div></div>
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const { appearance, toggle } = useAppearance()
  return <div className="auth-page">
    <header className="auth-header"><AuthBranding /><Button variant="outline" size="icon" aria-label={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => toggle()}>{appearance === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button></header>
    <main id="auth-content" className="auth-main"><aside className="auth-intro" aria-label="Welcome to Halili BH"><AuthTypewriter /><h2>Your stay.<br />Simply managed.</h2><p>A little less paperwork.<br />A little more peace of mind.</p><div className="auth-intro-rule" /></aside><div className="auth-form-column">{children}</div></main>
    <footer className="auth-footer">HALILI BH <span aria-hidden="true">·</span> Simple, everyday boarding house management.</footer>
  </div>
}

export function AuthCard({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  return <section className="auth-card" aria-labelledby="auth-title"><div className="auth-card-heading"><span className="auth-card-accent" aria-hidden="true" /><h1 id="auth-title">{title}</h1><p>{description}</p></div>{children}{footer && <div className="auth-card-footer">{footer}</div>}</section>
}

type FieldProps = ComponentProps<typeof Input> & { label: string; error?: string; hint?: string }

export function AuthField({ label, error, hint, id, className, 'aria-describedby': describedBy, ...props }: FieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const detailId = `${fieldId}-detail`
  return <div className="auth-field"><label htmlFor={fieldId}>{label}</label><Input {...props} id={fieldId} className={cn('auth-input', className)} aria-invalid={error ? true : undefined} aria-describedby={[describedBy, (error || hint) && detailId].filter(Boolean).join(' ') || undefined} />{(error || hint) && <p id={detailId} className={error ? 'auth-field-error' : 'auth-field-hint'}>{error ?? hint}</p>}</div>
}

export function AuthPasswordField({ label = 'Password', autoComplete = 'current-password', id, error, hint, disabled, ...props }: FieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const [visible, setVisible] = useState(false)
  return <div className="auth-password"><AuthField {...props} label={label} id={fieldId} error={error} hint={hint} type={visible ? 'text' : 'password'} autoComplete={autoComplete} disabled={disabled} className="pr-14" /><Button type="button" variant="ghost" size="icon" className="auth-password-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-controls={fieldId} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button></div>
}

export function AuthPasswordConfirmation(props: Omit<FieldProps, 'label'>) {
  return <AuthPasswordField {...props} label="Confirm password" autoComplete="new-password" />
}

export function AuthCodeField(props: Omit<FieldProps, 'label'>) {
  return <AuthField {...props} label="Verification code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="auth-code-input" />
}

export function AuthMessage({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  const Icon = tone === 'error' ? CircleAlert : Check
  return <div className={`auth-message auth-message-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon aria-hidden="true" /><span>{children}</span></div>
}

export function AuthSubmit({ children, pending, pendingLabel = 'Please wait…', disabled }: { children: ReactNode; pending?: boolean; pendingLabel?: string; disabled?: boolean }) {
  return <Button type="submit" variant="secondary" className="auth-submit" disabled={disabled || pending} aria-busy={pending}>{pending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}<span aria-live="polite">{pending ? pendingLabel : children}</span></Button>
}

export function AuthProgress({ steps, current }: { steps: string[]; current: number }) {
  return <ol className="auth-progress" aria-label="Setup progress">{steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? <Check /> : index + 1}</span>{step}</li>)}</ol>
}
