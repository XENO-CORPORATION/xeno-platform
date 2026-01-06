import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SiteGateContextType {
  isUnlocked: boolean;
  unlock: (password: string) => boolean;
  lock: () => void;
}

const SiteGateContext = createContext<SiteGateContextType | undefined>(undefined);

const SITE_PASSWORD = import.meta.env.VITE_SITE_PASSWORD;
const GATE_ENABLED = import.meta.env.VITE_ENABLE_SITE_GATE === 'true';

// Debug logging
console.log('[SiteGate] VITE_ENABLE_SITE_GATE:', import.meta.env.VITE_ENABLE_SITE_GATE);
console.log('[SiteGate] VITE_SITE_PASSWORD:', import.meta.env.VITE_SITE_PASSWORD);
console.log('[SiteGate] GATE_ENABLED:', GATE_ENABLED);
console.log('[SiteGate] SITE_PASSWORD:', SITE_PASSWORD);

export const SiteGateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    // Auto-unlock if gate is disabled or no password is set
    if (!GATE_ENABLED || !SITE_PASSWORD) {
      console.log('[SiteGate] Auto-unlocking because GATE_ENABLED:', GATE_ENABLED, 'SITE_PASSWORD:', !!SITE_PASSWORD);
      return true;
    }

    // Gate is enabled - require password on every visit
    console.log('[SiteGate] Gate is enabled, password required');
    return false;
  });

  const unlock = (password: string): boolean => {
    if (password === SITE_PASSWORD) {
      setIsUnlocked(true);
      return true;
    }
    return false;
  };

  const lock = () => {
    setIsUnlocked(false);
  };

  return (
    <SiteGateContext.Provider value={{ isUnlocked, unlock, lock }}>
      {children}
    </SiteGateContext.Provider>
  );
};

export const useSiteGate = (): SiteGateContextType => {
  const context = useContext(SiteGateContext);
  if (context === undefined) {
    throw new Error('useSiteGate must be used within a SiteGateProvider');
  }
  return context;
};
