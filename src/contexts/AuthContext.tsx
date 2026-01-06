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

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize authentication state
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check if user has stored token
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
      const response = await authService.register(userData);
      
      if (response.success && response.user) {
        setUser(response.user);
        return response;
      } else {
        return response;
      }
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