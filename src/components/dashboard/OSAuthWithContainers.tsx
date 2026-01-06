import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerConfigWizard } from './ContainerConfigWizard';
import { authService } from '../../services/authService';
import { 
  Server, 
  Plus, 
  Settings, 
  Play, 
  Square, 
  Monitor,
  DollarSign,
  Users,
  Clock,
  Activity,
  ArrowLeft,
  User
} from 'lucide-react';

interface ContainerInstance {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  config: {
    storage: number;
    cpu: number;
    memory: number;
    maxUsers: number;
    languages: string[];
  };
  cost: number;
  uptime: string;
  activeUsers: number;
  createdAt: string;
}

export const OSAuthWithContainers: React.FC = () => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const [showConfigWizard, setShowConfigWizard] = useState(false);
  const [containers, setContainers] = useState<ContainerInstance[]>([]);
  
  // Load user's containers on mount
  useEffect(() => {
    if (user) {
      // Load containers from localStorage for this user
      const storedContainers = localStorage.getItem(`containers_${user.id}`);
      if (storedContainers) {
        setContainers(JSON.parse(storedContainers));
      } else {
        // Initialize with default container for new users
        setContainers([
    {
      id: 'container-1',
      name: 'Development Environment',
      status: 'running',
      config: {
        storage: 100,
        cpu: 4,
        memory: 8,
        maxUsers: 3,
        languages: ['Node.js', 'Python']
      },
      cost: 45.00,
      uptime: '2d 14h',
      activeUsers: 1,
      createdAt: '2024-01-15'
    }]);
      }
    }
  }, [user]);
  
  // Save containers when they change
  useEffect(() => {
    if (user && containers.length > 0) {
      localStorage.setItem(`containers_${user.id}`, JSON.stringify(containers));
    }
  }, [containers, user]);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  
  // Set initial selected container
  useEffect(() => {
    if (containers.length > 0 && !selectedContainer) {
      setSelectedContainer(containers[0].id);
    }
  }, [containers, selectedContainer]);

  const handleCreateContainer = (config: any) => {
    const newContainer: ContainerInstance = {
      id: `container-${Date.now()}`,
      name: `New Container ${containers.length + 1}`,
      status: 'starting',
      config: {
        storage: config.storage,
        cpu: config.cpu,
        memory: config.memory,
        maxUsers: config.maxUsers,
        languages: Object.entries(config.languages)
          .filter(([_, enabled]) => enabled)
          .map(([lang, _]) => lang)
      },
      cost: calculatePrice(config),
      uptime: '0m',
      activeUsers: 0,
      createdAt: new Date().toISOString().split('T')[0]
    };

    setContainers(prev => [...prev, newContainer]);
    setSelectedContainer(newContainer.id);
    setShowConfigWizard(false);
    
    // Simulate container startup
    setTimeout(() => {
      setContainers(prev => 
        prev.map(c => 
          c.id === newContainer.id ? { ...c, status: 'running' } : c
        )
      );
    }, 2000);
  };

  const calculatePrice = (config: any) => {
    const resources = (config.storage * 0.1) + (config.cpu * 3) + (config.memory * 2.5);
    const languages = Object.values(config.languages).filter(Boolean).length * 2.5;
    const collaboration = config.maxUsers * 2;
    const advanced = 
      (config.backups ? 5 : 0) + 
      (config.encryption ? 3 : 0) + 
      (config.prioritySupport ? 10 : 0);
    return resources + languages + collaboration + advanced;
  };

  const handleContainerAction = (containerId: string, action: 'start' | 'stop' | 'restart') => {
    setContainers(prev =>
      prev.map(c =>
        c.id === containerId
          ? { ...c, status: action === 'start' ? 'starting' : 'stopping' }
          : c
      )
    );

    setTimeout(() => {
      setContainers(prev =>
        prev.map(c =>
          c.id === containerId
            ? { ...c, status: action === 'stop' ? 'stopped' : 'running' }
            : c
        )
      );
    }, 1500);
  };


  const selectedContainerData = containers.find(c => c.id === selectedContainer);
  const totalMonthlyCost = containers.reduce((sum, c) => sum + c.cost, 0);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'rgba(10,10,10,0.96)',
        padding: '32px',
        fontFamily: "'Inter', sans-serif",
        color: 'rgba(156,163,175,0.9)',
      }}
    >
      {/* Particle background */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        {Array.from({ length: 15 }).map((_, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              borderRadius: '50%',
              background: 'white',
              opacity: 0.1,
              width: `${Math.random() * 4 + 1}px`,
              height: `${Math.random() * 4 + 1}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `float ${Math.random() * 10 + 10}s infinite ease-in-out`,
              animationDelay: `${Math.random() * 5}s`
            }}
          />
        ))}
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Navigation Header */}
        <div style={{ marginBottom: '32px' }}>
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '24px',
              padding: '20px 24px',
              background: 'rgba(32,32,32,0.95)',
              borderRadius: '16px',
              backdropFilter: 'blur(25px)',
              WebkitBackdropFilter: 'blur(25px)',
              border: '1px solid rgba(156,163,175,0.1)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                onClick={() => navigate('/os/connect')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 16px',
                  background: 'rgba(25,25,25,0.8)',
                  border: '1px solid rgba(156,163,175,0.2)',
                  borderRadius: '10px',
                  color: 'rgba(156,163,175,0.8)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-out',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(25,25,25,1)';
                  e.currentTarget.style.color = 'rgba(156,163,175,1)';
                  e.currentTarget.style.borderColor = 'rgba(156,163,175,0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(25,25,25,0.8)';
                  e.currentTarget.style.color = 'rgba(156,163,175,0.8)';
                  e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                }}
              >
                <ArrowLeft style={{ width: '16px', height: '16px' }} />
                <span>Back to OS Auth</span>
              </button>
              <div style={{ width: '1px', height: '24px', background: 'rgba(156,163,175,0.2)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User style={{ width: '18px', height: '18px', color: 'rgba(156,163,175,0.6)' }} />
                <span style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)', fontWeight: '500' }}>
                  {user ? `${user.display_name}'s Workspace` : 'XenoOS Session'}
                </span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'rgba(156,163,175,0.9)', marginBottom: '4px' }}>
                ${totalMonthlyCost.toFixed(2)}/month
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)' }}>Total cost across all containers</div>
            </div>
          </div>
        </div>

        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <div 
            style={{
              textAlign: 'center',
              marginBottom: '32px',
              padding: '32px',
              background: 'rgba(32,32,32,0.95)',
              borderRadius: '20px',
              backdropFilter: 'blur(25px)',
              WebkitBackdropFilter: 'blur(25px)',
              border: '1px solid rgba(156,163,175,0.1)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
            }}
          >
            <h1 
              style={{
                fontSize: '36px',
                fontWeight: 'bold',
                color: 'rgba(156,163,175,0.95)',
                marginBottom: '12px',
                letterSpacing: '-0.5px',
              }}
            >
              XenoOS Container Management
            </h1>
            <p 
              style={{
                fontSize: '16px',
                color: 'rgba(156,163,175,0.7)',
                fontWeight: '500',
                letterSpacing: '0.3px',
              }}
            >
              Manage your development environments with dynamic provisioning
            </p>
            <div 
              style={{
                marginTop: '20px',
                padding: '12px 20px',
                background: 'rgba(25,25,25,0.3)',
                borderRadius: '8px',
                border: '1px solid rgba(156,163,175,0.1)',
                display: 'inline-block',
              }}
            >
              <span 
                style={{
                  fontSize: '13px',
                  color: 'rgba(156,163,175,0.6)',
                  fontWeight: '500',
                }}
              >
                🚀 Phase 1 Foundation Ready
              </span>
            </div>
          </div>

          {/* Quick Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
            <div 
              style={{
                padding: '24px',
                background: 'rgba(32,32,32,0.9)',
                borderRadius: '16px',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(156,163,175,0.1)',
                boxShadow: '0 15px 30px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div 
                  style={{
                    padding: '12px',
                    background: 'rgba(156,163,175, 0.15)',
                    borderRadius: '12px',
                    border: '1px solid rgba(156,163,175, 0.25)',
                  }}
                >
                  <Server style={{ width: '20px', height: '20px', color: 'rgba(156,163,175, 0.8)' }} />
                </div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175,0.95)', marginBottom: '4px' }}>
                    {containers.length}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)', fontWeight: '500' }}>
                    Active Containers
                  </div>
                </div>
              </div>
            </div>

            <div 
              style={{
                padding: '24px',
                background: 'rgba(32,32,32,0.9)',
                borderRadius: '16px',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(156,163,175,0.1)',
                boxShadow: '0 15px 30px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div 
                  style={{
                    padding: '12px',
                    background: 'rgba(156,163,175, 0.15)',
                    borderRadius: '12px',
                    border: '1px solid rgba(156,163,175, 0.25)',
                  }}
                >
                  <DollarSign style={{ width: '20px', height: '20px', color: 'rgba(156,163,175, 0.8)' }} />
                </div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175,0.95)', marginBottom: '4px' }}>
                    ${totalMonthlyCost.toFixed(0)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)', fontWeight: '500' }}>
                    Monthly Cost
                  </div>
                </div>
              </div>
            </div>

            <div 
              style={{
                padding: '24px',
                background: 'rgba(32,32,32,0.9)',
                borderRadius: '16px',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(156,163,175,0.1)',
                boxShadow: '0 15px 30px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div 
                  style={{
                    padding: '12px',
                    background: 'rgba(156,163,175, 0.15)',
                    borderRadius: '12px',
                    border: '1px solid rgba(156,163,175, 0.25)',
                  }}
                >
                  <Users style={{ width: '20px', height: '20px', color: 'rgba(156,163,175, 0.8)' }} />
                </div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175,0.95)', marginBottom: '4px' }}>
                    {containers.reduce((sum, c) => sum + c.activeUsers, 0)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)', fontWeight: '500' }}>
                    Active Users
                  </div>
                </div>
              </div>
            </div>

            <div 
              style={{
                padding: '24px',
                background: 'rgba(32,32,32,0.9)',
                borderRadius: '16px',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(156,163,175,0.1)',
                boxShadow: '0 15px 30px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div 
                  style={{
                    padding: '12px',
                    background: 'rgba(156,163,175, 0.15)',
                    borderRadius: '12px',
                    border: '1px solid rgba(156,163,175, 0.25)',
                  }}
                >
                  <Activity style={{ width: '20px', height: '20px', color: 'rgba(156,163,175, 0.8)' }} />
                </div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175,0.95)', marginBottom: '4px' }}>
                    {containers.filter(c => c.status === 'running').length}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)', fontWeight: '500' }}>
                    Running Now
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '32px' }}>
          {/* Container List */}
          <div>
            <div 
              style={{
                background: 'rgba(32,32,32,0.95)',
                borderRadius: '20px',
                backdropFilter: 'blur(25px)',
                WebkitBackdropFilter: 'blur(25px)',
                border: '1px solid rgba(156,163,175,0.1)',
                boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
                overflow: 'hidden',
              }}
            >
              <div 
                style={{
                  padding: '24px',
                  borderBottom: '1px solid rgba(156,163,175,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Server style={{ width: '20px', height: '20px', color: 'rgba(156,163,175,0.8)' }} />
                  <span style={{ fontSize: '18px', fontWeight: '600', color: 'rgba(156,163,175,0.9)' }}>Your Containers</span>
                </div>
                <button
                  onClick={() => setShowConfigWizard(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 16px',
                    background: 'rgba(59, 130, 246, 0.8)',
                    border: 'none',
                    borderRadius: '10px',
                    color: 'white',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease-out',
                    fontSize: '14px',
                    fontWeight: '500',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 1)';
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <Plus style={{ width: '16px', height: '16px' }} />
                  <span>New</span>
                </button>
              </div>
              <div style={{ padding: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {containers.map(container => (
                    <div
                      key={container.id}
                      onClick={() => setSelectedContainer(container.id)}
                      style={{
                        padding: '20px',
                        background: selectedContainer === container.id ? 'rgba(59, 130, 246, 0.15)' : 'rgba(25,25,25,0.6)',
                        border: selectedContainer === container.id ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(156,163,175,0.1)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-out',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedContainer !== container.id) {
                          e.currentTarget.style.background = 'rgba(25,25,25,0.8)';
                          e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedContainer !== container.id) {
                          e.currentTarget.style.background = 'rgba(25,25,25,0.6)';
                          e.currentTarget.style.borderColor = 'rgba(156,163,175,0.1)';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: 'rgba(156,163,175,0.9)' }}>{container.name}</div>
                        <div 
                          style={{
                            padding: '6px 12px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '500',
                            background: 'rgba(156,163,175, 0.15)',
                            color: 'rgba(156,163,175, 0.9)',
                            border: '1px solid rgba(156,163,175, 0.25)'
                          }}
                        >
                          {container.status}
                        </div>
                      </div>
                      <div style={{ color: 'rgba(156,163,175,0.7)', fontSize: '14px', lineHeight: '1.5' }}>
                        <div style={{ marginBottom: '8px' }}>{container.config.cpu} cores • {container.config.memory}GB RAM</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: '500', color: 'rgba(156,163,175, 0.8)' }}>${container.cost}/month</span>
                          <span style={{ color: 'rgba(156,163,175,0.6)' }}>{container.uptime}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {containers.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(156,163,175,0.6)' }}>
                      <Server style={{ width: '48px', height: '48px', margin: '0 auto 16px', opacity: 0.5 }} />
                      <p style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>No containers yet</p>
                      <p style={{ fontSize: '14px' }}>Create your first development environment</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Container Details */}
          <div>
            {selectedContainerData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Container Controls */}
                <div 
                  style={{
                    background: 'rgba(32,32,32,0.95)',
                    borderRadius: '20px',
                    backdropFilter: 'blur(25px)',
                    WebkitBackdropFilter: 'blur(25px)',
                    border: '1px solid rgba(156,163,175,0.1)',
                    boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}
                >
                  <div 
                    style={{
                      padding: '24px',
                      borderBottom: '1px solid rgba(156,163,175,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Monitor style={{ width: '20px', height: '20px', color: 'rgba(156,163,175,0.8)' }} />
                      <span style={{ fontSize: '18px', fontWeight: '600', color: 'rgba(156,163,175,0.9)' }}>{selectedContainerData.name}</span>
                      <div 
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: '500',
                          background: 'rgba(156,163,175, 0.15)',
                          color: 'rgba(156,163,175, 0.9)',
                          border: '1px solid rgba(156,163,175, 0.25)'
                        }}
                      >
                        {selectedContainerData.status}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleContainerAction(selectedContainerData.id, 'restart')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '10px',
                          background: 'rgba(25,25,25,0.8)',
                          border: '1px solid rgba(156,163,175,0.2)',
                          borderRadius: '8px',
                          color: 'rgba(156,163,175,0.8)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(25,25,25,1)';
                          e.currentTarget.style.color = 'rgba(156,163,175,1)';
                          e.currentTarget.style.borderColor = 'rgba(156,163,175,0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(25,25,25,0.8)';
                          e.currentTarget.style.color = 'rgba(156,163,175,0.8)';
                          e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                        }}
                      >
                        <Settings style={{ width: '16px', height: '16px' }} />
                      </button>
                      {selectedContainerData.status === 'running' ? (
                        <button
                          onClick={() => handleContainerAction(selectedContainerData.id, 'stop')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '10px',
                            background: 'rgba(239, 68, 68, 0.2)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px',
                            color: 'rgba(239, 68, 68, 0.9)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease-out',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                          }}
                        >
                          <Square style={{ width: '16px', height: '16px' }} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleContainerAction(selectedContainerData.id, 'start')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '10px',
                            background: 'rgba(34, 197, 94, 0.8)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease-out',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.8)';
                          }}
                        >
                          <Play style={{ width: '16px', height: '16px' }} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ padding: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                      <div 
                        style={{
                          textAlign: 'center',
                          padding: '20px',
                          background: 'rgba(25,25,25,0.4)',
                          borderRadius: '12px',
                          border: '1px solid rgba(156,163,175, 0.2)',
                        }}
                      >
                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175, 0.9)', marginBottom: '4px' }}>
                          {selectedContainerData.config.storage}GB
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)' }}>Storage</div>
                      </div>
                      <div 
                        style={{
                          textAlign: 'center',
                          padding: '20px',
                          background: 'rgba(25,25,25,0.4)',
                          borderRadius: '12px',
                          border: '1px solid rgba(156,163,175, 0.2)',
                        }}
                      >
                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175, 0.9)', marginBottom: '4px' }}>
                          {selectedContainerData.config.cpu}
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)' }}>CPU Cores</div>
                      </div>
                      <div 
                        style={{
                          textAlign: 'center',
                          padding: '20px',
                          background: 'rgba(25,25,25,0.4)',
                          borderRadius: '12px',
                          border: '1px solid rgba(156,163,175, 0.2)',
                        }}
                      >
                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175, 0.9)', marginBottom: '4px' }}>
                          {selectedContainerData.config.memory}GB
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)' }}>Memory</div>
                      </div>
                      <div 
                        style={{
                          textAlign: 'center',
                          padding: '20px',
                          background: 'rgba(25,25,25,0.4)',
                          borderRadius: '12px',
                          border: '1px solid rgba(156,163,175, 0.2)',
                        }}
                      >
                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'rgba(156,163,175, 0.9)', marginBottom: '4px' }}>
                          {selectedContainerData.activeUsers}/{selectedContainerData.config.maxUsers}
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(156,163,175,0.6)' }}>Users</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Access Options */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                  <div 
                    style={{
                      padding: '32px',
                      background: 'rgba(32,32,32,0.9)',
                      borderRadius: '16px',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(156,163,175,0.1)',
                      boxShadow: '0 15px 30px rgba(0,0,0,0.2)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease-out',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(32,32,32,1)';
                      e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 20px 40px rgba(0,0,0,0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(32,32,32,0.9)';
                      e.currentTarget.style.borderColor = 'rgba(156,163,175,0.1)';
                      e.currentTarget.style.transform = 'translateY(0px)';
                      e.currentTarget.style.boxShadow = '0 15px 30px rgba(0,0,0,0.2)';
                    }}
                  >
                    <div 
                      style={{
                        width: '60px',
                        height: '60px',
                        background: 'rgba(156,163,175, 0.15)',
                        borderRadius: '12px',
                        border: '1px solid rgba(156,163,175, 0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                      }}
                    >
                      <Monitor style={{ width: '24px', height: '24px', color: 'rgba(156,163,175, 0.8)' }} />
                    </div>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'rgba(156,163,175,0.9)', marginBottom: '8px' }}>Open Desktop</h3>
                    <p style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)', marginBottom: '20px' }}>Access full Ubuntu desktop environment</p>
                    <button 
                      style={{
                        width: '100%',
                        padding: '12px 20px',
                        background: 'rgba(59, 130, 246, 0.8)',
                        border: 'none',
                        borderRadius: '10px',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-out',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)';
                      }}
                    >
                      Launch Desktop
                    </button>
                  </div>

                  <div 
                    style={{
                      padding: '32px',
                      background: 'rgba(32,32,32,0.9)',
                      borderRadius: '16px',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(156,163,175,0.1)',
                      boxShadow: '0 15px 30px rgba(0,0,0,0.2)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease-out',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(32,32,32,1)';
                      e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 20px 40px rgba(0,0,0,0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(32,32,32,0.9)';
                      e.currentTarget.style.borderColor = 'rgba(156,163,175,0.1)';
                      e.currentTarget.style.transform = 'translateY(0px)';
                      e.currentTarget.style.boxShadow = '0 15px 30px rgba(0,0,0,0.2)';
                    }}
                  >
                    <div 
                      style={{
                        width: '60px',
                        height: '60px',
                        background: 'rgba(156,163,175, 0.15)',
                        borderRadius: '12px',
                        border: '1px solid rgba(156,163,175, 0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                      }}
                    >
                      <Server style={{ width: '24px', height: '24px', color: 'rgba(156,163,175, 0.8)' }} />
                    </div>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'rgba(156,163,175,0.9)', marginBottom: '8px' }}>Terminal Access</h3>
                    <p style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)', marginBottom: '20px' }}>Connect directly to container terminal</p>
                    <button 
                      style={{
                        width: '100%',
                        padding: '12px 20px',
                        background: 'rgba(25,25,25,0.8)',
                        border: '1px solid rgba(156,163,175,0.2)',
                        borderRadius: '10px',
                        color: 'rgba(156,163,175,0.8)',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-out',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(25,25,25,1)';
                        e.currentTarget.style.color = 'rgba(156,163,175,1)';
                        e.currentTarget.style.borderColor = 'rgba(156,163,175,0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(25,25,25,0.8)';
                        e.currentTarget.style.color = 'rgba(156,163,175,0.8)';
                        e.currentTarget.style.borderColor = 'rgba(156,163,175,0.2)';
                      }}
                    >
                      Open Terminal
                    </button>
                  </div>
                </div>

                {/* Configuration Details */}
                <div 
                  style={{
                    background: 'rgba(32,32,32,0.95)',
                    borderRadius: '20px',
                    backdropFilter: 'blur(25px)',
                    WebkitBackdropFilter: 'blur(25px)',
                    border: '1px solid rgba(156,163,175,0.1)',
                    boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}
                >
                  <div 
                    style={{
                      padding: '24px',
                      borderBottom: '1px solid rgba(156,163,175,0.1)',
                    }}
                  >
                    <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'rgba(156,163,175,0.9)' }}>Configuration & Billing</h2>
                  </div>
                  <div style={{ padding: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '32px' }}>
                      <div>
                        <h4 style={{ fontSize: '16px', fontWeight: '600', color: 'rgba(156,163,175,0.9)', marginBottom: '16px' }}>Languages & Tools</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {selectedContainerData.config.languages.map(lang => (
                            <div 
                              key={lang}
                              style={{
                                padding: '8px 12px',
                                background: 'rgba(25,25,25,0.6)',
                                border: '1px solid rgba(156,163,175,0.2)',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: '500',
                                color: 'rgba(156,163,175,0.8)',
                              }}
                            >
                              {lang}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 style={{ fontSize: '16px', fontWeight: '600', color: 'rgba(156,163,175,0.9)', marginBottom: '16px' }}>Billing Information</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)' }}>Monthly Cost</span>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(34, 197, 94, 0.9)' }}>${selectedContainerData.cost.toFixed(2)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)' }}>Daily Cost</span>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(156,163,175,0.8)' }}>${(selectedContainerData.cost / 30).toFixed(2)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)' }}>Uptime</span>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(156,163,175,0.8)' }}>{selectedContainerData.uptime}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div 
                style={{
                  background: 'rgba(32,32,32,0.95)',
                  borderRadius: '20px',
                  backdropFilter: 'blur(25px)',
                  WebkitBackdropFilter: 'blur(25px)',
                  border: '1px solid rgba(156,163,175,0.1)',
                  boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px',
                  textAlign: 'center',
                }}
              >
                <div>
                  <Server style={{ width: '64px', height: '64px', margin: '0 auto 16px', color: 'rgba(156,163,175,0.4)' }} />
                  <h3 style={{ fontSize: '20px', fontWeight: '600', color: 'rgba(156,163,175,0.9)', marginBottom: '8px' }}>No Container Selected</h3>
                  <p style={{ fontSize: '14px', color: 'rgba(156,163,175,0.7)', marginBottom: '24px' }}>
                    Select a container from the list or create a new one
                  </p>
                  <button 
                    onClick={() => setShowConfigWizard(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '12px 20px',
                      background: 'rgba(59, 130, 246, 0.8)',
                      border: 'none',
                      borderRadius: '10px',
                      color: 'white',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease-out',
                      fontSize: '14px',
                      fontWeight: '500',
                      margin: '0 auto',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)';
                    }}
                  >
                    <Plus style={{ width: '16px', height: '16px' }} />
                    <span>Create Container</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Configuration Wizard Modal */}
      {showConfigWizard && (
        <ContainerConfigWizard
          onComplete={handleCreateContainer}
          onCancel={() => setShowConfigWizard(false)}
        />
      )}
    </div>
  );
};
