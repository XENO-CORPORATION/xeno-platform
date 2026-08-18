import React from 'react';
import { Check } from 'lucide-react';
import { SUITES, EVERYTHING_ID, recommendedWorkspace } from '../../lib/workspaceSuites';

/* ═══════════════════════════════════════════════════════════════════════════
 * ROLE CARD
 *
 * The same shell-and-plate anatomy as the suite cards, from
 * `XENO CHROME - CONSTRUCTION PLAYBOOK.md`: a shell carrying page background,
 * plates floating on it with a 2px gap, header LIGHTER than body so the body
 * reads as recessed.
 *
 * The role step was still flat tiles while the workspace step had real cards.
 * Two adjacent steps in one flow built to two standards is the thing a person
 * notices without being able to name — the flow stops feeling like one
 * product.
 *
 * ── THE BODY PLATE SHOWS WHERE THE ANSWER LEADS ────────────────────────────
 *
 * Each card names the workspace that role will recommend. That is not
 * decoration to fill the plate: the very next step arrives with a card
 * PRE-SELECTED, and this is where that stops being a surprise. The user sees
 * the consequence before choosing, so the recommendation reads as something
 * they caused rather than something that happened to them.
 *
 * Roles with no confident mapping say so plainly instead of inventing one.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** What each role actually does — one line, concrete, no marketing. */
const ROLE_BLURB: Record<string, string> = {
  'Personal use': 'Projects for yourself',
  Designer: 'Interfaces, brand and layout',
  Developer: 'Code, agents and automation',
  Creator: 'Video, audio and publishing',
  Marketer: 'Campaigns, social and reach',
  'Studio or agency': 'Client work across disciplines',
  Education: 'Teaching, research and coursework',
  Other: 'Something else entirely',
};

/** The line under the blurb: where this role will be pointed next. */
function leadsTo(role: string): string {
  const rec = recommendedWorkspace(role);
  if (rec === EVERYTHING_ID) return 'Everything';
  const name = SUITES.find((s) => s.id === rec)?.name;
  // No guess. A role we cannot place says so, rather than being pointed
  // somewhere plausible and wrong.
  return name || 'You choose';
}

export const RoleCard: React.FC<{
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}> = ({ label, icon, selected, onClick, style }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    style={{
      background: '#08080a',
      boxShadow: selected
        ? '0 16px 38px -16px rgba(0,0,0,0.9)'
        : '0 8px 24px -14px rgba(0,0,0,0.8)',
      ...style,
    }}
    className={`focus-self group relative flex flex-col gap-[2px] rounded-[10px] border p-1.5 text-left
                transition-[border-color,transform,box-shadow] duration-200 ease-out will-change-transform
                hover:-translate-y-[3px] active:translate-y-0
                ${selected ? 'border-white/40' : 'border-white/[0.07] hover:border-white/[0.22]'}`}
  >
    {/* ── Header plate ── */}
    <span
      className="flex shrink-0 items-center gap-2.5 rounded-t-[7px] px-3 py-2.5 transition-colors duration-200"
      style={{ background: selected ? '#242424' : '#1a1a1a' }}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border transition-colors duration-200
                    ${selected
                      ? 'border-white/25 bg-white/[0.12] text-white'
                      : 'border-white/[0.09] bg-white/[0.04] text-white/50 group-hover:text-white/85'}`}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-tight text-white">
        {label}
      </span>

      {/* Replaces nothing — the header has room, and a check that appears in
          empty space cannot shift the label. */}
      <span
        aria-hidden
        className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[4px] bg-white
                    transition-all duration-200 ease-out
                    ${selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
      >
        <Check className="h-3 w-3 text-black" strokeWidth={3} />
      </span>
    </span>

    {/* ── Body plate ── */}
    <span className="flex flex-1 flex-col justify-between rounded-b-[7px] px-3 py-2.5" style={{ background: '#111111' }}>
      <span className="block text-[11.5px] leading-snug text-white/40">
        {ROLE_BLURB[label] || ''}
      </span>

      <span className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.06] pt-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/25">
          Workspace
        </span>
        <span className="ml-auto text-[11px] font-medium text-white/55">{leadsTo(label)}</span>
      </span>
    </span>
  </button>
);

export default RoleCard;
