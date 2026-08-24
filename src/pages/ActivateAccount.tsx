import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthMark from '../components/auth/AuthMark';
import {
  destinationAfterActivation, isFullPageActivationDest,
} from '../lib/onboardingHandoff.js';

/**
 * The waiting room between "signed up" and "can use the platform".
 *
 * ── STANDALONE AND CENTRED, DELIBERATELY ────────────────────────────────────
 *
 * Every other auth page sits in AuthLayout's split — hero panel left, form
 * right. This one does not, and the reason is what the page IS: a two-second
 * transactional step for someone who has ALREADY decided to sign up. The hero
 * exists to persuade, and there is nobody left to persuade; "Create without
 * limits." beside "enter your code" is a pitch aimed at a customer who already
 * bought.
 *
 * So it borrows AuthLayout's visual language exactly — the #000 ground, the
 * max-w-[400px] column, the 3xl heading, text-white/40 body, h-16 field,
 * h-12 rounded-[6px] button, the same fade-in — and drops only the split. Same
 * product, one screen with a single job.
 *
 * ── WHY A CODE RATHER THAN ONLY A LINK ──────────────────────────────────────
 *
 * Corporate mail security (Defender Safe Links, Proofpoint, Mimecast)
 * PRE-FETCHES every URL in an inbound message. v1 committed on GET, so a
 * scanner activated accounts with nobody involved — manufacturing the exact
 * proof of intent this gate exists to require. A scanner cannot type six
 * digits. The code also keeps the user in the tab they started in, which
 * matters because people sign up on a laptop and read mail on a phone.
 *
 * The link still works, and that is why this polls: a click on the phone
 * finishes this tab by itself.
 */

type Phase = 'waiting' | 'verifying' | 'done' | 'invalid-link';

const POLL_MS = 4000;
const POLL_CEILING_MS = 15 * 60 * 1000; // matches the code TTL
const RESEND_COOLDOWN_S = 60;

