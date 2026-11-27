import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DoorOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { formatDate, formatMoney } from '@/lib/format'
import { roomCategoryLabel } from '@/lib/room-rates'
import {
  AuthApiError, cancelTenantRoomChangeRequest, getTenantRoomChangeOptions, requestTenantRoomChange,
  type TenantRoomChangeOptions, type TenantRoomChangeRequest,
} from '@/features/auth/auth-api'

const statusLabels: Record<TenantRoomChangeRequest['status'], string> = {
  PENDING: 'Pending landlord review',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

function RequestSummary({ request }: { request: TenantRoomChangeRequest }) {
  return <article className="room-change-card" aria-label="Room change request">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <span className="room-change-status" data-status={request.status}>{statusLabels[request.status]}</span>
        <p className="mt-3 font-semibold">Room {request.currentRoomName} &rarr; Room {request.requestedRoomName}</p>
      </div>
      <p className="text-sm text-muted-foreground">Requested {formatDate(request.requestedStartDate)}</p>
    </div>
    <p className="mt-3 text-sm text-muted-foreground">Reason: {request.reason}</p>
    {request.status === 'PENDING' && <p className="mt-3 text-xs text-muted-foreground">The landlord must review this request. It does not reserve the room or change your current tenancy.</p>}
    {request.status === 'APPROVED' && request.approvedStartDate && <p className="mt-3 text-xs text-muted-foreground">Approved effective {formatDate(request.approvedStartDate)}. Historical bills and receipts remain unchanged.</p>}
    {request.status === 'REJECTED' && request.decisionReason && <p className="mt-3 text-xs text-muted-foreground">Landlord note: {request.decisionReason}</p>}
  </article>
}

export function TenantRoomChangeRequestSection() {
  const { refreshFromServer } = usePrototype()
  const [data, setData] = useState<TenantRoomChangeOptions | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [requestedRoomId, setRequestedRoomId] = useState('')
  const [requestedStartDate, setRequestedStartDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const value = await getTenantRoomChangeOptions()
      setData(value)
      setRequestedStartDate(current => current || value.serverDate)
      setState('ready')
      setError('')
    } catch (failure) {
      setState('error')
      setError(failure instanceof Error ? failure.message : 'Room options could not be loaded.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getTenantRoomChangeOptions().then(value => {
      if (cancelled) return
      setData(value)
      setRequestedStartDate(current => current || value.serverDate)
      setState('ready')
    }).catch((failure: unknown) => {
      if (cancelled) return
      setState('error')
      setError(failure instanceof Error ? failure.message : 'Room options could not be loaded.')
    })
    return () => { cancelled = true }
  }, [])

  const pending = data?.requests.find(request => request.status === 'PENDING') ?? null
  const latest = data?.requests[0] ?? null
  const previous = data?.requests.slice(1) ?? []

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !data) return
    if (!requestedRoomId) {
      setError('Choose the room you want to move to.')
      return
    }
    if (reason.trim().length < 3) {
      setError('Explain briefly why you want to move.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await requestTenantRoomChange({ requestedRoomId, requestedStartDate, reason })
      setReason('')
      setRequestedRoomId('')
      setRequestedStartDate(result.serverDate)
      setNotice('Room change request submitted. The landlord must review it before any transfer occurs.')
      await load()
      refreshFromServer()
    } catch (failure) {
      setError(failure instanceof AuthApiError ? failure.message : 'The room change request could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function cancel(requestId: string) {
    if (cancelling) return
    setCancelling(true)
    setError('')
    setNotice('')
    try {
      await cancelTenantRoomChangeRequest(requestId)
      setNotice('Your room change request was cancelled. No tenancy or financial record changed.')
      await load()
      refreshFromServer()
    } catch (failure) {
      setError(failure instanceof AuthApiError ? failure.message : 'The room change request could not be cancelled.')
    } finally {
      setCancelling(false)
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><DoorOpen className="size-5 text-[var(--tint)]" aria-hidden="true" />Request a room change</CardTitle>
      <CardDescription>Requests are reviewed by the landlord. A request does not reserve a room or change your current tenancy.</CardDescription>
    </CardHeader>
    <CardContent className="min-w-0">
      {state === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading available rooms…</p>}
      {state === 'error' && <div role="alert" className="grid gap-3"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></div>}
      {state === 'ready' && data && <>
        {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-300/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100">{notice}</p>}
        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
        {pending ? <>
          <RequestSummary request={pending} />
          <Button type="button" variant="outline" className="mt-4" disabled={cancelling} onClick={() => void cancel(pending.id)}>{cancelling ? 'Cancelling…' : 'Cancel request'}</Button>
        </> : <>
          {latest && <RequestSummary request={latest} />}
          {data.options.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{data.current ? 'No other room can accept your request right now. Ask the landlord about availability.' : 'You need an active room assignment before requesting a room change.'}</p> : <form className="mt-5 grid min-w-0 gap-4" onSubmit={submit} noValidate>
            <div className="grid min-w-0 gap-2">
              <label htmlFor="tenant-room-change-target" className="text-sm font-semibold">Room you want</label>
              <select id="tenant-room-change-target" value={requestedRoomId} onChange={event => { setRequestedRoomId(event.target.value); setError('') }} className="min-h-12 w-full min-w-0 max-w-full truncate rounded-xl border border-input bg-card px-3 text-base" disabled={saving}>
                <option value="">Choose an available room</option>
                {data.options.map(option => <option key={option.id} value={option.id}>Room {option.name} · {roomCategoryLabel(option.categoryId)} · {formatMoney(option.monthlyRentCents)}/month</option>)}
              </select>
            </div>
            <div className="grid min-w-0 gap-2">
              <label htmlFor="tenant-room-change-date" className="text-sm font-semibold">Requested move date</label>
              <input id="tenant-room-change-date" type="date" min={data.serverDate} value={requestedStartDate} onChange={event => { setRequestedStartDate(event.target.value); setError('') }} className="min-h-12 w-full min-w-0 max-w-full rounded-xl border border-input bg-card px-3" disabled={saving} required />
              <p className="text-xs text-muted-foreground">The landlord may adjust this date during review. No rent is prorated automatically.</p>
            </div>
            <div className="grid min-w-0 gap-2">
              <label htmlFor="tenant-room-change-reason" className="text-sm font-semibold">Reason</label>
              <textarea id="tenant-room-change-reason" rows={3} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setError('') }} className="min-h-24 w-full min-w-0 resize-y rounded-xl border border-input bg-card p-3" disabled={saving} required placeholder="Explain briefly why you want to move." />
              <p className="text-right text-xs text-muted-foreground">{reason.length} / 500 characters</p>
            </div>
            <Button type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Submitting…' : <><Plus aria-hidden="true" />Submit request</>}</Button>
          </form>}
        </>}
        {previous.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Previous requests ({previous.length})</summary><ul className="mt-3 grid gap-2">{previous.map(request => <li key={request.id} className="rounded-xl border px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>Room {request.currentRoomName} &rarr; Room {request.requestedRoomName}</span><span className="text-muted-foreground">{statusLabels[request.status]}</span></div><p className="mt-1 text-xs text-muted-foreground">Requested {formatDate(request.requestedStartDate)}</p></li>)}</ul></details>}
      </>}
    </CardContent>
  </Card>
}
