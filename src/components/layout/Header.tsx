import React, { useState, useEffect } from 'react';
import { Zap, Menu, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { authService } from '../../services/authService';

interface HeaderProps {
  onGetStarted: () => void;
}

const Header: React.FC<HeaderProps> = ({ onGetStarted }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const user = authService.getCurrentUser();
  const isAuthenticated = authService.isAuthenticated();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    
    // Add event listener with passive option for better performance
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    // Initial check
    handleScroll();
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
    
    // Prevent body scroll when menu is open
    if (!isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  };

  const navItems = ['Platform', 'Features', 'Workflow', 'About', 'Pricing'];

  return (
    <header 
      className={`fixed top-0 w-full z-navbar transition-all duration-300 ${
        isScrolled 
          ? 'bg-[rgba(18,18,18,0.95)] backdrop-blur-[10px] shadow-md' 
          : 'bg-[rgba(18,18,18,0.85)] backdrop-blur-[10px]'
      } border-b border-[rgba(255,255,255,0.05)] px-6 py-4`}
    >
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        {/* Logo */}
        <Link to="/" className="flex items-center space-x-2 transform-gpu">
          <Zap className="text-white" size={24} />
          <span className="font-bold text-xl tracking-tight">XenoStudio</span>
        </Link>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex space-x-8">
          {navItems.map((item) => (
            <a 
              key={item} 
              href={`#${item.toLowerCase()}`} 
              className="text-text-secondary hover:text-white transition-colors duration-200 border-b-2 border-transparent hover:border-white/20 pb-1"
            >
              {item}
            </a>
          ))}
        </nav>
        
        {/* Get Started Button - hidden on mobile */}
        <button 
          onClick={onGetStarted}
          className="hidden md:block bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.1)] px-5 py-2 rounded-xl font-medium transform-gpu transition-all duration-300 hover:bg-[rgba(255,255,255,0.08)] hover:scale-[1.02]"
        >
          Get Started
        </button>
        
        {/* Mobile Menu Button */}
        <button 
          className="md:hidden p-2 focus:outline-none" 
          onClick={toggleMobileMenu}
          aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMobileMenuOpen}
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
      
      {/* Mobile Menu */}
      <div 
        className={`fixed inset-0 bg-primary-bg bg-opacity-95 backdrop-blur-[10px] z-modal md:hidden transform-gpu transition-all duration-300 ${
          isMobileMenuOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
        }`}
        aria-hidden={!isMobileMenuOpen}
      >
        <div className="flex flex-col h-full pt-20 px-6">
          <nav className="flex flex-col space-y-6">
            {navItems.map((item) => (
              <a 
                key={item} 
                href={`#${item.toLowerCase()}`} 
                className="text-xl font-medium text-text-secondary hover:text-white transition-colors duration-200"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  document.body.style.overflow = '';
                }}
              >
                {item}
              </a>
            ))}
          </nav>
          
          <div className="mt-auto mb-12">
            <button 
              onClick={() => {
                setIsMobileMenuOpen(false);
                document.body.style.overflow = '';
                onGetStarted();
              }}
              className="w-full bg-white text-primary-bg py-4 rounded-xl font-medium transform-gpu transition-all duration-300 hover:bg-white/90 hover:scale-[1.02]"
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;