import * as React from 'react';
import { 
  Settings as SettingsIcon,
  Wifi,
  Monitor,
  Palette,
  Bell,
  Shield,
  User,
  HardDrive,
  Globe,
  Keyboard,
  Volume2,
  Battery,
  Info,
  ChevronRight,
  Search,
  X,
  Check,
  UserPlus,
  Mail,
  Clock,
  AlertCircle,
  Folder,
  FileText,
  Image,
  Music,
  Video,
  Database,
  Package
} from 'lucide-react';
import { authService } from '../../../services/authService';
import { useAuth } from '../../../contexts/AuthContext';
import { ContainerService } from '../../../services/containerService';

// Function to get real storage breakdown from container
async function getRealStorageBreakdown(containerId: string) {
  try {
    console.log('🔍 Analyzing real filesystem in container:', containerId);
    
    // Execute storage analysis commands inside the container
    const response = await fetch('/api/containers/' + containerId + '/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          'du -s /var/log 2>/dev/null || echo "0"',
          'du -s /tmp 2>/dev/null || echo "0"',  
          'du -s /usr 2>/dev/null || echo "0"',
          'du -s /home 2>/dev/null || echo "0"',
          'du -s /root 2>/dev/null || echo "0"',
          'du -s /opt 2>/dev/null || echo "0"'
        ]
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('📊 Container exec results:', data);
      
      // Parse the results and convert to bytes
      const parseSize = (output: string) => {
        const match = output.match(/^(\d+)/);
        return match ? parseInt(match[1]) * 1024 : 0; // du returns KB, convert to bytes
      };
      
      return {
        logs: parseSize(data.results[0] || '0'),
        temp: parseSize(data.results[1] || '0'), 
        system: parseSize(data.results[2] || '0'),
        home: parseSize(data.results[3] || '0'),
        root: parseSize(data.results[4] || '0'),
        applications: parseSize(data.results[5] || '0')
      };
    }
  } catch (error) {
    console.error('❌ Failed to get real storage breakdown:', error);
  }
  
  return null;
}

interface SettingsCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

interface NetworkInvitation {
  id: string;
  from: string;
  resource: string;
  type: 'file' | 'folder' | 'container';
  permissions: 'read' | 'write' | 'admin';
  timestamp: string;
  status: 'pending' | 'accepted' | 'rejected';
}

