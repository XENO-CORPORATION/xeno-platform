import { useCallback, useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * Step transitions.
 *
 * ── WHAT WAS ACTUALLY MISSING ──────────────────────────────────────────────
 *
 * The first version animated content IN on mount and did nothing else. Click
 * Continue and the old screen vanished on the same frame the new one started —
 * so the eye had nothing to follow, and the whole flow read as static no matter
 * how nice the entrance curve was. An entrance animation is not a transition:
 * a transition needs an EXIT, and the exit is the half that carries continuity.
 *
 * This drives a three-phase cycle so the outgoing step leaves before the
 * incoming one arrives, and both move in the direction of travel — forward
 * exits left and enters from the right, Back does the reverse. Direction is
 * what makes the flow feel like a place you are moving THROUGH rather than a
 * series of unrelated screens.
 *
 * ── WHY NOT JUST CSS ───────────────────────────────────────────────────────
 *
 * `key={step}` + a CSS animation only ever animates the NEW subtree; React has
 * already unmounted the old one, so there is nothing left to animate out. Any
 * exit animation requires holding the outgoing content in the DOM past the
 * state change, which is state, which is this hook.
 *
 * ── REDUCED MOTION ─────────────────────────────────────────────────────────
 *
 * Checked LIVE rather than once at mount: the OS setting can change while the
 * page is open, and a flow captured in the wrong mode at boot either animates
 * at somebody who asked it not to, or stays frozen for somebody who turned it
 * back on. When reduced, the swap is instantaneous — no exit hold, because
 * making a reduced-motion user wait out an animation they cannot see is the
 * worst of both.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Phase = 'in' | 'out';

const EXIT_MS = 170;

export function useStepTransition(step: number) {
  // The step currently PAINTED, which lags `step` for the length of the exit.
  const [rendered, setRendered] = useState(step);
  const [phase, setPhase] = useState<Phase>('in');
  const [direction, setDirection] = useState<1 | -1>(1);
  const prev = useRef(step);
  const timer = useRef<number | undefined>(undefined);

  const prefersReduced = useCallback(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (step === prev.current) return;

    setDirection(step > prev.current ? 1 : -1);
    prev.current = step;

    if (prefersReduced()) { setRendered(step); setPhase('in'); return; }

    setPhase('out');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setRendered(step);
      setPhase('in');
    }, EXIT_MS);
  }, [step, prefersReduced]);

  // A pending swap must not fire after unmount — it would set state on a dead
  // component and, worse, leave the flow painted on the wrong step if the user
  // navigated away mid-transition.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Style for the step container. Exits toward the direction of travel. */
  const style: React.CSSProperties = prefersReduced()
    ? {}
    : phase === 'out'
      ? {
          opacity: 0,
          transform: `translateX(${-16 * direction}px)`,
          transition: `opacity ${EXIT_MS}ms ease-in, transform ${EXIT_MS}ms ease-in`,
          pointerEvents: 'none',
        }
      : {
          // Entrance is driven by the .xeno-stagger children, so the container
          // itself only needs to be present and un-transformed. Animating both
          // would double the movement and read as a lurch.
          opacity: 1,
          transform: 'translateX(0)',
          transition: 'opacity 220ms ease-out, transform 220ms cubic-bezier(0.22,1,0.36,1)',
        };

  return { rendered, phase, direction, style, reduced: prefersReduced() };
}

export default useStepTransition;
