/**
 * A step, built from the REAL components, for the real-DOM gate.
 *
 * Not a mock of the layout: it imports the same RoleCard, PrimaryButton and
 * TextButton the page renders, arranged the way the page arranges them — cards
 * in a row, Back and Continue after them, all inside the one wrapper that
 * carries the grid. What is being tested is precisely that arrangement, so
 * substituting a stand-in for any part of it would test nothing.
 */
import React, { useState } from 'react';
import useRovingGrid from '../../src/components/onboarding/useRovingGrid';
import RoleCard from '../../src/components/onboarding/RoleCard';
import { PrimaryButton, TextButton } from '../../src/components/onboarding/OnboardingPieces';

export const log: string[] = [];

export function Step({ cards = 4, canContinue = true, step = 1 }) {
  const [picked, setPicked] = useState<string[]>([]);
  const grid = useRovingGrid(() => log.push('continue:enter'), step);
  return (
    <div {...grid.containerProps}>
      <div role="group" aria-label="cards">
        {Array.from({ length: cards }, (_, i) => (
          <RoleCard
            key={i}
            label={`Card ${i}`}
            icon={null}
            selected={picked.includes(String(i))}
            onClick={() => {
              log.push(`toggle:${i}`);
              setPicked((p) => (p.includes(String(i)) ? p.filter((x) => x !== String(i)) : [...p, String(i)]));
            }}
          />
        ))}
      </div>
      <div>
        <TextButton onClick={() => log.push('back')}>Back</TextButton>
        <PrimaryButton onClick={() => log.push('continue:click')} disabled={!canContinue}>
          Continue
        </PrimaryButton>
      </div>
    </div>
  );
}

/* The pricing card, for the real-DOM half of scripts/pricing.test.mjs. */
import { PlanCard } from '../../src/components/onboarding/OnboardingPieces';
export function Tier(props: React.ComponentProps<typeof PlanCard>) {
  return <PlanCard {...props} />;
}

/* The advertised annual saving. Re-exported rather than reimplemented: the gate
 * feeds it the REAL catalog, so it has to be the function the page calls. */
export { annualSavingFrom } from '../../src/pages/Onboarding';
