import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, File, FileImage, FileText, Search, Shapes } from 'lucide-react';
import {
  ARTIFACT_KIND_LABEL,
  deleteArtifact,
  getArtifactShareUrl,
  listArtifacts,
  type ArtifactKind,
  type ChatArtifact,
} from './chatArtifacts';

type ArtifactsSort = 'updated' | 'created' | 'name';
type KindFilter = ArtifactKind | 'all';

export type ChatArtifactsPageProps = {
  /** Left offset when history sidebar is open (same as Projects). */
  pageLeft: number;
  onClose: () => void;
};

const SORT_LABELS: Record<ArtifactsSort, string> = {
  updated: 'Last updated',
  created: 'Date created',
  name: 'Name',
};

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'document', label: 'Documents' },
  { id: 'code', label: 'Code' },
  { id: 'image', label: 'Images' },
  { id: 'html', label: 'Interactive' },
];

const formatEdited = (ts: number): string => {
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Edited today';
  if (diff < 2 * day) return 'Edited yesterday';
  const days = Math.floor(diff / day);
  if (days < 14) return `Edited ${days} days ago`;
  return `Edited ${new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
};

const KindIcon: React.FC<{ kind: ArtifactKind }> = ({ kind }) => {
  if (kind === 'image') return <FileImage size={14} aria-hidden="true" />;
  if (kind === 'code' || kind === 'html') return <File size={14} aria-hidden="true" />;
  return <FileText size={14} aria-hidden="true" />;
};

/**
 * Full-page Artifacts library — XENO chrome (Projects-style column), not a Claude clone.
 * Data only through chatArtifacts.ts so the backend can swap in later.
 */
const ChatArtifactsPage: React.FC<ChatArtifactsPageProps> = ({ pageLeft, onClose }) => {
  const [rows, setRows] = useState<ChatArtifact[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ArtifactsSort>('updated');
  const [kind, setKind] = useState<KindFilter>('all');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const next = await listArtifacts({ query, kind, sort });
    setRows(next);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [query, kind, sort]);

  useEffect(() => {
    if (!isSortOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-artifacts-sort-menu]')) return;
      setIsSortOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [isSortOpen]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const handleDelete = async (id: string) => {
    await deleteArtifact(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  const handleCopyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(getArtifactShareUrl(id));
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    } catch {
      /* clipboard denied — keep silent; button stays as Copy */
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  };

  return (
    <div
      className="absolute inset-0 z-[45] flex flex-col main-content-transition"
      style={{
        left: pageLeft,
        backgroundColor: 'var(--chat-canvas)',
        color: 'var(--chat-text)',
      }}
      role="dialog"
      aria-label="Artifacts"
    >
      <style>{`
        .chat-artifact-card {
          background-color: var(--chat-surface);
          border-color: var(--chat-border);
          box-shadow: 0 0 0 0 transparent;
          transform: translateY(0);
          cursor: pointer;
          transition:
            transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
            background-color 220ms ease,
            box-shadow 220ms ease;
        }
        .chat-artifact-card[data-selected='true'] {
          background-color: var(--chat-elevated);
        }
        .chat-artifact-card:hover,
        .chat-artifact-card:focus-visible {
          transform: translateY(-3px);
          background-color: var(--chat-elevated);
          box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.65);
        }
        .chat-artifact-copy-btn {
          transition:
            transform 160ms ease,
            background-color 160ms ease,
            color 160ms ease;
        }
        .chat-artifact-copy-btn:active {
          transform: scale(0.96);
        }
        .chat-artifact-card-icon {
          border-color: var(--chat-border);
          transition: color 220ms ease, background-color 220ms ease;
        }
        .chat-artifact-card:hover .chat-artifact-card-icon,
        .chat-artifact-card:focus-visible .chat-artifact-card-icon {
          background-color: var(--chat-control);
          color: var(--chat-text);
        }
        .chat-artifact-card-meta {
          transition: color 220ms ease;
        }
        .chat-artifact-card:hover .chat-artifact-card-meta,
        .chat-artifact-card:focus-visible .chat-artifact-card-meta {
          color: color-mix(in srgb, var(--chat-muted) 55%, var(--chat-text));
        }
      `}</style>
      <div className="mx-auto flex h-full w-full max-w-[48rem] flex-col px-4 sm:px-6">
        <div className="flex min-h-[2.75rem] flex-shrink-0 items-center justify-between gap-3 pt-6 pb-4 md:min-h-[3rem] md:pt-8 md:pb-5">
          <div className="relative" data-artifacts-sort-menu="">
            <button
              type="button"
              onClick={() => setIsSortOpen((open) => !open)}
              className="group relative flex items-center overflow-hidden rounded-lg py-1.5 pr-3 pl-3 text-[12.5px] hover:pl-8"
              style={{
                backgroundColor: 'var(--chat-control)',
                color: 'var(--chat-text)',
                willChange: 'padding',
                transition: 'padding 600ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              aria-haspopup="menu"
              aria-expanded={isSortOpen}
              aria-label={`Sort by ${SORT_LABELS[sort]}`}
            >
              <ChevronDown
                size={13}
                className="pointer-events-none absolute left-2.5 z-0 translate-x-5 text-[var(--chat-muted)] opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                style={{
                  willChange: 'opacity, transform',
                  transition:
                    'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1), transform 600ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                aria-hidden="true"
              />
              <span
                className="relative z-10 pl-0.5 font-medium text-[var(--chat-text)]"
                style={{ backgroundColor: 'var(--chat-control)' }}
              >
                {SORT_LABELS[sort]}
              </span>
            </button>
            {isSortOpen && (
              <div
                role="menu"
                className="chat-history-popover absolute left-0 top-full z-10 mt-1.5 min-w-full w-max overflow-hidden rounded-xl border p-1"
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  boxShadow:
                    '0 12px 28px -8px color-mix(in srgb, var(--chat-text) 18%, transparent)',
                }}
              >
                {(Object.keys(SORT_LABELS) as ArtifactsSort[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSort(value);
                      setIsSortOpen(false);
                    }}
                    className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-[var(--chat-text)] transition-colors hover:bg-[var(--chat-hover)]"
                  >
                    <span>{SORT_LABELS[value]}</span>
                    {sort === value && (
                      <Check
                        size={13}
                        className="ml-auto text-[var(--chat-accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12.5px] text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
          >
            Close
          </button>
        </div>

        <div className="mb-4 flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Shapes size={18} className="flex-shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
            <h2 className="truncate text-[1.35rem] font-medium tracking-tight text-[var(--chat-text)] md:text-[1.5rem]">
              Artifacts
            </h2>
          </div>
          <label className="relative block w-full sm:max-w-[16rem]">
            <span className="sr-only">Search artifacts</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--chat-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-9 w-full rounded-lg border bg-transparent pl-8 pr-3 text-[12.5px] text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] focus:border-[var(--chat-border)]"
              style={{ borderColor: 'var(--chat-border)' }}
            />
          </label>
        </div>

        <div className="mb-3 flex flex-shrink-0 flex-wrap gap-1.5">
          {KIND_FILTERS.map((filter) => {
            const active = kind === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setKind(filter.id)}
                className="rounded-lg px-2.5 py-1 text-[12px] transition-colors"
                style={{
                  backgroundColor: active ? 'var(--chat-control)' : 'transparent',
                  color: active ? 'var(--chat-text)' : 'var(--chat-muted)',
                }}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-8 pt-1.5 hide-scrollbar">
          {loading ? (
            <p className="px-1 py-8 text-[12.5px] text-[var(--chat-muted)]">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="px-1 py-10 text-center">
              <p className="text-[13px] font-medium text-[var(--chat-text)]">No artifacts yet</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--chat-muted)]">
                Generated documents, code, and images from chats will land here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((artifact) => {
                const isSelected = selectedId === artifact.id;
                const isCopied = copiedId === artifact.id;
                return (
                  <li key={artifact.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSelected(artifact.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleSelected(artifact.id);
                        }
                      }}
                      data-selected={isSelected ? 'true' : 'false'}
                      className="chat-artifact-card group flex w-full flex-col gap-2 rounded-xl border px-3.5 py-3 text-left outline-none"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="chat-artifact-card-icon mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border text-[var(--chat-muted)]">
                          <KindIcon kind={artifact.kind} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-[var(--chat-text)]">
                            {artifact.title}
                          </span>
                          <span className="chat-artifact-card-meta mt-0.5 block truncate text-[11.5px] text-[var(--chat-muted)]">
                            {ARTIFACT_KIND_LABEL[artifact.kind]} · From{' '}
                            {artifact.conversationTitle} · {formatEdited(artifact.updatedAt)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleCopyLink(artifact.id);
                          }}
                          className="chat-artifact-copy-btn flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
                          aria-label={
                            isCopied
                              ? `Copied link for ${artifact.title}`
                              : `Copy link for ${artifact.title}`
                          }
                          title={isCopied ? 'Copied' : 'Copy link'}
                        >
                          {isCopied ? (
                            <Check size={13} aria-hidden="true" />
                          ) : (
                            <Copy size={13} aria-hidden="true" />
                          )}
                          <span>{isCopied ? 'Copied' : 'Copy link'}</span>
                        </button>
                      </div>
                      <pre
                        className="max-h-[4.5rem] overflow-hidden whitespace-pre-wrap break-words rounded-lg px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--chat-muted)]"
                        style={{
                          backgroundColor: 'var(--chat-canvas)',
                          border: '1px solid var(--chat-border)',
                        }}
                      >
                        {artifact.previewText}
                      </pre>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {selected && (
            <div
              className="mt-4 rounded-xl border p-3.5"
              style={{
                backgroundColor: 'var(--chat-elevated)',
                borderColor: 'var(--chat-border)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-[var(--chat-text)]">
                    {selected.title}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--chat-muted)]">
                    Backend-ready id: <span className="font-mono">{selected.id}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(selected.id)}
                  className="flex-shrink-0 rounded-lg px-2.5 py-1 text-[12px] text-[var(--chat-danger)] transition-colors hover:bg-[var(--chat-hover)]"
                >
                  Delete
                </button>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--chat-muted)]">
                Open-in-chat and full preview ship when the artifacts API is live. This panel
                proves selection + delete against the mock module.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatArtifactsPage;
