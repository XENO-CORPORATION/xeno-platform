import React from 'react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/landing-v3/Header';
import HeroSection from '../components/landing-v3/HeroSection';
import UseCasesShowcase from '../components/landing-v3/UseCasesSection';
import ProductsShowcase from '../components/landing-v3/ProductsShowcase';
import ModelsStrip from '../components/landing-v3/ModelsStrip';
import FlowSection from '../components/landing-v3/FlowSection';
import PrivacyPricingSection from '../components/landing-v3/PrivacyPricingSection';
import CreateWithoutLimitsSection from '../components/landing-v3/CreateWithoutLimitsSection';
import Footer from '../components/landing-v3/Footer';

function Home3() {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/auth');
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="flex-1">
        <HeroSection />
        <ProductsShowcase />
        <ModelsStrip />
        <FlowSection />
        <UseCasesShowcase />
        <PrivacyPricingSection />
        <CreateWithoutLimitsSection />
      </main>

      <Footer />
    </div>
  );
}

export default Home3;
