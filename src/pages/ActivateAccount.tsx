import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * The waiting room between "signed up" and "can use the platform".
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 *
 * The activation gate shipped server-side first, and for a few hours the
 * enforcement was INVISIBLE: an unactivated user hit a bare 403 with no
 * explanation while the fix sat unread in their inbox. A gate nobody can see is
 * worse than no gate — it converts "unengaged user" into "user who thinks the
 * product is broken".
 *
 * ── WHY A CODE RATHER THAN ONLY A LINK ──────────────────────────────────────
 *
 * Corporate mail security (Defender Safe Links, Proofpoint, Mimecast)
 * PRE-FETCHES every URL in an inbound message. v1 committed on GET, so a
 * scanner activated accounts with nobody involved — manufacturing the exact
 * proof of intent the gate exists to require. A scanner cannot type six digits.
 *
 * The code also means you never leave this tab, which matters more than it
 * sounds: people sign up on a laptop and read mail on a phone, and a link-only
 * flow either strands them or lands a session on the wrong device.
 *
 * ── THE LINK STILL WORKS, AND THAT IS WHY WE POLL ───────────────────────────
 *
 * If they do click the link on the phone, this tab notices within a few seconds
 * and moves on by itself. Polling stops the moment it flips, on unmount, and
 * after a bounded window — an unattended tab must not poll forever.
 */

type Phase = 'waiting' | 'verifying' | 'done' | 'invalid-link';

const POLL_MS = 4000;
const POLL_CEILING_MS = 15 * 60 * 1000; // matches the code TTL
const RESEND_COOLDOWN_S = 60;

export default function ActivateAccount() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>(
    params.get('activated') === '1' ? 'done' : 'waiting',
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const email = (() => {
    try { return JSON.parse(localStorage.getItem('xenoos_user') || '{}').email || null; }
    catch { return null; }
  })();
  const token = localStorage.getItem('xenoos_auth_token');

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Arriving from the link's POST redirect.
  useEffect(() => {
    if (params.get('activation') === 'invalid') setPhase('invalid-link');
  }, [params]);

  /** Poll, so a click on another device finishes this tab. */
  useEffect(() => {
    if (phase !== 'waiting' || !token) return;
    const started = Date.now();
    let live = true;
    const tick = async () => {
      if (!live || Date.now() - started > POLL_CEILING_MS) return;
      try {
        const r = await fetch('/api/auth/activation-status', {
          headers: { Authorization: `Bearer ${token}` },
        });
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
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: value }),
      });
      const d = await r.json();
      if (d?.success) { setPhase('done'); return; }
      setError(d?.error || 'That code is not right.');
      setAttemptsLeft(typeof d?.attemptsLeft === 'number' ? d.attemptsLeft : null);
      setPhase('waiting');
      setCode('');
      inputRef.current?.focus();
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
    if (digits.length === 6) submit(digits);   // auto-submit, no button hunt
  };

  const resend = async () => {
    if (!token || cooldown > 0) return;
    setCooldown(RESEND_COOLDOWN_S); setError(null); setResendNote(null);
    try {
      const r = await fetch('/api/auth/resend-activation', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setResendNote(d?.alreadyActivated ? 'This account is already active.' : 'Sent. Check your inbox.');
      if (d?.alreadyActivated) setPhase('done');
    } catch {
      setResendNote('Could not send. Try again shortly.');
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#060608] px-5 py-16">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 text-center text-[11px] font-bold tracking-[0.34em] text-[#d8d8de]">XENO</div>
        <div className="rounded-md border border-white/[0.08] bg-[#111111] p-6">{children}</div>
      </div>
    </div>
  );

  if (phase === 'done') {
    return shell(
      <>
        <h1 className="text-[19px] font-semibold text-white">You're all set</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[#7f7f86]">
          Your account is active. Thanks for confirming — it keeps the platform clear of
          throwaway signups.
        </p>
        <button
          type="button"
          onClick={() => navigate('/overview')}
          className="mt-5 w-full cursor-pointer rounded-[4px] bg-[#e8e8ee] px-4 py-2.5 text-[13.5px] font-semibold text-[#111]"
        >
          Continue to the workspace
        </button>
      </>,
    );
  }

  if (phase === 'invalid-link') {
    return shell(
      <>
        <h1 className="text-[19px] font-semibold text-white">That link didn't work</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[#7f7f86]">
          It may have been altered in transit or already used. Enter the six-digit code from
          the same email instead, or send yourself a new one.
        </p>
        <button
          type="button"
          onClick={() => { setPhase('waiting'); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="mt-5 w-full cursor-pointer rounded-[4px] border border-white/[0.2] px-4 py-2.5 text-[13.5px] text-[#d8d8de]"
        >
          Enter a code instead
        </button>
      </>,
    );
  }

  return shell(
    <>
      <h1 className="text-[19px] font-semibold text-white">Confirm your email</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[#7f7f86]">
        We sent a six-digit code{email ? <> to <span className="text-[#d8d8de]">{email}</span></> : ''}.
        Enter it below to unlock the workspace.
      </p>

      <input
        ref={inputRef}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        // Lets iOS and Android offer the code straight from the notification,
        // which is the single biggest completion win on mobile.
        autoComplete="one-time-code"
        placeholder="000000"
        aria-label="Six-digit confirmation code"
        disabled={phase === 'verifying'}
        className="mt-5 w-full rounded-[4px] border border-white/10 bg-[#060608] px-4 py-3 text-center font-mono text-[26px] tracking-[0.3em] text-white outline-none transition-colors placeholder:text-[#3a3a3f] focus:border-white/25 disabled:opacity-50"
      />

      {error && (
        <p className="mt-3 text-[12.5px] text-red-300/90">
          {error}
          {attemptsLeft !== null && attemptsLeft > 0 && (
            <span className="text-[#7f7f86]"> {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left.</span>
          )}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0}
          className="cursor-pointer text-[12.5px] text-[#acacb4] transition-colors hover:text-white disabled:cursor-default disabled:text-[#5d5d63]"
        >
          {/* A disabled button with no countdown reads as broken. */}
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/auth')}
          className="cursor-pointer text-[12.5px] text-[#5d5d63] transition-colors hover:text-[#acacb4]"
        >
          Wrong address?
        </button>
      </div>

      {resendNote && <p className="mt-3 text-[12px] text-[#7f7f86]">{resendNote}</p>}

      <p className="mt-4 text-[11.5px] leading-relaxed text-[#5d5d63]">
        Clicking the link in the email works too — this page will notice and move on by itself.
      </p>
    </>,
  );
}
