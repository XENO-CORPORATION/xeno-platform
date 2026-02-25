import React from 'react';
import { Zap, Github, Twitter, Linkedin, Mail } from 'lucide-react';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  
  const footerLinks = {
    product: ['Platform', 'Features', 'Workflow', 'Pricing'],
    company: ['About', 'Careers', 'Blog', 'Press'],
    resources: ['Documentation', 'Support', 'API', 'Community'],
    legal: ['Terms', 'Privacy', 'Cookies', 'Licenses']
  };
  
  const socialLinks = [
    { icon: <Twitter size={20} />, label: 'Twitter', href: '#' },
    { icon: <Github size={20} />, label: 'GitHub', href: '#' },
    { icon: <Linkedin size={20} />, label: 'LinkedIn', href: '#' },
    { icon: <Mail size={20} />, label: 'Email', href: '#' }
  ];

  return (
    <footer className="border-t border-[rgba(255,255,255,0.05)] py-12 mt-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10 mb-12">
          {/* Logo and Info */}
          <div className="md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <Zap className="text-white" size={24} />
              <span className="font-bold text-xl tracking-tight">XenoStudio</span>
            </div>
            <p className="text-text-secondary text-sm max-w-md mb-6">
              XenoStudio empowers creators to design, connect, and deploy AI workflows through a visual programming canvas.
            </p>
            <div className="flex space-x-4">
              {socialLinks.map((social, index) => (
                <a 
                  key={index} 
                  href={social.href}
                  className="text-text-secondary hover:text-white transition-colors duration-200 p-2 bg-[rgba(255,255,255,0.05)] rounded-full"
                  aria-label={social.label}
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>
          
          {/* Navigation Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-white font-medium mb-4 uppercase text-sm tracking-wider">{category}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link}>
                    <a href="#" className="text-text-secondary hover:text-white transition-colors duration-200 text-sm">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        
        {/* Bottom Bar */}
        <div className="border-t border-[rgba(255,255,255,0.05)] pt-6 flex flex-col md:flex-row justify-between items-center">
          <p className="text-text-secondary text-sm mb-4 md:mb-0">
            © {currentYear} XenoStudio. All rights reserved.
          </p>
          <div className="flex items-center space-x-6">
            <span className="text-text-secondary text-sm">Made with cutting-edge AI technology</span>
            <div className="flex items-center text-text-secondary text-xs">
              <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.4)] mr-2"></div>
              <span>All systems operational</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;