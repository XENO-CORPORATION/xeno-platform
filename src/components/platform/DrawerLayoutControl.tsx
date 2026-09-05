import React, { useEffect, useRef, useState } from 'react';
import { Check, Maximize2, PanelRight, PanelsTopLeft } from 'lucide-react';

export type DrawerLayout = 'side' | 'full';

interface Props {
  value: DrawerLayout;
  onChange: (value: DrawerLayout) => void;
}

const DrawerLayoutControl: React.FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="xeno-drawer-layout-control" ref={rootRef}>
      <button type="button" aria-label="Change detail layout" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <PanelsTopLeft size={17} />
      </button>
      {open ? (
        <div className="xeno-drawer-layout-menu" role="menu" aria-label="Detail layout">
          <span>Switch layout</span>
          <button type="button" role="menuitemradio" aria-checked={value === 'side'} onClick={() => { onChange('side'); setOpen(false); }}>
            <PanelRight size={16} /><span>Side drawer</span>{value === 'side' ? <Check size={15} /> : null}
          </button>
          <button type="button" role="menuitemradio" aria-checked={value === 'full'} onClick={() => { onChange('full'); setOpen(false); }}>
            <Maximize2 size={16} /><span>Full page</span>{value === 'full' ? <Check size={15} /> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default DrawerLayoutControl;
