import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings, User, Power, Grid3X3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ContainerService } from '../../services/containerService';

// OS State Context
interface OSStateContextType {
  isOSActive: boolean;
  setOSActive: (active: boolean) => void;
}

const OSStateContext = React.createContext<OSStateContextType | undefined>(undefined);

export const OSStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOSActive, setIsOSActiveState] = React.useState(() => {
    return localStorage.getItem('isOSActive') === 'true';
  });

  const setOSActive = React.useCallback((active: boolean) => {
    setIsOSActiveState(active);
    localStorage.setItem('isOSActive', active.toString());
    // Dispatch custom event for other components to listen to
    window.dispatchEvent(new CustomEvent('os_state_changed', {
      detail: { isOSActive: active }
    }));
  }, []);

  return (
    <OSStateContext.Provider value={{ isOSActive, setOSActive }}>
      {children}
    </OSStateContext.Provider>
  );
};

export const useOSState = () => {
  const context = React.useContext(OSStateContext);
  if (context === undefined) {
    throw new Error('useOSState must be used within an OSStateProvider');
  }
  return context;
};

// Windows-like Start Menu Component
interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  onNavigateToAuth: () => void;
  user?: any;
}

export const StartMenu: React.FC<StartMenuProps> = ({ isOpen, onClose, onLogout, onNavigateToAuth, user }) => {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Start Menu */}
      <div
        className="fixed bottom-16 left-4 w-80 bg-[rgba(32,32,32,0.98)] backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden"
        style={{
          animation: 'slideUp 0.2s ease-out',
          opacity: 1,
          transform: 'translateY(0)'
        }}
      >
        {/* User Profile Section */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center">
              <User size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-medium">{user?.display_name || 'XenoLabs User'}</div>
              <div className="text-white/60 text-sm">{user?.email || 'user@xenolabs.local'}</div>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="py-2">
          <button
            className="w-full px-4 py-3 text-left text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-3"
            onClick={() => {
              console.log('Apps clicked');
              onClose();
            }}
          >
            <Grid3X3 size={18} />
            <span>All Apps</span>
          </button>

          <button
            className="w-full px-4 py-3 text-left text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-3"
            onClick={() => {
              console.log('Settings clicked');
              onClose();
            }}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>

          <button
            className="w-full px-4 py-3 text-left text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-3"
            onClick={onNavigateToAuth}
          >
            <User size={18} />
            <span>Switch User</span>
          </button>
        </div>

        {/* Power Options */}
        <div className="border-t border-white/10 py-2">
          <button
            className="w-full px-4 py-3 text-left text-red-400 hover:bg-red-500/20 transition-colors duration-200 flex items-center gap-3"
            onClick={onLogout}
          >
            <Power size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </>
  );
};

