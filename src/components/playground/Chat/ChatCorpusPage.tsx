import React, { useCallback, useEffect, useState } from 'react';
import { Button, StatusPill, Switch } from '@xenosystem/elements-react';
import { FileText, Globe, Monitor, Library } from '@/lib/icons';
import { chatService, type CorpusSource, type ProjectCorpus } from '@/services/chatService';

/**
 * A Chat project's Corpus (xeno-corpus docs/specs/2026-11-27-notebooks-in-chat.md §3.3,
 * `/chat/projects/<id>/corpus`): the sources this project's answers are grounded in, each with its
 * state, and whether answers use it. Answers cite these sources by number. Reading, ranking and citing
 * are XENO Corpus's own code (src/server/vendor/xeno-corpus-notebook), so the page carries its name
 * (owner, 2026-11-28: "we already have Corpus").
 *
 * What it never does: list a source as fine when nothing could be read from it (D22). A failed source
 * says why, and a stale one says it is not used until it is read again.
 */
export type ChatCorpusPageProps = {
  /** Left offset when the history sidebar is open (same as Scheduled / Artifacts). */
  pageLeft: number;
  projectId: string;
  projectName?: string;
  onClose: () => void;
};

const RADIUS = 'rounded-[4px]';

const REASONS: Record<string, string> = {
  not_read_into_passages: 'Not read into passages yet',
  older_passage_version: 'Read by an older version',
  file_changed: 'The file changed since it was read',
  extraction_changed: 'Read again since; passages are out of date',
  no_passages: 'No readable text',
  unsupported: 'This file type cannot be read',
  unsupported_type: 'This file type cannot be read',
  extract_limit: 'Too large to read',
  malware_detected: 'Blocked by the malware scan',
  pc_missing: 'The PC it was on has been removed',
  project_not_enabled: 'That PC no longer offers this corpus',
  snapshot_missing: 'Its saved copy is gone',
};
const reasonText = (reason: string | null): string => {
  if (!reason) return '';
  if (REASONS[reason]) return REASONS[reason];
  // Corpus's refusal reads "CODE: why" — the why is the sentence to show
  const why = reason.replace(/^[A-Z_]+:\s*/, '');
  return why.charAt(0).toUpperCase() + why.slice(1);
};

function StateLine({ source }: { source: CorpusSource }) {
  if (source.state === 'indexed') {
    return <StatusPill tone="success" dot>{source.passages === 1 ? '1 passage' : `${source.passages} passages`}</StatusPill>;
  }
  if (source.state === 'queued') return <StatusPill tone="neutral" dot>Reading</StatusPill>;
  if (source.state === 'stale') return <StatusPill tone="warning" dot>{`Out of date · ${reasonText(source.reason)}`}</StatusPill>;
  return <StatusPill tone="danger" dot>{`Couldn't read · ${reasonText(source.reason) || 'unknown reason'}`}</StatusPill>;
}

const KindIcon = ({ kind }: { kind: CorpusSource['kind'] }) =>
  kind === 'web' ? <Globe size={14} aria-hidden="true" /> : kind === 'local_corpus' ? <Monitor size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />;

export default function ChatCorpusPage({ pageLeft, projectId, projectName, onClose }: ChatCorpusPageProps) {
  const [corpus, setCorpus] = useState<ProjectCorpus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setCorpus(await chatService.getProjectCorpus(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Corpus could not be loaded');
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  // a source still being read changes on its own: look again while any is queued
  useEffect(() => {
    if (!corpus?.sources.some((s) => s.state === 'queued')) return undefined;
    const t = window.setTimeout(() => { void load(); }, 4000);
    return () => window.clearTimeout(t);
  }, [corpus, load]);

  const setSelected = async (source: CorpusSource, selected: boolean) => {
    setBusy(source.id);
    try {
      await chatService.setCorpusSourceSelected(projectId, source.id, selected);
      setCorpus((cp) => cp && { ...cp, sources: cp.sources.map((s) => (s.id === source.id ? { ...s, selected } : s)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change was not saved');
    } finally {
      setBusy(null);
    }
  };

  const sources = corpus?.sources ?? [];
  const used = sources.filter((s) => s.selected && s.state === 'indexed').length;

  return (
    <div
      className="absolute inset-0 z-[45] flex flex-col main-content-transition"
      style={{ left: pageLeft, backgroundColor: 'var(--chat-canvas)', color: 'var(--chat-text)' }}
      role="dialog"
      aria-label="Corpus"
      data-chat-corpus={projectId}
    >
      <div className="mx-auto flex h-full w-full max-w-[56rem] flex-col px-4 sm:px-6">
        <div className="flex min-h-[2.75rem] flex-shrink-0 items-center gap-3 pt-6 pb-4 md:pt-8 md:pb-5">
          <Button variant="secondary" size="sm" onClick={onClose} aria-label="Back to the project">
            {projectName || 'Project'}
          </Button>
          <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Library size={15} aria-hidden="true" /> Corpus
          </h1>
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-[var(--chat-muted)]" data-corpus-summary="">
          {corpus
            ? sources.length
              ? `Answers in this project come from ${used === 1 ? '1 source' : `${used} sources`} below, and cite them by number. Turn a source off to keep it out of answers.`
              : 'This project has no sources yet. Add files to the project and they are read into its Corpus.'
            : 'Loading the Corpus…'}
        </p>

        {error && (
          <div role="alert" className={`mb-3 border px-3 py-2 text-xs ${RADIUS}`} style={{ borderColor: 'var(--chat-border)', color: 'var(--chat-danger)' }}>
            {error}
          </div>
        )}

        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-8" aria-label="Sources">
          {sources.map((s) => (
            <li
              key={s.id}
              data-corpus-source={s.id}
              data-state={s.state}
              className={`flex items-center gap-3 border px-3 py-2.5 text-[12.5px] ${RADIUS}`}
              style={{ borderColor: 'var(--chat-border)', opacity: s.selected ? 1 : 0.6 }}
            >
              <span className="flex-shrink-0 text-[var(--chat-muted)]"><KindIcon kind={s.kind} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.title}</span>
                <span className="mt-1 block"><StateLine source={s} /></span>
              </span>
              <label className="flex flex-shrink-0 items-center gap-2 text-[11.5px] text-[var(--chat-muted)]">
                <span>Use in answers</span>
                <Switch
                  checked={s.selected}
                  disabled={busy === s.id || s.kind !== 'file'}
                  onCheckedChange={(checked) => { void setSelected(s, checked); }}
                  aria-label={`Use ${s.title} in answers`}
                />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
