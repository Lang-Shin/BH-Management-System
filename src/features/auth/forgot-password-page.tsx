import { Link } from 'react-router-dom'
import { AuthCard, AuthLayout } from './auth-components'

export default function ForgotPasswordPage() {
  return <AuthLayout><AuthCard title="Need help signing in?" description="Recovery is handled by a verified person, not an automated email." footer={<p><Link className="auth-link" to="/sign-in">Back to sign in</Link></p>}>
    <div className="mt-5 grid gap-5 text-sm leading-relaxed text-muted-foreground">
      <section><h2 className="font-semibold text-foreground">Tenant accounts</h2><p className="mt-1">Contact your landlord. After verifying your identity, the landlord can give you a single-use recovery link. Only you choose the new password.</p></section>
      <section><h2 className="font-semibold text-foreground">Landlord account</h2><p className="mt-1">Contact the verified operator for operator-assisted recovery. After recovery, sign in again and re-enroll your authenticator.</p></section>
      <p className="rounded-xl border bg-muted/40 p-3">BHMS does not reveal whether an email address has an account. Recovery emails are not sent automatically.</p>
    </div>
  </AuthCard></AuthLayout>
}
