import React from 'react';
import { Code2, FileText, Image, GitBranch, Boxes, Loader2, ArrowUpRight } from 'lucide-react';
import type { ArtifactKind } from '../artifacts/types';
import { useChatStore } from '../store';

const KIND_META: Record<ArtifactKind, { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  html: { label: 'Webpage', Icon: Code2 },
  svg: { label: 'SVG', Icon: Image },
  mermaid: { label: 'Diagram', Icon: GitBranch },
  react: { label: 'React', Icon: Boxes },
  document: { label: 'Document', Icon: FileText },
  code: { label: 'Code', Icon: Code2 },
};

/**
 * ArtifactCard — the compact inline placeholder shown in the message thread where an
 * artifact block sits, instead of dumping the raw source. Clicking opens the side panel.
 */
const ArtifactCard: React.FC<{
  artifactId: string;
  title: string;
  artifactKind: ArtifactKind;
  complete: boolean;
}> = ({ artifactId, title, artifactKind, complete }) => {
  const openArtifact = useChatStore((s) => s.openArtifact);
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const panelOpen = useChatStore((s) => s.artifactPanelOpen);
  const meta = KIND_META[artifactKind] ?? KIND_META.code;
  const isActive = panelOpen && activeArtifactId === artifactId;

  return (
    <button
      type="button"
      onClick={() => openArtifact(artifactId)}
      className={`group my-3 flex w-full max-w-md items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
        isActive
          ? 'border-[#ece7df]/50 bg-[#ece7df]/10'
          : 'border-white/12 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          isActive ? 'bg-[#ece7df]/20 text-[#c99bff]' : 'bg-white/[0.06] text-white/70'
        }`}
      >
        {complete ? <meta.Icon size={17} /> : <Loader2 size={17} className="animate-spin" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-white/90">{title}</span>
        <span className="mt-0.5 block text-[12px] text-white/45">
          {complete ? `${meta.label} · Click to open` : `${meta.label} · Generating…`}
        </span>
      </span>
      <ArrowUpRight
        size={16}
        className="shrink-0 text-white/30 transition-colors group-hover:text-white/70"
      />
    </button>
  );
};

export default ArtifactCard;
