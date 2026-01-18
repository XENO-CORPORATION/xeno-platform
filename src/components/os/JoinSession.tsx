/**
 * JoinSession Component
 * Handles joining a collaborative session via share link
 * Guest joins the HOST's container directly - no separate container needed
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCollaboration } from '../../contexts/CollaborationContext';
import { useOSState } from './OSAuthInterface';
import { useAuth } from '../../contexts/AuthContext';
import { Users, Loader2, AlertCircle } from 'lucide-react';

const JoinSession: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { joinSession } = useCollaboration();
  const { setOSActive } = useOSState();
  const { user } = useAuth();

  const [status, setStatus] = useState<'joining' | 'error' | 'success'>('joining');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const join = async () => {
      if (!token) {
        setStatus('error');
        setErrorMessage('Invalid invite link');
        return;
      }

      if (!user?.id) {
        setStatus('error');
        setErrorMessage('Please log in to join the collaboration session');
        return;
      }

      try {
        // Join the collaboration session - this will give us access to the host's container
        const success = await joinSession(token);

        if (success) {
          setStatus('success');
          // Activate OS and redirect to the shared workspace
          setOSActive(true);
          setTimeout(() => {
            navigate('/os/home');
          }, 1000);
        } else {
          setStatus('error');
          setErrorMessage('Failed to join session. The link may be expired or invalid.');
        }
      } catch (err) {
        console.error('Join error:', err);
        setStatus('error');
        setErrorMessage('An error occurred while joining the session.');
      }
    };

    join();
  }, [token, joinSession, navigate, user?.id, setOSActive]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-sm mx-4 p-6 bg-[#1c1c1c] rounded-lg border border-white/[0.08]">
        <div className="flex flex-col items-center text-center">
          {status === 'joining' && (
            <>
              <div className="w-12 h-12 bg-white/[0.06] rounded-full flex items-center justify-center mb-4">
                <Loader2 size={24} className="text-white/60 animate-spin" />
              </div>
              <h2 className="text-[15px] font-medium text-white/90 mb-2">Joining Session</h2>
              <p className="text-[12px] text-white/40">Connecting to shared workspace...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-12 h-12 bg-white/[0.06] rounded-full flex items-center justify-center mb-4">
                <Users size={24} className="text-white/60" />
              </div>
              <h2 className="text-[15px] font-medium text-white/90 mb-2">Joined Successfully</h2>
              <p className="text-[12px] text-white/40">Entering shared workspace...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-12 h-12 bg-white/[0.06] rounded-full flex items-center justify-center mb-4">
                <AlertCircle size={24} className="text-white/40" />
              </div>
              <h2 className="text-[15px] font-medium text-white/90 mb-2">Unable to Join</h2>
              <p className="text-[12px] text-white/40 mb-4">{errorMessage}</p>
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-white/[0.08] hover:bg-white/[0.12] rounded text-white/70 text-[12px] font-medium transition-colors"
              >
                Go to Home
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default JoinSession;
