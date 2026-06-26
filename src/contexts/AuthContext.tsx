/**
 * Authentication Context
 * Global authentication state management for the React app
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService, User, AuthResponse } from '../services/authService';

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
        const returnUrlParam = urlParams.get('returnUrl');
        if (returnUrlParam && returnUrlParam.startsWith('/') && !returnUrlParam.startsWith('//')) {
          sessionStorage.setItem('xeno_return_url', returnUrlParam);
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
          localStorage.setItem('xenoos_auth_token', oauthToken);

          // Clean up URL (remove token from URL for security)
          window.history.replaceState({}, '', window.location.pathname);

          // Validate and get user info
          const isValid = await authService.validateSession();
          if (isValid) {
            const storedUser = authService.getCurrentUser();
            setUser(storedUser);

            // Show welcome message for new users
            if (isNewUser) {
              console.log('Welcome to XenoStudio! Your account has been created.');
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

  // Once authenticated by ANY path (password, register, social/MFA, or restored
  // session), return the user to a pending OIDC authorize page if one is queued.
  useEffect(() => {
    if (!user) return;
    const rt = sessionStorage.getItem('xeno_return_url');
    if (rt && rt.startsWith('/') && !rt.startsWith('//')) {
      sessionStorage.removeItem('xeno_return_url');
      window.location.href = rt; // full-page load (backend authorize route)
    }
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
