/**
 * Authentication Context
 * Global authentication state management for the React app
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService, User, AuthResponse } from '../services/authService';
import {
  AUTH_TOKEN_KEY, ONBOARDING_NEXT_KEY, ONBOARDING_PATH,
  isAllowedOnboardingNext, stashReturnUrl, peekReturnUrl, consumeReturnUrl,
} from '../lib/onboardingHandoff.js';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (userData: { username: string; email: string; password: string; display_name: string }) => Promise<AuthResponse>;
  logout: () => void;
  validateSession: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

const normalizeUsername = (username: string, email: string): string => {
  const fallback = (email.split('@')[0] || 'user').toLowerCase();
  const source = (username || fallback).toLowerCase();
  const sanitized = source.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || `user_${Math.floor(Math.random() * 100000)}`;
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize authentication state
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check for OAuth token in URL (from OAuth callback redirect)
        const urlParams = new URLSearchParams(window.location.search);
        const oauthToken = urlParams.get('token');
        const isNewUser = urlParams.get('isNew') === 'true';
        const oauthError = urlParams.get('error');

        // Stash a returnUrl (e.g. from the OIDC /api/oauth2/authorize page) so we
        // can send the user back there after they authenticate by ANY method
        // (password / social / MFA). Same-tab sessionStorage survives the OAuth
        // round-trip. Same-origin only (open-redirect guard).
        stashReturnUrl(urlParams.get('returnUrl'));
        const nextParam = urlParams.get('next');
        if (isAllowedOnboardingNext(nextParam)) {
          sessionStorage.setItem(ONBOARDING_NEXT_KEY, nextParam);
        }

        // Handle OAuth error
        if (oauthError) {
          console.error('OAuth error:', oauthError);
          // Clean up URL
          window.history.replaceState({}, '', window.location.pathname);
          setIsLoading(false);
          return;
        }

        // Handle OAuth success - store token and validate
        if (oauthToken) {
          // Store the token
          localStorage.setItem(AUTH_TOKEN_KEY, oauthToken);

          // Clean up URL (remove token from URL for security)
          window.history.replaceState({}, '', window.location.pathname);

          // Validate and get user info
          const isValid = await authService.validateSession();
          if (isValid) {
            const storedUser = authService.getCurrentUser();
            setUser(storedUser);

            // A new website account goes to onboarding. A pending OIDC/CLI
            // returnUrl wins — interrupting that grant is how Hub/CLI break.
            if (isNewUser) {
              const pendingReturn = peekReturnUrl();
              if (!pendingReturn) {
                window.location.replace(ONBOARDING_PATH);
                return;
              }
            }
          } else {
            authService.logout();
            setUser(null);
          }
          setIsLoading(false);
          return;
        }

        // Normal token validation flow
        const storedUser = authService.getCurrentUser();
        if (storedUser && authService.isAuthenticated()) {
          // Validate the stored session
          const isValid = await authService.validateSession();
          if (isValid) {
            setUser(storedUser);
          } else {
            // Clear invalid session
            authService.logout();
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        authService.logout();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  // Refresh the cached user (and its credit balance shown in the taskbar) when a
  // metered action reports new usage — e.g. the streaming chat settling a credit
  // hold dispatches `xeno:credits-updated`. Uses the same /api/auth/me path the
  // account UI uses, so any component reading user.credits re-renders.
  useEffect(() => {
    const onCreditsUpdated = async () => {
      const response = await authService.refreshUser();
      if (response.success && response.user) setUser(response.user);
    };
    window.addEventListener('xeno:credits-updated', onCreditsUpdated);
    return () => window.removeEventListener('xeno:credits-updated', onCreditsUpdated);
  }, []);

  // Resume a pending OIDC/CLI grant only AFTER the account is activated.
  // Register used to jump here immediately, consume the key, then get
  // bounced to /auth/activate by the interceptor — Continue had nothing
  // left to resume and sent a portal signup to /onboarding instead.
  useEffect(() => {
    if (!user) return;
    const rt = peekReturnUrl();
    if (!rt) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        const r = await fetch('/api/auth/activation-status', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json().catch(() => null);
        if (cancelled || !d?.activated) return;
        const dest = consumeReturnUrl();
        if (dest) window.location.href = dest;
      } catch {
        // Leave the key. Activate Continue is the other reader.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const login = async (email: string, password: string): Promise<AuthResponse> => {
    try {
      setIsLoading(true);
      const response = await authService.login({ email, password });
      
      if (response.success && response.user) {
        setUser(response.user);
        return response;
      } else {
        return response;
      }
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: 'Login failed due to network error'
      };
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: { username: string; email: string; password: string; display_name: string }): Promise<AuthResponse> => {
    try {
      setIsLoading(true);
      const normalizedEmail = userData.email.trim().toLowerCase();
      const baseUsername = normalizeUsername(userData.username, normalizedEmail);
      const candidates = [
        baseUsername,
        `${baseUsername}_${Date.now().toString().slice(-4)}`,
        `${baseUsername}_${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`
      ];

      let lastResponse: AuthResponse = { success: false, error: 'Registration failed' };

      for (const candidate of candidates) {
        const response = await authService.register({
          ...userData,
          email: normalizedEmail,
          username: candidate,
          display_name: userData.display_name.trim()
        });

        lastResponse = response;

        if (response.success && response.user) {
          setUser(response.user);
          return response;
        }

        const error = (response.error || '').toLowerCase();
        const isUsernameCollision = error.includes('already exists') || error.includes('already');
        if (!isUsernameCollision) {
          return response;
        }
      }

      return lastResponse;
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: 'Registration failed due to network error'
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  const validateSession = async (): Promise<boolean> => {
    try {
      const isValid = await authService.validateSession();
      if (!isValid) {
        setUser(null);
        authService.logout();
      }
      return isValid;
    } catch (error) {
      console.error('Session validation error:', error);
      setUser(null);
      authService.logout();
      return false;
    }
  };

  const refreshUser = async (): Promise<void> => {
    try {
      const response = await authService.refreshUser();
      if (response.success && response.user) {
        setUser(response.user);
      }
    } catch (error) {
      console.error('User refresh error:', error);
    }
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    validateSession,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
