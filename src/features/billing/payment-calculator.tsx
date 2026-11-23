import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Calculator, Check, ChevronDown } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { collectionCatalog, prepareCollection, rentPrepaymentCatalog, type CollectibleItem, type CollectionInput, type RentPrepaymentCatalog } from '@/domain/calculations/payment-collection'
import { rentPrepaymentStarts } from '@/domain/calculations/rent-schedule'
import { occupiedRoomSelection } from '@/domain/calculations/occupied-rooms'
import { buildRoomPaymentQuote } from '@/domain/calculations/room-payment'
import { parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { formatDate, formatMoney, previousCalendarDate } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function PaymentCalculator({ periodId, periodLabel }: { periodId: string; periodLabel: string }) {
  const { data, commitAction, loadCollectionCatalog, loadRentPrepaymentCatalog, persistSnapshot, repositoryMode, commandError } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedHistoricalRoom = searchParams.get('collectRoom')
  const initialHistoricalRoom = requestedHistoricalRoom && data.rooms.some(room => room.id === requestedHistoricalRoom) ? requestedHistoricalRoom : null
  const handledHistoricalRoom = useRef<string | null>(initialHistoricalRoom)
  const [historicalRoomId, setHistoricalRoomId] = useState<string | null>(initialHistoricalRoom)
  const [cardsEpoch, setCardsEpoch] = useState(0)
  const [open, setOpen] = useState(Boolean(initialHistoricalRoom))
  const [step, setStep] = useState<'calculator' | 'confirm' | 'success'>('calculator')
  const [roomId, setRoomId] = useState(initialHistoricalRoom ?? '')
  const [selected, setSelected] = useState<string[]>([])
  const [readingText, setReadingText] = useState<Record<string, string>>({})
  const [serverItems, setServerItems] = useState<CollectibleItem[]>([])
  const [serverDate, setServerDate] = useState(occupancyDate)
  const [quotedKey, setQuotedKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [input, setInput] = useState<CollectionInput | null>(null)
  const [reviewItems, setReviewItems] = useState<CollectibleItem[]>([])
  const [rentMode, setRentMode] = useState<'OUTSTANDING' | 'PREPAY'>('OUTSTANDING')
  const [prepayStart, setPrepayStart] = useState('')
  const [prepayCount, setPrepayCount] = useState('1')
  const [prepayServer, setPrepayServer] = useState<{ key: string; loading: boolean; error: string; catalog: RentPrepaymentCatalog | null }>({ key: '', loading: false, error: '', catalog: null })
  const [prepayRetry, setPrepayRetry] = useState(0)
  const occupied = useMemo(() => occupiedRoomSelection(data, occupancyDate), [data, occupancyDate])
  const occupiedRoomIdsKey = occupied.rooms.map(room => room.id).join('|')
  const readings = useMemo(() => Object.fromEntries(Object.entries(readingText)
    .flatMap(([id, value]) => { const parsed = parseMeterReadingMilliKwh(value); return parsed === null ? [] : [[id, parsed]] })), [readingText]) as Record<string, number>
  const requestedKey = JSON.stringify({ roomId, readings })

  useEffect(() => {
    if (!open || !roomId || repositoryMode !== 'server' || step !== 'calculator') return
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setCatalogError('')
      loadCollectionCatalog(roomId, readings).then(result => {
        if (cancelled) return
        setServerItems(result.items)
        setServerDate(result.serverDate)
        setQuotedKey(JSON.stringify({ roomId, readings }))
      }).catch(cause => { if (!cancelled) setCatalogError(cause instanceof Error ? cause.message : 'The payment catalog could not be opened.') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, roomId, repositoryMode, readings, retry, step, loadCollectionCatalog])

  useEffect(() => {
    if (!requestedHistoricalRoom || handledHistoricalRoom.current === requestedHistoricalRoom) return
    if (!data.rooms.some(room => room.id === requestedHistoricalRoom)) return
    const timer = setTimeout(() => {
      handledHistoricalRoom.current = requestedHistoricalRoom
      setHistoricalRoomId(requestedHistoricalRoom)
      setRoomId(requestedHistoricalRoom)
      setSelected([]); setReadingText({}); setServerItems([]); setQuotedKey(''); setError(''); setCatalogError('')
      setRentMode('OUTSTANDING'); setPrepayStart(''); setPrepayCount('1')
      setCardsEpoch(epoch => epoch + 1)
      setStep('calculator')
      setOpen(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [requestedHistoricalRoom, data.rooms])

  useEffect(() => {
    if (!open || !roomId || historicalRoomId) return
    if (occupiedRoomIdsKey.split('|').includes(roomId)) return
    const timer = setTimeout(() => {
      setRoomId(''); setSelected([]); setReadingText({}); setServerItems([]); setQuotedKey(''); setError(''); setCatalogError(''); setInput(null)
      setRentMode('OUTSTANDING'); setPrepayStart(''); setPrepayCount('1')
      setCardsEpoch(epoch => epoch + 1)
    }, 0)
    return () => clearTimeout(timer)
  }, [open, roomId, historicalRoomId, occupiedRoomIdsKey])

  const asOf = repositoryMode === 'server' ? serverDate : occupancyDate
  const prepayStarts = useMemo(() => roomId ? rentPrepaymentStarts(data, roomId, asOf) : [], [data, roomId, asOf])
  const effectivePrepayStart = prepayStarts.some(option => String(option.sequence) === prepayStart)
    ? prepayStart : prepayStarts[0] ? String(prepayStarts[0].sequence) : ''
  const prepayStartOption = prepayStarts.find(option => String(option.sequence) === effectivePrepayStart)
  const prepayMaxCount = Math.max(1, 120 - (prepayStartOption?.sequence ?? 1) + 1)
  const prepayPeriodCount = Math.max(1, Math.min(Number(prepayCount) || 1, prepayMaxCount))
  const prepayActive = Boolean(open && roomId && rentMode === 'PREPAY' && prepayStartOption && step === 'calculator')
  const prepayRequestKey = JSON.stringify({
    roomId, cycleId: prepayStartOption?.cycleId, startSequence: prepayStartOption?.sequence,
    periodCount: prepayPeriodCount, retry: prepayRetry,
  })
  const localPrepayCatalog = useMemo(() => repositoryMode !== 'server' && prepayActive && prepayStartOption && roomId
    ? rentPrepaymentCatalog(data, roomId, {
      cycleId: prepayStartOption.cycleId, startSequence: prepayStartOption.sequence, periodCount: prepayPeriodCount,
    }, asOf)
    : null, [repositoryMode, prepayActive, prepayStartOption, roomId, data, prepayPeriodCount, asOf])
  const serverPrepayState = prepayServer.key === prepayRequestKey ? prepayServer : null
  const prepayCatalog = repositoryMode === 'server'
    ? prepayActive && serverPrepayState ? serverPrepayState.catalog : null
    : localPrepayCatalog
  const prepayLoading = repositoryMode === 'server' && prepayActive && (!serverPrepayState || serverPrepayState.loading)
  const prepayError = repositoryMode === 'server' && prepayActive ? serverPrepayState?.error ?? '' : ''
  const prepayItems = rentMode === 'PREPAY' ? prepayCatalog?.items ?? [] : []
  const prepayReady = rentMode === 'PREPAY' && !prepayLoading && !prepayError
    && prepayCatalog?.quote?.payable === true && prepayItems.length === prepayPeriodCount
    && prepayItems.every(item => item.selectable && item.amountCents > 0)

  useEffect(() => {
    if (!prepayActive || repositoryMode !== 'server' || !prepayStartOption || !roomId) return
    let cancelled = false
    const timer = setTimeout(() => {
      setPrepayServer({ key: prepayRequestKey, loading: true, error: '', catalog: null })
      loadRentPrepaymentCatalog({
        roomId, cycleId: prepayStartOption.cycleId,
        startSequence: prepayStartOption.sequence, periodCount: prepayPeriodCount,
      }).then(result => {
        if (!cancelled) setPrepayServer({ key: prepayRequestKey, loading: false, error: '', catalog: result })
      }).catch(cause => {
        if (!cancelled) setPrepayServer({
          key: prepayRequestKey, loading: false, catalog: null,
          error: cause instanceof Error ? cause.message : 'The rent prepayment quote could not be loaded.',
        })
      })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [prepayActive, repositoryMode, prepayStartOption, roomId, prepayPeriodCount, prepayRequestKey, loadRentPrepaymentCatalog])

  const items = repositoryMode === 'server' ? serverItems : roomId ? collectionCatalog(data, roomId, asOf, readings) : []
  const rentItems = items.filter(item => item.category === 'RENT')
  const utilityItems = items.filter(item => item.category !== 'RENT')
  const electricityItems = utilityItems.filter(item => item.category === 'ELECTRICITY')
  const electricityGroups = (() => {
    const groups = new Map<string, CollectibleItem[]>()
    for (const item of electricityItems) {
      const key = item.meterId ?? `room:${roomId}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.values()]
  })()
  const monthlyUtilityItems = utilityItems.filter(item => item.category !== 'ELECTRICITY')
  const months = [...new Set(monthlyUtilityItems.map(item => item.periodId))]
  const utilityChosen = items.filter(item => item.category !== 'RENT' && selected.includes(item.id))
  const outstandingRentChosen = rentItems.filter(item => selected.includes(item.id))
  const chosen = rentMode === 'PREPAY'
    ? prepayReady ? [...prepayItems, ...utilityChosen] : []
    : [...outstandingRentChosen, ...utilityChosen]
  const total = chosen.reduce((sum, item) => sum + item.amountCents, 0)
  const canReview = !loading && !catalogError && (repositoryMode !== 'server' || quotedKey === requestedKey)
    && !Object.values(readingText).some(value => value !== '' && parseMeterReadingMilliKwh(value) === null)
    && chosen.length > 0
    && chosen.every(item => item.selectable && item.amountCents > 0)
    && (rentMode === 'PREPAY' ? prepayReady : chosen.length === selected.length)
    && !(rentMode === 'PREPAY' && prepayLoading)
  const currentQuote = roomId ? buildRoomPaymentQuote(data, { roomId, periodId, selected: [], electricityReadingMilliKwh: null, asOf }) : null
  const payment = input ? data.payments.find(item => item.id === `payment-collection-${input.transactionId}`) : undefined
  const receipt = payment ? data.receipts.find(item => item.paymentId === payment.id) : undefined

  function clearHistoricalQuery() {
    if (!searchParams.has('collectRoom')) return
    const next = new URLSearchParams(searchParams)
    next.delete('collectRoom')
    setSearchParams(next, { replace: true })
    handledHistoricalRoom.current = null
  }

  function changeOpen(next: boolean) {
    if (saving) return
    setOpen(next)
    if (next) { setStep('calculator'); chooseRoom(''); setInput(null); setReviewItems([]) }
    else { setHistoricalRoomId(null); clearHistoricalQuery() }
  }

  function chooseRoom(id: string) {
    setHistoricalRoomId(null)
    clearHistoricalQuery()
    setRoomId(id); setSelected([]); setReadingText({}); setServerItems([]); setQuotedKey(''); setError(''); setCatalogError('')
    setRentMode('OUTSTANDING'); setPrepayStart(''); setPrepayCount('1')
    setCardsEpoch(epoch => epoch + 1)
    setLoading(repositoryMode === 'server' && Boolean(id))
    setInput(null)
  }

  function toggle(ids: string[]) {
    setSelected(current => ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])])
    setError(''); setInput(null)
  }

  function changeRentMode(mode: 'OUTSTANDING' | 'PREPAY') {
    if (mode === rentMode) return
    setRentMode(mode)
    setSelected(current => current.filter(id => !items.some(item => item.id === id && item.category === 'RENT')))
    setError(''); setInput(null)
    if (mode === 'PREPAY' && prepayStarts[0]) setPrepayStart(String(prepayStarts[0].sequence))
  }

  function choosePrepayStart(value: string) {
    const option = prepayStarts.find(item => String(item.sequence) === value)
    const max = Math.max(1, 120 - (option?.sequence ?? 1) + 1)
    setPrepayStart(value)
    setPrepayCount(current => String(Math.max(1, Math.min(Number(current) || 1, max))))
    setError(''); setInput(null)
  }

  function review() {
    if (!canReview) return
    const nextInput: CollectionInput = {
      transactionId: crypto.randomUUID(), roomId, readings, collectedOn: asOf,
      selections: chosen.map(({ id, amountCents, periodId: originalPeriod, dueDate, basis }) => ({ id, amountCents, periodId: originalPeriod, dueDate, basis })),
      ...(rentMode === 'PREPAY' && prepayCatalog?.quote ? {
        rentPrepayment: {
          cycleId: prepayCatalog.quote.cycleId,
          startSequence: prepayCatalog.quote.startSequence,
          periodCount: prepayCatalog.quote.periodCount,
        },
      } : {}),
    }
    setInput(nextInput); setReviewItems(chosen); setError(''); setStep('confirm')
  }

  async function confirm() {
    if (!input || saving) return
    setSaving(true); setError('')
    if (repositoryMode === 'local') {
      const result = prepareCollection(data, input)
      if (!result.ok) { setError(`These obligations changed: ${result.reason}. Return and refresh the selections.`); setSaving(false); return }
      const warning = await persistSnapshot(result.data)
      if (warning) { setError(`Payment was not saved. ${warning}`); setSaving(false); return }
    }
    const confirmed = await commitAction({ type: 'payment/collected', input }, input.transactionId)
    setSaving(false)
    if (!confirmed) { setError('Payment was not confirmed. Retry the same transaction or go back and refresh the catalog.'); return }
    setStep('success')
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className="payment-launcher"><span className="payment-launcher-icon"><Calculator aria-hidden="true" /></span><span className="text-left"><span className="block font-bold">Calculate payment</span><span className="block text-xs opacity-85">Room-based, calculated for you</span></span><ArrowUpRight className="ml-2 size-5 shrink-0" aria-hidden="true" /></button></DialogTrigger>
    <DialogContent className="payment-calculator" aria-describedby="payment-calculator-description">
      {step === 'calculator' && <form onSubmit={event => { event.preventDefault(); review() }}>
        <div className="payment-calculator-heading"><span className="payment-eyebrow">PAYMENT STUDIO · PHP</span><DialogTitle className="mt-2 text-2xl">Choose a room and its bills.</DialogTitle><DialogDescription id="payment-calculator-description" className="mt-2">Select specific unpaid rent periods and calendar-month utilities. Nothing is selected automatically.</DialogDescription><p className="mt-2 text-xs text-muted-foreground">Viewing Billing: {periodLabel}. Collection includes earlier outstanding obligations. Collection date: {formatDate(asOf)}.</p></div>
        <div className="payment-calculator-body">
          <label htmlFor="payment-room" className="mb-2 block text-sm font-semibold">Choose room</label>
          <select id="payment-room" value={historicalRoomId ? '' : roomId} onChange={event => chooseRoom(event.target.value)} className="payment-tenant-select" disabled={occupied.rooms.length === 0} aria-describedby="occupied-room-note">
            <option value="">{occupied.rooms.length === 0 ? 'No occupied rooms available' : 'Choose a room'}</option>
            {occupied.rooms.map(room => <option key={room.id} value={room.id}>Room {room.name}</option>)}
          </select>
          <p id="occupied-room-note" role="status" className="mt-2 text-xs text-muted-foreground">{occupied.rooms.length === 0 ? 'No occupied rooms available. Historical balances remain accessible from Pending Payments.' : 'Only rooms with at least one active occupant are shown.'}</p>
          {occupied.warnings.length > 0 && <ul role="note" className="mt-2 space-y-1 text-xs text-amber-900">{occupied.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          {historicalRoomId && roomId === historicalRoomId && <div role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Historical room collection: Room {data.rooms.find(room => room.id === historicalRoomId)?.name}</strong><span className="block text-xs">Opened from Pending Payments for an authorized historical balance.</span><Button type="button" variant="outline" className="mt-2 min-h-9" onClick={() => chooseRoom('')}>Clear historical room</Button></div>}
          {roomId && <div key={`${roomId}:${cardsEpoch}`} className="payment-obligation-cards">
            <details className="payment-obligation-card"><summary><strong>Rent</strong><span>Anniversary-based billing</span><ChevronDown className="payment-card-chevron" aria-hidden="true" /></summary><div className="payment-card-content">
              <div className="rent-payment-modes" role="group" aria-label="Rent payment mode">
                <button type="button" aria-pressed={rentMode === 'OUTSTANDING'} className="rent-payment-mode" onClick={() => changeRentMode('OUTSTANDING')}><strong>Pay outstanding rent</strong><span>Select individual overdue or current periods.</span></button>
                <button type="button" aria-pressed={rentMode === 'PREPAY'} className="rent-payment-mode" onClick={() => changeRentMode('PREPAY')}><strong>Pay multiple months in advance</strong><span>Select one starting period and a consecutive range.</span></button>
              </div>
              {rentMode === 'OUTSTANDING'
                ? rentItems.length === 0
                  ? <p className="text-sm text-muted-foreground"><input aria-label="Rent" type="checkbox" disabled /> {loading ? 'Loading rent periods…' : catalogError ? 'Rent periods unavailable.' : 'All rent periods paid'}</p>
                  : rentItems.map(item => <label key={item.id} className="collection-obligation">
                    <input type="checkbox" disabled={!item.selectable} checked={selected.includes(item.id)} onChange={() => toggle([item.id])} aria-label={item.charge && item.periodId === periodId ? 'Rent' : `Rent — ${item.periodLabel}`} />
                    <span><strong>{item.periodLabel}</strong><small>Due {item.dueDate ? formatDate(item.dueDate) : 'date not recorded'} · {item.status}</small><small>Original rate {formatMoney(item.originalCents ?? item.amountCents)}</small>{!item.selectable && <small>{item.detail}</small>}</span>
                    <strong>{formatMoney(item.amountCents)}</strong>
                  </label>)
                : <div className="rent-prepayment">
                  <p className="text-xs text-muted-foreground">Choose a starting unpaid anniversary period and the number of consecutive months. The current approved room rate is locked for newly prepaid periods; paid periods are never skipped automatically.</p>
                  {prepayStarts.length === 0
                    ? <p role="status" className="text-sm text-muted-foreground">No eligible rent prepayment is available. The room needs an active anniversary schedule and a settled move-in advance.</p>
                    : <>
                      <div className="rent-prepayment-controls">
                        <label>Starting rental period
                          <select aria-label="Starting rental period" value={effectivePrepayStart} onChange={event => choosePrepayStart(event.target.value)}>
                            {prepayStarts.map(option => <option key={`${option.cycleId}:${option.sequence}`} value={option.sequence}>{formatDate(option.startDate)} – {formatDate(previousCalendarDate(option.endDateExclusive))}</option>)}
                          </select>
                        </label>
                        <label>Consecutive months
                          <input aria-label="Consecutive months" type="number" min={1} max={prepayMaxCount} value={prepayCount} onChange={event => { setPrepayCount(event.target.value); setError(''); setInput(null) }} onBlur={() => setPrepayCount(String(prepayPeriodCount))} />
                        </label>
                      </div>
                      {prepayLoading && <p role="status" className="text-sm text-muted-foreground">Loading rent prepayment quote…</p>}
                      {prepayError && <div role="alert" className="rent-prepayment-alert">{prepayError}<Button type="button" variant="outline" className="mt-2 min-h-9" onClick={() => setPrepayRetry(value => value + 1)}>Retry rent quote</Button></div>}
                      {prepayCatalog?.quote && <section className="rent-prepayment-preview" aria-label="Selected prepayment periods">
                        <h4>Selected rental periods</h4>
                        <ul>
                          {prepayCatalog.quote.periods.map(line => <li key={line.rentalPeriodId} data-conflict={line.conflict ? 'true' : undefined}>
                            <span>
                              <strong>{formatDate(line.startDate)} – {formatDate(previousCalendarDate(line.endDateExclusive))}</strong>
                              <small>Due {formatDate(line.dueDate)} · Rate {formatMoney(line.rateSnapshotCents)}</small>
                              {line.paidCents > 0 && <small>{formatMoney(line.paidCents)} already paid · {formatMoney(line.amountCents)} remaining</small>}
                              {line.conflict && <small>{line.conflict === 'ALREADY_PAID' ? 'Already settled; no duplicate collection is allowed.' : line.conflict === 'ADVANCE_UNPAID' ? 'Settle the mandatory move-in advance first.' : line.conflict === 'PARTIAL_RENT_REVIEW' ? 'Partially paid rent needs reconciliation before prepayment.' : 'This period needs financial review.'}</small>}
                            </span>
                            <strong>{line.conflict ? (line.conflict === 'ALREADY_PAID' ? 'PAID' : 'REVIEW') : formatMoney(line.amountCents)}</strong>
                          </li>)}
                        </ul>
                        {prepayCatalog.quote.payable
                          ? <p className="rent-prepayment-total"><span>{prepayCatalog.quote.periodCount} consecutive periods · locked at {formatMoney(prepayCatalog.quote.rateCents)}</span><strong>{formatMoney(prepayCatalog.quote.totalCents)}</strong></p>
                          : <p role="alert" className="rent-prepayment-alert">This range cannot be collected. {prepayCatalog.reason === 'PAID_PERIOD_CONFLICT' ? 'One or more periods are already paid. Choose a later starting period or a smaller number of months.' : prepayCatalog.reason === 'PARTIAL_RENT' ? 'A selected period is partially paid. Existing rent is all-or-nothing, so reconciliation is required before any remaining balance can be collected.' : 'Choose another eligible range; the selection is not adjusted automatically.'}</p>}
                      </section>}
                      {!prepayCatalog?.quote && !prepayLoading && !prepayError && prepayCatalog?.reason && <p role="alert" className="rent-prepayment-alert">{prepayCatalog.reason}</p>}
                    </>}
                </div>}
            </div></details>
            <details className="payment-obligation-card"><summary><strong>Utilities</strong><span>Calendar-month billing</span><ChevronDown className="payment-card-chevron" aria-hidden="true" /></summary><div className="payment-card-content">
              <p className="text-xs text-muted-foreground">Water and washing are collected by their original calendar month. Electricity is one cumulative interval from the last settled reading, regardless of how many months have passed.</p>
              {electricityGroups.map(group => {
                const ids = group.map(item => item.id)
                const awaiting = group.some(item => item.status === 'AWAITING READING')
                const foundCharge = group.find(item => item.charge)?.charge
                const calculated = foundCharge?.category === 'ELECTRICITY' ? foundCharge : undefined
                const selectedGroup = ids.every(id => selected.includes(id))
                return <section key={group[0]!.meterId ?? roomId} className="collection-month" aria-label="Cumulative electricity">
                  <h3 className="font-semibold">Cumulative electricity</h3>
                  <div className="room-payment-option"><label className="collection-obligation">
                    <input type="checkbox" aria-label="Cumulative electricity" checked={selectedGroup} onChange={() => toggle(ids)} />
                    <span><strong>{group[0]!.meterId ? `Meter ${group[0]!.meterId}` : 'Room meter'}</strong><small>{awaiting ? 'AWAITING READING' : 'UNPAID · cumulative interval'}</small>{group.map(item => <small key={item.id}>{item.detail}</small>)}{calculated && <small>{calculated.electricity.previousReadingMilliKwh / 1000} → {calculated.electricity.currentReadingMilliKwh / 1000} kWh · {calculated.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(calculated.electricity.appliedRateCentsPerKwh)}/kWh</small>}</span>
                    <strong>{awaiting ? 'Amount pending calculation' : formatMoney(group.reduce((sum, item) => sum + item.amountCents, 0))}</strong>
                  </label>
                  {selectedGroup && group.map(item => item.needsReading && <div key={item.id} className="room-payment-electricity"><label htmlFor={`reading-${item.id}`}>Current meter reading (kWh)</label><input id={`reading-${item.id}`} className="electricity-reading-input" inputMode="decimal" value={readingText[item.id] ?? ''} onChange={event => { setReadingText(current => ({ ...current, [item.id]: event.target.value })); setInput(null) }} aria-invalid={Boolean(readingText[item.id] && parseMeterReadingMilliKwh(readingText[item.id]!) === null)} /><p className="text-xs">{item.detail}</p><Link to="/rooms" className="text-sm underline">Open Room Details for verified meter setup</Link></div>)}
                  </div>
                </section>
              })}
              {months.map(month => {
                const monthly = monthlyUtilityItems.filter(item => item.periodId === month)
                return <section key={month} className="collection-month" aria-label={monthly[0]!.periodLabel}><h3 className="font-semibold">{monthly[0]!.periodLabel}</h3>{(['WATER', 'WASHING_MACHINE'] as const).flatMap(category => {
                  const group = monthly.filter(item => item.category === category)
                  if (!group.length) return []
                  const ids = group.map(item => item.id)
                  const label = month === periodId ? CATEGORY_LABELS[category] : `${CATEGORY_LABELS[category]} — ${group[0]!.periodLabel}`
                  const awaiting = group.some(item => item.status === 'AWAITING READING')
                  return [<div key={category} className="room-payment-option"><label className="collection-obligation"><input type="checkbox" aria-label={label} checked={ids.every(id => selected.includes(id))} onChange={() => toggle(ids)} /><span><strong>{CATEGORY_LABELS[category]}</strong><small>{awaiting ? 'AWAITING READING' : group.every(item => item.dueDate) ? group[0]!.status : 'UNPAID · eligible monthly charge'}</small>{group.map(item => <small key={item.id}>{item.label} · {item.detail}</small>)}</span><strong>{awaiting ? 'Amount pending calculation' : formatMoney(group.reduce((sum, item) => sum + item.amountCents, 0))}</strong></label>
                  </div>]
                })}</section>
              })}
              {!electricityItems.length && !months.length && <p className="text-sm text-muted-foreground">{loading ? 'Loading utility obligations…' : catalogError ? 'Utility obligations unavailable.' : 'No unpaid utility obligations.'}</p>}
              {currentQuote?.options.filter(option => option.category !== 'RENT' && !(option.category === 'ELECTRICITY' ? electricityItems.length > 0 : utilityItems.some(item => item.periodId === periodId && item.category === option.category))).map(option => <p key={option.category} className="text-sm text-muted-foreground"><input type="checkbox" aria-label={option.category === 'ELECTRICITY' ? 'Cumulative electricity' : CATEGORY_LABELS[option.category]} disabled /> {option.category === 'ELECTRICITY' ? 'Cumulative electricity' : CATEGORY_LABELS[option.category]} · {option.state === 'PAID' ? 'PAID' : option.detail}</p>)}
            </div></details>
          </div>}
          {loading && <p role="status">Loading authoritative obligations…</p>}
          {catalogError && <div role="alert">{catalogError}<Button type="button" onClick={() => { setLoading(true); setRetry(current => current + 1) }}>Retry loading obligations</Button></div>}
          {error && <p role="alert">{error}</p>}
          {chosen.some(item => item.status === 'AWAITING READING') && <p className="text-xs text-muted-foreground">Electricity is excluded until a valid reading is entered.</p>}
        </div>
        <div className="payment-total-panel"><p>Total to pay</p><output aria-label="Total to pay" aria-live="polite" className="payment-total-value">{formatMoney(total)}</output><p className="text-xs">{chosen.length} obligations selected · pending measurements have no peso amount.</p><div className="mt-5 flex gap-3"><DialogClose asChild><Button type="button" variant="ghost" className="payment-cancel">Cancel</Button></DialogClose><Button type="submit" disabled={!canReview} className="flex-1">Review payment <Check className="size-4" /></Button></div></div>
      </form>}
      {step === 'confirm' && input && <div className="room-payment-confirm"><span className="payment-eyebrow">REVIEW BEFORE SAVING</span><DialogTitle className="mt-2 text-2xl">Confirm payment received</DialogTitle><DialogDescription>Only these selected obligations will be settled. Original periods, rates, due dates, and anniversary anchors remain unchanged.</DialogDescription><dl className="room-payment-summary"><div><dt>Room</dt><dd>Room {data.rooms.find(room => room.id === roomId)?.name}</dd></div><div><dt>Actual collection date</dt><dd>{formatDate(input.collectedOn)}</dd></div>{reviewItems.map(item => <div key={item.id}><dt>{CATEGORY_LABELS[item.category]} · {item.periodLabel}{item.dueDate && <small> · due {formatDate(item.dueDate)}</small>}</dt><dd>{formatMoney(item.amountCents)}</dd></div>)}<div className="room-payment-summary-total"><dt>Total to receive</dt><dd>{formatMoney(reviewItems.reduce((sum, item) => sum + item.amountCents, 0))}</dd></div></dl><p className="text-sm">One cash payment and one itemized receipt, with a separate allocation for each obligation.</p>{error && <p role="alert">{error} {commandError}</p>}<div className="mt-5 flex gap-3"><Button variant="outline" disabled={saving} onClick={() => { setStep('calculator'); setError(''); setRetry(current => current + 1); setPrepayRetry(current => current + 1) }}><ArrowLeft />Back</Button><Button onClick={confirm} disabled={saving}>{saving ? 'Saving payment…' : error ? 'Retry payment' : 'Confirm payment received'}</Button></div></div>}
      {step === 'success' && <div className="payment-success"><span className="payment-success-icon"><Check className="size-8" /></span><DialogTitle className="mt-2 text-2xl">Payment recorded</DialogTitle><DialogDescription>One confirmed room-level cash transaction. Only selected obligations were settled.</DialogDescription><p className="payment-success-amount">{formatMoney(payment?.amountCents ?? 0)}</p><p>{receipt?.receiptNumber}</p><ul className="payment-success-items" aria-label="Receipt items">{reviewItems.map(item => <li key={item.id}><span>{CATEGORY_LABELS[item.category]} · {item.periodLabel}</span><strong>{formatMoney(item.amountCents)}</strong></li>)}</ul>{reviewItems.some(item => item.reading) && <p>Meter baseline advanced to {(reviewItems.find(item => item.reading)?.reading?.readingMilliKwh ?? 0) / 1000} kWh.</p>}<Button autoFocus className="mt-5 w-full" onClick={() => changeOpen(false)}>Got it</Button></div>}
    </DialogContent>
  </Dialog>
}
