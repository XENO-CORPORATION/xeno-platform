import React from 'react';
import MarketingPage, { Section, Prose, FeatureGrid, CheckList, CTA } from '../components/marketing/MarketingPage';

const Docs: React.FC = () => (
  <MarketingPage
    eyebrow="DOCUMENTATION"
    title="Docs & guides"
    subtitle="Everything you need to set up XENO, learn the apps, and build on the platform — from your first render to a production agent workflow."
    updated="June 2026"
  >
    <Section title="Get started">
      <Prose
        blocks={[
          {
            p: (
              <>
                XENO is an AI-native creative and productivity ecosystem. Generate images, video, and
                audio; edit them in Pixel, Motion, Sound, and Canvas; launch everything from the Hub
                desktop app; and automate it all with the Agent CLI. Four steps gets you running.
              </>
            ),
          },
        ]}
      />
      <div className="mt-6">
        <FeatureGrid
          items={[
            {
              title: 'Create an account',
              desc: 'Sign up at xenostudio.ai to get your workspace, a starter credit balance, and access to every app and API.',
            },
            {
              title: 'Install Hub',
              desc: 'Download the XENO Hub desktop launcher. It installs, updates, and opens every creative app and signs you in once.',
            },
            {
              title: 'Buy credits',
              desc: 'Generation and inference are metered in credits. Top up from Billing — the same balance powers apps, agents, and the API.',
            },
            {
              title: 'Connect the CLI',
              desc: 'Install the Agent CLI, paste an API key from Settings, and drive generation and agents straight from your terminal.',
            },
          ]}
        />
      </div>
    </Section>

    <Section title="By product">
      <FeatureGrid
        cols={3}
        items={[
          {
            title: 'Hub',
            desc: 'Install, update, and launch every XENO app, manage your account and credits, and discover Marketplace add-ons. See /product/hub for the full guide.',
          },
          {
            title: 'Pixel',
            desc: 'Image editor and generator. Docs cover layers, the brush engine, masks, AI fill and upscale, and the .xpixel project format.',
          },
          {
            title: 'Motion',
            desc: 'Video editor. Docs cover the timeline, clips and transitions, effects, AI-assisted edits, and exporting from .xmotion projects.',
          },
          {
            title: 'Sound',
            desc: 'Audio editor and DAW. Docs cover tracks, mixing, effects, transcription, and AI cleanup for the .xsound format.',
          },
          {
            title: 'Agent CLI',
            desc: 'Terminal agent. Docs cover install, API keys, the tool registry, sessions, and scripting generation into your own pipelines.',
          },
          {
            title: 'Marketplace',
            desc: 'Apps, panels, plugins, models, and agents. Docs cover browsing, entitlements, installing, and publishing your own listings.',
          },
        ]}
      />
      <div className="mt-5">
        <Prose
          blocks={[
            {
              p: (
                <>
                  Product docs live with each product. Open a product page — for example{' '}
                  <a href="/product/hub" className="text-[#a760ff] hover:underline">
                    Hub
                  </a>{' '}
                  — to jump into its release notes, downloads, and reference.
                </>
              ),
            },
          ]}
        />
      </div>
    </Section>

    <Section title="Guides">
      <CheckList
        items={[
          'Sign in once with Hub and keep every app authenticated automatically',
          'Generate your first image from a text prompt and refine it in Pixel',
          'Move a generated clip into Motion and add transitions and effects',
          'Understand credits: how generation, inference, and exports are metered',
          'Create and rotate API keys, then call generation from the CLI',
          'Build a multi-step agent workflow with the Agent CLI and tool registry',
          'Install a Marketplace plugin and manage its capability permissions',
          'Save and reuse your own templates across Pixel, Motion, and Canvas',
        ]}
      />
    </Section>

    <CTA
      href="/learn"
      label="Browse tutorials"
      title="Prefer learning by doing?"
      desc="Step-by-step tutorials walk you through real projects in every XENO app."
    />
  </MarketingPage>
);

export default Docs;
