import React, { useCallback, useRef } from 'react';
import { ScopeStatusBadge, ScopeStatus } from './ScopeStatusBadge';

export interface WorkforceScope {
  id: string;
  label: string;
  status: ScopeStatus;
}

interface ScopeNavProps {
  scopes: WorkforceScope[];
  activeId: string;
  onSelect: (id: string) => void;
}

// NFR-08: the workforce scope navigator. A labelled nav landmark; every
// option is a real button with a visible text name; exactly one option is
// in the tab order (roving tabindex) while ArrowUp/ArrowDown/Home/End move
// between options and Enter/Space activates the focused one via onSelect.
// The active option carries aria-current so position survives restyle.
export const ScopeNav: React.FC<ScopeNavProps> = ({ scopes, activeId, onSelect }) => {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const focusOption = useCallback(
    (index: number) => {
      const clamped = (index + scopes.length) % scopes.length;
      buttons.current[clamped]?.focus();
    },
    [scopes.length],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(index + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(index - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusOption(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusOption(scopes.length - 1);
      }
    },
    [focusOption, scopes.length],
  );

  return (
    <nav aria-label="Workforce scopes">
      <ul className="scope-nav-list">
        {scopes.map((scope, index) => {
          const isActive = scope.id === activeId;
          return (
            <li key={scope.id}>
              <button
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                type="button"
                tabIndex={isActive ? 0 : -1}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(scope.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span className="scope-nav-label">{scope.label}</span>{' '}
                <ScopeStatusBadge status={scope.status} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