const Settings: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = React.useState<string>('system');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [invitations, setInvitations] = React.useState<NetworkInvitation[]>([]);
  const [showInviteModal, setShowInviteModal] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [invitePermission, setInvitePermission] = React.useState<'read' | 'write' | 'admin'>('read');
  
  const user = authService.getCurrentUser();
  const [storageData, setStorageData] = React.useState<any>(null);
  const [loadingStorage, setLoadingStorage] = React.useState(false);
  const [containerInfo, setContainerInfo] = React.useState<any>(null);

  // Mock invitations - in production would come from API
  React.useEffect(() => {
    const mockInvitations: NetworkInvitation[] = [
      {
        id: 'inv-1',
        from: 'alice@xenoos.io',
        resource: 'Project Files',
        type: 'folder',
        permissions: 'write',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        status: 'pending'
      },
      {
        id: 'inv-2',
        from: 'bob@xenoos.io',
        resource: 'Development Container',
        type: 'container',
        permissions: 'read',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        status: 'pending'
      }
    ];
    setInvitations(mockInvitations);
  }, []);

  // Fetch container storage data
  React.useEffect(() => {
    const fetchContainerStorage = async () => {
      console.log('🔄 Storage Effect triggered:', { selectedCategory, loadingStorage, userId: user?.id });
      
      if (loadingStorage || !user?.id) {
        console.log('❌ Storage fetch blocked:', { loadingStorage, userId: user?.id });
        return;
      }
      
      console.log('🚀 Starting storage fetch...');
      setLoadingStorage(true);
      try {
        // First get user's containers
        console.log('📦 Calling ContainerService.listContainers...');
        const containersResult = await ContainerService.listContainers(1, 1);
        console.log('📦 Containers result:', containersResult);
        
        if ('containers' in containersResult && containersResult.containers.length > 0) {
          const activeContainer = containersResult.containers[0]; // Get the most recent container
          console.log('🎯 Active container found:', activeContainer);
          setContainerInfo(activeContainer);
          
          // Get container stats for real storage data
          console.log('📊 Calling ContainerService.getContainerStats with ID:', activeContainer.id);
          const statsResult = await ContainerService.getContainerStats(activeContainer.id);
          console.log('📊 Stats result:', statsResult);
          
          if (statsResult && statsResult.success) {
            console.log('✅ Using real stats data:', statsResult.data);
            // Transform real stats data to expected format
            const realStats = statsResult.data;
            console.log('🔍 Real stats structure:', JSON.stringify(realStats, null, 2));
            const storageStats = realStats.usage?.storage || realStats.usage?.filesystem || {};
            console.log('🔍 Storage stats extracted:', storageStats);
            
            // Extract storage values - handle different possible formats
            let totalBytes = 0;
            let usedBytes = 0;
            
            if (storageStats.total && storageStats.used) {
              totalBytes = storageStats.total;
              usedBytes = storageStats.used;
            } else if (storageStats.size && storageStats.free) {
              totalBytes = storageStats.size;
              usedBytes = totalBytes - storageStats.free;
            } else if (activeContainer.config?.storage) {
              // Fallback to container limits
              totalBytes = activeContainer.config.storage * 1024 * 1024 * 1024;
              usedBytes = Math.floor(totalBytes * 0.4); // Assume 40% used
            } else {
              // Default fallback
              totalBytes = 10 * 1024 * 1024 * 1024; // 10GB
              usedBytes = Math.floor(totalBytes * 0.4);
            }
            
            console.log('📊 Parsed storage values:', { totalBytes, usedBytes });
            
            // Get real storage breakdown from container
            console.log('📁 Fetching real storage breakdown from container...');
            const storageBreakdown = await getRealStorageBreakdown(activeContainer.id);
            console.log('📁 Real storage breakdown:', storageBreakdown);
            
            const formattedStorageData = {
              total: totalBytes,
              used: usedBytes,
              available: totalBytes - usedBytes,
              breakdown: storageBreakdown || {
                system: Math.floor(usedBytes * 0.4),
                applications: Math.floor(usedBytes * 0.2),
                temp: Math.floor(usedBytes * 0.15),
                logs: Math.floor(usedBytes * 0.1),
                cache: Math.floor(usedBytes * 0.1),
                other: Math.floor(usedBytes * 0.05)
              }
            };
            
            console.log('💾 Formatted storage data:', formattedStorageData);
            console.log('🎯 About to call setStorageData with formatted data');
            setStorageData(formattedStorageData);
            console.log('✅ setStorageData called successfully');
          } else {
            console.log('⚠️ Stats failed, creating mock storage data...');
            // Mock storage data with realistic breakdown
            const totalStorage = activeContainer.config?.storage || 10;
            const usedStorage = Math.floor(totalStorage * (0.3 + Math.random() * 0.4)); // 30-70% used
            console.log('📏 Mock storage calculations:', { totalStorage, usedStorage });
            
            const mockStorageData = {
              total: totalStorage * 1024 * 1024 * 1024, // Convert to bytes
              used: usedStorage * 1024 * 1024 * 1024,
              available: (totalStorage - usedStorage) * 1024 * 1024 * 1024,
              breakdown: {
                system: Math.floor(usedStorage * 0.25) * 1024 * 1024 * 1024,
                applications: Math.floor(usedStorage * 0.2) * 1024 * 1024 * 1024,
                documents: Math.floor(usedStorage * 0.15) * 1024 * 1024 * 1024,
                images: Math.floor(usedStorage * 0.1) * 1024 * 1024 * 1024,
                videos: Math.floor(usedStorage * 0.15) * 1024 * 1024 * 1024,
                music: Math.floor(usedStorage * 0.05) * 1024 * 1024 * 1024,
                other: Math.floor(usedStorage * 0.1) * 1024 * 1024 * 1024
              }
            };
            console.log('📦 Setting mock storage data:', mockStorageData);
            setStorageData(mockStorageData);
          }
        } else {
          console.log('❌ No containers found or failed to fetch:', containersResult);
        }
      } catch (error) {
        console.error('❌ Failed to fetch container storage data:', error);
      } finally {
        console.log('✅ Storage fetch complete, setting loadingStorage to false');
        setLoadingStorage(false);
      }
    };

    if (selectedCategory === 'storage' && !loadingStorage) {
      fetchContainerStorage();
    }
  }, [user?.id, selectedCategory]);

  const categories: SettingsCategory[] = [
    { id: 'system', name: 'System', icon: <Monitor size={20} />, description: 'Display, sound, notifications, power' },
    { id: 'network', name: 'Network & Sharing', icon: <Wifi size={20} />, description: 'Wi-Fi, ethernet, VPN, sharing' },
    { id: 'personalization', name: 'Personalization', icon: <Palette size={20} />, description: 'Background, colors, themes, taskbar' },
    { id: 'accounts', name: 'Accounts', icon: <User size={20} />, description: 'Your info, email, sign-in options' },
    { id: 'privacy', name: 'Privacy & Security', icon: <Shield size={20} />, description: 'Location, camera, microphone' },
    { id: 'storage', name: 'Storage', icon: <HardDrive size={20} />, description: 'Storage space, drives, backup' },
    { id: 'accessibility', name: 'Accessibility', icon: <Globe size={20} />, description: 'Vision, hearing, interaction' },
    { id: 'about', name: 'About', icon: <Info size={20} />, description: 'System info, version, updates' }
  ];

  const filteredCategories = categories.filter(cat => 
    cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cat.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sidebarItemStyle = (isActive: boolean) => ({
    padding: '12px 16px',
    background: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '4px',
    transition: 'all 0.2s',
    border: '1px solid ' + (isActive ? 'rgba(255, 255, 255, 0.15)' : 'transparent')
  });

  const handleAcceptInvitation = (id: string) => {
    setInvitations(prev => 
      prev.map(inv => inv.id === id ? { ...inv, status: 'accepted' } : inv)
    );
  };

  const handleRejectInvitation = (id: string) => {
    setInvitations(prev => 
      prev.map(inv => inv.id === id ? { ...inv, status: 'rejected' } : inv)
    );
  };

  const handleSendInvite = () => {
    if (!inviteEmail) return;
    
    console.log('Sending invite to:', inviteEmail, 'with permission:', invitePermission);
    setShowInviteModal(false);
    setInviteEmail('');
    setInvitePermission('read');
  };

  const renderSystemSettings = () => (
    <div>
      <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'rgba(255, 255, 255, 0.95)' }}>
        System
      </h2>
      
      <div style={{ display: 'grid', gap: '16px' }}>
        {/* Display Settings */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <Monitor size={24} style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>Display</div>
                <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                  Resolution, brightness, night light
                </div>
              </div>
            </div>
            <ChevronRight size={20} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
          </div>
        </div>

        {/* Sound Settings */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <Volume2 size={24} style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>Sound</div>
                <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                  Volume, output device, system sounds
                </div>
              </div>
            </div>
            <ChevronRight size={20} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
          </div>
        </div>

        {/* Notifications */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <Bell size={24} style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>Notifications</div>
                <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                  Alerts, sounds, focus assist
                </div>
              </div>
            </div>
            <ChevronRight size={20} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
          </div>
        </div>

        {/* Power */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <Battery size={24} style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>Power & Battery</div>
                <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                  Sleep, battery saver, performance
                </div>
              </div>
            </div>
            <ChevronRight size={20} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderNetworkSettings = () => (
    <div>
      <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'rgba(255, 255, 255, 0.95)' }}>
        Network & Sharing
      </h2>

      {/* Pending Invitations */}
      {invitations.filter(inv => inv.status === 'pending').length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: 'rgba(255, 255, 255, 0.9)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Mail size={18} />
            Pending Invitations
            <span style={{
              padding: '2px 8px',
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.8)'
            }}>
              {invitations.filter(inv => inv.status === 'pending').length}
            </span>
          </h3>

          {invitations.filter(inv => inv.status === 'pending').map(invitation => (
            <div key={invitation.id} style={{
              padding: '16px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              marginBottom: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>
                    {invitation.from} wants to share "{invitation.resource}"
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                    Type: {invitation.type} • Permission: {invitation.permissions} • 
                    <Clock size={10} style={{ display: 'inline', marginLeft: '4px', marginRight: '2px' }} />
                    {new Date(invitation.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleAcceptInvitation(invitation.id)}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px',
                      color: 'rgba(255, 255, 255, 0.9)',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    }}
                  >
                    <Check size={14} />
                    Accept
                  </button>
                  <button
                    onClick={() => handleRejectInvitation(invitation.id)}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    }}
                  >
                    <X size={14} />
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Network Actions */}
      <div style={{ display: 'grid', gap: '16px' }}>
        {/* Send Invitation */}
        <div 
          onClick={() => setShowInviteModal(true)}
          style={{
            padding: '20px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <UserPlus size={24} style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>Send Invitation</div>
                <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                  Invite users to share resources
                </div>
              </div>
            </div>
            <ChevronRight size={20} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
          </div>
        </div>

        {/* Network Status */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(156, 163, 175, 0.1)'
        }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <Wifi size={24} style={{ color: 'rgba(34, 197, 94, 0.8)' }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>Network Status</div>
              <div style={{ fontSize: '13px', color: 'rgba(34, 197, 94, 0.8)', marginTop: '4px' }}>
                Connected to XenoOS Network
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderStorageSettings = () => {
    const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const getStoragePercentage = () => {
      if (!storageData) return 0;
      return Math.round((storageData.used / storageData.total) * 100);
    };

    const createStorageBar = (percentage: number, color: string) => {
      return (
        <div style={{
          width: '100%',
          height: '6px',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '3px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          <div style={{
            width: `${percentage}%`,
            height: '100%',
            background: color,
            borderRadius: '3px',
            transition: 'width 0.3s ease'
          }} />
        </div>
      );
    };

    if (loadingStorage) {
      return (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          height: '200px',
          color: 'rgba(156, 163, 175, 0.6)'
        }}>
          <HardDrive size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
          <p style={{ fontSize: '16px' }}>Loading storage information...</p>
        </div>
      );
    }

    if (!containerInfo || !storageData) {
      return (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          height: '200px',
          color: 'rgba(156, 163, 175, 0.6)'
        }}>
          <AlertCircle size={48} style={{ marginBottom: '16px' }} />
          <p style={{ fontSize: '16px' }}>No active container found</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>Create a container to view storage details</p>
        </div>
      );
    }

    const storageCategories = [
      { name: 'System (/usr)', icon: <Database size={20} />, bytes: storageData?.breakdown?.system || 0, color: '#3b82f6' },
      { name: 'Applications (/opt)', icon: <Package size={20} />, bytes: storageData?.breakdown?.applications || 0, color: '#10b981' },
      { name: 'User files (/home)', icon: <FileText size={20} />, bytes: storageData?.breakdown?.home || 0, color: '#f59e0b' },
      { name: 'Root directory', icon: <HardDrive size={20} />, bytes: storageData?.breakdown?.root || 0, color: '#ef4444' },
      { name: 'Temporary (/tmp)', icon: <Folder size={20} />, bytes: storageData?.breakdown?.temp || 0, color: '#e8e3dc' },
      { name: 'Log files (/var/log)', icon: <FileText size={20} />, bytes: storageData?.breakdown?.logs || 0, color: '#06b6d4' },
      { name: 'Cache & other', icon: <Package size={20} />, bytes: storageData?.breakdown?.other || 0, color: '#6b7280' }
    ];

    return (
      <div>
        <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'rgba(255, 255, 255, 0.95)' }}>
          Storage
        </h2>

        {/* Container Info Header */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <HardDrive size={24} style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: 'rgba(255, 255, 255, 0.95)' }}>
                {containerInfo.display_name || containerInfo.name || 'My Container'}
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)' }}>
                Container Storage Overview
              </div>
            </div>
          </div>

          {/* Storage Overview with Circular Progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* Circular Progress */}
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
              <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke="rgba(255, 255, 255, 0.1)"
                  strokeWidth="8"
                  fill="none"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke={getStoragePercentage() > 80 ? '#ef4444' : getStoragePercentage() > 60 ? '#f59e0b' : '#10b981'}
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={`${(getStoragePercentage() / 100) * 314} 314`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.5s ease' }}
                />
              </svg>
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '18px', fontWeight: '700', color: 'rgba(255, 255, 255, 0.95)' }}>
                  {getStoragePercentage()}%
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>
                  Used
                </div>
              </div>
            </div>

            {/* Storage Details */}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.7)' }}>Total capacity</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(255, 255, 255, 0.95)' }}>
                    {formatBytes(storageData.total)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.7)' }}>Used space</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(255, 255, 255, 0.95)' }}>
                    {formatBytes(storageData.used)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.7)' }}>Available</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(34, 197, 94, 0.8)' }}>
                    {formatBytes(storageData.available)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Storage Breakdown */}
        <div style={{
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <h3 style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: 'rgba(255, 255, 255, 0.95)', 
            marginBottom: '20px' 
          }}>
            Storage breakdown
          </h3>

          <div style={{ display: 'grid', gap: '16px' }}>
            {storageCategories.map((category, index) => {
              const percentage = storageData.total > 0 ? Math.round((category.bytes / storageData.total) * 100) : 0;
              return (
                <div key={index} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                }}>
                  <div style={{ color: category.color }}>
                    {category.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>
                        {category.name}
                      </span>
                      <span style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)' }}>
                        {formatBytes(category.bytes)} ({percentage}%)
                      </span>
                    </div>
                    {createStorageBar(percentage, category.color)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderAboutSettings = () => (
    <div>
      <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'rgba(255, 255, 255, 0.95)' }}>
        About
      </h2>

      <div style={{
        padding: '24px',
        background: 'rgba(31, 41, 55, 0.5)',
        borderRadius: '12px',
        border: '1px solid rgba(156, 163, 175, 0.1)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            margin: '0 auto 16px',
            background: 'rgba(156, 163, 175, 0.1)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <SettingsIcon size={40} style={{ color: 'rgba(156, 163, 175, 0.8)' }} />
          </div>
          <h3 style={{ fontSize: '20px', fontWeight: '600', color: 'rgba(255, 255, 255, 0.95)' }}>XenoOS</h3>
          <p style={{ fontSize: '14px', color: 'rgba(156, 163, 175, 0.7)', marginTop: '4px' }}>Version 2.0.0</p>
        </div>

        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Edition</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>XenoOS Professional</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>User</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>{user?.email || 'guest@xenoos.io'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>System Type</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>64-bit operating system</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Container ID</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>XENO-{Date.now().toString(36).toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (selectedCategory) {
      case 'system':
        return renderSystemSettings();
      case 'network':
        return renderNetworkSettings();
      case 'storage':
        return renderStorageSettings();
      case 'about':
        return renderAboutSettings();
      default:
        return (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            color: 'rgba(156, 163, 175, 0.6)'
          }}>
            <AlertCircle size={48} style={{ marginBottom: '16px' }} />
            <p style={{ fontSize: '16px' }}>This section is coming soon</p>
          </div>
        );
    }
  };

  return (
    <>
      <div style={{
        display: 'flex',
        height: '100%',
        background: 'rgba(20, 20, 20, 0.98)',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        {/* Sidebar */}
        <div style={{
          width: '280px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRight: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '20px',
          overflowY: 'auto'
        }}>
          {/* Search */}
          <div style={{
            position: 'relative',
            marginBottom: '24px'
          }}>
            <Search size={18} style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(255, 255, 255, 0.5)'
            }} />
            <input
              type="text"
              placeholder="Find a setting"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 40px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '13px',
                outline: 'none'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                e.target.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                e.target.style.background = 'rgba(255, 255, 255, 0.08)';
              }}
            />
          </div>

          {/* Categories */}
          <div>
            {filteredCategories.map(category => (
              <div
                key={category.id}
                style={sidebarItemStyle(selectedCategory === category.id)}
                onClick={() => setSelectedCategory(category.id)}
                onMouseEnter={(e) => {
                  if (selectedCategory !== category.id) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedCategory !== category.id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                  {category.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: '500',
                    color: selectedCategory === category.id ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.8)'
                  }}>
                    {category.name}
                  </div>
                  <div style={{ 
                    fontSize: '11px', 
                    color: 'rgba(255, 255, 255, 0.5)',
                    marginTop: '2px'
                  }}>
                    {category.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div style={{
          flex: 1,
          padding: '32px',
          overflowY: 'auto'
        }}>
          {renderContent()}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            width: '400px',
            background: 'rgba(25, 25, 25, 0.95)',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            backdropFilter: 'blur(20px)',
            padding: '24px'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: 'rgba(255, 255, 255, 0.95)',
              marginBottom: '20px'
            }}>
              Send Invitation
            </h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                color: 'rgba(255, 255, 255, 0.5)',
                marginBottom: '8px'
              }}>
                Email Address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                color: 'rgba(255, 255, 255, 0.5)',
                marginBottom: '8px'
              }}>
                Permission Level
              </label>
              <select
                value={invitePermission}
                onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write' | 'admin')}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              >
                <option value="read">Read Only</option>
                <option value="write">Read & Write</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleSendInvite}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(156, 163, 175, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(156, 163, 175, 0.2)';
                }}
              >
                Send Invitation
              </button>
              <button
                onClick={() => setShowInviteModal(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  color: 'rgba(156, 163, 175, 0.9)',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(156, 163, 175, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(156, 163, 175, 0.3)';
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Settings;
