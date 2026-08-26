import React from 'react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/landing/Header';
import HeroSection from '../components/landing/HeroSection';
import UseCasesShowcase from '../components/landing/UseCasesSection';
import Footer from '../components/landing/Footer';

function Home() {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="pt-[58px]">
        <HeroSection />
        <UseCasesShowcase />
      </main>

      <Footer />
    </div>
  );
}

export default Home;
