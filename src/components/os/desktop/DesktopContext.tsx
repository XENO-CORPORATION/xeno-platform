import * as React from 'react';
import { DesktopIconData, IconSize } from './Desktop';

interface DesktopContextType {
  selectedIcon: string | null;
  setSelectedIcon: (iconId: string | null) => void;
  icons: DesktopIconData[];
  setIcons: React.Dispatch<React.SetStateAction<DesktopIconData[]>>;
  iconSize: IconSize;
  setIconSize: (size: IconSize) => void;
}

const DesktopContext = React.createContext<DesktopContextType | undefined>(undefined);

export const useDesktop = () => {
  const context = React.useContext(DesktopContext);
  if (context === undefined) {
    throw new Error('useDesktop must be used within a DesktopProvider');
  }
  return context;
};

export default DesktopContext;
