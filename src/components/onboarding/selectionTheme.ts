import { useEffect, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * SELECTION TREATMENT — a temporary A/B so the two can be compared live.
 *
 * ⚠️ THIS IS A DECISION AID, NOT A FEATURE. Once a treatment is chosen, delete
 * this file, delete `SelectionToggle`, and inline the winning values. Shipping
 * a user-facing switch between two visual treatments would be shipping the
 * indecision.
 *
 * ── THE QUESTION IT EXISTS TO ANSWER ───────────────────────────────────────
 *
 * `lift` raises every selected surface — a lighter header plate and a
 * stronger gradient. With all four suites chosen at once that is four cards
 * brightening together, and the screen stops reading as black.
 *
 * `edge` keeps the surfaces exactly where they are and carries selection
 * entirely on the border and the check. The argument for it: on a dark UI,
 * brightness is the scarcest signal available, and spending it on FOUR cards
 * at once spends it on nothing — if everything is emphasised, nothing is. A
 * border is a boundary, and a boundary is what "selected" actually means.
 *
 * Persisted to localStorage so a reload does not reset the comparison
 * mid-judgement.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type SelectionTreatment = 'lift' | 'edge';

const KEY = 'xeno.onboarding.selectionTreatment';

export const TREATMENTS: Record<SelectionTreatment, {
  label: string;
  note: string;
  /** Header plate when selected. */
  headerBg: string;
  /** The bar's own surface when the frame is closed. */
  barBg: string;
  /** Border when selected. */
  border: string;
  /** Shadow when selected. */
  shadow: string;
}> = {
  lift: {
    label: 'Lift',
    note: 'Surfaces brighten',
    headerBg: '#242424',
    barBg: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.40)',
    shadow: '0 20px 46px -18px rgba(0,0,0,0.92)',
  },
  edge: {
    // Identical surfaces to the UNSELECTED state. Only the border and the
    // check change, so four cards selecting together does not wash the screen.
    label: 'Edge',
    note: 'Border only, stays black',
    headerBg: '#1a1a1a',
    barBg: 'transparent',
    border: 'rgba(255,255,255,0.55)',
    shadow: '0 14px 34px -18px rgba(0,0,0,0.9)',
  },
};

/** Read once, then keep in sync across every component using it. */
export function useSelectionTreatment(): [SelectionTreatment, (t: SelectionTreatment) => void] {
  const [treatment, setTreatment] = useState<SelectionTreatment>(() => {
    if (typeof window === 'undefined') return 'lift';
    const stored = window.localStorage.getItem(KEY);
    return stored === 'edge' || stored === 'lift' ? stored : 'lift';
  });

  useEffect(() => {
    // A custom event, not just localStorage: `storage` only fires in OTHER
    // tabs, so without this the toggle would update itself and leave the cards
    // it is meant to be changing on the previous treatment.
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<SelectionTreatment>).detail;
      if (next) setTreatment(next);
    };
    window.addEventListener('xeno:selection-treatment', onChange);
    return () => window.removeEventListener('xeno:selection-treatment', onChange);
  }, []);

  const set = (t: SelectionTreatment) => {
    window.localStorage.setItem(KEY, t);
    window.dispatchEvent(new CustomEvent('xeno:selection-treatment', { detail: t }));
  };

  return [treatment, set];
}
