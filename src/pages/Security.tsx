import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage, { Section, Prose, CheckList } from '../components/marketing/MarketingPage';

const Security: React.FC = () => (
  <MarketingPage
    eyebrow="SECURITY"
    title="Security at XENO"
    subtitle="How we protect your account, your work, and the data you trust us with across XENO Studio, the Hub, our creative apps, agents, and the marketplace."
    updated="June 2026"
  >
    <Section title="Our approach">
      <Prose
        blocks={[
          {
            p: (
              <>
                Security is foundational to how XENO Corporation builds and operates. We design our
                systems with defense-in-depth: multiple, independent layers of protection so that no
                single failure exposes your data. We follow the principle of least privilege, encrypt
                data in transit and at rest, and continuously monitor our infrastructure for anomalies.
                This page explains the practices we use today and the direction we are heading. It is a
                living document and will evolve as the platform grows.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="What we do">
      <CheckList
        items={[
          'Encryption in transit (TLS 1.2+) for all connections to XENO services',
          'Encryption at rest for stored data, backups, and credentials',
          'Least-privilege access controls with role-based permissions for staff',
          'Hardened cloud infrastructure with network isolation and firewalls',
          'Secure session management with the option to enable multi-factor authentication',
          'Scoped API keys you can rotate or revoke at any time',
          'Payment data handled by PCI-compliant processors — we never store raw card numbers',
          'Continuous monitoring, logging, and alerting on production systems',
          'Regular dependency updates and vulnerability patching',
          'A responsible disclosure program that rewards good-faith security research',
        ]}
      />
    </Section>

    <Section title="Details">
      <Prose
        blocks={[
          {
            h: 'Data encryption',
            p: (
              <>
                All traffic between your devices and XENO services is encrypted in transit using TLS
                1.2 or higher, with modern cipher suites and HTTPS enforced across our web properties and
                APIs. Data you store with us — including projects, account information, and backups — is
                encrypted at rest using industry-standard algorithms such as AES-256. Encryption keys are
                managed separately from the data they protect and are rotated on a regular schedule.
              </>
            ),
          },
          {
            h: 'Infrastructure & access controls',
            p: (
              <>
                XENO runs on hardened cloud infrastructure with network segmentation, firewalls, and
                isolated environments separating production from development. Access to production systems
                is restricted to a small number of authorized personnel, granted on a least-privilege
                basis, logged, and reviewed periodically. Administrative access requires strong
                authentication, and sensitive operations are audited. We maintain backups and disaster
                recovery procedures to keep your work safe and available.
              </>
            ),
          },
          {
            h: 'Authentication',
            p: (
              <>
                Accounts are protected by secure, server-side sessions with sensible expiry and the
                ability to sign out of active sessions. We support OAuth sign-in with trusted providers
                and offer scoped API keys for programmatic access — each key can be named, limited, rotated,
                and revoked independently. You can enable optional multi-factor authentication (MFA) for an
                additional layer of protection on your account. We recommend MFA for all users and require
                it for sensitive administrative actions.
              </>
            ),
          },
          {
            h: 'Payment security',
            p: (
              <>
                Payments and credit purchases are processed by established, PCI-DSS compliant payment
                providers. Card details are sent directly to our payment processor and are never stored on
                XENO servers — we retain only the limited, non-sensitive metadata needed to manage your
                billing, subscriptions, and credits. This keeps the most sensitive payment data out of our
                systems entirely.
              </>
            ),
          },
          {
            h: 'Data privacy & retention',
            p: (
              <>
                We collect only the data we need to operate the platform and we retain it only for as long
                as necessary to provide our services or meet legal obligations. You can request access to,
                correction of, or deletion of your personal data. For full details on what we collect, how
                we use it, and your rights, see our{' '}
                <Link to="/privacy" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  Privacy Policy
                </Link>
                .
              </>
            ),
          },
          {
            h: 'Responsible disclosure',
            p: (
              <>
                We welcome reports from the security community. If you believe you have found a
                vulnerability, please report it to{' '}
                <a href="mailto:security@xenostudio.ai" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  security@xenostudio.ai
                </a>{' '}
                with enough detail to reproduce the issue. We commit to acknowledging good-faith reports
                promptly, investigating thoroughly, keeping you updated, and recognizing or rewarding
                researchers who help us improve. Please give us a reasonable window to remediate before any
                public disclosure, and avoid accessing, modifying, or deleting data that is not your own.
              </>
            ),
          },
          {
            h: 'Compliance',
            p: (
              <>
                We build our practices around widely recognized security and privacy frameworks and are
                actively working toward formal certification against standard industry frameworks as the
                platform matures. We are happy to discuss our security posture with enterprise customers and
                provide additional documentation under appropriate agreements.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Report a security issue">
      <Prose
        blocks={[
          {
            p: (
              <>
                If you have discovered a vulnerability or have any concern about the security of XENO,
                please contact us at{' '}
                <a href="mailto:security@xenostudio.ai" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  security@xenostudio.ai
                </a>
                . We take every report seriously and will respond as quickly as we can.
              </>
            ),
          },
        ]}
      />
    </Section>
  </MarketingPage>
);

export default Security;
