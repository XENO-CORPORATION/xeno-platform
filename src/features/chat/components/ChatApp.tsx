import React, { useEffect, useState } from 'react';
import { Menu, PanelLeftOpen, X } from 'lucide-react';
import { useChatStore } from '../store';
import ConversationRail from './ConversationRail';
import MessageThread from './MessageThread';
import Composer from './Composer';

/**
 * ChatApp — the self-contained, full-viewport chat surface.
 *
 * Layout: [ ConversationRail | MessageThread + Composer ]. Responsive — the rail
 * collapses on desktop and becomes an overlay drawer on mobile. No app-shell
 * dependencies, so this component can also be dropped straight into the standalone
 * xeno-chat.com shell.
 */
const ChatApp: React.FC = () => {
  const init = useChatStore((s) => s.init);
  const [railOpen, setRailOpen] = useState(true); // desktop rail visibility
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile drawer

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
    </div>
  );
};

export default ChatApp;
