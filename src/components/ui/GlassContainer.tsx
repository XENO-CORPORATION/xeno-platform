import React from 'react';

interface GlassContainerProps {
  className?: string;
  children: React.ReactNode;
  hoverEffect?: boolean;
  onClick?: () => void;
  as?: React.ElementType;
  testId?: string;
}

const GlassContainer: React.FC<GlassContainerProps> = ({ 
  className = '', 
  children, 
  hoverEffect = false,
  onClick,
  as: Component = 'div',
  testId,
}) => (
  <Component 
    className={`bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.1)] 
    rounded-2xl shadow-glass transform-gpu transition-all duration-300 p-8
    ${hoverEffect ? 'hover:bg-[rgba(255,255,255,0.08)] hover:scale-[1.02] hover:shadow-glass-hover' : ''} 
    ${className}`}
    onClick={onClick}
    data-testid={testId}
  >
    {children}
  </Component>
);

export default GlassContainer;