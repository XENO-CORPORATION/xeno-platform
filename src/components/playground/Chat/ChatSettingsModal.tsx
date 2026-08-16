import React, { useEffect, useState } from 'react';
import { Download, Plus, Settings, X, XDecl } from '@/lib/icons';
import {
  getChatPersonaId,
  listPersonas,
  setChatPersonaId,
  type ChatPersona,
} from './chatCustomize';
import { IconButton, useDialog, useTabs } from '@xenosystem/elements-react';
import ChatSkillsWorkspace from './ChatSkillsWorkspace';

export type ChatFontSize = 'small' | 'medium' | 'large';
export type ChatAlignment = 'left' | 'center' | 'right';

export type ChatSettingsModalProps = {
  onClose: () => void;
  /** null = New chat draft (Customize skills/persona bind when the chat is created). */
  conversationId: string | null;
  /** Apply persona to the live composer (Customize / New chat). */
  onApplyPersona: (persona: ChatPersona | null) => void;
  chatAlignment: ChatAlignment;
  onChatAlignmentChange: (value: ChatAlignment) => void;
  isWideChatEnabled: boolean;
  onWideChatChange: (value: boolean) => void;
  chatFontSize: ChatFontSize;
  onChatFontSizeChange: (value: ChatFontSize) => void;
  isMobile: boolean;
  maxInterfacesReached: boolean;
  isMultiInterface: boolean;
  onCreateNewInterface?: () => void;
  onCloseInterface?: () => void;
  canExport: boolean;
  onExportMarkdown?: () => void;
};

type Section = 'customize' | 'preferences';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'customize', label: 'Customize' },
  { id: 'preferences', label: 'Preferences' },
];

const RADIUS = 'rounded-[6px]';

/**
 * Chat LLM settings: Customize (skills + persona for this conversation) · Preferences.
 * Account Skills / Instructions / Personas library: sidebar → Settings.
 * Enter/exit animation is owned by the parent portal in ChatWithLLM.
 */
