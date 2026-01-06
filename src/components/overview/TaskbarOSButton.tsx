import React from 'react';

interface TaskbarOSButtonProps {
  onClick: () => void;
}

const TaskbarOSButton: React.FC<TaskbarOSButtonProps> = ({ onClick }) => (
  <button
    className="flex items-center justify-center rounded-md font-medium bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors duration-300"
    type="button"
    style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 30 }}
    onClick={onClick}
    title="OS"
  >
    <span style={{ fontSize: 12, fontWeight: 600 }}>OS</span>
  </button>
);

export default TaskbarOSButton;
