import React from 'react';
import { HardDrive, Cloud, Monitor } from 'lucide-react';

/* Hero mockup — File Explorer's This PC with a XENO Storage drive beside the PC's own disks.
 * The Z: row is what XENO Storage 0.1.0 measured on 2026-10-21: the Google account's own name and
 * its 5,120 GB with 5,119.8 GB free, reported through the drive letter's own volume (Dokany).
 * The other rows are illustrative local disks. */

const drives = [
  { letter: 'C:', name: 'Local Disk', icon: Monitor, used: 0.62, size: '931 GB', free: '354 GB free' },
  { letter: 'Z:', name: 'BUNKER CAMP - Google Drive', icon: Cloud, used: 0.0001, size: '5.00 TB', free: '4.99 TB free', ours: true },
  { letter: 'Y:', name: 'XENO Storage', icon: HardDrive, used: 0.18, size: '100 GB', free: '82 GB free', ours: true },
];

const StorageThisPc: React.FC = () => (
  <div className="flex h-full w-full flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0d0d0f] text-left">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <Monitor className="h-3.5 w-3.5 text-[#cdc7be]" />
      <span className="text-[11.5px] text-[#cdc7be]">This PC</span>
      <span className="ml-auto font-mono text-[9.5px] text-[#5d5850]">Devices and drives</span>
    </div>
    <div className="flex h-[clamp(304px,40vh,372px)] flex-col gap-2.5 overflow-hidden px-3.5 py-3">
      {drives.map((d) => (
        <div key={d.letter} className={`flex items-center gap-3 rounded-[8px] border px-3 py-2.5 ${d.ours ? 'border-white/[0.14] bg-white/[0.04]' : 'border-white/[0.06] bg-white/[0.015]'}`}>
          <d.icon className={`h-7 w-7 shrink-0 ${d.ours ? 'text-[#e8e8e3]' : 'text-[#807970]'}`} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-[#e8e8e3]">{d.name} ({d.letter})</div>
            <div className="mt-1.5 h-[6px] w-full overflow-hidden rounded-[3px] bg-white/[0.08]">
              <div className="h-full bg-[#d8dfe6]" style={{ width: `${Math.max(1, d.used * 100)}%` }} />
            </div>
            <div className="mt-1 font-mono text-[9.5px] text-[#807970]">{d.free} of {d.size}</div>
          </div>
        </div>
      ))}
      <div className="mt-auto font-mono text-[9.5px] leading-[1.7] text-[#5d5850]">
        Z: and Y: are XENO Storage drives. Files appear at once and download when opened.
      </div>
    </div>
  </div>
);

export default StorageThisPc;
