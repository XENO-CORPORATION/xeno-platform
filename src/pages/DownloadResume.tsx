/**
 * /download/resume?i=<intent>
 *
 * Where every interrupted download comes back to. Sign-in returns here,
 * onboarding returns here, and Stripe returns here — so this is the single place
 * that has to know how to finish the job, whatever was missing.
 *
 * 🔴 THE THREE DOTS ARE NOT DECORATION. Stripe redirects the browser back the
 * instant the payment is authorised, but the plan is granted by a WEBHOOK — a
 * different process, arriving anywhere from a few hundred milliseconds to tens of
 * seconds later. For that window a customer who has genuinely paid is, as far as
 * the database is concerned, still on the free plan.
 *
 * The naive implementation asks once, sees `plan`, and sends the person who just
 * paid back to the pricing page. That is the single worst screen in this entire
 * flow, and it is the default outcome if nobody thinks about it. So the wait is a
 * real state with a real spinner: we poll until the entitlement lands, and only
 * give up after long enough that something is genuinely wrong.
 */
import React from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Download, Check, AlertCircle } from 'lucide-react';
import {
  readIntent, claimIntent, startTransfer,
  type IntentEnvelope, type DownloadState,
} from '../lib/downloadFlow';
import { getProduct } from '../lib/productCatalog';

const OS_NAME: Record<string, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

/* Long enough to cover a slow webhook, short enough that a genuinely stuck
 * payment does not spin forever. Backed off so we are not hammering the API for
 * a minute: the first seconds are when it usually lands. */
const POLL_MS = [800, 800, 1200, 1200, 2000, 2000, 3000, 3000, 4000, 5000, 5000, 5000, 5000, 5000];

const Dots: React.FC = () => (
  <span className="inline-flex items-center gap-1" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70"
        style={{ animation: `xenoDot 1.2s ${i * 0.16}s infinite ease-in-out` }}
      />
    ))}
  </span>
);

