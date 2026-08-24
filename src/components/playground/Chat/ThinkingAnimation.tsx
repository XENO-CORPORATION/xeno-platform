import React, { useEffect, useState } from 'react';

interface ThinkingAnimationProps {
  duration?: number;
  isLive?: boolean;
}

const ThinkingAnimation: React.FC<ThinkingAnimationProps> = ({
  duration = 0,
  isLive = true
}) => {
  const [currentDuration, setCurrentDuration] = useState(duration);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setCurrentDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  return (
    <div className="thinking-animation">
      <div className="thinking-spinner"></div>
      <span className="thinking-text">
        Thinking<span className="thinking-dots"></span>
        {currentDuration > 0 && <span className="thinking-duration">{currentDuration}s</span>}
      </span>
      <style>{`
        .thinking-animation {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: #19191a;
          border: 1px solid #3a3a3d;
          border-radius: 0.5rem;
        }
        .thinking-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(156, 163, 175, 0.2);
          border-top: 2px solid #9ca3af;
          border-radius: 50%;
          animation: thinking-spin 1s linear infinite;
          flex-shrink: 0;
        }
        @keyframes thinking-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .thinking-text {
          font-size: 0.875rem;
          color: #9ca3af;
        }
        .thinking-dots::after {
          content: '';
          animation: thinking-dots-anim 1.5s steps(4, end) infinite;
        }
        @keyframes thinking-dots-anim {
          0%, 20% { content: ''; }
          40% { content: '.'; }
          60% { content: '..'; }
          80%, 100% { content: '...'; }
        }
        .thinking-duration {
          margin-left: 0.5rem;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
};

export const ThinkingAnimationInline: React.FC<ThinkingAnimationProps> = ({
  duration = 0,
  isLive = true
}) => {
  const [currentDuration, setCurrentDuration] = useState(duration);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setCurrentDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  return (
    <span className="text-sm text-[var(--chat-muted)]">
      Thinking{currentDuration > 0 && <span className="text-[var(--chat-muted)] ml-1">({currentDuration}s)</span>}
    </span>
  );
};

export default ThinkingAnimation;
