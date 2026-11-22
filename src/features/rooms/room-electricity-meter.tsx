import { useRef, useState, type FormEvent } from 'react'
import { Gauge, LockKeyhole, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { latestSettledReading, meterInitializationStatus } from '@/domain/calculations/meter-baseline'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { isIsoDate } from '@/domain/validation/date'
import { formatDate } from '@/lib/format'

export function RoomElectricityMeter({ roomId }: { roomId: string }) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const [active, setActive] = useState(false)
  const [reading, setReading] = useState('')
  const [readOn, setReadOn] = useState(DEMO_DATE)
  const [sourceNote, setSourceNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const setup = meterInitializationStatus(data, roomId)
  const { meter } = setup
  const eligible = setup.state === 'ELIGIBLE'
  const unlocked = active && eligible
  const latest = meter ? latestSettledReading(data, meter.id) : null
  const initial = meter ? data.meterReadings.find(item => item.meterId === meter.id && item.status === 'INITIAL') : null
  const readings = meter ? [...data.meterReadings].filter(item => item.meterId === meter.id)
    .sort((a, b) => b.readOn.localeCompare(a.readOn) || (a.status === 'INITIAL' ? 1 : -1)).slice(0, 4) : []

  async function saveInitialReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!unlocked || submitting.current) return
    const parsed = parseMeterReadingMilliKwh(reading.trim())
    const nextErrors: Record<string, string> = {}
    if (parsed === null) nextErrors.reading = 'Enter a non-negative kWh reading with up to three decimal places.'
    if (!isIsoDate(readOn) || readOn > DEMO_DATE) nextErrors.date = 'Enter a valid reading date no later than the current sample date.'
    if (sourceNote.trim().length > 500) nextErrors.source = 'Keep the source note within 500 characters.'
    setErrors(nextErrors)
    setNotice('')
    if (Object.keys(nextErrors).length > 0 || parsed === null) return
    const input = { roomId, readingMilliKwh: parsed, readOn, sourceNote, initializedOn: DEMO_DATE }
    const result = prepareMeterInitialization(data, input)
    if (!result.ok) {
      setErrors({ save: result.reason === 'NOT_ELIGIBLE' ? 'This meter is no longer eligible. Its existing history has not been changed.' : 'The initial reading could not be saved. Review the input and try again.' })
      return
    }
    submitting.current = true
    setSaving(true)
    const warning = await persistSnapshot(result.data)
    submitting.current = false
    setSaving(false)
    if (warning) {
      setErrors({ save: `Initial reading was not saved. ${warning}` })
      return
    }
    dispatch({ type: 'electricity/meterInitialized', ...input })
    setActive(false)
    setNotice('Initial reading saved. Setup is locked. No electricity bill, payment, or receipt was created.')
  }

  return <section className="room-details-section" aria-labelledby="room-meter-title">
    <h2 id="room-meter-title" className="flex items-center gap-2"><Gauge className="size-5" aria-hidden="true" />Electricity meter</h2>
    {meter ? <>
      <dl className="room-details-grid">
        <div><dt>Meter</dt><dd>{meter.label}</dd></div>
        <div><dt>Meter identifier</dt><dd className="break-all">{meter.serialNumber ?? meter.id}</dd></div>
        <div><dt>Last settled reading</dt><dd>{latest ? `${latest.readingMilliKwh / 1000} kWh` : 'None recorded'}</dd></div>
        <div><dt>Last settled date</dt><dd>{latest ? formatDate(latest.readOn) : '—'}</dd></div>
        <div><dt>Reading unit</dt><dd>kWh</dd></div>
        {initial && <><div><dt>Initial reading</dt><dd>{initial.readingMilliKwh / 1000} kWh</dd></div><div><dt>Initial reading date</dt><dd>{formatDate(initial.readOn)}</dd></div></>}
      </dl>
      <h3 className="mt-5 text-sm font-semibold">Recent reading history</h3>
      <ul className="room-details-readings">{readings.map(item => {
        const settled = data.charges.some(charge => charge.category === 'ELECTRICITY' && charge.electricity.currentReadingId === item.id)
        const label = item.status === 'INITIAL' ? 'INITIAL READING' : item.status === 'SUPERSEDED' ? 'SUPERSEDED READING' : item.status === 'DRAFT' ? 'DRAFT READING' : settled ? 'SETTLED READING' : 'LEGACY READING'
        return <li key={item.id} className="room-meter-history-item"><div className="min-w-0"><p className="text-xs font-semibold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.readOn)}</p>{item.sourceNote && <p className="mt-1 break-words text-xs text-muted-foreground">Source: {item.sourceNote}</p>}</div><span className="font-semibold tabular-nums">{item.readingMilliKwh / 1000} kWh</span></li>
      })}</ul>
      <div className="room-details-note"><p className="font-semibold">Authorized meter corrections</p><p className="mt-1">Editing a settled reading could invalidate historic consumption or payment history. Use the authorized payment-correction workflow in Payments &amp; Receipts. Meter replacement and unrestricted baseline editing are not available here.</p><Button type="button" variant="outline" className="mt-3" disabled aria-label="Edit meter information unavailable">Edit meter information</Button></div>
    </> : <p className="room-details-empty">No electricity meter is recorded for this room.</p>}

    <div className="room-meter-setup" role="region" aria-labelledby="room-meter-setup-title">
      <div className="room-meter-setup-header"><div><h3 id="room-meter-setup-title">Initial meter reading setup</h3><p>Administrative setup only. Normal electricity billing stays available while setup is locked.</p></div><span className="room-meter-setup-state" data-active={unlocked}>{unlocked ? <Unlock aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}{unlocked ? 'ACTIVE' : 'LOCKED'}</span></div>
      <p className="text-xs font-semibold text-muted-foreground">{setup.state === 'HAS_HISTORY' ? 'HAS HISTORY' : setup.state === 'INITIALIZED' ? 'INITIALIZED' : setup.state === 'REQUIRES_REVIEW' ? 'REQUIRES REVIEW' : 'NOT INITIALIZED'}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{setup.message}</p>
      <Button type="button" variant="outline" disabled={!eligible || saving} aria-expanded={unlocked} aria-controls={`meter-setup-inputs-${roomId}`} onClick={() => { setActive(current => !current); setErrors({}); setNotice('') }}>{unlocked ? 'Deactivate' : 'Activate'}</Button>
      {notice && <p role="status" className="room-meter-setup-notice">{notice}</p>}
      {unlocked && <form id={`meter-setup-inputs-${roomId}`} onSubmit={saveInitialReading} noValidate className="room-meter-setup-form">
        <p className="room-meter-setup-warning">Use only a verified previous settled reading. This is a starting baseline, not proof that an electricity bill was paid. Saved history cannot be overwritten through setup.</p>
        <div className="room-meter-setup-fields">
          <div><label htmlFor={`meter-initial-reading-${roomId}`}>Previous settled meter reading (kWh)</label><Input id={`meter-initial-reading-${roomId}`} inputMode="decimal" value={reading} onChange={event => setReading(event.target.value)} disabled={saving} aria-invalid={Boolean(errors.reading)} aria-describedby={errors.reading ? `meter-reading-error-${roomId}` : undefined} />{errors.reading && <p id={`meter-reading-error-${roomId}`} role="alert">{errors.reading}</p>}</div>
          <div><label htmlFor={`meter-initial-date-${roomId}`}>Date of previous settled reading</label><Input id={`meter-initial-date-${roomId}`} type="date" value={readOn} max={DEMO_DATE} onChange={event => setReadOn(event.target.value)} disabled={saving} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? `meter-date-error-${roomId}` : undefined} />{errors.date && <p id={`meter-date-error-${roomId}`} role="alert">{errors.date}</p>}</div>
        </div>
        <div><label htmlFor={`meter-initial-source-${roomId}`}>Source note (optional)</label><textarea id={`meter-initial-source-${roomId}`} value={sourceNote} onChange={event => setSourceNote(event.target.value)} maxLength={500} disabled={saving} rows={3} placeholder="For example: landlord’s handwritten records" />{errors.source && <p role="alert">{errors.source}</p>}</div>
        {errors.save && <p role="alert">{errors.save}</p>}
        <Button type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Saving initial reading…' : 'Save Initial Reading'}</Button>
      </form>}
    </div>
  </section>
}
