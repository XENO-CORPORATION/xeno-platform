import React, { useState } from 'react';
import { Check, CreditCard, Building, Zap, Users, HelpCircle, ChevronRight } from 'lucide-react';
import GlassContainer from '../ui/GlassContainer';

interface PricingProps {
  onGetStarted: () => void;
}

const Pricing: React.FC<PricingProps> = ({ onGetStarted }) => {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [showFaq, setShowFaq] = useState<number | null>(null);
  
  const pricingPlans = [
    {
      name: "Starter",
      description: "Perfect for exploring and experimenting with AI workflows",
      monthlyPrice: "Free",
      yearlyPrice: "Free",
      features: [
        "5 workflow projects",
        "Basic node components",
        "Standard processing speed",
        "Community support",
        "10 daily generations"
      ],
      highlighted: false,
      ctaText: "Get Started",
      ctaHighlight: false
    },
    {
      name: "Creator",
      description: "For individual professionals and content creators",
      monthlyPrice: "$29",
      yearlyPrice: "$19",
      features: [
        "Unlimited projects",
        "Full node library access",
        "Priority processing",
        "Email & chat support",
        "100 daily generations",
        "Custom node parameters",
        "Export in multiple formats"
      ],
      highlighted: true,
      ctaText: "Start Free Trial",
      ctaHighlight: true
    },
    {
      name: "Team",
      description: "Collaborative tools for creative teams and agencies",
      monthlyPrice: "$79",
      yearlyPrice: "$59",
      features: [
        "Everything in Creator",
        "Team collaboration tools",
        "Version history",
        "Advanced analytics",
        "Unlimited generations",
        "Priority support",
        "API access"
      ],
      highlighted: false,
      ctaText: "Contact Sales",
      ctaHighlight: false
    }
  ];
  
  const faqs = [
    {
      question: "How does the pricing work?",
      answer: "Our pricing is based on a subscription model with both monthly and annual billing options. Annual billing provides a significant discount. Each tier offers different features and usage limits to fit your needs."
    },
    {
      question: "Can I upgrade or downgrade my plan?",
      answer: "Yes, you can change your subscription plan at any time. When upgrading, you'll be prorated for the remainder of your billing period. When downgrading, the new rate will apply at the next billing cycle."
    },
    {
      question: "What happens when I reach my generation limit?",
      answer: "Once you reach your daily generation limit, you'll need to wait until the next day for your limit to reset, or you can upgrade to a higher tier for increased or unlimited generations."
    },
    {
      question: "Is there a trial period available?",
      answer: "Yes, we offer a 14-day free trial of our Creator plan so you can experience all the premium features before committing to a subscription."
    },
    {
      question: "Do you offer custom enterprise solutions?",
      answer: "Absolutely. For large organizations with specific needs, we offer custom enterprise plans with dedicated support, custom integrations, and tailored workflows. Contact our sales team for details."
    }
  ];

  const getPrice = (plan: typeof pricingPlans[0]) => {
    if (plan.monthlyPrice === "Free") return "Free";
    
    return (
      <>
        {billingPeriod === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice}
        <span className="text-sm font-normal text-text-secondary">
          {plan.monthlyPrice !== "Free" && ` / ${billingPeriod === 'monthly' ? 'mo' : 'mo, billed annually'}`}
        </span>
      </>
    );
  };

  return (
    <div className="standard-container">
      <div className="text-center mb-16">
        <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[rgba(255,255,255,0.05)] mb-6">
          <CreditCard size={14} className="mr-2 text-white" />
          <span className="text-text-secondary text-sm">Simple Pricing</span>
        </div>
        <h2 className="section-title">Plans for Every Creator</h2>
        <p className="section-description">
          Choose the perfect plan to power your creative AI workflow, from individual projects to enterprise solutions.
        </p>
        
        {/* Billing toggle - optimized animations */}
        <div className="mt-8 inline-flex p-1 bg-[rgba(255,255,255,0.05)] rounded-lg transform-gpu">
          <button 
            className={`px-4 py-2 rounded-md text-sm transition-all duration-300 ${
              billingPeriod === 'monthly' 
                ? 'bg-white text-primary-bg' 
                : 'text-text-secondary hover:bg-[rgba(255,255,255,0.08)]'
            }`}
            onClick={() => setBillingPeriod('monthly')}
            aria-pressed={billingPeriod === 'monthly'}
          >
            Monthly
          </button>
          <button 
            className={`px-4 py-2 rounded-md text-sm transition-all duration-300 ${
              billingPeriod === 'yearly' 
                ? 'bg-white text-primary-bg' 
                : 'text-text-secondary hover:bg-[rgba(255,255,255,0.08)]'
            }`}
            onClick={() => setBillingPeriod('yearly')}
            aria-pressed={billingPeriod === 'yearly'}
          >
            Yearly <span className="text-xs ml-1 opacity-80">Save 35%</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16 progressive-load">
        {pricingPlans.map((plan, index) => (
          <div key={index} className={`relative ${plan.highlighted ? 'md:-mt-4 md:mb-4' : ''}`}>
            {plan.highlighted && (
              <div className="absolute -top-4 left-0 right-0 flex justify-center z-elevated">
                <div className="bg-white text-primary-bg px-4 py-1 rounded-full text-sm font-medium transform-gpu">
                  Most Popular
                </div>
              </div>
            )}
            <GlassContainer 
              className={`h-full flex flex-col ${
                plan.highlighted 
                  ? 'border-white/20 backdrop-blur-[15px] bg-[rgba(255,255,255,0.08)]' 
                  : ''
              }`}
            >
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                <p className="text-sm text-text-secondary">{plan.description}</p>
              </div>
              
              <div className="mb-6">
                <div className="text-3xl font-bold text-white">
                  {getPrice(plan)}
                </div>
              </div>
              
              <div className="flex-grow mb-6">
                <ul className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start">
                      <Check size={18} className="text-white mr-2 mt-0.5 flex-shrink-0" />
                      <span className="text-text-secondary text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <button 
                onClick={onGetStarted}
                className={`w-full py-3 rounded-xl font-medium transition-all duration-300 transform-gpu ${
                  plan.ctaHighlight
                    ? 'bg-white text-primary-bg hover:bg-white/90 hover:scale-[1.02]' 
                    : 'bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.12)] hover:scale-[1.02]'
                }`}
              >
                {plan.ctaText}
              </button>
            </GlassContainer>
          </div>
        ))}
      </div>

      {/* Enterprise callout */}
      <div className="mb-16">
        <GlassContainer className="bg-[rgba(255,255,255,0.03)]">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="mb-6 md:mb-0 md:mr-8">
              <div className="flex items-center mb-4">
                <Building size={24} className="text-white mr-3" />
                <h3 className="text-2xl font-bold text-white">Enterprise Solution</h3>
              </div>
              <p className="text-text-secondary max-w-2xl">
                Need a custom solution for your organization? Our enterprise plan includes dedicated support, custom integrations, and tailored AI workflows to meet your specific requirements.
              </p>
            </div>
            <button 
              onClick={onGetStarted}
              className="whitespace-nowrap bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.2)] px-6 py-3 rounded-xl font-medium hover:bg-[rgba(255,255,255,0.12)] transition-all duration-300 transform-gpu hover:scale-[1.02] flex items-center"
            >
              <span>Contact Sales</span>
              <ChevronRight size={16} className="ml-2" />
            </button>
          </div>
        </GlassContainer>
      </div>

      {/* FAQ Section with efficient transitions */}
      <div className="mb-16">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center p-3 rounded-lg bg-[rgba(255,255,255,0.05)] mb-4">
            <HelpCircle size={20} className="text-white" />
          </div>
          <h3 className="text-2xl font-bold text-white">Frequently Asked Questions</h3>
        </div>
        
        <div className="space-y-4 max-w-3xl mx-auto progressive-load">
          {faqs.map((faq, index) => (
            <div 
              key={index} 
              className="bg-[rgba(255,255,255,0.03)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.1)] rounded-xl overflow-hidden transition-all duration-300 transform-gpu"
            >
              <button 
                className="w-full px-6 py-4 text-left flex items-center justify-between"
                onClick={() => setShowFaq(showFaq === index ? null : index)}
                aria-expanded={showFaq === index}
              >
                <span className="font-medium text-white">{faq.question}</span>
                <ChevronRight 
                  size={18} 
                  className={`text-white transition-transform duration-300 transform-gpu ${showFaq === index ? 'rotate-90' : ''}`} 
                />
              </button>
              <div 
                className={`px-6 overflow-hidden transition-all duration-300 transform-gpu ${
                  showFaq === index ? 'max-h-40 pb-4 opacity-100' : 'max-h-0 opacity-0'
                }`}
                aria-hidden={showFaq !== index}
              >
                <p className="text-text-secondary text-sm">{faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA - optimized transitions */}
      <div className="text-center">
        <p className="text-text-secondary mb-6">
          All plans include a 14-day money-back guarantee. No questions asked.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <button 
            onClick={onGetStarted}
            className="bg-white text-primary-bg px-6 py-3 rounded-xl font-medium transition-all duration-300 transform-gpu hover:bg-white/90 hover:scale-[1.02] flex items-center justify-center"
          >
            <Zap size={18} className="mr-2" />
            <span>Get Started Now</span>
          </button>
          <button 
            onClick={onGetStarted}
            className="bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.1)] px-6 py-3 rounded-xl font-medium hover:bg-[rgba(255,255,255,0.08)] transition-all duration-300 transform-gpu hover:scale-[1.02] flex items-center justify-center"
          >
            <Users size={18} className="mr-2" />
            <span>Talk to Sales</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Pricing;