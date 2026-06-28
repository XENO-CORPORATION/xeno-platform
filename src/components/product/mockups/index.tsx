import React from 'react';
import CommsChat from './CommsChat';

/* Built-in product mockups — referenced from a content module's Media as
 * { type: 'mockup', src: '<key>' }. Lets a landing page ship a crisp, faithful
 * UI mockup (no heavy screenshot asset) keyed by name. Add a product's mockup
 * here and reference it from src/content/products/<slug>.ts. */
const MOCKUPS: Record<string, React.ComponentType> = {
  'comms-chat': CommsChat,
};

export function Mockup({ name }: { name: string }): React.ReactElement | null {
  const Cmp = MOCKUPS[name];
  return Cmp ? <Cmp /> : null;
}

export function hasMockup(name: string): boolean {
  return name in MOCKUPS;
}
