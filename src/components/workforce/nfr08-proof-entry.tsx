import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ScopeNav } from './ScopeNav';
import { ScopeDialog } from './ScopeDialog';

// Proof-only entry: bundles the real workforce components for the NFR-08
// jsdom proof. Not imported by the app.
export const scopes = [
  { id: 'ws-1', label: 'Workspace one', status: 'active' as const },
  { id: 'ws-2', label: 'Workspace two', status: 'paused' as const },
  { id: 'ws-3', label: 'Workspace three', status: 'blocked' as const },
];

let root: ReturnType<typeof createRoot> | null = null;
let selected: string | null = null;

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button id="dialog-opener" type="button" onClick={() => setOpen(true)}>
        Open scope dialog
      </button>
      <ScopeDialog open={open} title="Scope details" onClose={() => setOpen(false)}>
        <label>
          Scope note
          <input type="text" defaultValue="" />
        </label>
        <button type="button">Apply note</button>
      </ScopeDialog>
    </div>
  );
}

export async function render(kind: 'nav' | 'dialog') {
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  selected = scopes[0].id;
  await act(async () => {
    root = createRoot(container);
    if (kind === 'nav') {
      root.render(<ScopeNav scopes={scopes} activeId={scopes[0].id} onSelect={(id) => { selected = id; }} />);
    } else {
      root.render(<DialogHarness />);
    }
  });
  return {
    selected: () => selected,
    dispatch: async (target: Element | null, event: Event) => {
      await act(async () => {
        target?.dispatchEvent(event);
      });
    },
  };
}

export async function keyDown(target: Element | null, key: string) {
  await act(async () => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

export async function click(target: Element | null) {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
