import React from 'react';

interface DisplayContainerProps {
  children: React.ReactNode;
  noPadding?: boolean; // Optional prop to disable padding for full-screen interfaces
  background?: string;
}

const DisplayContainer: React.FC<DisplayContainerProps> = ({ children, noPadding = false, background }) => {
  return (
    <div
      style={{
        flex: 1,
        height: '100vh',
        background: background ?? 'var(--primary-bg)',
        boxSizing: 'border-box',
        padding: noPadding ? '0' : '8px',
        margin: 0,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
};

export default DisplayContainer;
