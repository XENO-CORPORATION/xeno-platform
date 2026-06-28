import React from 'react';
import MarketingPage, { Section, Prose, FeatureGrid, CheckList } from '../components/marketing/MarketingPage';

const Press: React.FC = () => (
  <MarketingPage
    eyebrow="PRESS"
    title="Press & media"
    subtitle="Resources for journalists, analysts, and creators writing about XENO. For interviews, review access, or anything not covered here, get in touch."
    updated="June 2026"
  >
    <Section title="About XENO">
      <Prose
        blocks={[
          {
            p: (
              <>
                XENO is an AI-native creative and productivity platform. It brings generative AI together
                with a suite of professional creative apps — image, video, audio, and product design —
                a desktop launcher, embeddable AI agents, and a marketplace, all running on one
                credits-based ecosystem. The goal is to give individuals and small teams studio-grade
                leverage in a single, interoperable platform rather than a sprawl of disconnected
                subscriptions.
              </>
            ),
          },
          {
            p: (
              <>
                Where AI usually arrives as a bolt-on feature, XENO is designed around it from the
                foundation up: a shared inference runtime powers generation and editing across every app,
                and AI agents can operate inside the tools to remove tedious work. XENO is an emerging
                company that builds in the open and ships continuously.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Brand assets">
      <CheckList
        items={[
          'Logo pack — primary wordmark and icon in light and dark variants (SVG and PNG).',
          'Product screenshots — high-resolution captures of the apps and the Hub launcher.',
          'Brand guidelines — color, typography, and usage notes for accurate representation.',
        ]}
      />
      <p className="mt-5 text-[13px] leading-[1.6] text-[#948d83]">
        Brand assets are available on request — email{' '}
        <a href="mailto:press@xenostudio.ai" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">press@xenostudio.ai</a>{' '}
        and we'll send the latest pack.
      </p>
    </Section>

    <Section title="Fast facts">
      <FeatureGrid
        cols={2}
        items={[
          {
            title: 'What it is',
            desc: 'An AI-native ecosystem of creative and productivity apps, a desktop launcher, AI agents, and a marketplace on one credits-based platform.',
          },
          {
            title: "Who it's for",
            desc: 'Independent creators, designers, founders, and small teams who want professional output without a stack of disconnected tools.',
          },
          {
            title: 'Founded',
            desc: 'An emerging company building and shipping in 2026, with new apps and capabilities arriving continuously.',
          },
          {
            title: 'Headquarters',
            desc: 'Remote-first, distributed team — no single office.',
          },
        ]}
      />
    </Section>

    <Section title="Media contact">
      <Prose
        blocks={[
          {
            p: (
              <>
                For interviews, briefings, review access, or fact-checking, reach the team at{' '}
                <a href="mailto:press@xenostudio.ai" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">press@xenostudio.ai</a>.
                We aim to respond to press inquiries quickly and can usually arrange demos on short notice.
              </>
            ),
          },
        ]}
      />
    </Section>
  </MarketingPage>
);

export default Press;
