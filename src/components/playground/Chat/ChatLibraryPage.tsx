import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, TextInput } from '@xenosystem/elements-react';
import {
  Download,
  File,
  FileImage,
  FileText,
  LayoutGrid,
  Library,
  Plus,
  Rows,
  SearchDecl,
  Trash,
  Upload,
  X,
} from '@/lib/icons';
import {
  chatService,
} from '@/services/chatService';
import {
  libraryItemToAssetRef,
  libraryService,
  type LibraryItemRecord,
  type LibrarySort,
  type LibraryTab,
} from '@/services/libraryService';
import LibraryAssetViewer from '@/components/library/LibraryAssetViewer';
import { createArtifact, type ArtifactKind } from './chatArtifacts';

type LibraryView = 'list' | 'grid';

export type ChatLibraryPageProps = {
  pageLeft?: number;
  onClose?: () => void;
};

const TAB_LABELS: Record<LibraryTab, string> = {
  all: 'All',
  images: 'Images',
  files: 'Files',
};

const SORT_LABELS: Record<LibrarySort, string> = {
  updated: 'Last modified',
  created: 'Newest',
  name: 'Name',
  size: 'Size',
};

const readTabFromUrl = (): LibraryTab => {
  if (typeof window === 'undefined') return 'all';
  const value = new URLSearchParams(window.location.search).get('tab');
  if (value === 'images') return 'images';
  if (value === 'files' || value === 'documents') return 'files';
  return 'all';
};

const setLibraryUrl = (tab: LibraryTab, replace = false) => {
  if (typeof window === 'undefined') return;
  const url = tab === 'all' ? '/library' : `/library?tab=${tab}`;
  window.history[replace ? 'replaceState' : 'pushState']({ view: 'library', tab }, '', url);
};

