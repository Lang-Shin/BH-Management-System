import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Link2, ShieldOff, ShieldCheck } from 'lucide-react'
import { useOptionalAuth } from '@/app/providers/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AuthApiError, cancelInvitation, createTenantInvitation, issueAccountRecovery, listAccounts, reactivateAccount, suspendAccount, type AuthAccount, type AuthInvitation } from '@/features/auth/auth-api'
import { formatDate } from '@/lib/format'
import type { Tenant } from '@/domain/types/models'

type PendingAction = { label: string; run: () => Promise<void> }

function accountStatus(tenant: Tenant, account: AuthAccount | undefined, invitation: AuthInvitation | undefined): { label: string; detail: string } {
  if (account?.status === 'DISABLED') return { label: 'Suspended', detail: 'Sign-in and protected access are denied.' }
  if (tenant.status === 'MOVED_OUT' && account) {
    if (account.access_expires_at && Date.parse(account.access_expires_at) <= Date.now()) return { label: 'Access expired', detail: 'The authorized historical-access window has ended.' }
    return { label: 'Former tenant', detail: account.access_expires_at ? `Historical access until ${formatDate(account.access_expires_at.slice(0, 10))}.` : 'Historical access remains authorized.' }
  }
  if (account?.status === 'ACTIVE') return { label: 'Active', detail: account.email_verified ? 'Account active and email marked verified.' : 'Account active; email is stored as unverified.' }
  if (invitation) return { label: 'Invitation pending', detail: `Expires ${formatDate(invitation.expires_at.slice(0, 10))}.` }
  return { label: 'No account', detail: 'No tenant sign-in account is linked yet.' }
}

export function TenantAccountAccess({ tenant }: { tenant: Tenant }) {
  const auth = useOptionalAuth()
  const enabled = Boolean(auth?.enabled && auth.status === 'authenticated' && (auth.session?.role === 'OWNER' || auth.session?.role === 'ADMIN'))
  const [accounts, setAccounts] = useState<AuthAccount[]>([])
  const [invitations, setInvitations] = useState<AuthInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const result = await listAccounts()
      setAccounts(result.accounts)
      setInvitations(result.invitations)
      setError(null)
    } catch (failure) {
      setError(failure instanceof AuthApiError ? failure.message : 'Account access status could not be loaded.')
    } finally { setLoading(false) }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    listAccounts().then(result => {
      if (cancelled) return
      setAccounts(result.accounts)
      setInvitations(result.invitations)
      setError(null)
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof AuthApiError ? failure.message : 'Account access status could not be loaded.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled])

  if (!enabled) return null

  const account = accounts.find(item => item.tenant_id === tenant.id)
  const invitation = invitations.find(item => item.tenant_id === tenant.id && item.kind === 'TENANT')
  const status = accountStatus(tenant, account, invitation)

  const run = async (task: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await task()
      setMessage(success)
      await load()
    } catch (failure) {
      setError(failure instanceof AuthApiError
        ? failure.code === 'FRESH_AUTH_REQUIRED' ? 'Sign in again before changing account access.'
          : failure.message
        : 'The account action could not be completed.')
    } finally { setBusy(false) }
  }

  const generate = async () => {
    await run(async () => {
      const result = await createTenantInvitation(tenant.id)
      if (result.inviteUrl) setLink(result.inviteUrl)
    }, 'A new single-use tenant invitation was created.')
  }

  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setMessage('Invitation link copied.') }
    catch { setError('Could not copy the link. Select it manually.') }
  }

  const share = async () => {
    if (!link) return
    if (!navigator.share) return copy()
    try { await navigator.share({ title: 'Halili BH account invitation', text: 'Your private Halili BH account invitation.', url: link }) }
    catch { /* cancelled share is not an error */ }
  }

  return <section className="rounded-lg border p-4" aria-labelledby="tenant-account-access-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="tenant-account-access-title" className="text-lg font-semibold">Account access</h2><p className="mt-1 text-sm text-muted-foreground">Tenant sign-in and invitation status. Financial records stay independent of authentication.</p></div>
      <span className="rounded-full border bg-muted px-3 py-1 text-sm font-semibold">{status.label}</span>
    </div>
    <p className="mt-3 text-sm text-muted-foreground">{status.detail}</p>
    {account && <p className="mt-2 break-all text-sm"><span className="text-muted-foreground">Account email: </span>{account.email}</p>}
    {link && <div className="mt-3 rounded-lg border bg-muted/40 p-3"><p className="break-all text-xs">{link}</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={copy}><Copy aria-hidden="true" />Copy link</Button><Button type="button" size="sm" variant="outline" onClick={share}><Link2 aria-hidden="true" />Share</Button></div></div>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      {!account && invitation && <><Button type="button" size="sm" onClick={generate} disabled={busy}>Regenerate invitation</Button><Button type="button" size="sm" variant="outline" onClick={() => setPendingAction({ label: 'Cancel this pending invitation?', run: async () => { await cancelInvitation(invitation.id); setLink(null) } })} disabled={busy}>Cancel invitation</Button></>}
      {!account && !invitation && <Button type="button" size="sm" onClick={generate} disabled={busy}>{busy ? 'Creating…' : 'Generate invitation'}</Button>}
      {account && account.status === 'ACTIVE' && tenant.status === 'ACTIVE' && <Button type="button" size="sm" variant="outline" onClick={() => setPendingAction({ label: `Suspend account access for ${tenant.name}? Existing sessions will be denied.`, run: async () => { await suspendAccount(account.id) } })} disabled={busy}><ShieldOff aria-hidden="true" />Suspend account</Button>}
      {account && (account.status === 'DISABLED' || tenant.status === 'MOVED_OUT') && <Button type="button" size="sm" variant="outline" onClick={() => setPendingAction({ label: `Reactivate account access for ${tenant.name}?`, run: async () => { await reactivateAccount(account.id) } })} disabled={busy}><ShieldCheck aria-hidden="true" />Reactivate account</Button>}
      {account && <Button type="button" size="sm" variant="outline" onClick={() => void run(async () => { const result = await issueAccountRecovery(account.id); if (result.recoveryUrl) setLink(result.recoveryUrl) }, 'A single-use password recovery link was created.')} disabled={busy}><KeyRound aria-hidden="true" />Recovery link</Button>}
    </div>
    {invitation && <p className="mt-3 text-xs text-muted-foreground">Invitation status: {invitation.state.toLowerCase()} · expires {formatDate(invitation.expires_at.slice(0, 10))}.</p>}
    {loading && <p role="status" className="mt-3 text-xs text-muted-foreground">Refreshing account status…</p>}
    <Dialog open={Boolean(pendingAction)} onOpenChange={open => { if (!open) setPendingAction(null) }}><DialogContent><DialogHeader><DialogTitle>Confirm account access change</DialogTitle><DialogDescription>{pendingAction?.label}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setPendingAction(null)}>Cancel</Button><Button type="button" onClick={() => { if (!pendingAction) return; const action = pendingAction; setPendingAction(null); void run(action.run, 'Account access updated.') }} disabled={busy}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
