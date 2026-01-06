import React from 'react';
import { Zap, Plus } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  buttonText: string;
  onAction: () => void;
  icon?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  buttonText,
  onAction,
  icon = <Zap size={32} className="text-white/40" />
}) => {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
      <div className="bg-white/5 p-4 rounded-full mb-6">
        {icon}
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">{title}</h2>
      <p className="text-white/60 max-w-md mb-8">{description}</p>
      <button
        onClick={onAction}
        className="flex items-center space-x-2 bg-white text-primary-bg px-5 py-2.5 rounded-xl font-medium hover:bg-white/90 transition-all duration-300 transform-gpu"
      >
        <Plus size={18} />
        <span>{buttonText}</span>
      </button>
    </div>
  );
};

export default EmptyState;