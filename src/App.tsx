import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import Home from "./pages/Home";
import Home2 from "./pages/Home2";
import Home3 from "./pages/Home3";
import Marketplace from "./pages/Marketplace";
import ProductPage from "./pages/ProductPage";
import ProductReleases from "./pages/ProductReleases";
import ProductReleaseDetail from "./pages/ProductReleaseDetail";
import ProductDownload from "./pages/ProductDownload";
import ProductPrivacy from "./pages/ProductPrivacy";
import ProductsIndex from "./pages/ProductsIndex";
import ReleaseNotes from "./pages/ReleaseNotes";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Learn from "./pages/Learn";
import LearnTutorial from "./pages/LearnTutorial";
import Forum from "./pages/Forum";
import ForumThread from "./pages/ForumThread";
import ForumNew from "./pages/ForumNew";
import ForumModeration from './pages/ForumModeration';
import RemoteRuns from "./pages/RemoteRuns";
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Features from './pages/Features';
import Pricing from './pages/Pricing';
import Roadmap from './pages/Roadmap';
import DocsHome from './pages/DocsHome';
import ProductDocs, { ProductDocsRedirect } from './pages/ProductDocs';
import Templates from './pages/Templates';
import ApiReference from './pages/ApiReference';
import About from './pages/About';
import Careers from './pages/Careers';
import Press from './pages/Press';
import Partners from './pages/Partners';
import Security from './pages/Security';
import Refunds from './pages/Refunds';
import Cookies from './pages/Cookies';
import Withdrawal from './pages/Withdrawal';
import Impressum from './pages/Impressum';
import OverviewPage from './pages/Overview';
import SharedChatView from './pages/SharedChatView';
import OSAuthInterface, { OSStateProvider } from './components/os/OSAuthInterface';
import OSHomeInterface from './components/os/OSHomeInterface';
import { OSAuthWithContainers } from './components/dashboard/OSAuthWithContainers';
import OSContainerWizard from './components/os/OSContainerWizard';
import JoinSession from './components/os/JoinSession';
import { AuthProvider } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { CollaborationProvider } from './contexts/CollaborationContext';
import ProtectedRoute from './components/auth/ProtectedRoute';

// Auth layout with shared video panel
import AuthLayout from './components/layouts/AuthLayout';
import AuthContent from './pages/AuthContent';
import AuthRouteAlias from './pages/AuthRouteAlias';
import ActivateAccount from './pages/ActivateAccount';
import Onboarding from './pages/Onboarding';
import DownloadResume from './pages/DownloadResume';
import DeviceAuthContent from './pages/DeviceAuthContent';
import HelpContent from './pages/HelpContent';
import ContactContent from './pages/ContactContent';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';

// Import MultiChatContainer for standalone xeno-chat.com domain
import MultiChatContainer from './components/playground/Chat/MultiChatContainer';


// Lazy load StudioVideoCanvas for standalone canvas page
const StudioVideoCanvas = React.lazy(() =>
  import('./components/playground/Studio/VideoStudio')
    .then(module => ({ default: module.StudioVideoCanvas }))
);

// Domain detection for xeno-chat.com standalone chat interface
const isXenoChatDomain = typeof window !== 'undefined' &&
  (window.location.hostname === 'xeno-chat.com' ||
   window.location.hostname === 'www.xeno-chat.com' ||
   window.location.hostname === 'chat.xeno-studio.com');

