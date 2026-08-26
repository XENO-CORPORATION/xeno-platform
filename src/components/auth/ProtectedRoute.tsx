/**
 * Protected Route Component
 * Redirects to login if user is not authenticated.
 * A signed-in account that has not finished (or skipped) onboarding is
 * sent there once — every protected surface, not just the email-activate door.
 */

import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  AUTH_TOKEN_KEY, ONBOARDING_DONE_KEY, ONBOARDING_PATH,
} from '../../lib/onboardingHandoff.js';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  redirectTo = '/login'
}) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [onboarding, setOnboarding] = useState<'checking' | 'needed' | 'done'>('checking');

  useEffect(() => {
    if (import.meta.env.DEV || !isAuthenticated) {
      setOnboarding('checking');
      return;
    }
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ONBOARDING_DONE_KEY) === '1') {
      setOnboarding('done');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        const res = await fetch('/api/auth/onboarding', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setOnboarding('done');
          return;
        }
        if (data?.done) {
          sessionStorage.setItem(ONBOARDING_DONE_KEY, '1');
          setOnboarding('done');
        } else {
          setOnboarding('needed');
        }
      } catch {
        // Fail open: a dead survey table must not wall someone out of the product.
        if (!cancelled) setOnboarding('done');
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // DEV BYPASS: VPS auth endpoints returning 502 — skip auth locally
  // TODO: remove before deploying
  if (import.meta.env.DEV) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white/70">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to={redirectTo}
        state={{ from: location }}
        replace
      />
    );
  }

  if (onboarding === 'checking') {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white/70">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (onboarding === 'needed') {
    return <Navigate to={ONBOARDING_PATH} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
