// XenoOS Authentication Service
// Real authentication with database integration

const API_BASE = '/api';

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  created_at: string;
  email_verified: boolean;
  is_active: boolean;
  credits: number;
  bonus_credits_claimed: boolean;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  display_name: string;
}

class AuthService {
  private token: string | null = null;

  constructor() {
    // Load token from localStorage on initialization
    this.token = localStorage.getItem('xenoos_auth_token');
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!this.token;
  }

  // Get current token
  getToken(): string | null {
    return this.token;
  }

  // Get current user
  getCurrentUser(): User | null {
    const userData = localStorage.getItem('xenoos_user');
    if (userData) {
      try {
        return JSON.parse(userData);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Login user
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        this.token = data.token;
        localStorage.setItem('xenoos_auth_token', data.token);
        localStorage.setItem('xenoos_user', JSON.stringify(data.user));
        return data;
      } else {
        return {
          success: false,
          error: data.error || 'Login failed'
        };
      }
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Register new user
  async register(userData: RegisterRequest): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        this.token = data.token;
        localStorage.setItem('xenoos_auth_token', data.token);
        localStorage.setItem('xenoos_user', JSON.stringify(data.user));
        return data;
      } else {
        return {
          success: false,
          error: data.error || 'Registration failed'
        };
      }
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Logout user
  logout(): void {
    this.token = null;
    localStorage.removeItem('xenoos_auth_token');
    localStorage.removeItem('xenoos_user');
  }

  // Get auth headers for API requests
  getAuthHeaders(): Record<string, string> {
    if (this.token) {
      return {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      };
    }
    return { 'Content-Type': 'application/json' };
  }

  // Validate current session
  async validateSession(): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await fetch(`${API_BASE}/auth/validate`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  // Initialize database and create default admin user
  async initializeDatabase(): Promise<void> {
    try {
      // Create database tables
      const response = await fetch(`${API_BASE}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        console.log('Database initialized successfully');
      } else {
        console.warn('Database initialization may have issues');
      }
    } catch (error) {
      console.warn('Could not initialize database:', error);
    }
  }

  // Update user profile
  async updateProfile(data: { display_name?: string; username?: string; avatar_url?: string }): Promise<AuthResponse> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/profile`, {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Update local user data
        localStorage.setItem('xenoos_user', JSON.stringify(result.user));
        return result;
      } else {
        return {
          success: false,
          error: result.error || 'Failed to update profile'
        };
      }
    } catch (error) {
      console.error('Profile update error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Change password
  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/password`, {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return { success: true, message: data.message };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to change password'
        };
      }
    } catch (error) {
      console.error('Password change error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Get usage statistics
  async getUsageStats(): Promise<{
    success: boolean;
    usage?: {
      current_credits: number;
      total_credits_earned: number;
      credits_used: number;
      bonus_claimed: boolean;
      member_since: string;
      history: Array<{ feature: string; credits_used: number; created_at: string }>;
    };
    error?: string;
  }> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/usage`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return { success: true, usage: data.usage };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to fetch usage data'
        };
      }
    } catch (error) {
      console.error('Usage fetch error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Use credits for a feature
  async useCredits(feature: string, amount: number): Promise<{
    success: boolean;
    credits_used?: number;
    remaining_credits?: number;
    error?: string;
  }> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/use-credits`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ feature, amount }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Update local user credits
        const currentUser = this.getCurrentUser();
        if (currentUser) {
          const updatedUser = { ...currentUser, credits: data.remaining_credits };
          localStorage.setItem('xenoos_user', JSON.stringify(updatedUser));
        }
        return {
          success: true,
          credits_used: data.credits_used,
          remaining_credits: data.remaining_credits
        };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to use credits'
        };
      }
    } catch (error) {
      console.error('Credit usage error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Delete account
  async deleteAccount(password: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/account`, {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Clear local data
        this.logout();
        return { success: true, message: data.message };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to delete account'
        };
      }
    } catch (error) {
      console.error('Account deletion error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Refresh user data from server
  async refreshUser(): Promise<AuthResponse> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem('xenoos_user', JSON.stringify(data.user));
        return { success: true, user: data.user };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to refresh user data'
        };
      }
    } catch (error) {
      console.error('User refresh error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // Claim bonus credits
  async claimBonusCredits(): Promise<{ success: boolean; message?: string; credits?: number; error?: string; bonus_amount?: number }> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/claim-bonus`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Update local user data with new credits
        const currentUser = this.getCurrentUser();
        if (currentUser) {
          const updatedUser = { ...currentUser, credits: data.credits, bonus_credits_claimed: true };
          localStorage.setItem('xenoos_user', JSON.stringify(updatedUser));
        }
        
        return {
          success: true,
          message: data.message,
          credits: data.credits,
          bonus_amount: data.welcome_amount || data.bonus_amount
        };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to claim bonus credits'
        };
      }
    } catch (error) {
      console.error('Bonus claim error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }
}

// Create and export singleton instance
export const authService = new AuthService();

// Initialize database on service creation
authService.initializeDatabase();

export default authService;