function App() {
  // Fix iOS Safari 100vh issue
  useEffect(() => {
    const setHeight = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    };

    setHeight();
    window.addEventListener('resize', setHeight);
    window.addEventListener('orientationchange', setHeight);

    return () => {
      window.removeEventListener('resize', setHeight);
      window.removeEventListener('orientationchange', setHeight);
    };
  }, []);

  // Render standalone chat interface for xeno-chat.com domain
  if (isXenoChatDomain) {
    return (
      <AuthProvider>
        <Routes>
          {/* Standalone Chat Interface - Full viewport */}
          <Route path="/" element={
            <ProtectedRoute>
              <div className="w-full h-screen bg-[#0a0a0b]">
                <MultiChatContainer isStandalone={true} />
              </div>
            </ProtectedRoute>
          } />

          {/* Authentication Page */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<AuthContent mode="signin" />} />
            <Route path="/signup" element={<AuthContent mode="signup" />} />
            <Route path="/auth" element={<AuthRouteAlias />} />
          </Route>

          {/* Catch-all: redirect to chat */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    );
  }

  // Default: the full xenostudio.ai experience
  return (
    <AuthProvider>
      <WorkspaceProvider>
      <CollaborationProvider>
        <OSStateProvider>
          <Routes>
            {/* Landing Page — the v3 redesign is now the default homepage */}
            <Route path="/" element={<Home3 />} />
            <Route path="/v3" element={<Home3 />} />{/* alias — keep existing links working */}
            <Route path="/v1" element={<Home />} />{/* previous homepage, preserved */}
            <Route path="/v2" element={<Home2 />} />
            <Route path="/marketplace" element={<Marketplace />} />
            {/* Product pages — registry-driven, one template for all products */}
            <Route path="/products" element={<ProductsIndex />} />
            <Route path="/product/:slug" element={<ProductPage />} />
            <Route path="/product/:slug/download" element={<ProductDownload />} />
            <Route path="/product/:slug/releases" element={<ProductReleases />} />
            <Route path="/product/:slug/releases/:version" element={<ProductReleaseDetail />} />
            {/* Canonical docs live under /docs — redirect the per-product path in. */}
            <Route path="/product/:slug/docs" element={<ProductDocsRedirect />} />
            {/* Per-product privacy policy. A web-store listing needs a stable
                public URL for a policy describing what THAT product does with
                your data. Products with no authored policy redirect to the
                platform-wide /privacy, so this path is never a dead end. */}
            <Route path="/product/:slug/privacy" element={<ProductPrivacy />} />
            {/* XENO Swarm was renamed to XENO Anima — keep old links working. */}
            <Route path="/product/swarm" element={<Navigate to="/product/anima" replace />} />
            {/* Legacy /download retired → the Hub download page (client-side, so
                in-app links like the header Download button land there too). */}
            <Route path="/download" element={<Navigate to="/product/hub/download" replace />} />
            {/* /product/extension/download retired: its release feed (R2
                apps/extension/releases.json) was withdrawn and now 404s, so the
                page could only render an error. Falls through to the generic
                /product/:slug/download, which redirects to the product page. */}
            <Route path="/releases/:version" element={<ReleaseNotes />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/learn/:slug" element={<LearnTutorial />} />
            {/* XENO Forum. Only :shortId resolves a thread — the trailing slug is
                decorative, so a retitled thread never breaks a citation (SPEC D9).
                /community redirects in because that is what people type and what
                inbound links will use. */}
            <Route path="/forum" element={<Forum />} />
            <Route path="/forum/new" element={<ForumNew />} />
            <Route path="/forum/moderation" element={<ForumModeration />} />
            <Route path="/forum/t/:shortId" element={<ForumThread />} />
            <Route path="/forum/t/:shortId/:slug" element={<ForumThread />} />
            <Route path="/community" element={<Navigate to="/forum" replace />} />
            <Route path="/remote/runs" element={
              <ProtectedRoute>
                <RemoteRuns />
              </ProtectedRoute>
            } />

            {/* Auth Layout Routes - Shared video panel, swappable right content */}
            {/* Standalone, OUTSIDE AuthLayout: a confirmation step has nobody
                left to persuade, so it gets no hero panel. */}
            <Route path="/auth/activate" element={<ActivateAccount />} />

            {/* Onboarding. Also outside AuthLayout, and for the same reason as
                activation: it owns the whole viewport and imposes its own
                chrome. It sits on the authenticated side of the funnel — the
                page itself redirects anyone who has already finished. */}
            <Route path="/onboarding" element={<Onboarding />} />

            {/* Where every interrupted download comes back to. Deliberately
                OUTSIDE any auth layout: a signed-out visitor lands here after
                Stripe or an OAuth bounce, and wrapping it in a guard would
                redirect away the one page that knows how to finish the job. */}
            <Route path="/download/resume" element={<DownloadResume />} />

            {/* RFC 8628 verification URI. The provider emits /activate, so it
                must be a real route rather than falling through to home. */}
            <Route element={<AuthLayout />}>
              <Route path="/activate" element={<DeviceAuthContent protocol="oidc" />} />
            </Route>

            <Route element={<AuthLayout />}>
              <Route path="/login" element={<AuthContent mode="signin" />} />
              <Route path="/signup" element={<AuthContent mode="signup" />} />
              {/* Backward-compatible aliases. Canonical human routes are
                  /login and /signup; protocol routes remain /api/oauth2/*. */}
              <Route path="/auth" element={<AuthRouteAlias />} />
              <Route path="/auth/:app" element={<AuthRouteAlias />} />
              {/* Old CLI clients still use this custom device-code surface. */}
              <Route path="/auth/:app/device" element={<DeviceAuthContent protocol="legacy" />} />
              {/* Password reset + email verification — public (the token is the credential) */}
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/help" element={<HelpContent />} />
              <Route path="/contact" element={<ContactContent />} />
            </Route>

            {/* Public Legal Pages - No auth required */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {/* Marketing / resource / legal pages (footer) */}
            <Route path="/features" element={<Features />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/docs" element={<DocsHome />} />
            <Route path="/docs/:slug" element={<ProductDocs />} />
            <Route path="/docs/:slug/:page" element={<ProductDocs />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/api-reference" element={<ApiReference />} />
            <Route path="/about" element={<About />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/press" element={<Press />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/security" element={<Security />} />
            <Route path="/refunds" element={<Refunds />} />
            <Route path="/cookies" element={<Cookies />} />
            {/* Statutory withdrawal instruction (Art. 246a EGBGB Anlage 1/2).
                Both spellings routed: /widerruf is what a German consumer will
                type, /withdrawal is what the English pages link to. An
                instruction nobody can reach has instructed nobody. */}
            <Route path="/withdrawal" element={<Withdrawal />} />
            <Route path="/widerruf" element={<Withdrawal />} />
            <Route path="/impressum" element={<Impressum />} />

            {/* Standalone Video Studio Canvas - Full page interface */}
            <Route path="/studio/video/canvas/:projectId?" element={
              <ProtectedRoute>
                <React.Suspense fallback={<div className="w-full h-screen flex items-center justify-center bg-black text-white">Loading Canvas...</div>}>
                  <StudioVideoCanvas />
                </React.Suspense>
              </ProtectedRoute>
            } />

            {/* Direct Conversation and Sub-surface Routes */}
            <Route path="/c/:conversationId" element={
              <ProtectedRoute>
                <OverviewPage />
              </ProtectedRoute>
            } />
            <Route path="/c" element={
              <ProtectedRoute>
                <OverviewPage />
              </ProtectedRoute>
            } />
            <Route path="/projects" element={<Navigate to="/overview/chat/projects" replace />} />
            <Route path="/scheduled" element={<Navigate to="/overview/chat/scheduled" replace />} />
            <Route path="/artifacts" element={<Navigate to="/overview/chat/artifacts" replace />} />
            <Route path="/customize" element={<Navigate to="/overview/chat/customize" replace />} />

            {/* Public Shared Conversation Viewer (no auth required) */}
            <Route path="/share/:token" element={<SharedChatView />} />
            <Route path="/share/e/:token" element={<SharedChatView />} />

            {/* /chat -> the overview chat */}
            <Route path="/chat" element={<Navigate to="/overview/chat/llm" replace />} />
            <Route path="/chat/c/:conversationId" element={
              <ProtectedRoute>
                <OverviewPage />
              </ProtectedRoute>
            } />

            {/* Test comparison routes for user evaluation */}
            <Route path="/test/chat-main" element={
              <ProtectedRoute>
                <div className="w-full h-screen">
                  <MultiChatContainer isStandalone={false} />
                </div>
              </ProtectedRoute>
            } />
            <Route path="/test/chat-standalone" element={
              <ProtectedRoute>
                <div className="w-full h-screen bg-[#0a0a0b]">
                  <MultiChatContainer isStandalone={true} />
                </div>
              </ProtectedRoute>
            } />

            {/* Protected Routes - Only accessible after authentication */}
            <Route path="/overview/*" element={
              <ProtectedRoute>
                <OverviewPage />
              </ProtectedRoute>
            } />

            {/* NEW: Phase 1 Foundation - Container Management */}
            <Route path="/os/containers" element={
              <ProtectedRoute>
                <div className="min-h-screen">
                  <OSAuthWithContainers />
                </div>
              </ProtectedRoute>
            } />

            {/* Container Configuration Wizard - PROTECTED */}
            <Route path="/os/container-wizard" element={
              <ProtectedRoute>
                <OSContainerWizard />
              </ProtectedRoute>
            } />

            {/* OS Connect full-viewport route - Connect to XenoOS container - PROTECTED */}
            <Route path="/os/connect" element={
              <ProtectedRoute>
                <OSAuthInterface onClose={() => window.history.back()} />
              </ProtectedRoute>
            } />

            {/* OS Home full-viewport route - PROTECTED */}
            <Route path="/os/home" element={
              <ProtectedRoute>
                <OSHomeInterface />
              </ProtectedRoute>
            } />

            {/* Join Collaboration Session - PROTECTED */}
            <Route path="/os/join/:token" element={
              <ProtectedRoute>
                <JoinSession />
              </ProtectedRoute>
            } />

            {/* Catch-all: redirect unknown paths to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </OSStateProvider>
      </CollaborationProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}

export default App;
