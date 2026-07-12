import React, { useState } from 'react';
import { Shield, Trash2, Bell, Moon, Eye, EyeOff, Loader2, AlertTriangle, Settings, Lock, Globe, Volume2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';
import UpgradePrompt from '../common/UpgradePrompt';

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Password change state
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Preferences state
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [soundEffects, setSoundEffects] = useState(true);
  const [language, setLanguage] = useState('en');

  const handlePasswordChange = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setIsSavingPassword(true);

    try {
      const result = await authService.changePassword(currentPassword, newPassword);

      if (result.success) {
        setPasswordSuccess('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setIsChangingPassword(false);
        setTimeout(() => setPasswordSuccess(null), 3000);
      } else {
        setPasswordError(result.error || 'Failed to change password');
      }
    } catch (err) {
      setPasswordError('An error occurred');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);

    if (!deletePassword) {
      setDeleteError('Password is required');
      return;
    }

    setIsDeleting(true);

    try {
      const result = await authService.deleteAccount(deletePassword);

      if (result.success) {
        if (logout) {
          logout();
        }
        navigate('/');
      } else {
        setDeleteError(result.error || 'Failed to delete account');
      }
    } catch (err) {
      setDeleteError('An error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle component
  const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      className={`relative w-10 h-6 rounded-full transition-colors ${
        enabled ? 'bg-white/20' : 'bg-white/10'
      }`}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
          enabled ? 'left-5 bg-white' : 'left-1 bg-white/50'
        }`}
      />
    </button>
  );

  return (
    <div className="h-full bg-[#121212] overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
              <Settings size={20} className="text-white/70" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Settings</h1>
              <p className="text-white/40 text-sm">Customize your experience</p>
            </div>
          </div>

          {passwordSuccess && (
            <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
              {passwordSuccess}
            </div>
          )}
        </div>

        {/* Free-tier upgrade nudge (renders only for Free users) */}
        <UpgradePrompt context="general" className="mb-6" />

        {/* Main Content */}
        <div className="grid grid-cols-3 gap-6">
          {/* Left Column - Security */}
          <div className="space-y-4">
            {/* Security Card */}
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-[#2a2a2d]">
                <Shield size={16} className="text-white/50" />
                <div>
                  <h2 className="text-sm font-medium text-white">Security</h2>
                  <p className="text-white/30 text-xs">Protect your account</p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* Password Section */}
                <div className="flex items-center justify-between p-3 bg-[#121212] border border-[#2a2a2d] rounded-lg">
                  <div className="flex items-center gap-3">
                    <Lock size={14} className="text-white/30" />
                    <div>
                      <div className="text-sm text-white">Password</div>
                      <div className="text-xs text-white/30">Last changed 30 days ago</div>
                    </div>
                  </div>
                  {!isChangingPassword && (
                    <button
                      onClick={() => setIsChangingPassword(true)}
                      className="px-3 py-1.5 text-xs text-white/50 hover:text-white bg-[#2a2a2d] hover:bg-[#3a3a3d] rounded-lg transition-colors"
                    >
                      Update
                    </button>
                  )}
                </div>

                {isChangingPassword && (
                  <div className="p-4 bg-[#121212] border border-[#2a2a2d] rounded-lg space-y-3">
                    {passwordError && (
                      <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                        {passwordError}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs text-white/30 uppercase tracking-wide">Current Password</label>
                      <div className="relative">
                        <input
                          type={showCurrentPassword ? 'text' : 'password'}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="w-full px-3 py-2 pr-10 bg-[#19191a] border border-[#3a3a3d] focus:border-white/30 rounded-lg text-white text-sm placeholder-white/20 focus:outline-none transition-colors"
                          placeholder="Enter current password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/50"
                        >
                          {showCurrentPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-white/30 uppercase tracking-wide">New Password</label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full px-3 py-2 pr-10 bg-[#19191a] border border-[#3a3a3d] focus:border-white/30 rounded-lg text-white text-sm placeholder-white/20 focus:outline-none transition-colors"
                          placeholder="Enter new password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/50"
                        >
                          {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-white/30 uppercase tracking-wide">Confirm Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2 bg-[#19191a] border border-[#3a3a3d] focus:border-white/30 rounded-lg text-white text-sm placeholder-white/20 focus:outline-none transition-colors"
                        placeholder="Confirm new password"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          setIsChangingPassword(false);
                          setCurrentPassword('');
                          setNewPassword('');
                          setConfirmPassword('');
                          setPasswordError(null);
                        }}
                        className="px-3 py-2 text-xs text-white/40 hover:text-white/60 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handlePasswordChange}
                        disabled={isSavingPassword}
                        className="flex-1 px-4 py-2 text-xs font-medium text-[#121212] bg-white hover:bg-white/90 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSavingPassword && <Loader2 size={12} className="animate-spin" />}
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <div className="bg-[#19191a] border border-red-500/10 rounded-xl">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-red-500/10">
                <AlertTriangle size={16} className="text-red-400/70" />
                <div>
                  <h2 className="text-sm font-medium text-white">Danger Zone</h2>
                  <p className="text-white/30 text-xs">Irreversible actions</p>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Trash2 size={14} className="text-red-400/50" />
                    <div>
                      <div className="text-sm text-white">Delete Account</div>
                      <div className="text-xs text-white/30">Remove all your data</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Preferences */}
          <div className="col-span-2">
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl">
              <div className="px-6 py-4 border-b border-[#2a2a2d]">
                <h2 className="text-base font-medium text-white">Preferences</h2>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  {/* Notifications */}
                  <div className="p-4 bg-[#121212] border border-[#2a2a2d] rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <Bell size={16} className="text-white/40" />
                      <Toggle enabled={notifications} onChange={() => setNotifications(!notifications)} />
                    </div>
                    <div className="text-sm font-medium text-white mb-1">Notifications</div>
                    <div className="text-xs text-white/30">Get notified about activity</div>
                  </div>

                  {/* Dark Mode */}
                  <div className="p-4 bg-[#121212] border border-[#2a2a2d] rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <Moon size={16} className="text-white/40" />
                      <Toggle enabled={darkMode} onChange={() => setDarkMode(!darkMode)} />
                    </div>
                    <div className="text-sm font-medium text-white mb-1">Dark Mode</div>
                    <div className="text-xs text-white/30">Use dark theme</div>
                  </div>

                  {/* Sound Effects */}
                  <div className="p-4 bg-[#121212] border border-[#2a2a2d] rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <Volume2 size={16} className="text-white/40" />
                      <Toggle enabled={soundEffects} onChange={() => setSoundEffects(!soundEffects)} />
                    </div>
                    <div className="text-sm font-medium text-white mb-1">Sound Effects</div>
                    <div className="text-xs text-white/30">Play sounds for interactions</div>
                  </div>

                  {/* Language */}
                  <div className="p-4 bg-[#121212] border border-[#2a2a2d] rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <Globe size={16} className="text-white/40" />
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="px-2 py-1 text-xs text-white/60 bg-[#2a2a2d] border border-[#3a3a3d] rounded-lg focus:outline-none cursor-pointer"
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                      </select>
                    </div>
                    <div className="text-sm font-medium text-white mb-1">Language</div>
                    <div className="text-xs text-white/30">Display language</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setShowDeleteModal(false)}
          />

          <div className="relative w-full max-w-md bg-[#19191a] border border-[#2a2a2d] rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Delete Account</h3>
                <p className="text-white/40 text-sm">This cannot be undone</p>
              </div>
            </div>

            <p className="text-white/50 text-sm mb-5">
              All your data, including credits, history, and settings will be permanently deleted.
            </p>

            {deleteError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {deleteError}
              </div>
            )}

            <div className="mb-5 space-y-2">
              <label className="text-xs text-white/40 uppercase tracking-wide">
                Enter password to confirm
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="w-full px-4 py-3 bg-[#121212] border border-[#3a3a3d] focus:border-red-500/50 rounded-lg text-white text-sm placeholder-white/20 focus:outline-none transition-colors"
                placeholder="Your password"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword('');
                  setDeleteError(null);
                }}
                className="flex-1 px-4 py-2.5 text-sm text-white/50 hover:text-white/70 bg-[#2a2a2d] hover:bg-[#3a3a3d] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting && <Loader2 size={14} className="animate-spin" />}
                Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
