import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage, { Section, Prose, CheckList } from '../components/marketing/MarketingPage';

const Cookies: React.FC = () => (
  <MarketingPage
    eyebrow="LEGAL"
    title="Cookie policy"
    subtitle="How XENO uses cookies and similar technologies to keep you signed in, remember your preferences, and improve the platform — and how you can control them."
    updated="June 2026"
  >
    <Section title="What cookies are">
      <Prose
        blocks={[
          {
            p: (
              <>
                Cookies are small text files that a website stores on your device when you visit. They are
                widely used to make sites work, to make them work more efficiently, and to provide
                information to the site owners. We also use similar technologies such as local storage and
                pixels; in this policy we refer to all of them collectively as "cookies." Cookies can be
                "session" cookies, which are deleted when you close your browser, or "persistent" cookies,
                which remain until they expire or you delete them.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="How we use them">
      <Prose
        blocks={[
          {
            p: (
              <>
                We use cookies to keep you securely signed in to your XENO account, to remember your
                settings and preferences, to keep the platform safe from fraud and abuse, and to understand
                how our services are used so we can improve them. We do not use cookies to build advertising
                profiles, and we do not sell the information cookies collect. Where required by law, we ask
                for your consent before setting non-essential cookies.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Types of cookies we use">
      <CheckList
        items={[
          'Strictly necessary — required to sign in, secure your session, and operate core features. These cannot be switched off in our systems.',
          'Preferences — remember choices such as language, theme, and layout so the platform feels consistent across visits.',
          'Analytics — help us understand which features are used and where to improve, using aggregated, privacy-respecting measurement.',
          'Security — detect suspicious activity, prevent fraud and abuse, and protect your account and our infrastructure.',
        ]}
      />
    </Section>

    <Section title="Details">
      <Prose
        blocks={[
          {
            h: 'Third-party cookies',
            p: (
              <>
                Some cookies are set by trusted third parties that provide services on our behalf — for
                example, our payment processor for secure checkout, our authentication providers for OAuth
                sign-in, and our analytics and infrastructure providers. These partners may set cookies when
                you interact with the relevant features. Their use of cookies is governed by their own
                policies, and we work only with providers that maintain appropriate privacy and security
                standards.
              </>
            ),
          },
          {
            h: 'Managing cookies',
            p: (
              <>
                You can control and delete cookies through your browser settings — most browsers let you
                block or remove cookies and notify you when new ones are set. Where we offer a cookie
                preference center, you can use it to accept or reject non-essential categories at any time.
                Please note that blocking strictly necessary cookies may prevent parts of XENO, including
                sign-in, from working correctly.
              </>
            ),
          },
          {
            h: 'Do Not Track',
            p: (
              <>
                Some browsers offer a "Do Not Track" (DNT) signal. There is no single industry standard for
                how sites should respond to DNT, so we do not currently respond to DNT signals. We will
                continue to monitor developments in this area and update our approach if a common standard
                emerges.
              </>
            ),
          },
          {
            h: 'Changes',
            p: (
              <>
                We may update this cookie policy from time to time to reflect changes in technology, our
                services, or the law. When we make material changes, we will update the date at the top of
                this page. For more on how we handle your information generally, please see our{' '}
                <Link to="/privacy" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  Privacy Policy
                </Link>
                .
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Contact">
      <Prose
        blocks={[
          {
            p: (
              <>
                If you have questions about how we use cookies, contact us at{' '}
                <a href="mailto:privacy@xenostudio.ai" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  privacy@xenostudio.ai
                </a>
                .
              </>
            ),
          },
        ]}
      />
    </Section>
  </MarketingPage>
);

export default Cookies;
