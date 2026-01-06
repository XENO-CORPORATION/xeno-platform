import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const Privacy: React.FC = () => {
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
          <h1 className="text-4xl lg:text-5xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-white/40 text-sm">Last updated: December 2024</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8">
          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">1. Introduction</h2>
            <p className="text-white/60 leading-relaxed">
              Welcome to Xeno Studio ("we," "our," or "us"). Xeno Studio is a content creation platform
              that provides AI-powered tools for image generation, video editing, and social media publishing.
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information
              when you use our website at xeno-studio.com and our services.
            </p>
            <p className="text-white/60 leading-relaxed mt-4">
              By using Xeno Studio, you agree to the collection and use of information in accordance with
              this policy. If you do not agree with our policies and practices, please do not use our services.
            </p>
          </section>

          {/* Data We Collect */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">2. Data We Collect</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              We collect information that you provide directly to us and information that is automatically
              collected when you use our services:
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Account Information</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>Email address</li>
              <li>Username and display name</li>
              <li>Password (stored securely using industry-standard hashing)</li>
              <li>Profile information you choose to provide</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">Connected Platform Data</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>OAuth tokens from connected social platforms (YouTube, TikTok, Instagram, etc.)</li>
              <li>Basic profile information from connected accounts (as authorized by you)</li>
              <li>Platform user IDs necessary for publishing content on your behalf</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">Content You Create</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>Images, videos, and other media you create or upload</li>
              <li>Prompts and inputs used for AI generation</li>
              <li>Project files and saved work</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">Usage Analytics</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>Device information and browser type</li>
              <li>IP address and approximate location</li>
              <li>Pages visited and features used</li>
              <li>Time spent on the platform</li>
            </ul>
          </section>

          {/* Third-Party Platform Integrations */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">3. Third-Party Platform Integrations</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              Xeno Studio's Social Media Hub feature allows you to connect your social media accounts
              to publish content directly from our platform. Here's what you need to know:
            </p>

            <h3 className="text-lg font-medium mb-2 text-white/90">Platforms We Connect To</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>YouTube (Google)</li>
              <li>TikTok</li>
              <li>Instagram</li>
              <li>Other social platforms as they become available</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">What We Access</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>Basic profile information (username, profile picture, account ID)</li>
              <li>Permission to post content on your behalf when you explicitly request it</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">What We Do NOT Access</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>Private messages or direct messages</li>
              <li>Followers or following lists (unless specifically required and authorized)</li>
              <li>Analytics or insights data (unless specifically authorized)</li>
              <li>Content from other users or your feed</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">How We Handle OAuth Tokens</h3>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>OAuth tokens are stored securely and encrypted at rest</li>
              <li>Tokens are only used to perform actions you explicitly request</li>
              <li>We never share your tokens with third parties</li>
              <li>Tokens are immediately deleted when you disconnect a platform</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 text-white/90">Your Control</h3>
            <p className="text-white/60 leading-relaxed">
              You can disconnect any connected platform at any time through your account settings.
              When you disconnect a platform, we immediately revoke our access and delete the
              associated OAuth tokens. We only post content when you explicitly click "Publish"
              or take similar intentional action.
            </p>
          </section>

          {/* How We Use Data */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">4. How We Use Your Data</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              We use the information we collect for the following purposes:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>To provide our services, including AI content generation and social media publishing</li>
              <li>To process your transactions and manage your account</li>
              <li>To communicate with you about your account, updates, and support requests</li>
              <li>To improve and optimize our platform and user experience</li>
              <li>To detect, prevent, and address technical issues or security threats</li>
              <li>To comply with legal obligations</li>
            </ul>
            <p className="text-white/60 leading-relaxed font-medium">
              We do NOT sell your personal data to third parties. We do NOT use your content to
              train AI models without your explicit consent.
            </p>
          </section>

          {/* Data Storage & Security */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">5. Data Storage & Security</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              We take the security of your data seriously and implement industry-standard measures
              to protect it:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>All data is transmitted using TLS/SSL encryption</li>
              <li>Sensitive data (including OAuth tokens) is encrypted at rest</li>
              <li>Passwords are hashed using secure, one-way algorithms</li>
              <li>We use secure cloud infrastructure with regular security audits</li>
              <li>Access to user data is restricted to authorized personnel only</li>
              <li>We maintain regular backups with encryption</li>
            </ul>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">6. Data Retention</h2>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>Account data is retained while your account is active</li>
              <li>OAuth tokens are deleted immediately when you disconnect a platform</li>
              <li>Content you delete is removed from our active systems within 30 days</li>
              <li>Upon account deletion, all personal data is removed within 30 days, except where
                  we are required to retain it for legal or legitimate business purposes</li>
              <li>Anonymous, aggregated data may be retained for analytics purposes</li>
            </ul>
          </section>

          {/* User Rights */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">7. Your Rights</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              You have the following rights regarding your personal data:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li><strong className="text-white/80">Access:</strong> Request a copy of the personal data we hold about you</li>
              <li><strong className="text-white/80">Correction:</strong> Request correction of inaccurate or incomplete data</li>
              <li><strong className="text-white/80">Deletion:</strong> Request deletion of your account and personal data</li>
              <li><strong className="text-white/80">Portability:</strong> Request an export of your data in a machine-readable format</li>
              <li><strong className="text-white/80">Disconnect:</strong> Disconnect any connected social media platform at any time</li>
              <li><strong className="text-white/80">Withdraw Consent:</strong> Withdraw consent for optional data processing</li>
            </ul>
            <p className="text-white/60 leading-relaxed mt-4">
              To exercise any of these rights, please contact us at the email address provided below.
            </p>
          </section>

          {/* Cookies */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">8. Cookies</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              We use cookies and similar technologies to:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li>Keep you signed in to your account</li>
              <li>Remember your preferences and settings</li>
              <li>Understand how you use our platform (analytics)</li>
              <li>Improve our services and user experience</li>
            </ul>
            <p className="text-white/60 leading-relaxed">
              You can control cookies through your browser settings. Note that disabling certain
              cookies may affect the functionality of our services.
            </p>
          </section>

          {/* Changes to Policy */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">9. Changes to This Policy</h2>
            <p className="text-white/60 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any
              significant changes by posting a notice on our website or sending you an email.
              The "Last updated" date at the top of this policy indicates when it was last revised.
              Your continued use of our services after changes are posted constitutes your acceptance
              of the updated policy.
            </p>
          </section>

          {/* Contact */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">10. Contact Us</h2>
            <p className="text-white/60 leading-relaxed">
              If you have any questions about this Privacy Policy, your personal data, or wish to
              exercise your rights, please contact us at:
            </p>
            <div className="mt-4 p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p className="text-white/80 font-medium">Xeno Studio</p>
              <p className="text-white/60 mt-2">Email: privacy@xeno-studio.com</p>
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

export default Privacy;
