import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, PanelLeftOpen, X } from 'lucide-react';
import { useChatStore } from '../store';
import { deriveArtifacts } from '../artifacts/parse';
import ConversationRail from './ConversationRail';
import MessageThread from './MessageThread';
import Composer from './Composer';
import ArtifactPanel from './ArtifactPanel';
import type { UIMessage } from '../types';

const MIN_PANEL = 360;
const DEFAULT_PANEL = 540;
// Stable empty reference — returning a fresh [] from a Zustand v5 selector trips
// useSyncExternalStore's "getSnapshot should be cached" infinite-render guard.
const EMPTY: UIMessage[] = [];

/**
 * ChatApp — the self-contained, full-viewport chat surface.
 *
 * Layout: [ ConversationRail | (MessageThread + Composer) | ArtifactPanel ]. The
 * artifact panel opens on the right when an artifact card is clicked (or auto-opens on
 * the first artifact of a conversation); the thread column narrows to make room and the
 * panel is resizable via the drag handle on its left edge. On mobile it becomes a
 * full-screen overlay. No app-shell dependencies, so this drops into xeno-chat.com too.
 */
const ChatApp: React.FC = () => {
  const init = useChatStore((s) => s.init);
  const activeId = useChatStore((s) => s.activeId);
  const messages =
    useChatStore((s) => (s.activeId ? s.messagesByConv[s.activeId] : undefined)) ?? EMPTY;
  const panelOpen = useChatStore((s) => s.artifactPanelOpen);
  const openArtifact = useChatStore((s) => s.openArtifact);
  const closeArtifactPanel = useChatStore((s) => s.closeArtifactPanel);

  const [railOpen, setRailOpen] = useState(true); // desktop rail visibility
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile drawer
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL);
  const dragging = useRef(false);
  // Teardown for an in-flight resize drag (remove window listeners + reset body styles).
  // Held in a ref so an unmount / panel-close mid-drag can run it — otherwise the drag's
  // window listeners leak and the body stays stuck at userSelect:none / col-resize.
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  // Stop any in-flight stream when the chat surface unmounts (e.g. navigating away
  // mid-generation), so we don't leave the SSE request open and the server metering.
  useEffect(
    () => () => {
      const s = useChatStore.getState();
      if (s.isStreaming) s.stopStreaming();
    },
    [],
  );

  // Auto-open the panel the first time a conversation produces an artifact (once per
  // conversation — a manual close is respected and won't be reopened).
  const artifacts = useMemo(() => deriveArtifacts(messages), [messages]);
  const autoOpened = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeId || artifacts.length === 0) return;
    if (autoOpened.current.has(activeId)) return;
    autoOpened.current.add(activeId);
    openArtifact(artifacts[artifacts.length - 1].id);
  }, [activeId, artifacts, openArtifact]);

  // Resizable panel (drag the handle on its left edge).
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // If a previous drag somehow didn't tear down, do it now before starting a new one.
    dragCleanup.current?.();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const max = Math.min(window.innerWidth * 0.72, 1100);
      const next = window.innerWidth - ev.clientX;
      setPanelWidth(Math.max(MIN_PANEL, Math.min(next, max)));
    };
    const cleanup = () => {
      dragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragCleanup.current = null;
    };
    const onUp = () => cleanup();
    dragCleanup.current = cleanup;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Unmount safety net: if the chat surface unmounts (or the panel closes) mid-drag, the
  // mouseup that would normally clean up never fires. Run the pending teardown so the
  // window listeners don't leak and the <body> doesn't stay stuck in the drag styles.
  useEffect(() => () => dragCleanup.current?.(), []);

  const showPanel = panelOpen;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#060606] text-white antialiased">
      {/* Desktop rail */}
      {railOpen && (
        <aside className="hidden w-[272px] shrink-0 border-r border-white/8 lg:block">
          <ConversationRail onCollapse={() => setRailOpen(false)} />
        </aside>
      )}

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[280px] max-w-[82vw] border-r border-white/8 shadow-2xl">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-48px)]">
              <ConversationRail onNavigate={() => setDrawerOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-white/8 px-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 lg:hidden"
            title="Open conversations"
          >
            <Menu size={18} />
          </button>
          {!railOpen && (
            <button
              onClick={() => setRailOpen(true)}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 lg:flex"
              title="Open sidebar"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          <span className="text-[14px] font-semibold tracking-tight text-white/85">XENO Chat</span>
        </header>

        <MessageThread />
        <Composer />
      </div>

      {/* Desktop artifact panel — resizable, closeable */}
      {showPanel && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onDragStart}
            className="hidden w-1 shrink-0 cursor-col-resize bg-white/8 transition-colors hover:bg-[#ece7df]/50 lg:block"
          />
          <aside
            className="hidden shrink-0 border-l border-white/8 lg:block"
            style={{ width: panelWidth }}
          >
            <ArtifactPanel onClose={closeArtifactPanel} />
          </aside>

          {/* Mobile: full-screen overlay */}
          <div className="fixed inset-0 z-50 lg:hidden">
            <ArtifactPanel onClose={closeArtifactPanel} />
          </div>
        </>
      )}
    </div>
  );
};

export default ChatApp;
