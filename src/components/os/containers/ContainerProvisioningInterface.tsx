/**
 * XenoOS Container Provisioning Interface
 * Enhanced OS Auth Interface with Dynamic Container Provisioning
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Plus, Server, User, Power } from 'lucide-react';
import { useOSState } from '../OSAuthInterface';
import ContainerConfigurationWizard from './ContainerConfigurationWizard';
import PriceCalculator from './PriceCalculator';
import { ContainerConfig } from '../../../types/container';

interface ContainerProvisioningInterfaceProps {
  onClose: () => void;
}

const ContainerProvisioningInterface: React.FC<ContainerProvisioningInterfaceProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const { setOSActive } = useOSState();
  const [hoveredContainer, setHoveredContainer] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfigWizard, setShowConfigWizard] = useState(false);
  const [showPriceCalculator, setShowPriceCalculator] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<ContainerConfig>({
    storage: 10,
    cpu: 1,
    memory: 2,
    languages: { nodejs: true, python: false, go: false, rust: false, java: false },
    maxUsers: 1,
    realTimeSync: true,
    backups: false,
    encryption: false,
    prioritySupport: false,
    name: '',
    description: '',
  });

  const handleSubmit = () => {
    if (password.length > 0) {
      setIsSubmitting(true);
      setTimeout(() => {
        setIsSubmitting(false);
        setOSActive(true);
        navigate('/os/home');
      }, 1000);
    }
  };

  const handleCreateContainer = async (config: ContainerConfig) => {
    try {
      // Here we would make the API call to create the container
      const response = await fetch('/api/containers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'current-user-id', // Would get from auth context
          config,
          autoStart: true,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setShowConfigWizard(false);
        // Navigate to the new container or show success
        console.log('Container created:', result.data);
        // Could navigate directly to the container
        setOSActive(true);
        navigate('/os/home');
      } else {
        console.error('Container creation failed:', result.error);
        // Handle error - show notification
      }
    } catch (error) {
      console.error('Container creation error:', error);
      // Handle network error
    }
  };

  const handleConfigChange = (newConfig: ContainerConfig) => {
    setCurrentConfig(newConfig);
  };

  return (
    <>
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
        {/* Container Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
          }}
        >
          {/* Existing Container (Left) */}
          <div
            style={{
              width: 160,
              height: 160,
              background: hoveredContainer === 'left'
                ? 'rgba(25,25,25,0.9)'
                : 'rgba(25,25,25,0.8)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(15px)',
              WebkitBackdropFilter: 'blur(15px)',
              transition: 'background 0.15s ease-out',
              cursor: 'pointer',
              willChange: 'background',
            }}
            onMouseEnter={() => setHoveredContainer('left')}
            onMouseLeave={() => setHoveredContainer(null)}
            onClick={() => setShowPriceCalculator(!showPriceCalculator)}
            title="Existing Container"
          >
            <div style={{ textAlign: 'center' }}>
              <Server
                size={32}
                style={{
                  color: hoveredContainer === 'left'
                    ? 'rgba(156,163,175,1)'
                    : 'rgba(156,163,175,0.8)',
                  transition: 'color 0.12s ease-out',
                  marginBottom: '8px',
                }}
              />
              <div
                style={{
                  fontSize: '12px',
                  color: 'rgba(156,163,175,0.8)',
                  fontWeight: '500',
                }}
              >
                Existing
              </div>
            </div>
          </div>

          {/* Main Centered Container */}
          <div
            style={{
              width: 320,
              height: 330,
              background: 'rgba(32,32,32,0.95)',
              borderRadius: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'center',
              padding: '20px 20px 12px 20px',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            {/* Avatar and Info */}
            <div style={{ width: '100%', marginBottom: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 12,
                  border: '2px solid rgba(156,163,175,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: '20px',
                  marginBottom: '16px',
                }}
              >
                <User size={32} style={{ color: 'rgba(156,163,175,0.6)' }} />
              </div>

              <div
                style={{
                  color: 'rgba(156,163,175,0.8)',
                  fontSize: 16,
                  fontWeight: '500',
                  letterSpacing: '0.5px',
                  userSelect: 'none',
                  marginBottom: '20px',
                }}
              >
                XenoLabs Terminal
              </div>
            </div>

            {/* Password Input */}
            <div style={{ width: '100%', marginBottom: '16px' }}>
              <div
                style={{
                  width: '100%',
                  borderRadius: 8,
                  padding: '12px 16px',
                  border: '1px solid rgba(156,163,175,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'border-color 0.15s ease-out',
                }}
              >
                <input
                  type="password"
                  placeholder="Enter password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(156,163,175,0.9)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password.length > 0) {
                      handleSubmit();
                    }
                  }}
                />
              </div>
            </div>

            {/* Forgot PIN */}
            <div style={{ textAlign: 'center' }}>
              <span
                style={{
                  color: 'rgba(156,163,175,0.7)',
                  fontSize: 13,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => console.log('Forgot PIN clicked')}
              >
                I forgot my PIN
              </span>
            </div>
          </div>

          {/* New Container (Right) */}
          <div
            style={{
              width: 160,
              height: 160,
              background: hoveredContainer === 'right'
                ? 'rgba(25,25,25,0.9)'
                : 'rgba(25,25,25,0.8)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(15px)',
              WebkitBackdropFilter: 'blur(15px)',
              transition: 'background 0.15s ease-out',
              cursor: 'pointer',
              willChange: 'background',
            }}
            onMouseEnter={() => setHoveredContainer('right')}
            onMouseLeave={() => setHoveredContainer(null)}
            onClick={() => setShowConfigWizard(true)}
            title="Create New Container"
          >
            <div style={{ textAlign: 'center' }}>
              <Plus
                size={32}
                style={{
                  color: hoveredContainer === 'right'
                    ? 'rgba(156,163,175,1)'
                    : 'rgba(156,163,175,0.8)',
                  transition: 'color 0.12s ease-out',
                  marginBottom: '8px',
                }}
              />
              <div
                style={{
                  fontSize: '12px',
                  color: 'rgba(156,163,175,0.8)',
                  fontWeight: '500',
                }}
              >
                New Container
              </div>
            </div>
          </div>
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
            onClick={() => navigate('/overview')}
            title="Exit OS Auth"
          >
            <LogOut size={20} style={{ color: 'rgba(156,163,175,0.8)' }} />
          </button>
        </div>

        {/* Price Calculator Overlay */}
        {showPriceCalculator && (
          <div
            style={{
              position: 'fixed',
              top: '50%',
              right: '20px',
              transform: 'translateY(-50%)',
              width: '400px',
              maxHeight: '80vh',
              overflow: 'auto',
              background: 'rgba(32,32,32,0.98)',
              borderRadius: '16px',
              border: '1px solid rgba(156,163,175,0.2)',
              backdropFilter: 'blur(20px)',
              zIndex: 10002,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ color: 'white', fontSize: '18px', fontWeight: '600' }}>
                  Pricing Calculator
                </h3>
                <button
                  onClick={() => setShowPriceCalculator(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(156,163,175,0.8)',
                    cursor: 'pointer',
                    fontSize: '20px',
                  }}
                >
                  ×
                </button>
              </div>
              
              <PriceCalculator
                config={currentConfig}
                onConfigChange={handleConfigChange}
                showBreakdown={true}
                showSuggestions={true}
              />
            </div>
          </div>
        )}
      </div>

      {/* Container Configuration Wizard */}
      <ContainerConfigurationWizard
        isVisible={showConfigWizard}
        onComplete={handleCreateContainer}
        onCancel={() => setShowConfigWizard(false)}
        initialConfig={currentConfig}
      />

      {/* Backdrop for Price Calculator */}
      {showPriceCalculator && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 10001,
          }}
          onClick={() => setShowPriceCalculator(false)}
        />
      )}
    </>
  );
};

export default ContainerProvisioningInterface;