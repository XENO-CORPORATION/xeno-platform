import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useOSState } from './OSAuthInterface';
import { useAuth } from '../../contexts/AuthContext';
import { ContainerProvider, useContainer } from '../../contexts/ContainerContext';
import { Desktop, WindowManager } from './desktop';

// Component that handles loading state and shows desktop when ready
const OSHomeContent: React.FC = () => {
  const { isLoading, isInitialized, error } = useContainer();

  // Show loading state during preload
  if (isLoading || !isInitialized) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,10,0.96)',
        color: 'rgba(156,163,175,0.9)',
        fontSize: '16px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '16px', fontSize: '24px' }}>🐳</div>
          <div style={{ marginBottom: '8px', fontWeight: '600' }}>Preloading Container Data</div>
          <div style={{ fontSize: '14px', opacity: 0.7 }}>
            Loading file system, storage info, and container details...
          </div>
          <div style={{
            marginTop: '16px',
            width: '200px',
            height: '4px',
            background: 'rgba(156,163,175,0.2)',
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, rgba(156,163,175,0.6) 0%, rgba(156,163,175,0.3) 50%, rgba(156,163,175,0.6) 100%)',
              animation: 'pulse 2s ease-in-out infinite'
            }} />
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)',
        color: 'white',
        fontSize: '18px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '16px', fontSize: '24px' }}>❌</div>
          <div>Container Initialization Failed</div>
          <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '8px', maxWidth: '400px' }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  // Show desktop when everything is loaded
  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Desktop />
    </div>
  );
};

const OSHomeInterface: React.FC = () => {
  const navigate = useNavigate();
  const { isOSActive } = useOSState();
  const { isAuthenticated, user } = useAuth();

  // Redirect if not authenticated or OS not active
  React.useEffect(() => {
    if (!isOSActive || !isAuthenticated || !user?.id) {
      navigate('/os/connect');
    }
  }, [isOSActive, isAuthenticated, user?.id, navigate]);

  // Don't render anything if redirecting
  if (!isOSActive || !isAuthenticated || !user?.id) {
    return null;
  }

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0, padding: 0 }}>
      <ContainerProvider>
        <WindowManager>
          <OSHomeContent />
        </WindowManager>
      </ContainerProvider>
    </div>
  );
};

export default OSHomeInterface;
