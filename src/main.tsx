import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { SiteGateProvider } from './contexts/SiteGateContext.tsx';
import { SiteGateWrapper } from './components/auth/SiteGate.tsx';

const STRICT_MODE_ENABLED = import.meta.env.VITE_ENABLE_STRICT_MODE === 'true';

const RootProvider = ({ children }: { children: ReactNode }) =>
  STRICT_MODE_ENABLED ? <StrictMode>{children}</StrictMode> : <>{children}</>;

createRoot(document.getElementById('root')!).render(
  <RootProvider>
    <BrowserRouter>
      <SiteGateProvider>
        <SiteGateWrapper>
          <App />
        </SiteGateWrapper>
      </SiteGateProvider>
    </BrowserRouter>
  </RootProvider>
);
