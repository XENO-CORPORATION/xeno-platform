import React, { useState, useEffect } from 'react';
import { User, Mail, AtSign, Calendar, Shield, Camera, Check, Loader2, Coins, Gift } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';

const ProfilePage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [username, setUsername] = useState(user?.username || '');

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '');
      setUsername(user.username || '');
    }
  }, [user]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updates: { display_name?: string; username?: string } = {};

      if (displayName !== user?.display_name) {
        updates.display_name = displayName;
      }
      if (username !== user?.username) {
        updates.username = username;
      }

      if (Object.keys(updates).length === 0) {
        setIsEditing(false);
        return;
      }

      const result = await authService.updateProfile(updates);

      if (result.success) {
        setSuccess('Profile updated successfully');
        setIsEditing(false);
        if (refreshUser) {
          await refreshUser();
        }
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Failed to update profile');
      }
    } catch (err) {
      setError('An error occurred while saving');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setDisplayName(user?.display_name || '');
    setUsername(user?.username || '');
    setIsEditing(false);
    setError(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center bg-[#121212]">
        <Loader2 size={24} className="text-white/40 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full bg-[#121212] overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
              <User size={20} className="text-white/70" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Profile</h1>
              <p className="text-white/40 text-sm">Manage your account information</p>
            </div>
          </div>

          {/* Status Messages */}
          {(error || success) && (
            <div className={`px-4 py-2 rounded-lg text-sm ${
              error
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            }`}>
              {error || success}
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-3 gap-6">
          {/* Left Column - Avatar & Stats */}
          <div className="space-y-4">
            {/* Avatar Card */}
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-6">
              <div className="flex flex-col items-center text-center">
                {/* Avatar */}
                <div className="relative mb-4">
                  <div className="w-24 h-24 rounded-xl bg-[#2a2a2d] border border-[#3a3a3d] flex items-center justify-center overflow-hidden">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl font-semibold text-white/50">
                        {user.display_name?.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <button className="absolute -bottom-1 -right-1 p-2 bg-[#2a2a2d] hover:bg-[#3a3a3d] border border-[#3a3a3d] rounded-lg transition-colors">
                    <Camera size={12} className="text-white/60" />
                  </button>
                </div>

                <h3 className="text-lg font-semibold text-white">{user.display_name}</h3>
                <p className="text-white/40 text-sm">@{user.username}</p>

                <div className="mt-3 px-3 py-1 bg-[#2a2a2d] rounded-full">
                  <span className="text-xs font-medium text-white/50 uppercase tracking-wide">Creator</span>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Coins size={14} className="text-amber-400/70" />
                </div>
                <div className="text-xl font-semibold text-white">
                  {user.credits?.toLocaleString() || 0}
                </div>
                <div className="text-white/30 text-xs uppercase tracking-wide mt-1">Credits</div>
              </div>

              <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Gift size={14} className="text-emerald-400/70" />
                </div>
                <div className="text-sm font-medium">
                  {user.bonus_credits_claimed ? (
                    <span className="text-emerald-400">Claimed</span>
                  ) : (
                    <span className="text-white/40">Available</span>
                  )}
                </div>
                <div className="text-white/30 text-xs uppercase tracking-wide mt-1">Bonus</div>
              </div>
            </div>

            {/* Member Since */}
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-4">
              <div className="flex items-center gap-3">
                <Calendar size={16} className="text-white/30" />
                <div>
                  <div className="text-white/30 text-xs uppercase tracking-wide">Member since</div>
                  <div className="text-white/70 text-sm mt-0.5">{formatDate(user.created_at)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Form */}
          <div className="col-span-2">
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl">
              {/* Section Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2d]">
                <h2 className="text-base font-medium text-white">Personal Information</h2>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-4 py-2 text-sm text-white/60 hover:text-white bg-[#2a2a2d] hover:bg-[#3a3a3d] border border-[#3a3a3d] rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleCancel}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm text-white/40 hover:text-white/60 rounded-lg transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm font-medium text-[#121212] bg-white hover:bg-white/90 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Save
                    </button>
                  </div>
                )}
              </div>

              {/* Form Fields */}
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  {/* Display Name */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-white/40 uppercase tracking-wide">
                      <User size={12} />
                      Display Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full px-4 py-3 bg-[#121212] border border-[#3a3a3d] focus:border-white/30 rounded-lg text-white text-sm placeholder-white/20 focus:outline-none transition-colors"
                        placeholder="Your display name"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-[#121212] border border-[#2a2a2d] rounded-lg text-white/70 text-sm">
                        {user.display_name}
                      </div>
                    )}
                  </div>

                  {/* Username */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-white/40 uppercase tracking-wide">
                      <AtSign size={12} />
                      Username
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase())}
                        className="w-full px-4 py-3 bg-[#121212] border border-[#3a3a3d] focus:border-white/30 rounded-lg text-white text-sm placeholder-white/20 focus:outline-none transition-colors"
                        placeholder="your_username"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-[#121212] border border-[#2a2a2d] rounded-lg text-white/70 text-sm">
                        @{user.username}
                      </div>
                    )}
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-white/40 uppercase tracking-wide">
                    <Mail size={12} />
                    Email Address
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 px-4 py-3 bg-[#121212] border border-[#2a2a2d] rounded-lg text-white/50 text-sm">
                      {user.email}
                    </div>
                    {user.email_verified && (
                      <div className="flex items-center gap-2 px-3 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                        <Shield size={14} className="text-emerald-400" />
                        <span className="text-emerald-400 text-xs font-medium uppercase tracking-wide">Verified</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