const formatBytes = (raw: number | string | null | undefined): string => {
  const bytes = Number(raw || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};

const formatModified = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

const itemIcon = (item: LibraryItemRecord) => {
  if (item.category === 'images') return FileImage;
  if (item.item_type === 'document' || item.mime_type?.startsWith('text/')) return FileText;
  return File;
};

const authHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('xenoos_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const LibraryThumbnail: React.FC<{ item: LibraryItemRecord; className?: string }> = ({ item, className = '' }) => {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let cancelled = false;
    const preview = item.preview_url;
    if (!preview) {
      setSrc(null);
      return undefined;
    }
    if (!preview.startsWith('/api/')) {
      setSrc(preview);
      return undefined;
    }
    const separator = preview.includes('?') ? '&' : '?';
    void fetch(`${preview}${separator}variant=thumbnail`, { headers: authHeaders(), signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Preview unavailable');
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setSrc(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.preview_url, visible]);

  return (
    <span ref={containerRef} className={`flex items-center justify-center overflow-hidden bg-[var(--chat-control)] text-[var(--chat-muted)] ${className}`}>
      {src
        ? <img src={src} alt="" className="h-full w-full object-cover" decoding="async" />
        : <FileImage size={22} aria-hidden="true" />}
    </span>
  );
};

const ChatLibraryPage: React.FC<ChatLibraryPageProps> = ({ pageLeft = 0, onClose = () => undefined }) => {
  const [items, setItems] = useState<LibraryItemRecord[]>([]);
  const [tab, setTab] = useState<LibraryTab>(readTabFromUrl);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('updated');
  const [view, setView] = useState<LibraryView>(() => (
    typeof window !== 'undefined' && localStorage.getItem('xeno_library_view') === 'grid' ? 'grid' : 'list'
  ));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<LibraryItemRecord | null>(null);
  const [selectedBody, setSelectedBody] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    if (!chatService.isAuthenticated()) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const next = await libraryService.list({ tab, query, sort, limit: 200 });
      setItems(next);
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : 'Library unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [tab, query, sort]);

  useEffect(() => {
    const onPopState = () => setTab(readTabFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('xeno_library_view', view);
  }, [view]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!newMenuRef.current?.contains(event.target as Node)) setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newMenuOpen]);

  const counts = useMemo(() => ({
    images: items.filter((item) => item.category === 'images').length,
    files: items.filter((item) => item.category === 'files').length,
  }), [items]);

  const chooseTab = (next: LibraryTab) => {
    setTab(next);
    setLibraryUrl(next);
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        await libraryService.upload(file, 'library');
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createDocument = async () => {
    if (!draftTitle.trim() || !draftContent.trim() || creating) return;
    setCreating(true);
    try {
      await createArtifact({ title: draftTitle, content: draftContent, kind: 'document' as ArtifactKind });
      setDraftTitle('');
      setDraftContent('');
      setNewDocumentOpen(false);
      chooseTab('files');
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const openItem = async (item: LibraryItemRecord) => {
    setSelected(item);
    setSelectedBody(item.description || '');
    if (item.source === 'artifact') {
      const artifact = await chatService.getArtifact(item.source_id);
      if (artifact?.content) setSelectedBody(artifact.content);
    }
  };

  const downloadItem = async (item: LibraryItemRecord) => {
    const url = item.source === 'file'
      ? await libraryService.createSignedLink(item.source_id, { download: true })
      : item.preview_url;
    if (!url) return;
    try {
      const response = await fetch(url, { headers: url.startsWith('/api/') ? authHeaders() : {} });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Download failed');
    }
  };

  const deleteItem = async (item: LibraryItemRecord) => {
    const removed = await libraryService.delete(item.source, item.source_id);
    if (!removed) {
      setError('Could not delete this item.');
      return;
    }
    setSelected(null);
    await refresh();
  };

  return (
    <div
      className="absolute inset-0 z-[45] flex flex-col main-content-transition"
      style={{ left: pageLeft, backgroundColor: 'var(--chat-canvas)', color: 'var(--chat-text)' }}
      role="dialog"
      aria-label="Library"
      aria-modal="true"
    >
      <style>{`
        .chat-library-row { transition: background-color 160ms ease, transform 160ms ease; }
        .chat-library-row:hover, .chat-library-row:focus-visible { background: var(--chat-hover); }
        .chat-library-card { transition: transform 200ms cubic-bezier(.22,1,.36,1), border-color 160ms ease, background-color 160ms ease; }
        .chat-library-card:hover, .chat-library-card:focus-visible { transform: translateY(-3px); border-color: color-mix(in srgb, var(--chat-border) 35%, var(--chat-text)); background: var(--chat-elevated); }
        .chat-library-tab { position: relative; }
        .chat-library-tab::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -8px; height: 2px; border-radius: 999px; background: var(--chat-text); transform: scaleX(0); opacity: 0; transition: transform 180ms cubic-bezier(.22,1,.36,1), opacity 180ms ease; }
        .chat-library-tab[data-active='true']::after { transform: scaleX(1); opacity: 1; }
      `}</style>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void uploadFiles(event.target.files)}
        aria-label="Upload files to Library"
      />

      <div className="mx-auto flex h-full w-full max-w-[58rem] flex-col px-4 sm:px-6 lg:px-8">
        <header className="flex flex-shrink-0 items-center justify-between gap-4 pb-5 pt-7 md:pt-9">
          <div className="flex min-w-0 items-center gap-2.5">
            <Library size={20} className="text-[var(--chat-muted)]" aria-hidden="true" />
            <h1 className="font-display text-[1.55rem] font-semibold tracking-tight md:text-[1.8rem]">Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={newMenuRef}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setNewMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
              >
                <Plus size={14} aria-hidden="true" />
                {uploading ? 'Uploading…' : 'New'}
              </Button>
              {newMenuOpen && (
                <div
                  role="menu"
                  className="chat-history-popover absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-xl border p-1.5 shadow-2xl"
                  style={{ backgroundColor: 'var(--chat-elevated)', borderColor: 'var(--chat-border)' }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-[var(--chat-hover)]"
                    onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click(); }}
                  >
                    <Upload size={14} /> Upload files
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-[var(--chat-hover)]"
                    onClick={() => { setNewMenuOpen(false); setNewDocumentOpen(true); }}
                  >
                    <FileText size={14} /> New document
                  </button>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </header>

        <div className="flex flex-shrink-0 flex-col gap-4 border-b pb-3" style={{ borderColor: 'var(--chat-border)' }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1">
              {(Object.keys(TAB_LABELS) as LibraryTab[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-active={tab === value ? 'true' : 'false'}
                  className="chat-library-tab rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[var(--chat-muted)] transition-colors hover:text-[var(--chat-text)] data-[active=true]:text-[var(--chat-text)]"
                  onClick={() => chooseTab(value)}
                  aria-pressed={tab === value}
                >
                  {TAB_LABELS[value]}
                </button>
              ))}
            </div>
            <TextInput
              leadingIcon={SearchDecl}
              type="search"
              size="md"
              className="w-full sm:w-[17rem]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your library"
              aria-label="Search Library"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-[var(--chat-muted)]">
              {loading ? 'Loading…' : `${items.length} ${items.length === 1 ? 'item' : 'items'}${tab === 'all' ? ` · ${counts.images} images · ${counts.files} files` : ''}`}
            </p>
            <div className="flex items-center gap-1.5">
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as LibrarySort)}
                className="h-8 rounded-lg border bg-[var(--chat-surface)] px-2.5 text-[11.5px] text-[var(--chat-text)] outline-none"
                style={{ borderColor: 'var(--chat-border)' }}
                aria-label="Sort Library"
              >
                {(Object.keys(SORT_LABELS) as LibrarySort[]).map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
              </select>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
                style={{ borderColor: 'var(--chat-border)', background: view === 'list' ? 'var(--chat-control)' : undefined }}
                onClick={() => setView('list')}
                aria-label="List view"
                aria-pressed={view === 'list'}
              ><Rows size={14} /></button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
                style={{ borderColor: 'var(--chat-border)', background: view === 'grid' ? 'var(--chat-control)' : undefined }}
                onClick={() => setView('grid')}
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
              ><LayoutGrid size={14} /></button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: 'color-mix(in srgb, #ef4444 45%, var(--chat-border))', color: '#f87171' }}>
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={13} /></button>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto pb-10 pt-4 hide-scrollbar">
          {!loading && items.length === 0 ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border bg-[var(--chat-surface)] text-[var(--chat-muted)]" style={{ borderColor: 'var(--chat-border)' }}>
                {tab === 'images' ? <FileImage size={20} /> : tab === 'files' ? <FileText size={20} /> : <Library size={20} />}
              </span>
              <p className="text-[14px] font-medium">{query ? 'Nothing matches your search' : `No ${tab === 'all' ? 'library items' : tab} yet`}</p>
              <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-[var(--chat-muted)]">
                {query ? 'Try a different name or clear the search.' : 'Uploads, generated images, and chat artifacts are saved to your account here.'}
              </p>
              {!query && <Button variant="secondary" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()}>Upload files</Button>}
            </div>
          ) : view === 'list' ? (
            <div className="min-w-[34rem]">
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-3 px-3 pb-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--chat-muted)]">
                <span>Name</span><span>Modified</span><span>Size</span><span />
              </div>
              <ul>
                {items.map((item) => {
                  const Icon = itemIcon(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="chat-library-row grid w-full grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none"
                        onClick={() => void openItem(item)}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border text-[var(--chat-muted)]" style={{ borderColor: 'var(--chat-border)', background: 'var(--chat-surface)' }}><Icon size={15} /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.75px] font-medium">{item.name}</span>
                            <span className="mt-0.5 block truncate text-[10.5px] text-[var(--chat-muted)]">{item.conversation_title ? `From ${item.conversation_title}` : item.mime_type || item.item_type}</span>
                          </span>
                        </span>
                        <span className="text-[11.5px] text-[var(--chat-muted)]">{formatModified(item.updated_at)}</span>
                        <span className="text-[11.5px] text-[var(--chat-muted)]">{formatBytes(item.size_bytes)}</span>
                        <span className="text-right text-[var(--chat-muted)]">›</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => {
                const Icon = itemIcon(item);
                return (
                  <li key={item.id}>
                    <button type="button" className="chat-library-card flex w-full flex-col overflow-hidden rounded-2xl border text-left outline-none" style={{ borderColor: 'var(--chat-border)', background: 'var(--chat-surface)' }} onClick={() => void openItem(item)}>
                      {item.category === 'images' ? <LibraryThumbnail item={item} className="aspect-square w-full" /> : <span className="flex aspect-square w-full items-center justify-center bg-[var(--chat-control)] text-[var(--chat-muted)]"><Icon size={30} /></span>}
                      <span className="min-w-0 px-3 py-2.5">
                        <span className="block truncate text-[12px] font-medium">{item.name}</span>
                        <span className="mt-1 block text-[10.5px] text-[var(--chat-muted)]">{formatModified(item.updated_at)} · {formatBytes(item.size_bytes)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </div>

      {newDocumentOpen && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="New document">
          <div className="w-full max-w-lg rounded-2xl border p-4 shadow-2xl" style={{ background: 'var(--chat-elevated)', borderColor: 'var(--chat-border)' }}>
            <div className="flex items-center justify-between"><h2 className="text-[15px] font-medium">New document</h2><button type="button" onClick={() => setNewDocumentOpen(false)} aria-label="Close"><X size={15} /></button></div>
            <TextInput className="mt-4 w-full" size="lg" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Document name" aria-label="Document name" />
            <textarea className="mt-3 min-h-44 w-full resize-y rounded-xl border bg-[var(--chat-surface)] p-3 text-[12.5px] leading-relaxed outline-none" style={{ borderColor: 'var(--chat-border)' }} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} placeholder="Start writing…" aria-label="Document content" />
            <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setNewDocumentOpen(false)}>Cancel</Button><Button variant="primary" size="sm" disabled={!draftTitle.trim() || !draftContent.trim() || creating} onClick={() => void createDocument()}>{creating ? 'Creating…' : 'Create'}</Button></div>
          </div>
        </div>
      )}

      {selected?.category === 'images' && createPortal(
        <LibraryAssetViewer
          items={items.filter((item) => item.category === 'images').map((item) => ({
            id: item.id,
            name: item.name,
            asset: libraryItemToAssetRef(item),
            sourceUrl: item.preview_url || undefined,
            context: item.conversation_title || 'Account',
          }))}
          activeId={selected.id}
          onClose={() => setSelected(null)}
        />,
        document.body,
      )}

      {selected && selected.category !== 'images' && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${selected.name} preview`} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl" style={{ background: 'var(--chat-elevated)', borderColor: 'var(--chat-border)' }}>
            <div className="flex items-start justify-between gap-4 border-b px-4 py-3" style={{ borderColor: 'var(--chat-border)' }}>
              <div className="min-w-0"><h2 className="truncate text-[14px] font-medium">{selected.name}</h2><p className="mt-1 text-[10.5px] text-[var(--chat-muted)]">{formatModified(selected.updated_at)} · {formatBytes(selected.size_bytes)}</p></div>
              <button type="button" className="text-[var(--chat-muted)] hover:text-[var(--chat-text)]" onClick={() => setSelected(null)} aria-label="Close preview"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-words rounded-xl border bg-[var(--chat-surface)] p-4 font-mono text-[11.5px] leading-relaxed" style={{ borderColor: 'var(--chat-border)' }}>{selectedBody || 'Preview is not available for this file type.'}</pre>
            </div>
            <div className="flex items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--chat-border)' }}>
              <Button variant="danger" size="sm" onClick={() => void deleteItem(selected)}><Trash size={13} /> Delete</Button>
              <div className="flex items-center gap-2">
                {selected.conversation_id && <Button variant="secondary" size="sm" onClick={() => { window.location.href = `/c/${selected.conversation_id}`; }}>Open chat</Button>}
                {(selected.preview_url || selected.source === 'file') && <Button variant="primary" size="sm" onClick={() => void downloadItem(selected)}><Download size={13} /> Download</Button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatLibraryPage;
