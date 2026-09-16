import * as React from 'react';

// OS State Context
interface OSStateContextType {
  isOSActive: boolean;
  setOSActive: (active: boolean) => void;
}

const OSStateContext = React.createContext<OSStateContextType | undefined>(undefined);

export const OSStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOSActive, setIsOSActiveState] = React.useState(() => {
    return localStorage.getItem('isOSActive') === 'true';
  });

  const setOSActive = React.useCallback((active: boolean) => {
    setIsOSActiveState(active);
    localStorage.setItem('isOSActive', active.toString());
    // Dispatch custom event for other components to listen to
    window.dispatchEvent(new CustomEvent('os_state_changed', {
      detail: { isOSActive: active }
    }));
  }, []);

  return (
    <OSStateContext.Provider value={{ isOSActive, setOSActive }}>
      {children}
    </OSStateContext.Provider>
  );
};

export const useOSState = () => {
  const context = React.useContext(OSStateContext);
  if (context === undefined) {
    throw new Error('useOSState must be used within an OSStateProvider');
  }
  return context;
};
