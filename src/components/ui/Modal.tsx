import React from 'react';
import ChatModal from '../playground/Chat/ChatModal';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Kept for its callers' API only: the dialog itself is the platform's ONE dialog (ChatModal — the New task
 * window's construction, owner 2026-10-14). Do not give this file its own chrome again.
 */
const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, className = '' }) => {
  if (!isOpen) return null;
  return (
    <ChatModal size="md" title={title} onClose={onClose} footer={null} className={className}>
      {children}
    </ChatModal>
  );
};

export default Modal;
