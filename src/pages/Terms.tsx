import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage from '../components/marketing/MarketingPage';

const Terms: React.FC = () => {
  return (
    <MarketingPage eyebrow="Legal" title="Terms of Service" updated="September 2026">
      <div className="legal-prose">
          {/* Acceptance of Terms */}
          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using XENOsystem ("the Service"), you agree to be bound by these
              Terms of Service ("Terms"). If you do not agree to these Terms, you may not access
              or use the Service. These Terms constitute a legally binding agreement between you
              and XENOsystem.
            </p>
            <p>
              We may modify these Terms at any time. If we make material changes, we will notify
              you through the Service or by email. Your continued use of the Service after changes
              are posted constitutes your acceptance of the modified Terms.
            </p>
          </section>

          {/* Description of Service */}
          <section>
            <h2>2. Description of Service</h2>
            <p>
              XENOsystem is a content creation platform that provides:
            </p>
            <ul>
              <li>AI-powered image and video generation tools</li>
              <li>Video editing and enhancement capabilities</li>
              <li>Social Media Hub for publishing content to connected platforms (YouTube, TikTok, Instagram, etc.)</li>
              <li>Content management and organization features</li>
              <li>Cloud-based storage and processing</li>
            </ul>
          </section>

          {/* User Accounts */}
          <section>
            <h2>3. User Accounts</h2>

            <h3>Eligibility</h3>
            <p>
              You must be at least 18 years of age, or the age of legal majority in your
              jurisdiction, to use the Service. If you are under 18, you may only use the
              Service with the involvement and consent of a parent or legal guardian who
              agrees to be bound by these Terms.
            </p>

            <h3>Account Security</h3>
            <ul>
              <li>You are responsible for maintaining the confidentiality of your account credentials</li>
              <li>You are responsible for all activities that occur under your account</li>
              <li>You must notify us immediately of any unauthorized use of your account</li>
              <li>One account per person; creating multiple accounts is prohibited</li>
            </ul>

            <h3>Account Information</h3>
            <p>
              You agree to provide accurate, current, and complete information during registration
              and to update such information to keep it accurate, current, and complete.
            </p>
          </section>

          {/* Connected Platforms */}
          <section>
            <h2>4. Connected Platforms</h2>
            <p>
              Our Social Media Hub feature allows you to connect third-party social media accounts
              (such as YouTube, TikTok, and Instagram) to publish content directly from XENOsystem.
            </p>

            <h3>Authorization</h3>
            <p>
              When you connect a social media account, you authorize XENOsystem to post content
              to that platform on your behalf when you explicitly request publication. We will
              only take actions that you specifically initiate.
            </p>

            <h3>Platform Compliance</h3>
            <ul>
              <li>You must comply with each connected platform's terms of service and community guidelines</li>
              <li>You are responsible for ensuring your content meets platform requirements</li>
              <li>We are not responsible for actions taken by third-party platforms, including content removal or account suspension</li>
            </ul>

            <h3>Disconnection</h3>
            <p>
              You can disconnect any connected platform at any time through your account settings.
              Upon disconnection, we will immediately revoke our access and delete associated
              authorization tokens.
            </p>

            <h3>Third-Party Changes</h3>
            <p>
              We are not responsible for changes to third-party platform APIs, policies, or
              availability. Such changes may affect the functionality of connected platform features.
            </p>
          </section>

          {/* User Content */}
          <section>
            <h2>5. User Content</h2>

            <h3>Ownership</h3>
            <p>
              You retain ownership of all content you create, upload, or generate using the Service
              ("User Content"). We do not claim ownership of your User Content.
            </p>

            <h3>License Grant</h3>
            <p>
              By using the Service, you grant XENOsystem a limited, non-exclusive, royalty-free
              license to process, store, display, and transmit your User Content as necessary to
              provide the Service. This includes publishing content to connected platforms when you
              request it.
            </p>

            <h3>Your Responsibilities</h3>
            <ul>
              <li>You are solely responsible for your User Content</li>
              <li>You must ensure your content does not violate any laws or third-party rights</li>
              <li>You must have all necessary rights and permissions to use and share your content</li>
              <li>You are responsible for ensuring content complies with platform guidelines when publishing to social media</li>
            </ul>
          </section>

          {/* Prohibited Uses */}
          <section>
            <h2>6. Prohibited Uses</h2>
            <p>
              You agree not to use the Service to:
            </p>
            <ul>
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
            <h2>7. Intellectual Property</h2>
            <p>
              The Service, including its original content, features, and functionality, is owned
              by XENOsystem and is protected by international copyright, trademark, patent, trade
              secret, and other intellectual property laws. Our trademarks and trade dress may not
              be used in connection with any product or service without our prior written consent.
            </p>
          </section>

          {/* Payment Terms */}
          <section>
            <h2>8. Payment Terms</h2>
            <ul>
              <li>Certain features may require payment of fees</li>
              <li>All fees are stated in EUR (euros) unless otherwise specified</li>
              <li>Applicable VAT is calculated and shown at checkout and added where required</li>
              <li>Subscription fees are billed in advance on a recurring basis</li>
              <li>Refunds are provided in accordance with our refund policy</li>
              <li>We reserve the right to change pricing with reasonable notice</li>
            </ul>

            <h3>Subscription term and automatic renewal</h3>
            <p>
              A subscription runs for the period shown at purchase — monthly or annual — and{' '}
              <strong className="text-white/80">renews automatically</strong> for the same period unless
              you cancel before the current period ends. The renewal price is the price shown on your
              billing page. If we change it, we will tell you by email before the change takes effect,
              and you may cancel before it applies.
            </p>

            <h3>Cancelling</h3>
            <p>
              You may cancel at any time from your billing page, or by emailing{' '}
              <a href="mailto:billing@xenostudio.ai" className="text-white/80 underline underline-offset-2">billing@xenostudio.ai</a>.
              Your plan stays active until the end of the period you have already paid for; we do not
              pro-rate the remainder. After that it does not renew and you are not charged again.
              Cancelling does not delete your account or your data, and it does not remove software
              already installed — but features that depend on an active plan stop working.
            </p>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2>9. Right of Withdrawal (consumers in the EU)</h2>
            <p>
              If you are a consumer resident in the European Union, you normally have{' '}
              <strong className="text-white/80">14 days</strong> to withdraw from a distance contract
              without giving any reason.
            </p>
            <p>
              Because our software and platform are made available to you immediately after payment,
              we ask you at checkout to request that immediate access and to confirm that you
              understand{' '}
              <strong className="text-white/80">this ends your right of withdrawal</strong> for that
              digital content. We record that confirmation, the exact wording you agreed to, and the
              time you gave it.
            </p>
            <p>
              If you would rather keep your withdrawal right, do not complete checkout — contact{' '}
              <a href="mailto:support@xenostudio.ai" className="text-white/80 underline underline-offset-2">support@xenostudio.ai</a>{' '}
              and we will arrange delayed access instead.
            </p>
            <p>
              This statutory right is separate from our{' '}
              <Link to="/refunds" className="text-white/80 underline underline-offset-2">Refund Policy</Link>,
              which may be more generous and is never less. Nothing in these Terms limits rights you
              have under mandatory consumer law.
            </p>
            <div className="mt-4 p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p>Exercising the right</p>
              <p>
                Where the right applies, tell us clearly — an email to{' '}
                <a href="mailto:support@xenostudio.ai" className="text-white/80 underline underline-offset-2">support@xenostudio.ai</a>{' '}
                is enough. You may use the{' '}
                <Link to="/withdrawal" className="text-white/80 underline underline-offset-2">model withdrawal form</Link>,
                but you do not have to. We will
                refund within 14 days of being told, using the same payment method you used.
              </p>
            </div>
          </section>

          <section>
            <h2>10. Limitation of Liability</h2>
            <p>
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
              EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, XENO STUDIO SHALL NOT BE LIABLE FOR:
            </p>
            <ul>
              <li>Indirect, incidental, special, consequential, or punitive damages</li>
              <li>Loss of profits, data, use, or goodwill</li>
              <li>Service interruptions or platform outages</li>
              <li>Third-party platform API changes or availability</li>
              <li>Actions taken by connected social media platforms</li>
              <li>Account suspensions or content removal by third parties</li>
            </ul>
            <p>
              IN NO EVENT SHALL OUR TOTAL LIABILITY EXCEED THE GREATER OF (A) THE AMOUNT YOU
              PAID US IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM, OR (B) ONE HUNDRED EUROS (€100).
            </p>
          </section>

          {/* Indemnification */}
          <section>
            <h2>11. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless XENOsystem, its officers,
              directors, employees, and agents from any claims, damages, losses, liabilities,
              costs, and expenses (including reasonable attorneys' fees) arising out of or
              related to your use of the Service, your User Content, or your violation of
              these Terms.
            </p>
          </section>

          {/* Termination */}
          <section>
            <h2>12. Termination</h2>

            <h3>By Us</h3>
            <p>
              We may suspend or terminate your account and access to the Service at any time,
              with or without cause, and with or without notice. Reasons for termination may
              include violation of these Terms, harmful or illegal activity, or extended inactivity.
            </p>

            <h3>By You</h3>
            <p>
              You may close your account at any time through your account settings or by
              contacting us. Upon closure, your right to use the Service will immediately cease.
            </p>

            <h3>Effect of Termination</h3>
            <p>
              Upon termination, all licenses and rights granted to you under these Terms will
              immediately terminate. We may delete your account data in accordance with our
              data retention policies.
            </p>
          </section>

          {/* Dispute Resolution */}
          <section>
            <h2>13. Dispute Resolution</h2>
            <p>
              Any disputes arising out of or relating to these Terms or the Service shall be
              resolved through good-faith negotiations. If negotiations fail, disputes shall
              be settled through binding arbitration in accordance with applicable arbitration
              rules, except where prohibited by law.
            </p>
          </section>

          {/* Governing Law */}
          <section>
            <h2>14. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws,
              without regard to conflict of law principles. You agree to submit to the personal
              jurisdiction of the courts for the resolution of any disputes not subject to
              arbitration.
            </p>
          </section>

          {/* General Provisions */}
          <section>
            <h2>15. General Provisions</h2>
            <ul>
              <li><strong className="text-white/80">Entire Agreement:</strong> These Terms constitute the entire agreement between you and XENOsystem regarding the Service.</li>
              <li><strong className="text-white/80">Severability:</strong> If any provision is found unenforceable, the remaining provisions will continue in effect.</li>
              <li><strong className="text-white/80">Waiver:</strong> Our failure to enforce any right or provision shall not constitute a waiver of such right or provision.</li>
              <li><strong className="text-white/80">Assignment:</strong> You may not assign these Terms without our prior written consent.</li>
            </ul>
          </section>

          {/* Contact */}
          <section>
            <h2>16. Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <div className="mt-4 p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p>XENOsystem</p>
              <p>Email: legal@xenostudio.ai</p>
            </div>
          </section>
      </div>
    </MarketingPage>
  );
};

export default Terms;