const ChatSettingsModal: React.FC<ChatSettingsModalProps> = ({
  onClose,
  conversationId,
  onApplyPersona,
  chatAlignment,
  onChatAlignmentChange,
  isWideChatEnabled,
  onWideChatChange,
  chatFontSize,
  onChatFontSizeChange,
  isMobile,
  maxInterfacesReached,
  isMultiInterface,
  onCreateNewInterface,
  onCloseInterface,
  canExport,
  onExportMarkdown,
}) => {
  const [section, setSection] = useState<Section>('customize');
  const tabs = useTabs<Section>({ ids: SECTIONS.map((s) => s.id), activeId: section, onChange: setSection });
  const [personas, setPersonas] = useState<ChatPersona[]>([]);
  const [chatPersonaId, setChatPersonaIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [personaRows, personaId] = await Promise.all([
        listPersonas(),
        getChatPersonaId(conversationId),
      ]);
      setPersonas(personaRows);
      setChatPersonaIdState(personaId);
      setLoading(false);
    })();
  }, [conversationId]);

  /* Escape was the only part of being a dialog this one did. `useDialog` adds the rest — focus in on
     open, Tab kept inside, focus back to the opener on close. `lockScroll` is off because the app
     already keeps the body unscrollable. */
  const { panelProps } = useDialog<HTMLDivElement>({ open: true, onClose, lockScroll: false });

  const handleSelectChatPersona = async (persona: ChatPersona) => {
    const nextId = chatPersonaId === persona.id ? null : persona.id;
    await setChatPersonaId(conversationId, nextId);
    setChatPersonaIdState(nextId);
    onApplyPersona(nextId ? persona : null);
  };

  const prefBtn = (active: boolean) =>
    `${RADIUS} flex-1 px-3 py-1.5 text-[12.5px] border transition-colors ${
      active
        ? 'border-[var(--chat-muted)] text-[var(--chat-text)]'
        : 'border-[var(--chat-border)] text-[var(--chat-muted)] hover:border-[color-mix(in_srgb,var(--chat-border)_40%,var(--chat-text))] hover:text-[var(--chat-text)]'
    }`;

  return (
    <div
      {...panelProps}
      role="dialog"
      aria-modal="true"
      aria-label="Chat settings"
      className={`flex h-[94vh] max-h-[94vh] w-full flex-col overflow-hidden border sm:h-[min(52rem,92vh)] sm:max-h-[92vh] ${RADIUS}`}
      style={{
        backgroundColor: 'var(--chat-elevated)',
        borderColor:
          'color-mix(in srgb, var(--chat-border) 70%, var(--chat-muted))',
        color: 'var(--chat-text)',
        boxShadow: '0 20px 50px -16px rgba(0, 0, 0, 0.75)',
      }}
      data-chat-settings-card=""
    >
      <style>{`
        .chat-settings-row,
        .chat-skills-row {
          transition: background-color 140ms ease;
        }
        .chat-settings-row:hover,
        .chat-skills-row:hover {
          background-color: var(--chat-surface);
        }
      `}</style>

      <div
        className="flex flex-shrink-0 items-center gap-2.5 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--chat-border)' }}
      >
        <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
          <Settings
            size={16}
            className="flex-shrink-0 text-[var(--chat-muted)]"
            aria-hidden="true"
          />
          <h2 className="text-[14px] font-semibold tracking-tight text-[var(--chat-text)]">
            Settings
          </h2>
        </div>

        <div
          className="ml-1 flex min-w-0 flex-1 items-center gap-0.5"
          {...tabs.tablistProps}
          aria-label="Settings sections"
        >
          {SECTIONS.map(({ id, label }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                {...tabs.tabProps(id)}
                onClick={() => setSection(id)}
                className={`${RADIUS} px-2.5 py-1 text-[12.5px] transition-colors ${
                  active
                    ? 'bg-[var(--chat-control)] font-medium text-[var(--chat-text)]'
                    : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <IconButton
          icon={XDecl}
          variant="ghost"
          size="md"
          iconSize={16}
          onClick={onClose}
          aria-label="Close chat settings"
        />
      </div>

      <div {...tabs.panelProps} className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
        {loading ? (
          <p className="py-8 text-[12.5px] text-[var(--chat-muted)]">
            Loading…
          </p>
        ) : section === 'customize' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="flex-shrink-0">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                  Persona
                </span>
                <p className="text-[12.5px] text-[var(--chat-muted)]">
                  Voice for this chat. Account library lives in sidebar Settings.
                </p>
              </div>
              {personas.length === 0 ? (
                <p className="text-[12.5px] text-[var(--chat-muted)]">
                  No personas yet — create one in sidebar Settings → Personas.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {personas.map((persona) => {
                    const active = chatPersonaId === persona.id;
                    return (
                      <button
                        key={persona.id}
                        type="button"
                        onClick={() => void handleSelectChatPersona(persona)}
                        className={`chat-settings-row ${RADIUS} flex min-h-[4.25rem] min-w-[calc(50%-0.375rem)] flex-1 basis-[calc(33.333%-0.5rem)] flex-col items-start justify-between gap-1 border px-2.5 py-2 text-left transition-colors sm:min-w-[calc(33.333%-0.5rem)]`}
                        style={{
                          borderColor: active
                            ? 'var(--chat-muted)'
                            : 'var(--chat-border)',
                          backgroundColor: active
                            ? 'var(--chat-surface)'
                            : 'transparent',
                        }}
                      >
                        <span className="min-w-0 w-full">
                          <span
                            className={`block truncate text-[13px] ${
                              active
                                ? 'font-medium text-[var(--chat-text)]'
                                : 'text-[var(--chat-text)]'
                            }`}
                          >
                            {persona.label}
                          </span>
                          <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--chat-muted)]">
                            {persona.summary}
                          </span>
                        </span>
                        {active && (
                          <span className="text-[10.5px] font-medium text-[var(--chat-muted)]">
                            On
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden border-t pt-4"
              style={{ borderColor: 'var(--chat-border)' }}
            >
              <div className="mb-2 flex flex-shrink-0 flex-wrap items-baseline gap-x-4 gap-y-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                  Skills
                </span>
                <p className="text-[12.5px] text-[var(--chat-muted)]">
                  This chat only — Create / Add / Import and On/Off. Account
                  library: sidebar Settings → Skills.
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatSkillsWorkspace
                  visibility="chat"
                  conversationId={conversationId}
                  showEnabled
                  fillHeight
                  helpText="Library = skills on this chat. Add pulls from your account library or the catalog."
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 overflow-y-auto">
            <div>
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                Chat width
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onWideChatChange(false)}
                  className={prefBtn(!isWideChatEnabled)}
                >
                  Default
                </button>
                <button
                  type="button"
                  onClick={() => onWideChatChange(true)}
                  className={prefBtn(isWideChatEnabled)}
                >
                  Wide
                </button>
              </div>
            </div>

            <div>
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                Alignment
              </span>
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as ChatAlignment[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onChatAlignmentChange(value)}
                    className={prefBtn(chatAlignment === value)}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                Font size
              </span>
              <div className="flex gap-1.5">
                {(['small', 'medium', 'large'] as ChatFontSize[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onChatFontSizeChange(value)}
                    className={prefBtn(chatFontSize === value)}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {!isMobile && (
              <div>
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                  Interfaces
                </span>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={maxInterfacesReached || !onCreateNewInterface}
                    onClick={() => {
                      if (onCreateNewInterface && !maxInterfacesReached) {
                        onCreateNewInterface();
                        onClose();
                      }
                    }}
                    className={`w-full flex items-center justify-center gap-2 ${prefBtn(false)} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <Plus size={14} aria-hidden="true" />
                    New interface
                  </button>
                  {isMultiInterface && onCloseInterface && (
                    <button
                      type="button"
                      onClick={() => {
                        onCloseInterface();
                        onClose();
                      }}
                      className={`w-full flex items-center justify-center gap-2 ${RADIUS} border px-3 py-1.5 text-[12.5px] text-[var(--chat-muted)] hover:border-[var(--chat-danger)] hover:text-[var(--chat-danger)]`}
                      style={{ borderColor: 'var(--chat-border)' }}
                    >
                      Close this interface
                    </button>
                  )}
                </div>
              </div>
            )}

            {canExport && onExportMarkdown && (
              <div>
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--chat-muted)]">
                  Export
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onExportMarkdown();
                    onClose();
                  }}
                  className={`w-full flex items-center justify-center gap-2 ${prefBtn(false)}`}
                >
                  <Download size={14} aria-hidden="true" />
                  Export markdown
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatSettingsModal;