const DownloadResume: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get('i') || '';
  const checkout = params.get('checkout');

  const [env, setEnv] = React.useState<IntentEnvelope | null>(null);
  const [phase, setPhase] = React.useState<'loading' | 'waiting' | 'settled' | 'starting' | 'started' | 'error'>('loading');
  const [message, setMessage] = React.useState<string>('');
  const started = React.useRef(false);

  const product = env ? getProduct(env.slug) : null;

  /* Claim first. Arriving here is the observable moment an anonymous visitor
   * became a known one, and it is what makes "this account exists because of a
   * download" answerable at all. `isNew` is set by the OAuth callback. */
  React.useEffect(() => {
    if (!token) { setPhase('error'); setMessage('This download link is missing its reference.'); return; }
    let cancelled = false;

    (async () => {
      let wasSignup = false;
      try {
        wasSignup = sessionStorage.getItem('xeno_signup_pending') === '1';
        if (wasSignup) sessionStorage.removeItem('xeno_signup_pending');
      } catch { /* storage disabled — attribution degrades, flow continues */ }

      const claimed = await claimIntent(token, wasSignup);
      const first = claimed || (await readIntent(token));
      if (cancelled) return;

      if (!first) { setPhase('error'); setMessage('This download link has expired. Start the download again from the product page.'); return; }
      setEnv(first);

      /* Coming back from a successful checkout, a non-ready state is almost
       * certainly the webhook still in flight — wait rather than bounce. */
      if (checkout === 'success' && first.state !== 'ready') { setPhase('waiting'); return; }
      setPhase('settled');
    })();

    return () => { cancelled = true; };
  }, [token, checkout]);

  /* The webhook wait. */
  React.useEffect(() => {
    if (phase !== 'waiting') return;
    let cancelled = false;
    let i = 0;

    const tick = async () => {
      if (cancelled) return;
      const next = await readIntent(token);
      if (cancelled) return;
      if (next) {
        setEnv(next);
        if (next.state === 'ready') { setPhase('settled'); return; }
      }
      i += 1;
      if (i >= POLL_MS.length) {
        /* Deliberately NOT an error, and deliberately not a bounce to pricing.
         * The payment may still be settling; telling someone their purchase
         * failed when it has not is worse than telling them to wait. */
        setPhase('settled');
        setMessage('Your payment went through, but the plan has not appeared yet. This usually clears within a minute — reload this page, and contact us if it does not.');
        return;
      }
      setTimeout(tick, POLL_MS[i]);
    };

    const t = setTimeout(tick, POLL_MS[0]);
    return () => { cancelled = true; clearTimeout(t); };
  }, [phase, token]);

  /* Ready → go. Once, guarded: React 18 StrictMode double-invokes effects in
   * development, and two grants for one click is a confusing audit row. */
  React.useEffect(() => {
    if (phase !== 'settled' || !env || env.state !== 'ready' || started.current) return;
    started.current = true;
    setPhase('starting');
    (async () => {
      const ok = await startTransfer(env.slug, env.os, env.token, env.version || undefined);
      setPhase(ok ? 'started' : 'error');
      if (!ok) setMessage('We could not start the download. Reload the page to try again.');
    })();
  }, [phase, env]);

  const state: DownloadState | null = env?.state ?? null;
  const osLabel = env ? (OS_NAME[env.os] || env.os) : '';
  const name = product?.name || env?.slug || 'your download';

  const busy = phase === 'loading' || phase === 'waiting' || phase === 'starting';

  const headline = (() => {
    if (phase === 'error') return 'Something went wrong';
    if (phase === 'waiting') return 'Confirming your plan';
    if (phase === 'started') return `Downloading ${name}`;
    if (phase === 'starting') return `Starting ${name}`;
    if (state === 'signin') return 'Sign in to download';
    if (state === 'onboarding') return 'One quick step first';
    if (state === 'plan') return 'Choose a plan to download';
    if (state === 'unavailable') return `No ${osLabel} build yet`;
    return `Download ${name}`;
  })();

  const body = (() => {
    if (message) return message;
    if (phase === 'waiting') return 'Payment received. We are activating your plan — this takes a few seconds.';
    if (phase === 'started') return `${name} for ${osLabel} is downloading. If nothing happened, use the button below.`;
    if (state === 'signin') return `Your ${name} download is saved. Sign in or create an account and it will continue automatically.`;
    if (state === 'onboarding') return 'Tell us a little about what you do, and your download continues straight after.';
    if (state === 'plan') return `${name} is included with every XENO plan. Choose one and your download continues automatically.`;
    if (state === 'unavailable') return `There is no ${osLabel} build of ${name} published yet. Nothing was charged.`;
    return '';
  })();

  return (
    <div className="min-h-screen bg-[#08070a] px-6 py-24 text-[#ece7df]">
      <style>{'@keyframes xenoDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}'}</style>

      <div className="mx-auto max-w-[520px]">
        <div className="rounded-[14px] border border-white/[0.09] bg-[#0d0d0d] p-8">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-[10px] border border-white/[0.09] bg-white/[0.03]">
            {phase === 'error' ? <AlertCircle className="h-5 w-5 text-[#948d83]" />
              : phase === 'started' ? <Check className="h-5 w-5" />
                : <Download className="h-5 w-5" />}
          </div>

          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{headline}</h1>
          {body && <p className="mt-2 text-[13.5px] leading-[1.6] text-[#948d83]">{body}</p>}

          <div className="mt-7">
            {busy && (
              <div className="inline-flex w-full items-center justify-center gap-2 rounded-[8px] bg-white px-6 py-3 text-[14px] font-semibold text-black">
                {phase === 'waiting' ? 'Activating' : 'Preparing'} <Dots />
              </div>
            )}

            {!busy && state === 'ready' && (
              <button
                type="button"
                onClick={() => { started.current = false; setPhase('settled'); }}
                className="w-full rounded-[8px] bg-white px-6 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90"
              >
                {phase === 'started' ? 'Download again' : `Download for ${osLabel}`}
              </button>
            )}

            {!busy && env && state && state !== 'ready' && (
              <Link
                to={env.next}
                className="block w-full rounded-[8px] bg-white px-6 py-3 text-center text-[14px] font-semibold text-black transition-colors hover:bg-white/90"
              >
                {state === 'signin' ? 'Continue'
                  : state === 'onboarding' ? 'Continue'
                    : state === 'plan' ? 'See plans'
                      : 'Back to product'}
              </Link>
            )}

            {phase === 'error' && (
              <Link
                to="/products"
                className="block w-full rounded-[8px] border border-white/[0.12] px-6 py-3 text-center text-[14px] font-semibold text-[#ece7df] transition-colors hover:border-white/[0.22]"
              >
                Browse products
              </Link>
            )}
          </div>

          {env && (
            <p className="mt-5 text-[11.5px] leading-[1.5] text-[#69635b]">
              {name} · {osLabel}{env.version ? ` · ${env.version}` : ''}
              {state === 'plan' && ' · one plan covers every XENO app'}
            </p>
          )}
        </div>

        {state === 'plan' && (
          <p className="mt-4 text-center text-[12px] text-[#69635b]">
            Already subscribed on another account? <Link to="/auth" className="text-[#ece7df] hover:underline">Switch account</Link>
          </p>
        )}
      </div>
    </div>
  );
};

export default DownloadResume;
