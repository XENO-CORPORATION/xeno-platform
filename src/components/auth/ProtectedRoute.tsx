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
  ONBOARDING_DONE_KEY, ONBOARDING_PATH, ONBOARDING_WELCOME_DONE_KEY,
  ONBOARDING_WELCOME_PATH, welcomePathForDestination,
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
  const [onboarding, setOnboarding] = useState<'checking' | 'needed' | 'welcome' | 'done'>('checking');

  useEffect(() => {
    if (!isAuthenticated) {
      setOnboarding('checking');
      return;
    }
    const isWelcomePreview = import.meta.env.DEV
      && location.pathname === ONBOARDING_WELCOME_PATH
      && new URLSearchParams(location.search).get('preview') === '1';
    if (isWelcomePreview) {
      setOnboarding('done');
      return;
    }
    if (
      typeof sessionStorage !== 'undefined'
      && sessionStorage.getItem(ONBOARDING_DONE_KEY) === '1'
      && sessionStorage.getItem(ONBOARDING_WELCOME_DONE_KEY) === '1'
    ) {
      setOnboarding('done');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/onboarding');
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          sessionStorage.setItem(ONBOARDING_WELCOME_DONE_KEY, '1');
          setOnboarding('done');
          return;
        }
        if (data?.done) {
          sessionStorage.setItem(ONBOARDING_DONE_KEY, '1');
          if (data?.welcomeAcknowledged) {
            sessionStorage.setItem(ONBOARDING_WELCOME_DONE_KEY, '1');
            setOnboarding('done');
          } else if (location.pathname === ONBOARDING_WELCOME_PATH) {
            setOnboarding('done');
          } else if (location.pathname.startsWith('/overview')) {
            setOnboarding('welcome');
          } else {
            setOnboarding('done');
          }
        } else {
          setOnboarding('needed');
        }
      } catch {
        // Fail open: a dead survey table must not wall someone out of the product.
        if (!cancelled) {
          sessionStorage.setItem(ONBOARDING_WELCOME_DONE_KEY, '1');
          setOnboarding('done');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, location.pathname, location.search]);

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

  if (onboarding === 'welcome') {
    return <Navigate to={welcomePathForDestination(`${location.pathname}${location.search}`)} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
