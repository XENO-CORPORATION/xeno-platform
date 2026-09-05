import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '../ui/Modal';

interface CreateLabModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreateLabModal: React.FC<CreateLabModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  return <Modal isOpen={isOpen} onClose={onClose} title="Create Lab">
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-white/70">
        <ShieldAlert size={20} className="mt-0.5 shrink-0" />
        <div><h3 className="m-0 text-sm font-semibold text-white">Lab persistence is not available</h3><p className="mb-0 mt-2 text-sm leading-6 text-white/55">The platform does not currently expose a server-confirmed Lab create/read/update contract. Nothing will be fabricated in browser state. Persisted agent work is available through Projects.</p></div>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70">Close</button>
        <button type="button" onClick={() => { onClose(); navigate('/overview/projects'); }} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Open Projects</button>
      </div>
    </div>
  </Modal>;
};

export default CreateLabModal;
