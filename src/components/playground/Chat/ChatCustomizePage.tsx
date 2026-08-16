import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button, IconButton, TextInput, useDialog } from '@xenosystem/elements-react';
import { Briefcase, ChevronRight, Search, XDecl, SearchDecl, ChevronRightDecl } from '@/lib/icons';
import {
  listSkills,
  setSkillEnabled,
  type ChatSkill,
} from './chatCustomize';
import {
  MAX_ADD_LEAF_SKILLS,
  resolveSkillCategory,
  SKILL_CATEGORY_LABEL,
  SKILL_CATEGORY_ORDER,
  type SkillCategoryId,
} from './chatSkillsLibrary';
import {
  buildSettingsStaggerItemVariants,
  SETTINGS_ITEM_IN_S,
  SETTINGS_ITEM_OUT_S,
  SETTINGS_STAGGER_EASE,
  SETTINGS_STAGGER_IN_S,
  SETTINGS_STAGGER_OUT_S,
  settingsSectionOrchestratorVariants,
} from './chatSettingsStagger';

export type ChatCustomizePageProps = {
  onClose: () => void;
  /**
   * Skills On/Off scope: real conversation id, or null for the New chat draft.
   */
  conversationId: string | null;
  /** Enter/exit card motion (grows from Customize / ⋯, top-right). */
  isOpen?: boolean;
  isShown?: boolean;
  /**
   * Pixel offset from viewport center → trigger button center.
   * Card translates from here on open and returns on close.
   */
  motionFrom?: { x: number; y: number };
};

const CUSTOMIZE_MODAL_MS = 420;
const CUSTOMIZE_MODAL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Uses CSS vars set on the card: --customize-from-x / --customize-from-y (px). */
const CUSTOMIZE_MODAL_KEYFRAMES = `
  @keyframes chat-customize-modal-in {
    from {
      opacity: 0;
      transform: translate(var(--customize-from-x, 40%), var(--customize-from-y, -20%)) scale(0.2);
    }
    to {
      opacity: 1;
      transform: translate(0, 0) scale(1);
    }
  }
  @keyframes chat-customize-modal-out {
    from {
      opacity: 1;
      transform: translate(0, 0) scale(1);
    }
    to {
      opacity: 0;
      transform: translate(var(--customize-from-x, 40%), var(--customize-from-y, -20%)) scale(0.2);
    }
  }
`;

const RADIUS = 'rounded-[6px]';


