import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const Terms: React.FC = () => {
  return (
    <div className="min-h-screen h-full bg-[#08080a] text-white font-['Inter',sans-serif] flex flex-col">
      {/* Simple Header */}
      <header className="border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <img
              src="/logo.svg"
              alt="Xeno"
              className="w-8 h-8 rounded-lg object-contain invert"
            />
            <span className="text-lg font-semibold text-white">Xeno Studio</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 lg:py-16 w-full">
        <div className="mb-12">
          <h1 className="text-4xl lg:text-5xl font-bold mb-4">Terms of Service</h1>
          <p className="text-white/40 text-sm">Last updated: December 2024</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8">
          {/* Acceptance of Terms */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">1. Acceptance of Terms</h2>
            <p className="text-white/60 leading-relaxed">
              By accessing or using Xeno Studio ("the Service"), you agree to be bound by these
              Terms of Service ("Terms"). If you do not agree to these Terms, you may not access
              or use the Service. These Terms constitute a legally binding agreement between you
              and Xeno Studio.
            </p>
            <p className="text-white/60 leading-relaxed mt-4">
              We may modify these Terms at any time. If we make material changes, we will notify
              you through the Service or by email. Your continued use of the Service after changes
              are posted constitutes your acceptance of the modified Terms.
            </p>
          </section>

          {/* Description of Service */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">2. Description of Service</h2>
            <p className="text-white/60 leading-relaxed">
              Xeno Studio is a content creation platform that provides:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mt-4">
              <li>AI-powered image and video generation tools</li>
              <li>Video editing and enhancement capabilities</li>
              <li>Social Media Hub for publishing content to connected platforms (YouTube, TikTok, Instagram, etc.)</li>
              <li>Content management and organization features</li>
              <li>Cloud-based storage and processing</li>
            </ul>
          </section>

          {/* User Accounts */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">3. User Accounts</h2>

            <h3 className="text-lg font-medium mb-2 text-white/90">Eligibility</h3>
            <p className="text-white/60 leading-relaxed mb-4">
              You must be at least 18 years of age, or the age of legal majority in your
              jurisdiction, to use the Service. If you are under 18, you may only use the
              Service with the involvement and consent of a parent or legal guardian who
              agrees to be bound by these Terms.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Account Security</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>You are responsible for maintaining the confidentiality of your account credentials</li>
              <li>You are responsible for all activities that occur under your account</li>
              <li>You must notify us immediately of any unauthorized use of your account</li>
              <li>One account per person; creating multiple accounts is prohibited</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">Account Information</h3>
            <p className="text-white/60 leading-relaxed">
              You agree to provide accurate, current, and complete information during registration
              and to update such information to keep it accurate, current, and complete.
            </p>
          </section>

          {/* Connected Platforms */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">4. Connected Platforms</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              Our Social Media Hub feature allows you to connect third-party social media accounts
              (such as YouTube, TikTok, and Instagram) to publish content directly from Xeno Studio.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Authorization</h3>
            <p className="text-white/60 leading-relaxed mb-4">
              When you connect a social media account, you authorize Xeno Studio to post content
              to that platform on your behalf when you explicitly request publication. We will
              only take actions that you specifically initiate.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Platform Compliance</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>You must comply with each connected platform's terms of service and community guidelines</li>
              <li>You are responsible for ensuring your content meets platform requirements</li>
              <li>We are not responsible for actions taken by third-party platforms, including content removal or account suspension</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">Disconnection</h3>
            <p className="text-white/60 leading-relaxed">
              You can disconnect any connected platform at any time through your account settings.
              Upon disconnection, we will immediately revoke our access and delete associated
              authorization tokens.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Third-Party Changes</h3>
            <p className="text-white/60 leading-relaxed">
              We are not responsible for changes to third-party platform APIs, policies, or
              availability. Such changes may affect the functionality of connected platform features.
            </p>
          </section>

          {/* User Content */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">5. User Content</h2>

            <h3 className="text-lg font-medium mb-2 text-white/90">Ownership</h3>
            <p className="text-white/60 leading-relaxed mb-4">
              You retain ownership of all content you create, upload, or generate using the Service
              ("User Content"). We do not claim ownership of your User Content.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">License Grant</h3>
            <p className="text-white/60 leading-relaxed mb-4">
              By using the Service, you grant Xeno Studio a limited, non-exclusive, royalty-free
              license to process, store, display, and transmit your User Content as necessary to
              provide the Service. This includes publishing content to connected platforms when you
              request it.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Your Responsibilities</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>You are solely responsible for your User Content</li>
              <li>You must ensure your content does not violate any laws or third-party rights</li>
              <li>You must have all necessary rights and permissions to use and share your content</li>
              <li>You are responsible for ensuring content complies with platform guidelines when publishing to social media</li>
            </ul>
          </section>

          {/* Prohibited Uses */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">6. Prohibited Uses</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              You agree not to use the Service to:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>Create, upload, or share illegal content</li>
              <li>Generate or distribute child sexual abuse material (CSAM) or content sexualizing minors</li>
              <li>Create content that promotes violence, terrorism, or hatred against individuals or groups</li>
              <li>Infringe on intellectual property rights of others</li>
              <li>Harass, abuse, threaten, or impersonate others</li>
              <li>Engage in spam, phishing, or fraudulent activities</li>
              <li>Attempt to gain unauthorized access to the Service or other users' accounts</li>
              <li>Interfere with or disrupt the Service or servers</li>
              <li>Use the Service for any unlawful purpose</li>
              <li>Violate the terms of connected third-party platforms</li>
              <li>Generate deepfakes or synthetic media intended to deceive or harm</li>
              <li>Circumvent any usage limits or access controls</li>
            </ul>
          </section>

          {/* Intellectual Property */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">7. Intellectual Property</h2>
            <p className="text-white/60 leading-relaxed">
              The Service, including its original content, features, and functionality, is owned
              by Xeno Studio and is protected by international copyright, trademark, patent, trade
              secret, and other intellectual property laws. Our trademarks and trade dress may not
              be used in connection with any product or service without our prior written consent.
            </p>
          </section>

          {/* Payment Terms */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">8. Payment Terms</h2>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>Certain features may require payment of fees</li>
              <li>All fees are stated in EUR (euros) unless otherwise specified</li>
              <li>Applicable VAT is calculated and shown at checkout and added where required</li>
              <li>Subscription fees are billed in advance on a recurring basis</li>
              <li>Refunds are provided in accordance with our refund policy</li>
              <li>We reserve the right to change pricing with reasonable notice</li>
            </ul>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">9. Limitation of Liability</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
              EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p className="text-white/60 leading-relaxed mb-4">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, XENO STUDIO SHALL NOT BE LIABLE FOR:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>Indirect, incidental, special, consequential, or punitive damages</li>
              <li>Loss of profits, data, use, or goodwill</li>
              <li>Service interruptions or platform outages</li>
              <li>Third-party platform API changes or availability</li>
              <li>Actions taken by connected social media platforms</li>
              <li>Account suspensions or content removal by third parties</li>
            </ul>
            <p className="text-white/60 leading-relaxed">
              IN NO EVENT SHALL OUR TOTAL LIABILITY EXCEED THE GREATER OF (A) THE AMOUNT YOU
              PAID US IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM, OR (B) ONE HUNDRED EUROS (€100).
            </p>
          </section>

          {/* Indemnification */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">10. Indemnification</h2>
            <p className="text-white/60 leading-relaxed">
              You agree to indemnify, defend, and hold harmless Xeno Studio, its officers,
              directors, employees, and agents from any claims, damages, losses, liabilities,
              costs, and expenses (including reasonable attorneys' fees) arising out of or
              related to your use of the Service, your User Content, or your violation of
              these Terms.
            </p>
          </section>

          {/* Termination */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">11. Termination</h2>

            <h3 className="text-lg font-medium mb-2 text-white/90">By Us</h3>
            <p className="text-white/60 leading-relaxed mb-4">
              We may suspend or terminate your account and access to the Service at any time,
              with or without cause, and with or without notice. Reasons for termination may
              include violation of these Terms, harmful or illegal activity, or extended inactivity.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">By You</h3>
            <p className="text-white/60 leading-relaxed mb-4">
              You may close your account at any time through your account settings or by
              contacting us. Upon closure, your right to use the Service will immediately cease.
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Effect of Termination</h3>
            <p className="text-white/60 leading-relaxed">
              Upon termination, all licenses and rights granted to you under these Terms will
              immediately terminate. We may delete your account data in accordance with our
              data retention policies.
            </p>
          </section>

          {/* Dispute Resolution */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">12. Dispute Resolution</h2>
            <p className="text-white/60 leading-relaxed">
              Any disputes arising out of or relating to these Terms or the Service shall be
              resolved through good-faith negotiations. If negotiations fail, disputes shall
              be settled through binding arbitration in accordance with applicable arbitration
              rules, except where prohibited by law.
            </p>
          </section>

          {/* Governing Law */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">13. Governing Law</h2>
            <p className="text-white/60 leading-relaxed">
              These Terms shall be governed by and construed in accordance with applicable laws,
              without regard to conflict of law principles. You agree to submit to the personal
              jurisdiction of the courts for the resolution of any disputes not subject to
              arbitration.
            </p>
          </section>

          {/* General Provisions */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">14. General Provisions</h2>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li><strong className="text-white/80">Entire Agreement:</strong> These Terms constitute the entire agreement between you and Xeno Studio regarding the Service.</li>
              <li><strong className="text-white/80">Severability:</strong> If any provision is found unenforceable, the remaining provisions will continue in effect.</li>
              <li><strong className="text-white/80">Waiver:</strong> Our failure to enforce any right or provision shall not constitute a waiver of such right or provision.</li>
              <li><strong className="text-white/80">Assignment:</strong> You may not assign these Terms without our prior written consent.</li>
            </ul>
          </section>

          {/* Contact */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">15. Contact Us</h2>
            <p className="text-white/60 leading-relaxed">
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <div className="mt-4 p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p className="text-white/80 font-medium">Xeno Studio</p>
              <p className="text-white/60 mt-2">Email: legal@xeno-studio.com</p>
            </div>
          </section>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/30">
            © {new Date().getFullYear()} Xeno Studio. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-white/40">
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Terms;
