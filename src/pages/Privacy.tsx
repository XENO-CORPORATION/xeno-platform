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
              when you use our website at xenostudio.ai and our services.
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
              {/*
                Do not restore an "encrypted at rest" claim here without first
                implementing it. Verified 2026-07-29: the schema stores
                `access_token TEXT` / `refresh_token TEXT`, there is not one crypto
                primitive anywhere in src/server (no createCipheriv, no AES, no
                encryption key in any .env.example), and the host has no LUKS or
                dm-crypt volume. Passwords and session tokens ARE hashed — those
                claims are accurate; this one was not, and it sat in a document
                that Art. 13 GDPR makes binding.
              */}
              <li>OAuth tokens are held in access-restricted storage, separate from your profile</li>
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
              {/*
                Three claims were removed here on 2026-07-29 because they were not
                true: at-rest encryption (no crypto primitive in src/server, no LUKS
                on the host), "regular security audits" (none have been performed),
                and encrypted backups (the backup path writes plain dumps).
                Each is a good thing to implement — but a privacy notice has to
                describe what IS done, and this one is legally binding under
                Art. 13 GDPR. Re-add a line here only after the control ships.
              */}
              <li>Passwords are hashed using bcrypt, and session tokens are stored only as hashes</li>
              <li>Access to user data is restricted to authorized personnel only</li>
              <li>We maintain regular database backups with tested restores</li>
            </ul>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">6. Data Retention</h2>
            <ul className="list-disc list-inside text-white/60 space-y-2">
              <li>Account data is retained while your account is active</li>
              <li>OAuth tokens are deleted immediately when you disconnect a platform</li>
              <li>Content you delete is removed from our active systems within 30 days</li>
              <li>Upon account deletion, your personal data is removed within 30 days, apart from
                  the two narrow exceptions set out below</li>
              <li>Anonymous, aggregated data may be retained for analytics purposes</li>
            </ul>

            <h3 className="text-lg font-semibold mt-6 mb-3 text-white/90">Specific periods</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-white/60">
                <thead className="text-white/80 border-b border-white/10">
                  <tr>
                    <th className="py-2 pr-4 font-medium">What</th>
                    <th className="py-2 pr-4 font-medium">How long</th>
                    <th className="py-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr>
                    <td className="py-2 pr-4">Download records (which app, which version, when)</td>
                    <td className="py-2 pr-4">400 days</td>
                    <td className="py-2">Security and licence auditing. Payment disputes and
                        licence questions routinely arrive more than a year later.</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Download session records</td>
                    <td className="py-2 pr-4">180 days</td>
                    <td className="py-2">To resume an interrupted download or purchase, and to
                        understand where the process fails.</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Records of outdated app versions being refused</td>
                    <td className="py-2 pr-4">90 days</td>
                    <td className="py-2">Operational only — to see how many people a minimum
                        version requirement affects.</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Purchase acknowledgements (see below)</td>
                    <td className="py-2 pr-4">Retained</td>
                    <td className="py-2">Evidence of the agreement you gave at checkout.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-semibold mt-6 mb-3 text-white/90">
              What survives account deletion, and why
            </h3>
            <p className="text-white/60 leading-relaxed mb-4">
              Two things are kept after you delete your account. We are telling you plainly rather
              than relying on a general clause about &ldquo;legitimate business purposes&rdquo;:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-4">
              <li><strong className="text-white/80">Your checkout acknowledgement.</strong> Before
                  a purchase you confirm that you want immediate access and that you understand
                  this ends your 14-day right of withdrawal. We keep that record, its exact
                  wording and its timestamp.</li>
              <li><strong className="text-white/80">Your download record.</strong> Which
                  application and version was obtained, and when, for up to 400 days.</li>
            </ul>
            <p className="text-white/60 leading-relaxed mb-4">
              Both are kept under Article 17(3)(e) GDPR, which permits retention where it is
              necessary for the establishment, exercise or defence of legal claims. Both are the
              evidence in a payment dispute, and a dispute is usually raised after an account has
              been closed &mdash; so deleting them on request would mean deleting them at exactly
              the moment they are needed.
            </p>
            <p className="text-white/60 leading-relaxed">
              <strong className="text-white/80">Your email address is not kept.</strong> It is
              replaced by a keyed one-way code that cannot be turned back into an address. Its only
              use is to answer a question you yourself raise: if you contact us about a charge, we
              can derive the same code from the address you write from and locate the record. It
              cannot be used to identify you in any other context, and we cannot reverse it.
            </p>
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
            <h2 className="text-2xl font-semibold mb-4 text-white">9. Who Else Receives Your Data</h2>
            <p className="text-white/60 leading-relaxed">
              We use a small number of processors to run the service. Each receives only what it
              needs, under a data-processing agreement, and none of them may use your data for their
              own purposes.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="py-2 pr-4 font-semibold text-white/80">Processor</th>
                    <th className="py-2 pr-4 font-semibold text-white/80">What it receives</th>
                    <th className="py-2 font-semibold text-white/80">Why</th>
                  </tr>
                </thead>
                <tbody className="text-white/60">
                  <tr className="border-b border-white/[0.05]">
                    <td className="py-2 pr-4">Stripe</td>
                    <td className="py-2 pr-4">name, email, billing address, payment token</td>
                    <td className="py-2">taking payments and preventing fraud</td>
                  </tr>
                  <tr className="border-b border-white/[0.05]">
                    <td className="py-2 pr-4">Cloudflare</td>
                    <td className="py-2 pr-4">IP address, request metadata</td>
                    <td className="py-2">serving the site and blocking abuse</td>
                  </tr>
                  <tr className="border-b border-white/[0.05]">
                    <td className="py-2 pr-4">Resend</td>
                    <td className="py-2 pr-4">email address, message content</td>
                    <td className="py-2">sending account and notification email</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Our hosting provider</td>
                    <td className="py-2 pr-4">everything stored in the service</td>
                    <td className="py-2">running the servers and databases</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-white/60 leading-relaxed mt-4">
              Where a processor operates outside the EEA, transfers are covered by the European
              Commission&apos;s Standard Contractual Clauses. We do not sell your data, and we do not
              share it for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">10. Our Legal Basis (GDPR Art. 6)</h2>
            <p className="text-white/60 leading-relaxed">
              We process personal data only where we have a lawful basis for it:
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mt-4">
              <li>
                <strong className="text-white/80">Performance of a contract</strong> (Art. 6(1)(b)) —
                to create and run your account, provide the software and platform you subscribed to,
                and take payment for it.
              </li>
              <li>
                <strong className="text-white/80">Legal obligation</strong> (Art. 6(1)(c)) — to issue
                and keep invoices and tax records for as long as the law requires, which is why some
                billing data outlives a deleted account.
              </li>
              <li>
                <strong className="text-white/80">Legitimate interests</strong> (Art. 6(1)(f)) — to
                keep the service secure, investigate abuse, and understand which features are used.
                You may object to processing on this basis at any time.
              </li>
              <li>
                <strong className="text-white/80">Consent</strong> (Art. 6(1)(a)) — where we ask for
                it explicitly, such as optional email you can unsubscribe from. You may withdraw
                consent at any time without affecting processing already carried out.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">11. Changes to This Policy</h2>
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
            <h2 className="text-2xl font-semibold mb-4 text-white">12. Contact Us</h2>
            <p className="text-white/60 leading-relaxed">
              If you have any questions about this Privacy Policy, your personal data, or wish to
              exercise your rights, please contact us at:
            </p>
            <div className="mt-4 p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p className="text-white/80 font-medium">Xeno Studio</p>
              <p className="text-white/60 mt-2">Email: privacy@xenostudio.ai</p>
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