const formatUpdated = (ts: number): string => {
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  const days = Math.floor(diff / day);
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Per-chat Customize dialog (⋯ / briefcase): Skills On/Off only.
 * Browse by category (same drill-down idea as Settings → Skills → Add).
 * Account library: sidebar → Settings → Skills.
 */
const ChatCustomizePage: React.FC<ChatCustomizePageProps> = ({
  onClose,
  conversationId,
  isOpen = true,
  isShown = true,
  motionFrom = { x: 0, y: 0 },
}) => {
  /* Focus in, Tab kept inside, focus back to the opener — but NOT Escape. This page owns a layered
     Escape of its own: inside a category it goes back to the category list, and only closes from the
     top level. Handing Escape to the hook would collapse both steps into one and drop someone out of
     the page when they meant to leave a category. */
  const { panelProps } = useDialog<HTMLDivElement>({ open: isOpen, lockScroll: false });
  const [skills, setSkills] = useState<ChatSkill[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<SkillCategoryId | null>(
    null,
  );
  /** Bumps when returning to the category grid so stagger re-runs. */
  const [categoriesEpoch, setCategoriesEpoch] = useState(0);
  const reduceMotion = useReducedMotion() ?? false;
  const staggerItemVariants = buildSettingsStaggerItemVariants(reduceMotion);
  const fromTransform = `translate(${motionFrom.x}px, ${motionFrom.y}px) scale(0.2)`;

  const showCategories = useCallback(() => {
    setActiveCategory(null);
    setCategoriesEpoch((n) => n + 1);
  }, []);

  // Parent drives the cascade; cards only fade/slide (Motion staggerChildren).
  const categoryGridVariants = reduceMotion
    ? {
        hidden: {},
        visible: {},
      }
    : {
        hidden: {
          transition: {
            when: 'afterChildren' as const,
            staggerChildren: SETTINGS_STAGGER_OUT_S,
            staggerDirection: -1 as const,
          },
        },
        visible: {
          transition: {
            when: 'beforeChildren' as const,
            staggerChildren: SETTINGS_STAGGER_IN_S,
          },
        },
      };

  const categoryCardVariants = reduceMotion
    ? {
        hidden: { opacity: 1, y: 0 },
        visible: { opacity: 1, y: 0 },
      }
    : {
        hidden: {
          opacity: 0,
          y: -10,
          transition: {
            duration: SETTINGS_ITEM_OUT_S,
            ease: SETTINGS_STAGGER_EASE,
          },
        },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: SETTINGS_ITEM_IN_S,
            ease: SETTINGS_STAGGER_EASE,
          },
        },
      };

  const refresh = async (search = query) => {
    const rows = await listSkills({ query: search, conversationId });
    setSkills(rows);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refresh('');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    void refresh(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeCategory) {
        showCategories();
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, activeCategory, showCategories]);

  const categories = useMemo(() => {
    const counts = new Map<SkillCategoryId, number>();
    for (const skill of skills) {
      const id = resolveSkillCategory(skill.id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return SKILL_CATEGORY_ORDER.filter((id) => (counts.get(id) ?? 0) > 0).map(
      (id) => ({
        id,
        label: SKILL_CATEGORY_LABEL[id],
        count: counts.get(id) ?? 0,
      }),
    );
  }, [skills]);

  const leafSkills = useMemo(() => {
    if (!activeCategory) return [];
    return skills
      .filter((skill) => resolveSkillCategory(skill.id) === activeCategory)
      .slice(0, MAX_ADD_LEAF_SKILLS);
  }, [skills, activeCategory]);

  /** Search jumps straight to matching rows (skip category step). */
  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    return skills.slice(0, MAX_ADD_LEAF_SKILLS);
  }, [skills, query]);

  const toggleSkill = async (skill: ChatSkill) => {
    await setSkillEnabled(skill.id, !skill.enabled, conversationId);
    await refresh(query);
  };

  /**
   * Skill table rows — stagger children of the parent orchestrator
   * (same pattern as Settings section content).
   */
  const renderSkillRows = (
    rows: ChatSkill[],
    staggerTotal: number,
    staggerStartIndex = 0,
  ) => {
    return (
      <div
        className={`flex flex-col overflow-hidden border ${RADIUS}`}
        style={{ borderColor: 'var(--chat-border)' }}
      >
        <motion.div
          custom={{ index: staggerStartIndex, total: staggerTotal }}
          variants={staggerItemVariants}
          className="flex border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]"
          style={{
            borderColor: 'var(--chat-border)',
            backgroundColor: 'var(--chat-surface)',
          }}
        >
          <span className="min-w-0 flex-1">Skill</span>
          <span className="hidden w-[5.5rem] flex-shrink-0 sm:block">
            Author
          </span>
          <span className="w-[4.5rem] flex-shrink-0">Updated</span>
          <span className="w-[4.5rem] flex-shrink-0 text-right">
            {conversationId ? 'This chat' : 'New chat'}
          </span>
        </motion.div>
        {rows.map((skill, index) => (
          <motion.div
            key={skill.id}
            custom={{
              index: staggerStartIndex + 1 + index,
              total: staggerTotal,
            }}
            variants={staggerItemVariants}
            className="chat-customize-row flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
            style={{ borderColor: 'var(--chat-border)' }}
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-[var(--chat-text)]">
                {skill.name}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--chat-muted)]">
                {skill.summary}
              </span>
            </div>
            <span className="hidden w-[5.5rem] flex-shrink-0 truncate text-[12.5px] text-[var(--chat-muted)] sm:block">
              {skill.author}
            </span>
            <span className="w-[4.5rem] flex-shrink-0 text-[12.5px] text-[var(--chat-muted)]">
              {formatUpdated(skill.updatedAt)}
            </span>
            <div className="w-[4.5rem] flex-shrink-0 text-right">
              {/* Stays hand-written: a switch by ROLE, a button by shape. `<Switch>` is a 36 × 20
                  track with a knob that slides; this is a 52px pill that spells the state out in
                  words, and the word is what makes a row of skills readable at a glance. Taking the
                  component would not be adopting it — it would be redrawing the control. One of the
                  three such pills in the chat; the one real switch converted, in
                  ChatGlobalSettingsPage, at exactly its own size. */}
              <button
                type="button"
                role="switch"
                aria-checked={skill.enabled}
                onClick={() => {
                  void toggleSkill(skill);
                }}
                className={`${RADIUS} min-w-[3.25rem] px-2 py-1 text-[11.5px] font-medium`}
                style={{
                  backgroundColor: skill.enabled
                    ? 'var(--chat-control)'
                    : 'transparent',
                  color: skill.enabled
                    ? 'var(--chat-text)'
                    : 'var(--chat-muted)',
                  border: '1px solid var(--chat-border)',
                }}
              >
                {skill.enabled ? 'On' : 'Off'}
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={onClose}
      data-chat-customize-dialog=""
      style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
    >
      <style>{CUSTOMIZE_MODAL_KEYFRAMES}</style>
      {/* Backdrop on its own layer so card exit isn’t killed by parent opacity. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-chat-customize-backdrop=""
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--chat-canvas) 40%, rgba(0, 0, 0, 0.45))',
          opacity: isShown ? 1 : 0,
          transition: `opacity ${CUSTOMIZE_MODAL_MS}ms ${CUSTOMIZE_MODAL_EASE}`,
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
        }}
      />
      <div
        {...panelProps}
        role="dialog"
        aria-modal="true"
        aria-label="Customize"
        onClick={(event) => event.stopPropagation()}
        className="relative flex h-[min(40rem,94vh)] w-full max-w-[40rem] flex-col overflow-hidden rounded-2xl border will-change-[transform,opacity] sm:h-[min(38rem,90vh)]"
        style={{
          backgroundColor: 'var(--chat-elevated)',
          borderColor:
            'color-mix(in srgb, var(--chat-border) 70%, var(--chat-muted))',
          color: 'var(--chat-text)',
          boxShadow: '0 20px 50px -16px rgba(0, 0, 0, 0.75)',
          transformOrigin: 'center center',
          // Keep text clipped to the card while it scales — stops “ghost” glyphs on exit.
          ['--customize-from-x' as string]: `${motionFrom.x}px`,
          ['--customize-from-y' as string]: `${motionFrom.y}px`,
          ...(isShown
            ? {
                animation: `chat-customize-modal-in ${CUSTOMIZE_MODAL_MS}ms ${CUSTOMIZE_MODAL_EASE} forwards`,
              }
            : !isOpen
              ? {
                  animation: `chat-customize-modal-out ${CUSTOMIZE_MODAL_MS}ms ${CUSTOMIZE_MODAL_EASE} forwards`,
                }
              : {
                  opacity: 0,
                  transform: fromTransform,
                }),
        }}
      >
        <style>{`
          .chat-theme-light [data-chat-customize-backdrop],
          [data-chat-theme-preference='light'] [data-chat-customize-backdrop] {
            background-color: color-mix(in srgb, var(--chat-canvas) 55%, rgba(15, 15, 18, 0.28)) !important;
          }
          .chat-customize-row {
            transition: background-color 140ms ease;
          }
          .chat-customize-row:hover {
            background-color: var(--chat-surface);
          }
        `}</style>

        <div className="flex flex-shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Briefcase
              size={18}
              className="flex-shrink-0 text-[var(--chat-muted)]"
              aria-hidden="true"
            />
            <h2 className="flex-shrink-0 text-[16px] font-semibold tracking-tight text-[var(--chat-text)]">
              Customize
            </h2>
            <span
              className="ml-1 h-4 w-px flex-shrink-0"
              style={{ backgroundColor: 'var(--chat-border)' }}
              aria-hidden="true"
            />
            <div className="relative ml-1 flex-shrink-0">
              {/* Stays hand-written, and the reason is the BOX, not the mark.
                  The mark is already in the library: `info` is a rounded square holding a dot and a
                  stem, which is what a 6px-radius border around a 10px "i" draws. So this is not an
                  unusual control — it is `<IconButton icon={InfoDecl}>` with one thing in the way.
                  The box is 18 × 18 and the control scale starts at xs = 24. Six pixels in a header
                  row that already sets its rhythm off an 18px Briefcase, so growing it is a visible
                  change to this header, not a swap. `iconSize` reaches the glyph and deliberately not
                  the box: the library's position is that height is a surface-level variable, so an
                  18px control is a size token this app has not declared rather than an override to
                  write at one call site. Convert when it has one. */}
              <button
                type="button"
                className={`${RADIUS} peer flex h-[18px] w-[18px] items-center justify-center border border-[var(--chat-border)] bg-transparent text-[10px] font-semibold leading-none text-[var(--chat-muted)] transition-colors hover:border-[var(--chat-muted)] hover:text-[var(--chat-text)] focus-visible:border-[var(--chat-muted)] focus-visible:text-[var(--chat-text)] focus-visible:outline-none`}
                aria-label="About Customize"
                aria-describedby="chat-customize-help"
              >
                <span aria-hidden="true">i</span>
              </button>
              <div
                id="chat-customize-help"
                role="tooltip"
                className={`pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-[min(18rem,calc(100vw-2rem))] border px-2.5 py-2 text-[12px] leading-relaxed opacity-0 shadow-lg transition-opacity duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100 ${RADIUS}`}
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  color: 'var(--chat-text)',
                }}
              >
                {conversationId
                  ? 'On/Off for this chat only. Account library: sidebar Settings → Skills. Add to this chat: Chat settings → Customize.'
                  : 'On/Off for the draft chat. Account library: sidebar Settings → Skills. Add here: Chat settings → Customize.'}
              </div>
            </div>
          </div>
          <IconButton
            icon={XDecl}
            variant="ghost"
            size="md"
            iconSize={16}
            onClick={onClose}
            aria-label="Close customize"
          />
        </div>

        <div className="flex-shrink-0 px-5 pb-3">
          <TextInput
            leadingIcon={SearchDecl}
            size="lg"
            type="search"
            className="w-full"
            aria-label="Search skills"
            value={query}
            onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value.trim()) setActiveCategory(null);
              }}
            placeholder="Search"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-5 pb-6">
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.p
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-10 text-center text-[13px] text-[var(--chat-muted)]"
              >
                Loading…
              </motion.p>
            ) : skills.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full min-h-[14rem] flex-col items-center justify-center px-4 text-center"
              >
                <div
                  className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: 'var(--chat-surface)' }}
                  aria-hidden="true"
                >
                  {/* The weight comes from the declaration. 1.5 was here to make a 22px glyph read
                      lighter in an empty state, which is a job for colour — and it already has the
                      muted token doing exactly that. */}
                  <Briefcase
                    size={22}
                    className="text-[var(--chat-muted)]"
                  />
                </div>
                <p className="max-w-[20rem] text-[13px] leading-relaxed text-[var(--chat-muted)]">
                  No skills on this chat yet.
                  <br />
                  Open Chat settings → Customize to Add,
                  <br />
                  or build the account library in sidebar Settings → Skills.
                </p>
              </motion.div>
            ) : searchResults ? (
              (() => {
                const searchStaggerTotal =
                  1 +
                  (searchResults.length > 0 ? searchResults.length + 1 : 0);
                return (
                  <motion.div
                    key={`search-${query}`}
                    className="flex h-full min-h-0 flex-col gap-2"
                    variants={settingsSectionOrchestratorVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                  >
                    <motion.p
                      custom={{ index: 0, total: searchStaggerTotal }}
                      variants={staggerItemVariants}
                      className="flex-shrink-0 text-[11px] text-[var(--chat-muted)]"
                    >
                      {searchResults.length === 0
                        ? 'No matches'
                        : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'}`}
                    </motion.p>
                    {searchResults.length > 0 && (
                      <div className="min-h-0 flex-1 overflow-hidden">
                        {renderSkillRows(
                          searchResults,
                          searchStaggerTotal,
                          1,
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })()
            ) : activeCategory == null ? (
              <motion.div
                key={`categories-${categoriesEpoch}`}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                variants={categoryGridVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                {categories.map((category) => (
                  <motion.button
                    key={category.id}
                    type="button"
                    variants={categoryCardVariants}
                    onClick={() => setActiveCategory(category.id)}
                    className={`chat-customize-row flex items-center gap-3 border px-3 py-3 text-left ${RADIUS}`}
                    style={{
                      borderColor: 'var(--chat-border)',
                      backgroundColor: 'var(--chat-surface)',
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-[var(--chat-text)]">
                        {category.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--chat-muted)]">
                        {category.count} skill
                        {category.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span className="flex-shrink-0 text-[11px] text-[var(--chat-muted)]">
                      {category.count}
                    </span>
                    <ChevronRight
                      size={16}
                      aria-hidden="true"
                      className="flex-shrink-0 text-[var(--chat-muted)]"
                    />
                  </motion.button>
                ))}
              </motion.div>
            ) : (
              (() => {
                const leafStaggerTotal =
                  1 +
                  (leafSkills.length === 0 ? 1 : leafSkills.length + 1);
                return (
                  <motion.div
                    key={`leaf-${activeCategory}`}
                    className="flex h-full min-h-0 flex-col gap-2"
                    variants={settingsSectionOrchestratorVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                  >
                    <motion.div
                      custom={{ index: 0, total: leafStaggerTotal }}
                      variants={staggerItemVariants}
                      className="flex flex-shrink-0 items-center gap-2"
                    >
                      <Button
                        variant="ghost"
                        size="md"
                        leadingIcon={ChevronRightDecl}
                        className="chat-icon-flip-x"
                        onClick={showCategories}
                      >
                        Categories
                      </Button>
                      <span className="text-[12.5px] text-[var(--chat-muted)]">
                        {SKILL_CATEGORY_LABEL[activeCategory]}
                        {leafSkills.length > 0
                          ? ` · ${leafSkills.length}`
                          : ''}
                      </span>
                    </motion.div>
                    {leafSkills.length === 0 ? (
                      <motion.p
                        custom={{ index: 1, total: leafStaggerTotal }}
                        variants={staggerItemVariants}
                        className="py-8 text-center text-[12.5px] text-[var(--chat-muted)]"
                      >
                        No skills in this category.
                      </motion.p>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-hidden">
                        {renderSkillRows(
                          leafSkills,
                          leafStaggerTotal,
                          1,
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })()
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default ChatCustomizePage;
