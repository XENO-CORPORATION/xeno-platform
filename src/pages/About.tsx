import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage, { Section, Prose, FeatureGrid, CTA } from '../components/marketing/MarketingPage';

const About: React.FC = () => (
  <MarketingPage
    eyebrow="ABOUT"
    title="Building the AI-native creative platform"
    subtitle="XENO is one integrated ecosystem for making things — creative apps, productivity tools, and AI agents that work together on a shared platform."
    updated="June 2026"
  >
    <Section title="Our mission">
      <Prose
        blocks={[
          {
            p: (
              <>
                Creative software has spent two decades getting heavier, more fragmented, and more
                expensive — a different subscription for every task, none of them aware of the others.
                Generative AI changed what's possible, but it mostly arrived as bolt-on buttons inside
                tools that were never designed for it.
              </>
            ),
          },
          {
            p: (
              <>
                XENO exists to rebuild the creative stack from first principles for the AI era. Our
                mission is to give individuals and small teams the kind of leverage that used to require
                a studio: a single platform where you can generate, edit, compose, and ship — with AI as
                a genuine collaborator and your work flowing freely between apps.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="What we believe">
      <FeatureGrid
        cols={3}
        items={[
          {
            title: 'Creators first',
            desc: 'Every decision starts with the person making something, not the org chart or the upsell. Power and control belong to the user.',
          },
          {
            title: 'AI as a tool, not a gimmick',
            desc: 'AI should remove tedium and expand what you can attempt — never replace your taste or hide what it is doing behind magic.',
          },
          {
            title: 'One integrated platform',
            desc: 'Pixel, Motion, Sound, Canvas, the Hub, and agents share one foundation so your work moves between them without friction.',
          },
          {
            title: 'Open & interoperable',
            desc: 'Standard formats, documented APIs, and a marketplace anyone can build on. Your files and workflows are never a hostage.',
          },
          {
            title: 'Privacy by default',
            desc: 'Your projects are yours. We design for local-first work, clear data boundaries, and bring-your-own-key wherever it makes sense.',
          },
          {
            title: 'Built in public',
            desc: 'We ship early, change the changelog often, and tell you what is real versus what is coming. Credibility is earned in the open.',
          },
        ]}
      />
    </Section>

    <Section title="What we're building">
      <Prose
        blocks={[
          {
            h: 'A connected ecosystem',
            p: (
              <>
                The platform spans creative apps — <Link to="/products" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">Pixel, Motion, Sound, and Canvas</Link> —
                alongside the XENO Hub launcher, an embeddable agent runtime, and a marketplace where
                developers can publish panels, plugins, models, and agents. Underneath sits a unified
                inference runtime and a cloud OS that handles identity, entitlements, usage, and sync.
              </>
            ),
          },
          {
            h: 'Local-first, without lock-in',
            p: (
              <>
                Apps can run on your machine and connect to cloud capabilities when you choose. Standard
                formats, documented APIs, and a shared engine keep your work portable rather than trapping
                it inside one product or provider.
              </>
            ),
          },
          {
            p: (
              <>
                We're an emerging company building ambitiously and shipping continuously. Explore what's
                live today on the <Link to="/products" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">products page</Link> —
                and expect it to keep growing.
              </>
            ),
          },
        ]}
      />
    </Section>

    <CTA
      href="/careers"
      label="See open roles"
      title="Want to help build it?"
      desc="We're a small, senior team that works across the stack and ships fast."
    />
  </MarketingPage>
);

export default About;