const OSAuthInterface: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const navigate = useNavigate();
  const { setOSActive } = useOSState();
  const { user } = useAuth();
  const [hoveredContainer, setHoveredContainer] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [deployedContainer, setDeployedContainer] = React.useState<any>(null);
  const [selectedContainer, setSelectedContainer] = React.useState<string | null>(null);
  const [isLoadingContainers, setIsLoadingContainers] = React.useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showDeleteButton, setShowDeleteButton] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<'local' | 'remote'>('local'); // Toggle between local and remote views

  // Fetch user's containers from the database on mount
  React.useEffect(() => {
    // Clear old localStorage container data to prevent conflicts
    localStorage.removeItem('deployedContainers');
    localStorage.removeItem('deployedContainer');
    localStorage.removeItem('newContainerAdded');

    const fetchUserContainers = async () => {
      console.log('🔄 OSAuthInterface: Starting to fetch user containers...');
      console.log('👤 Current user:', user);
      
      if (!user) {
        console.log('❌ No user found, skipping container fetch');
        setIsLoadingContainers(false);
        return;
      }

      try {
        setIsLoadingContainers(true);
        console.log('📡 Making API call to fetch containers...');
        const result = await ContainerService.listContainers(1, 10);
        console.log('📄 Container API result:', result);
        
        if ('containers' in result) {
          console.log(`✅ Found ${result.containers.length} containers`);
          if (result.containers.length > 0) {
            // Get the latest container (most recently created)
            const latestContainer = result.containers[result.containers.length - 1];
            console.log('🚀 Setting latest container:', latestContainer);
            setDeployedContainer(latestContainer);
          } else {
            console.log('📦 No containers found for user');
            setDeployedContainer(null);
          }
        } else if ('error' in result) {
          console.error('❌ Failed to fetch containers:', result.error);
        } else {
          console.error('❌ Unexpected API response format:', result);
        }
      } catch (error) {
        console.error('💥 Error fetching containers:', error);
      } finally {
        setIsLoadingContainers(false);
      }
    };

    fetchUserContainers();
  }, [user]);

  const handleSubmit = async () => {
    if (!deployedContainer?.id) {
      console.error('No container to launch');
      return;
    }

    setIsSubmitting(true);

    try {
      // Check if container is already running
      if (deployedContainer.status === 'running') {
        console.log('Container already running, proceeding to OS Home');
        // Set OS as active and navigate directly
        setOSActive(true);
        navigate('/os/home');
        return;
      }

      console.log('Starting container:', deployedContainer.id);
      const result = await ContainerService.startContainer(deployedContainer.id);

      if (result.success) {
        console.log('Container started successfully');
        // Set OS as active
        setOSActive(true);
        // Navigate to OS Home - now connected to the actual running container
        navigate('/os/home');
      } else {
        console.error('Failed to start container:', result.error);
        alert(`Failed to start container: ${result.error}`);
      }
    } catch (error) {
      console.error('Error starting container:', error);
      alert(`Error starting container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowDeleteButton(!showDeleteButton);
  };

  const handleRemoteContainerClick = () => {
    if (viewMode === 'local') {
      // Switch to remote view from local view (works with or without deployed container)
      setViewMode('remote');
    } else if (viewMode === 'remote') {
      // Switch back to local view when in remote view
      setViewMode('local');
    }
  };


  const handleDeleteContainer = async () => {
    if (!deployedContainer?.id) return;

    setIsDeleting(true);
    try {
      const result = await ContainerService.deleteContainer(deployedContainer.id);
      if (result.success) {
        // Remove container from state
        setDeployedContainer(null);
        console.log('Container deleted successfully');
      } else {
        console.error('Failed to delete container:', result.error);
        alert(`Failed to delete container: ${result.error}`);
      }
    } catch (error) {
      console.error('Delete container error:', error);
      alert('Failed to delete container. Please try again.');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setShowDeleteButton(false);
    }
  };


  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(10,10,10,0.96)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      {/* Container Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '32px',
          padding: '20px',
          height: '100vh',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
        }}
      >
        {/* Left Container Column - Container + Delete Button */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {/* Left Container - Deployed Container or User Profile */}
          <div
            style={{
              width: 180,
              height: 180,
              background: hoveredContainer === 'left'
                ? 'rgba(25,25,25,0.9)'
                : 'rgba(25,25,25,0.8)',
              borderRadius: 16,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              transition: 'all 0.2s ease-out',
              cursor: 'pointer',
              willChange: 'background',
              padding: '24px',
              border: deployedContainer ? '1px solid rgba(156,163,175,0.3)' : '1px solid rgba(156,163,175,0.1)',
              boxShadow: deployedContainer ? '0 10px 30px rgba(0,0,0,0.3)' : 'none',
            }}
            onMouseEnter={() => setHoveredContainer('left')}
            onMouseLeave={() => setHoveredContainer(null)}
            onClick={handleRemoteContainerClick}
          >
          {/* Conditional content based on viewMode */}
          {viewMode === 'local' ? (
            <>
              {/* Remote Container Icon when in local view */}
              <div
                style={{
                  marginBottom: '12px',
                  color: hoveredContainer === 'left'
                    ? 'rgba(156,163,175,1)'
                    : 'rgba(156,163,175,0.8)',
                  transition: 'color 0.15s ease-out',
                }}
              >
                <svg
                  width="52"
                  height="52"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M20 20c0-4.4-3.6-8-8-8s-8 3.6-8 8"/>
                </svg>
              </div>
              
              {/* Remote Container Label */}
              <div
                style={{
                  fontSize: 14,
                  color: hoveredContainer === 'left'
                    ? 'rgba(156,163,175,1)'
                    : 'rgba(156,163,175,0.7)',
                  textAlign: 'center',
                  transition: 'color 0.15s ease-out',
                  fontWeight: '500',
                  letterSpacing: '0.3px',
                }}
              >
                Remote Container
              </div>
            </>
          ) : (
            <>
              {/* Deployed Container Icon when in remote view */}
              <div
                style={{
                  marginBottom: '8px',
                  color: hoveredContainer === 'left'
                    ? 'rgba(156,163,175,1)'
                    : 'rgba(156,163,175,0.8)',
                  transition: 'color 0.15s ease-out',
                }}
              >
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              
              {/* Deployed Container Name */}
              <div
                style={{
                  fontSize: 12,
                  color: hoveredContainer === 'left'
                    ? 'rgba(156,163,175,1)'
                    : 'rgba(156,163,175,0.7)',
                  textAlign: 'center',
                  transition: 'color 0.15s ease-out',
                  fontWeight: '500',
                  letterSpacing: '0.3px',
                  lineHeight: 1.2,
                }}
              >
                {deployedContainer ? (deployedContainer.display_name || deployedContainer.name || 'My Container') : 'No Container'}
              </div>
            </>
          )}
          </div>

        </div>

        {/* Main Centered Container - Show when container exists in local view OR when in remote view */}
        {(deployedContainer && viewMode === 'local') || viewMode === 'remote' ? (
        <div
          style={{
            width: 360,
            height: 'auto',
            minHeight: 480,
            maxHeight: 550,
            background: 'rgba(32,32,32,0.95)',
            borderRadius: 20,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '24px 24px 20px 24px',
            backdropFilter: 'blur(25px)',
            WebkitBackdropFilter: 'blur(25px)',
            border: '1px solid rgba(156,163,175,0.1)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
            transition: 'all 0.3s ease-out',
          }}
          onContextMenu={(e) => {
            if (deployedContainer && viewMode === 'local') {
              handleRightClick(e);
            }
          }}
        >
            {viewMode === 'local' ? (
              <>
              {/* Local Container Launch Interface - Container Info */}
              <div
                style={{
                  width: '100%',
                  borderRadius: 12,
                  padding: '0px',
                  marginBottom: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                {/* Container Icon */}
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 14,
                    border: '2px solid rgba(156,163,175,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: '4px',
                    marginBottom: '16px',
                    transition: 'all 0.15s ease-out',
                    background: 'rgba(25,25,25,0.3)',
                  }}
                >
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      color: 'rgba(156,163,175,0.7)',
                      transition: 'color 0.15s ease-out',
                    }}
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                </div>

                {/* Container Details */}
                <div
                  style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    borderRadius: 8,
                    marginBottom: '18px',
                    background: 'rgba(25,25,25,0.2)',
                    border: '1px solid rgba(156,163,175,0.1)',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      color: 'rgba(156,163,175,0.9)',
                      fontSize: 18,
                      fontWeight: '600',
                      letterSpacing: '0.5px',
                      userSelect: 'none',
                      marginBottom: '8px',
                    }}
                  >
                    {deployedContainer.display_name || deployedContainer.name || deployedContainer.config?.template || 'Remote Container'}
                  </div>
                  <div
                    style={{
                      color: 'rgba(156,163,175,0.7)',
                      fontSize: 13,
                      fontWeight: '500',
                      letterSpacing: '0.3px',
                      userSelect: 'none',
                      marginBottom: '6px',
                    }}
                  >
                    {deployedContainer.resource_limits?.cpu_cores || deployedContainer.config?.cpu || 1} CPU • {deployedContainer.resource_limits?.memory_gb || deployedContainer.config?.memory || 2}GB RAM • {deployedContainer.resource_limits?.storage_gb || deployedContainer.config?.storage || 10}GB
                  </div>
                  <div
                    style={{
                      color: deployedContainer.status === 'running' ? 'rgba(34,197,94,0.8)' : 'rgba(156,163,175,0.6)',
                      fontSize: 14,
                      fontWeight: '600',
                    }}
                  >
                    Status: {deployedContainer.status || 'Active'}
                  </div>
                </div>
              </div>

              {/* Password Section */}
              <div
                style={{
                  width: '100%',
                  padding: '16px',
                  background: 'rgba(25,25,25,0.2)',
                  borderRadius: '12px',
                  border: '1px solid rgba(156,163,175,0.1)',
                  marginBottom: '12px',
                }}
              >
                
                {/* Launch Button */}
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    background: !isSubmitting
                      ? 'rgba(156,163,175,0.15)'
                      : 'rgba(156,163,175,0.05)',
                    border: '1px solid rgba(156,163,175,0.3)',
                    borderRadius: '8px',
                    color: !isSubmitting
                      ? 'rgba(156,163,175,0.9)'
                      : 'rgba(156,163,175,0.4)',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: !isSubmitting ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease-out',
                    letterSpacing: '0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSubmitting) {
                      e.currentTarget.style.background = 'rgba(156,163,175,0.25)';
                      e.currentTarget.style.color = 'white';
                      e.currentTarget.style.borderColor = 'rgba(156,163,175,0.4)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSubmitting) {
                      e.currentTarget.style.background = 'rgba(156,163,175,0.15)';
                      e.currentTarget.style.color = 'rgba(156,163,175,0.9)';
                      e.currentTarget.style.borderColor = 'rgba(156,163,175,0.3)';
                    }
                  }}
                >
                  {isSubmitting ? (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{
                        animation: 'spin 1s linear infinite',
                      }}
                    >
                      <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.5 0 4.74 1.02 6.36 2.68"/>
                    </svg>
                  ) : (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>Connect to Container</span>
                    </>
                  )}
                </button>
              </div>


          {/* Delete Button for Deployed Container */}
          <div
            style={{
              height: '36px', // Reserve space for the button
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '12px',
            }}
          >
            {showDeleteButton && (
              <button
                style={{
                  padding: '8px 16px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '8px',
                  color: 'rgba(239,68,68,0.9)',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  minWidth: '100px',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.2)';
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)';
                  e.currentTarget.style.color = 'rgba(239,68,68,1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
                  e.currentTarget.style.color = 'rgba(239,68,68,0.9)';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                title="Delete this container permanently"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 6h18l-2 13H5L3 6z"/>
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
                Delete
              </button>
            )}
          </div>
              </>
            ) : (
              <>
              {/* Join via Share Link Info */}
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 14,
                    border: '2px solid rgba(156,163,175,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '20px',
                    background: 'rgba(25,25,25,0.3)',
                  }}
                >
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ color: 'rgba(156,163,175,0.7)' }}
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>

                <div
                  style={{
                    color: 'rgba(156,163,175,0.9)',
                    fontSize: 18,
                    fontWeight: '600',
                    textAlign: 'center',
                    marginBottom: '8px',
                    letterSpacing: '0.5px',
                  }}
                >
                  Join Collaboration
                </div>

                <div
                  style={{
                    color: 'rgba(156,163,175,0.6)',
                    fontSize: 13,
                    textAlign: 'center',
                    marginBottom: '24px',
                    lineHeight: '1.5',
                    letterSpacing: '0.3px',
                  }}
                >
                  Ask your friend to share their collaboration link with you.
                  Simply open the link in your browser to join their workspace.
                </div>

                <button
                  onClick={() => setViewMode('local')}
                  style={{
                    padding: '10px 20px',
                    background: 'rgba(156,163,175,0.1)',
                    border: '1px solid rgba(156,163,175,0.2)',
                    borderRadius: '8px',
                    color: 'rgba(156,163,175,0.8)',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(156,163,175,0.15)';
                    e.currentTarget.style.borderColor = 'rgba(156,163,175,0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(156,163,175,0.1)';
                    e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                  }}
                >
                  ← Back to My Container
                </button>
              </>
            )}
        </div>
        ) : null}

        {/* Right Container - Container Management */}
        <div
          style={{
            width: 180,
            height: 180,
            background: hoveredContainer === 'right'
              ? 'rgba(25,25,25,0.9)'
              : 'rgba(25,25,25,0.8)',
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            transition: 'all 0.2s ease-out',
            cursor: 'pointer',
            willChange: 'background',
            padding: '24px',
            border: '1px solid rgba(156,163,175,0.1)',
          }}
          onMouseEnter={() => setHoveredContainer('right')}
          onMouseLeave={() => setHoveredContainer(null)}
          onClick={() => navigate('/os/container-wizard')}
          title="Create New Container - Phase 1 Foundation"
        >
          {/* Container Icon */}
          <div
            style={{
              marginBottom: '12px',
              color: hoveredContainer === 'right'
                ? 'rgba(156,163,175,1)'
                : 'rgba(156,163,175,0.8)',
              transition: 'color 0.15s ease-out',
            }}
          >
            <svg
              width="38"
              height="38"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
          
          {/* Plus Icon */}
          <div
            style={{
              fontSize: 28,
              color: hoveredContainer === 'right'
                ? 'rgba(156,163,175,1)'
                : 'rgba(156,163,175,0.8)',
              fontWeight: 'bold',
              userSelect: 'none',
              transition: 'color 0.15s ease-out',
              willChange: 'color',
              marginBottom: '8px',
            }}
          >
            +
          </div>
          
          {/* Label */}
          <div
            style={{
              fontSize: 14,
              color: hoveredContainer === 'right'
                ? 'rgba(156,163,175,1)'
                : 'rgba(156,163,175,0.7)',
              textAlign: 'center',
              transition: 'color 0.15s ease-out',
              fontWeight: '500',
              letterSpacing: '0.3px',
            }}
          >
            Containers
          </div>
        </div>
      </div>

      {/* Settings Button - Bottom Left */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '24px',
          zIndex: 10001,
        }}
      >
        <button
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '8px',
            background: 'rgba(32,32,32,0.9)',
            border: '2px solid rgba(156,163,175,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease-out',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(32,32,32,1)';
            e.currentTarget.style.borderColor = 'rgba(156,163,175,0.6)';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(32,32,32,0.9)';
            e.currentTarget.style.borderColor = 'rgba(156,163,175,0.3)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onClick={() => {
            console.log('Settings clicked - navigating to containers');
            navigate('/os/containers');
          }}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings
            size={20}
            style={{
              color: 'rgba(156,163,175,0.8)',
              transition: 'color 0.15s ease-out',
            }}
          />
        </button>
      </div>

      {/* Power Button - Bottom Right */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 10001,
        }}
      >
        <button
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '8px',
            background: 'rgba(32,32,32,0.9)',
            border: '2px solid rgba(156,163,175,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease-out',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(32,32,32,1)';
            e.currentTarget.style.borderColor = 'rgba(156,163,175,0.6)';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(32,32,32,0.9)';
            e.currentTarget.style.borderColor = 'rgba(156,163,175,0.3)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onClick={() => {
            console.log('Exit OS Auth clicked');
            navigate('/overview');
          }}
          title="Exit OS Auth"
          aria-label="Exit OS Auth and return to overview"
        >
          <LogOut
            size={20}
            style={{
              color: 'rgba(156,163,175,0.8)',
              transition: 'color 0.15s ease-out',
            }}
          />
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 10003,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={() => setShowDeleteConfirm(false)}
          />

          {/* Dialog */}
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10004,
              background: 'rgba(32,32,32,0.95)',
              borderRadius: '16px',
              border: '1px solid rgba(156,163,175,0.3)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '32px',
              minWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'rgba(239,68,68,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgb(239,68,68)"
                  strokeWidth="2"
                >
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
            </div>

            {/* Title */}
            <h3
              style={{
                color: 'rgba(156,163,175,0.95)',
                fontSize: '20px',
                fontWeight: '600',
                textAlign: 'center',
                marginBottom: '12px',
                letterSpacing: '0.3px',
              }}
            >
              Delete Remote Container
            </h3>

            {/* Message */}
            <p
              style={{
                color: 'rgba(156,163,175,0.8)',
                fontSize: '14px',
                textAlign: 'center',
                marginBottom: '24px',
                lineHeight: '1.5',
              }}
            >
              Are you sure you want to permanently delete this remote container?{' '}
              <strong style={{ color: 'rgba(156,163,175,0.95)' }}>
                {deployedContainer?.display_name || deployedContainer?.name || 'Remote Container'}
              </strong>
              <br />
              This action cannot be undone and all data will be lost.
            </p>

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
              }}
            >
              <button
                style={{
                  padding: '12px 24px',
                  background: 'rgba(156,163,175,0.1)',
                  border: '1px solid rgba(156,163,175,0.3)',
                  borderRadius: '8px',
                  color: 'rgba(156,163,175,0.9)',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-out',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(156,163,175,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(156,163,175,0.1)';
                }}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '12px 24px',
                  background: 'rgba(239,68,68,0.9)',
                  border: '1px solid rgba(239,68,68,0.9)',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease-out',
                  opacity: isDeleting ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.background = 'rgba(220,38,38,0.9)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDeleting) {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.9)';
                  }
                }}
                onClick={handleDeleteContainer}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ animation: 'spin 1s linear infinite' }}
                    >
                      <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.5 0 4.74 1.02 6.36 2.68"/>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  'Delete Remote Container'
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default OSAuthInterface;
