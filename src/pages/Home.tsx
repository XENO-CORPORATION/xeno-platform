import React from 'react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/landing/Header';
import HeroSection from '../components/landing/HeroSection';
import BentoShowcase from '../components/landing/BentoShowcase';
import FeaturesSection from '../components/landing/FeaturesSection';
import UseCasesSection from '../components/landing/UseCasesSection';
import PricingSection from '../components/landing/PricingSection';
import CTASection from '../components/landing/CTASection';
import Footer from '../components/landing/Footer';

function Home() {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="pt-[46px]">
        <HeroSection />
        <BentoShowcase />
        <section id="features">
          <FeaturesSection />
        </section>
        <section id="use-cases">
          <UseCasesSection onGetStarted={handleGetStarted} />
        </section>
        <section id="pricing">
          <PricingSection onGetStarted={handleGetStarted} />
        </section>
        <CTASection onGetStarted={handleGetStarted} />
      </main>

      <Footer />
    </div>
  );
}

export default Home;