const ActivateAccount = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [isVisible, setIsVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>(params.get('activated') === '1' ? 'done' : 'waiting');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const email = (() => {
    try { return JSON.parse(localStorage.getItem('xenoos_user') || '{}').email || null; }
    catch { return null; }
  })();
  const token = typeof window !== 'undefined' ? localStorage.getItem('xenoos_auth_token') : null;

  useEffect(() => { setIsVisible(true); }, []);
  useEffect(() => { if (phase === 'waiting') inputRef.current?.focus(); }, [phase]);
  useEffect(() => { if (params.get('activation') === 'invalid') setPhase('invalid-link'); }, [params]);

  /** Poll, so a click on another device finishes this tab. */
  useEffect(() => {
    if (phase !== 'waiting' || !token) return;
    const started = Date.now();
    let live = true;
    const tick = async () => {
      if (!live || Date.now() - started > POLL_CEILING_MS) return;
      try {
        const r = await fetch('/api/auth/activation-status', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        if (live && d?.activated) { setPhase('done'); return; }
      } catch { /* a dropped poll is not worth showing anyone */ }
      if (live) window.setTimeout(tick, POLL_MS);
    };
    const t = window.setTimeout(tick, POLL_MS);
    return () => { live = false; window.clearTimeout(t); };
  }, [phase, token]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const submit = useCallback(async (value: string) => {
    if (!token) { setError('Please sign in again.'); return; }
    setPhase('verifying'); setError(null);
    try {
      const r = await fetch('/api/auth/activate/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: value }),
      });
      const d = await r.json();
      if (d?.success) { setPhase('done'); return; }
      setError(d?.error || 'That code is not right.');
      setAttemptsLeft(typeof d?.attemptsLeft === 'number' ? d.attemptsLeft : null);
      setPhase('waiting'); setCode('');
    } catch {
      setError('Could not reach the server. Try again.');
      setPhase('waiting');
    }
  }, [token]);

  /** Paste-tolerant: people paste "123 456" or "123-456" straight from mail. */
  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError(null);
    if (digits.length === 6) submit(digits);   // auto-submit, no button to hunt for
  };

  const resend = async () => {
    if (!token || cooldown > 0 || resending) return;
    setResending(true); setResendMessage(''); setError(null);
    try {
      const r = await fetch('/api/auth/resend-activation', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d?.alreadyActivated) { setPhase('done'); return; }
      setResendMessage('Sent. Check your inbox.');
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setResendMessage('Could not send. Try again shortly.');
    } finally { setResending(false); }
  };

  return (
    <div className="h-screen h-[100dvh] overflow-hidden bg-[#000000] text-white font-['Inter',sans-serif] antialiased flex flex-col">
      {/* The mark sits with the content, not in a chrome bar — there is no
          layout to align to, and a lone top-left logo on a centred page reads
          as a fragment of a page that did not load. */}
      {/* Top-left, same position and rhythm as every other auth page. It was
          centred under a wordmark; a back link is navigation, and navigation
          belongs in the corner you look at first, not in the middle of the
          reading column. */}
      <header className="shrink-0 flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4">
        <Link
          to="/auth"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} />
          <span>Back to sign in</span>
        </Link>
        <AuthMark />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-6 pb-10">
        <div
          className={`w-full max-w-[400px] transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          {phase === 'done' ? (
            <div className="animate-fadeSlideUp">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-[6px] bg-white/[0.06] border border-white/[0.08]">
                <ArrowRight size={22} className="text-white/70" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">You&rsquo;re all set</h2>
              <p className="text-white/40 leading-relaxed">
                Your account is active. Thanks for confirming &mdash; it keeps the platform clear of
                throwaway signups.
              </p>
              {/* A pending OIDC/CLI grant resumes first. Website signups
                  with no grant go to onboarding. Hardcoding /onboarding here
                  is how a portal signup lost its authorize URL. */}
              <button
                type="button"
                onClick={() => {
                  const dest = destinationAfterActivation();
                  if (isFullPageActivationDest(dest)) {
                    window.location.href = dest;
                    return;
                  }
                  navigate(dest);
                }}
                className="mt-8 w-full h-12 rounded-[6px] bg-white text-black font-semibold transition-all duration-300 hover:bg-white/90"
              >
                Continue
              </button>
            </div>
          ) : phase === 'invalid-link' ? (
            <div className="animate-fadeSlideUp">
              <h2 className="text-3xl font-bold tracking-tight mb-2">That link didn&rsquo;t work</h2>
              <p className="text-white/40 leading-relaxed">
                It may have been altered in transit or already used. Enter the six-digit code from the
                same email instead, or send yourself a new one.
              </p>
              <button
                type="button"
                onClick={() => setPhase('waiting')}
                className="mt-8 w-full h-12 rounded-[6px] border border-white/[0.12] text-white/80 font-medium transition-all duration-300 hover:border-white/25 hover:text-white"
              >
                Enter a code instead
              </button>
            </div>
          ) : (
            <div className="animate-fadeSlideUp">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Confirm your email</h2>
              <p className="text-white/40 leading-relaxed">
                We sent a six-digit code{email ? <> to <span className="text-white/70">{email}</span></> : ''}.
                Enter it below to unlock the workspace.
              </p>

              {/*
                SIX CELLS, ONE INPUT.

                The obvious build is six <input>s. It is also the one that
                breaks the things that matter most here: pasting "481 902" from
                a mail client, and `autocomplete="one-time-code"` — which on iOS
                and Android offers the code straight from the notification and
                is the single biggest completion win on mobile. Six inputs turn
                both into focus-juggling bugs.

                So there is ONE real input, spanning the row and transparent,
                with six cells drawn underneath it. Paste, autofill, mobile
                keyboards and screen readers all see a normal six-character
                field; the person sees six boxes. The caret is hidden because
                the filled/active cell already shows position.
              */}
              <div
                className="relative mt-8 cursor-text"
                onClick={() => inputRef.current?.focus()}
              >
                <input
                  ref={inputRef}
                  value={code}
                  onChange={(e) => onChange(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-label="Six-digit confirmation code"
                  disabled={phase === 'verifying'}
                  className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-text disabled:cursor-default"
                />
                <div className="grid grid-cols-6 gap-2" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, i) => {
                    const char = code[i];
                    // The "active" cell is the next empty one — or the last,
                    // once full, so the ring does not vanish on the sixth digit.
                    const active = focused && (i === Math.min(code.length, 5));
                    return (
                      <div
                        key={i}
                        className={`h-14 sm:h-16 flex items-center justify-center rounded-[4px] border font-mono text-2xl sm:text-3xl transition-all duration-150 ${
                          char ? 'text-white' : 'text-white/20'
                        } ${
                          active
                            ? 'border-white/40 bg-white/[0.07]'
                            : char
                              ? 'border-white/[0.14] bg-white/[0.04]'
                              : 'border-white/[0.08] bg-white/[0.02]'
                        } ${phase === 'verifying' ? 'opacity-50' : ''}`}
                      >
                        {char || ''}
                      </div>
                    );
                  })}
                </div>
              </div>

              {error && (
                <p className="mt-4 text-sm text-red-300/90">
                  {error}
                  {attemptsLeft !== null && attemptsLeft > 0 && (
                    <span className="text-white/40"> {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left.</span>
                  )}
                </p>
              )}

              <div className="mt-8 pt-6 border-t border-white/[0.06] flex items-center justify-between">
                <button
                  type="button"
                  onClick={resend}
                  disabled={cooldown > 0 || resending}
                  className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors disabled:text-white/25 disabled:cursor-default"
                >
                  <RefreshCw size={14} className={resending ? 'animate-spin' : ''} />
                  {/* A disabled button with no countdown reads as broken. */}
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
                </button>
                <Link to="/auth" className="text-sm text-white/30 hover:text-white/60 transition-colors">
                  Wrong address?
                </Link>
              </div>

              {resendMessage && <p className="mt-4 text-sm text-white/50">{resendMessage}</p>}

              {/*
                Names a TIMEFRAME and names SPAM. Without both, someone whose
                mail is slow has no idea whether to wait or to act, and the
                single most common reason a code never arrives is a filter, not
                a bug. "Check your spam" after five minutes is the whole
                support ticket, pre-answered.
              */}
              <p className="mt-6 text-xs leading-relaxed text-white/25">
                Not there within a few minutes? Check your spam folder, or send a new code.
                Clicking the link in the email works too &mdash; this page will notice and move
                on by itself.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivateAccount;
