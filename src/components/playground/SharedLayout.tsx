import React, { ReactNode, useEffect, useState } from 'react';
import { useLayout } from '../../pages/Overview';

interface SharedLayoutProps {
  children: ReactNode;
}

/**
 * SharedLayout ensures consistent spacing and responsive behavior
 * for all playground interfaces relative to the sidebar state
 */
const SharedLayout: React.FC<SharedLayoutProps> = ({ children }) => {
  const { isSidebarCollapsed } = useLayout();
  const [mounted, setMounted] = useState(false);
  
  // This effect ensures that any interface transition happens after component mount
  useEffect(() => {
    setMounted(true);
  }, []);
  
  return (
    <div 
      className={`h-full w-full bg-black/10 rounded-xl border border-white/10 overflow-hidden transition-all duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}
    >
      {children}
    </div>
  );
};

export default SharedLayout; 