import React, { useState } from 'react';
import { Check, CreditCard, Zap, Plus, Star } from 'lucide-react';
import Modal from '../ui/Modal';

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  popular?: boolean;
  savings?: string;
}

const TopUpModal: React.FC<TopUpModalProps> = ({ isOpen, onClose }) => {
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'paypal'>('card');
  
  const creditPackages: CreditPackage[] = [
    {
      id: 'starter',
      name: 'Starter',
      credits: 1000,
      price: 9.99
    },
    {
      id: 'pro',
      name: 'Professional',
      credits: 5000,
      price: 39.99,
      popular: true,
      savings: '20%'
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      credits: 15000,
      price: 99.99,
      savings: '33%'
    }
  ];
  
  const handleSelectPackage = (id: string) => {
    setSelectedPackage(id);
  };
  
  const handleTopUp = () => {
    if (!selectedPackage) return;
    
    // Here you would process the payment and add credits
    console.log(`Processing ${selectedPackage} package payment...`);
    
    // Close modal after successful payment
    onClose();
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Top Up Credits">
      <div className="space-y-6">
        <p className="text-white/70">
          Purchase additional credits to use for AI model executions in your labs and playgrounds.
        </p>
        
        {/* Credit packages */}
        <div className="space-y-4">
          <h3 className="text-white text-sm font-medium">Select a package:</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {creditPackages.map((pkg) => (
              <div 
                key={pkg.id}
                className={`relative border rounded-xl p-4 cursor-pointer transition-all duration-300 transform-gpu 
                  ${selectedPackage === pkg.id 
                    ? 'border-white/30 bg-white/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/8'
                  }
                `}
                onClick={() => handleSelectPackage(pkg.id)}
              >
                {/* Popular badge */}
                {pkg.popular && (
                  <div className="absolute -top-2 -right-2 bg-indigo-500 text-white px-2 py-0.5 rounded-full text-xs font-medium">
                    Popular
                  </div>
                )}
                
                <div className="text-center space-y-2">
                  <h4 className="text-white font-medium">{pkg.name}</h4>
                  <div className="flex items-center justify-center">
                    <Zap size={16} className="text-yellow-400 mr-1" />
                    <span className="text-xl font-bold text-white">{pkg.credits.toLocaleString()}</span>
                  </div>
                  <div className="text-white/90 font-medium">
                    ${pkg.price}
                  </div>
                  {pkg.savings && (
                    <div className="text-green-400 text-xs font-medium">
                      Save {pkg.savings}
                    </div>
                  )}
                </div>
                
                {/* Selected indicator */}
                {selectedPackage === pkg.id && (
                  <div className="absolute top-2 right-2 text-white">
                    <Check size={18} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Payment methods */}
        <div className="space-y-2">
          <h3 className="text-white text-sm font-medium">Payment method:</h3>
          <div className="flex space-x-4">
            <button
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-colors ${
                paymentMethod === 'card' 
                  ? 'border-white/30 bg-white/10' 
                  : 'border-white/10 bg-transparent hover:bg-white/5'
              }`}
              onClick={() => setPaymentMethod('card')}
            >
              <CreditCard size={16} className="text-white/70" />
              <span>Credit Card</span>
            </button>
            
            <button
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-colors ${
                paymentMethod === 'paypal' 
                  ? 'border-white/30 bg-white/10' 
                  : 'border-white/10 bg-transparent hover:bg-white/5'
              }`}
              onClick={() => setPaymentMethod('paypal')}
            >
              <div className="text-white/70 text-sm font-bold">P</div>
              <span>PayPal</span>
            </button>
          </div>
        </div>
        
        {/* Terms */}
        <div className="text-xs text-white/50">
          By clicking Top Up, you agree to our Terms of Service and Privacy Policy.
          Credits do not expire and can be used across all features.
        </div>
        
        {/* Actions */}
        <div className="flex justify-end space-x-4 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleTopUp}
            disabled={!selectedPackage}
            className={`px-4 py-2 rounded-lg bg-white text-primary-bg font-medium flex items-center space-x-2 transition-all transform-gpu ${
              !selectedPackage ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/90 hover:scale-[1.02]'
            }`}
          >
            <Zap size={16} />
            <span>Top Up Now</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default TopUpModal;