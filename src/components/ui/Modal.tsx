import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, className = '' }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    // Lock body scroll when modal is open
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);
  
  // Close modal when clicking outside
  const handleOutsideClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-all duration-300 transform-gpu"
      onClick={handleOutsideClick}
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className={`bg-[rgba(30,30,30,0.95)] border border-white/10 rounded-2xl shadow-glass max-w-lg w-full max-h-[90vh] overflow-auto transform-gpu transition-all duration-300 ${className}`}
        style={{ animation: 'fadeIn 0.3s ease-out forwards' }}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 id="modal-title" className="text-xl font-semibold text-white">{title}</h2>
          <button 
            onClick={onClose}
            className="text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-5">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;