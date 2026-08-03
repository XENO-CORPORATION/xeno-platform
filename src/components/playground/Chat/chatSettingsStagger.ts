/** Shared enter/exit stagger for Settings section content. */

export const SETTINGS_STAGGER_IN_S = 0.05;
export const SETTINGS_STAGGER_OUT_S = 0.04;
export const SETTINGS_ITEM_IN_S = 0.24;
export const SETTINGS_ITEM_OUT_S = 0.18;
export const SETTINGS_STAGGER_EASE = [0.22, 0.7, 0.2, 1] as const;

export type SettingsStaggerCustom = { index: number; total: number };

/** Parent waits for children so AnimatePresence doesn't cut exit short. */
export const settingsSectionOrchestratorVariants = {
  visible: {
    transition: { when: 'beforeChildren' as const },
  },
  hidden: {
    transition: { when: 'afterChildren' as const },
  },
};

export function buildSettingsStaggerItemVariants(reduceMotion: boolean) {
  if (reduceMotion) {
    return {
      visible: { opacity: 1, y: 0, transition: { duration: 0 } },
      hidden: { opacity: 0, y: 0, transition: { duration: 0 } },
    };
  }
  return {
    visible: ({ index }: SettingsStaggerCustom) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: index * SETTINGS_STAGGER_IN_S,
        duration: SETTINGS_ITEM_IN_S,
        ease: SETTINGS_STAGGER_EASE,
      },
    }),
    hidden: ({ index, total }: SettingsStaggerCustom) => ({
      opacity: 0,
      y: -10,
      transition: {
        delay: Math.max(0, total - 1 - index) * SETTINGS_STAGGER_OUT_S,
        duration: SETTINGS_ITEM_OUT_S,
        ease: SETTINGS_STAGGER_EASE,
      },
    }),
  };
}
