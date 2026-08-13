import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
// XENO Elements first, so this app's own rules win any tie on their own terms. Nothing in it targets
// a bare element — every rule is scoped to a `.xeno-*` class or to the scrollbar — so importing it
// restyles none of the 392 components already here. It only supplies the tokens, the scrollbar, and
// the styles for XENO components as they are adopted.
import '@xenosystem/elements-react/xeno-elements.css';
import './index.css';
import { SiteGateProvider } from './contexts/SiteGateContext.tsx';
import { SiteGateWrapper } from './components/auth/SiteGate.tsx';

const STRICT_MODE_ENABLED = import.meta.env.VITE_ENABLE_STRICT_MODE === 'true';

/**
 * The one thing `.xeno-scroll-wake` on <html> needs from the app: a marker saying the page is moving.
 *
 * A stylesheet can observe hover but not activity, and for the document element hover is useless — it
 * is true whenever the pointer is anywhere in the window, which would leave the page's scrollbar
 * permanently on. So the bar is gated on this instead: set while scrolling, dropped 600ms after the
 * last event. Longer than a panel's dwell because a page is scrolled in bursts, and a bar that blinks
 * out between two flicks of the wheel is worse than one that lingers.
 *
 * Outside React on purpose — it belongs to the document, not to any component's lifecycle.
 */
const trackPageScrolling = (): void => {
  const root = document.documentElement;
  let idle: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener(
    'scroll',
    () => {
      root.setAttribute('data-scrolling', '');
      clearTimeout(idle);
      idle = setTimeout(() => root.removeAttribute('data-scrolling'), 600);
    },
    { passive: true, capture: true },
  );
};
trackPageScrolling();

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
