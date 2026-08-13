import React, { useState, useCallback } from 'react';
import { X } from '@/lib/icons';
import ChatWithLLM from './ChatWithLLM';

interface ChatInterface {
  id: string;
  title: string;
  createdAt: number;
}

interface MultiChatContainerProps {
  isStandalone?: boolean; // True when rendered without OverviewTaskbar (e.g., xeno-chat.com)
}

const MultiChatContainer: React.FC<MultiChatContainerProps> = ({ isStandalone = false }) => {
  const [interfaces, setInterfaces] = useState<ChatInterface[]>([
    {
      id: 'default',
      title: 'Chat 1',
      createdAt: Date.now()
    }
  ]);

  const createNewInterface = useCallback(() => {
    if (interfaces.length >= 4) {
      console.warn('Maximum of 4 interfaces allowed');
      return;
    }

    const newInterface: ChatInterface = {
      id: `chat-${Date.now()}`,
      title: `Chat ${interfaces.length + 1}`,
      createdAt: Date.now()
    };

    setInterfaces(prev => [...prev, newInterface]);
  }, [interfaces.length]);

  const closeInterface = useCallback((interfaceId: string) => {
    if (interfaces.length === 1) {
      console.warn('Cannot close the last interface');
      return;
    }

    setInterfaces(prev => prev.filter(iface => iface.id !== interfaceId));
  }, [interfaces.length]);

  const getLayoutClasses = () => {
    const count = interfaces.length;
    switch (count) {
      case 1:
        return 'grid-cols-1';
      case 2:
        return 'grid-cols-2';
      case 3:
        return 'grid-cols-3';
      case 4:
        return 'grid-cols-2 grid-rows-2';
      default:
        return 'grid-cols-1';
    }
  };

  return (
    <div className="h-full w-full">
      {/* Use auto-rows-fr to ensure equal row heights, and grid-cols with 1fr for equal column widths */}
      <div className={`h-full grid auto-rows-fr ${interfaces.length === 1 ? 'gap-0' : 'gap-2'} ${getLayoutClasses()}`}>
        {interfaces.map((iface, index) => (
          <div key={iface.id} className={`relative h-full min-h-0 overflow-hidden ${interfaces.length === 1 ? '' : 'border border-[#1e1e21] rounded-lg bg-[#0a0a0b]'}`}>
            {/* Chat Interface - header/conversation selector is now inside ChatWithLLM */}
            <ChatWithLLM
              key={iface.id}
              interfaceId={iface.id}
              interfaceTitle={iface.title}
              onCreateNewInterface={createNewInterface}
              onCloseInterface={closeInterface}
              isMultiInterface={interfaces.length > 1}
              maxInterfacesReached={interfaces.length >= 4}
              isStandalone={isStandalone}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default MultiChatContainer; 