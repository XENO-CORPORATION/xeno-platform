import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import Home from './pages/Home';
import Auth from './pages/Auth';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import OverviewPage from './pages/Overview';
import OSAuthInterface, { OSStateProvider } from './components/os/OSAuthInterface';
import OSHomeInterface from './components/os/OSHomeInterface';
import { OSAuthWithContainers } from './components/dashboard/OSAuthWithContainers';
import OSContainerWizard from './components/os/OSContainerWizard';
import JoinSession from './components/os/JoinSession';
import { AuthProvider } from './contexts/AuthContext';
import { CollaborationProvider } from './contexts/CollaborationContext';
import ProtectedRoute from './components/auth/ProtectedRoute';

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
              <div className="w-full h-screen bg-[#121212]">
                <MultiChatContainer isStandalone={true} />
              </div>
            </ProtectedRoute>
          } />

          {/* Authentication Page */}
          <Route path="/auth" element={<Auth />} />

          {/* Catch-all: redirect to chat */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    );
  }

  // Default: Full xeno-studio.com experience
  return (
    <AuthProvider>
      <CollaborationProvider>
        <OSStateProvider>
          <Routes>
            {/* Landing Page - Show this first */}
            <Route path="/" element={<Home />} />

            {/* Authentication Pages */}
            <Route path="/auth" element={<Auth />} />

            {/* Public Legal Pages - No auth required */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />

            {/* Standalone Video Studio Canvas - Full page interface */}
            <Route path="/studio/video/canvas/:projectId?" element={
              <ProtectedRoute>
                <React.Suspense fallback={<div className="w-full h-screen flex items-center justify-center bg-black text-white">Loading Canvas...</div>}>
                  <StudioVideoCanvas />
                </React.Suspense>
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
    </AuthProvider>
  );
}

export default App;