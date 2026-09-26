import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { Dialog } from './Dialog'

type Csp = { state: 'loading' } | { state: 'none' } | { state: 'found'; policy: string }
type SelfTest = null | { blockedBy: string } | { blockedBy: null }

/** Explains, and lets the user test, the browser-enforced "nothing is sent" guarantee. */
export function VerifyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [csp, setCsp] = useState<Csp>({ state: 'loading' })
  const [test, setTest] = useState<SelfTest>(null)

  useEffect(() => {
    let alive = true
    // Same-origin request for this page: allowed by `connect-src 'self'`.
    fetch('/', { cache: 'no-store' })
      .then(r => r.headers.get('content-security-policy'))
      .then(policy => alive && setCsp(policy ? { state: 'found', policy } : { state: 'none' }))
      .catch(() => alive && setCsp({ state: 'none' }))
    return () => {
      alive = false
    }
  }, [])

  const runSelfTest = () => {
    setTest(null)
    let blockedBy: string | null = null
    const onViolation = (e: SecurityPolicyViolationEvent) => (blockedBy = e.violatedDirective)
    document.addEventListener('securitypolicyviolation', onViolation)
    // `.invalid` never resolves, so nothing can leave the device even if the policy were missing.
    fetch('https://example.invalid/', { mode: 'no-cors' })
      .catch(() => {})
      .finally(() => {
        // The violation event is dispatched asynchronously.
        setTimeout(() => {
          document.removeEventListener('securitypolicyviolation', onViolation)
          setTest({ blockedBy })
        }, 300)
      })
  }

  return (
    <Dialog title={t.verifyTitle} onClose={onClose}>
      <div className="space-y-6 text-sm leading-relaxed">
        <p>{t.verifyIntro}</p>

        <section className="space-y-2">
          <h3 className="font-medium">{t.verifyCspHeading}</h3>
          <p className="text-muted-foreground">{t.verifyCspBody}</p>
          {csp.state === 'loading' && <p className="text-muted-foreground">{t.verifyCspLoading}</p>}
          {csp.state === 'none' && <p className="rounded-lg bg-muted px-3 py-2">{t.verifyCspNone}</p>}
          {csp.state === 'found' && (
            <>
              <p className="text-muted-foreground">{t.verifyCspLive}</p>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">{csp.policy.split(';').map(d => d.trim()).filter(Boolean).join(';\n')}</pre>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="rounded-full border border-border px-4 py-1.5 transition-colors hover:bg-foreground/5" onClick={runSelfTest}>
                  {t.verifySelfTest}
                </button>
                <span className="text-xs text-muted-foreground">{t.verifySelfTestNote}</span>
              </div>
              {test && (
                <p className="rounded-lg bg-muted px-3 py-2" role="status">
                  {test.blockedBy ? t.verifyBlocked(test.blockedBy) : t.verifyNotBlocked}
                </p>
              )}
            </>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">{t.verifyStepsHeading}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            {t.verifySteps.map(s => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">{t.verifyScopeHeading}</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {t.verifyScope.map(s => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  )
}
