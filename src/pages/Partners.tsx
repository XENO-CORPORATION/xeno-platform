import React from 'react';
import MarketingPage, { Section, Prose, FeatureGrid, CheckList, CTA } from '../components/marketing/MarketingPage';

const Partners: React.FC = () => (
  <MarketingPage
    eyebrow="PARTNERS"
    title="Partner with XENO"
    subtitle="XENO grows through the people who build on it, sell it, and teach it. Whatever you bring to the table, there's a way to work together."
    updated="June 2026"
  >
    <Section title="Ways to partner">
      <FeatureGrid
        cols={3}
        items={[
          {
            title: 'Technology & integration partners',
            desc: 'Connect your product to the XENO ecosystem through our APIs, formats, and agent runtime to reach creators where they already work.',
          },
          {
            title: 'Marketplace developers',
            desc: 'Publish panels, plugins, models, and agents to the XENO Marketplace and earn on every purchase, subscription, or per-use invocation.',
          },
          {
            title: 'Resellers & agencies',
            desc: 'Bring XENO to your clients and teams with volume terms, and deliver work faster on a single integrated platform.',
          },
          {
            title: 'Affiliates',
            desc: 'Refer creators and earn on qualifying subscriptions — with clean tracking and timely payouts.',
          },
          {
            title: 'Education',
            desc: 'Equip students and programs with professional, AI-native creative tools through education pricing and curriculum support.',
          },
          {
            title: 'Startups program',
            desc: 'Early-stage teams get platform access and support to build their product and content on XENO from day one.',
          },
        ]}
      />
    </Section>

    <Section title="Why partner">
      <CheckList
        items={[
          'One integrated platform — reach creators across image, video, audio, design, and agents from a single integration.',
          'A growing marketplace — sell to an audience that is already buying tools, models, and agents.',
          'Fair, transparent economics — clear revenue share, usage-based metering where applicable, and reliable payouts.',
          'Open and documented — standard formats and APIs mean less custom glue and less lock-in for everyone.',
          'Build alongside us — direct access to the team, early roadmap visibility, and co-marketing for strong partners.',
        ]}
      />
    </Section>

    <Section title="Get in touch">
      <Prose
        blocks={[
          {
            p: (
              <>
                Tell us what you're building or who you'd bring to XENO, and we'll find the right way to
                work together. Email{' '}
                <a href="mailto:partners@xenostudio.ai" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">partners@xenostudio.ai</a>{' '}
                with a few lines about your company and your goals, and the relevant team will follow up.
              </>
            ),
          },
        ]}
      />
    </Section>

    <CTA
      href="/marketplace"
      label="Explore the marketplace"
      title="Build on XENO"
      desc="See what developers are already publishing and where your product fits."
    />
  </MarketingPage>
);

export default Partners;
