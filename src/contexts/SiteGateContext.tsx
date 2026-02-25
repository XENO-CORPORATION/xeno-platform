import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SiteGateContextType {
  isUnlocked: boolean;
  unlock: (password: string) => boolean;
  lock: () => void;
}

const SiteGateContext = createContext<SiteGateContextType | undefined>(undefined);

const SITE_PASSWORD = import.meta.env.VITE_SITE_PASSWORD;

const GATE_ALLOWED_HOSTNAMES = new Set(['xenostudio.ai', 'www.xenostudio.ai']);

const getCurrentHostname = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.hostname.toLowerCase();
};

const GATE_ENABLED =
  import.meta.env.VITE_ENABLE_SITE_GATE === 'true' &&
  GATE_ALLOWED_HOSTNAMES.has(getCurrentHostname());

const SITE_GATE_UNLOCKED_STORAGE_KEY = 'xeno_site_gate_unlocked';

const isGateUnlockedInSession = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return sessionStorage.getItem(SITE_GATE_UNLOCKED_STORAGE_KEY) === 'true';
};

const setGateUnlockedInSession = (): void => {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(SITE_GATE_UNLOCKED_STORAGE_KEY, 'true');
  }
};

const clearGateUnlockedInSession = (): void => {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SITE_GATE_UNLOCKED_STORAGE_KEY);
  }
};


export const SiteGateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    // Auto-unlock if gate is disabled or no password is set
    if (!GATE_ENABLED || !SITE_PASSWORD) {
      return true;
    }

    // Keep gate unlocked during same browser session (e.g. OAuth redirects)
    return isGateUnlockedInSession();
  });

  const unlock = (password: string): boolean => {
    if (password === SITE_PASSWORD) {
      setIsUnlocked(true);
      setGateUnlockedInSession();
      return true;
    }
    return false;
  };

  const lock = () => {
    setIsUnlocked(false);
    clearGateUnlockedInSession();
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
