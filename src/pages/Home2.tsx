import React from 'react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/landing-v2/Header';
import HeroSection from '../components/landing-v2/HeroSection';
import UseCasesShowcase from '../components/landing-v2/UseCasesSection';
import Footer from '../components/landing-v2/Footer';

function Home2() {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#020203] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main>
        <HeroSection />
        <UseCasesShowcase onGetStarted={handleGetStarted} />
      </main>

      <Footer />
    </div>
  );
}

export default Home2;
