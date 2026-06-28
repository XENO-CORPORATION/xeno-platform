import React from 'react';
import MarketingPage, { Section, Prose, FeatureGrid, CTA } from '../components/marketing/MarketingPage';

const Templates: React.FC = () => (
  <MarketingPage
    eyebrow="TEMPLATES"
    title="Start from a template"
    subtitle="Skip the blank canvas. Open a curated starting point inside any XENO app, make it yours, and save it back for next time."
    updated="June 2026"
  >
    <Section title="Browse by category">
      <FeatureGrid
        cols={3}
        items={[
          {
            title: 'Image styles & presets',
            desc: 'Prompt styles, color grades, and Pixel adjustment stacks — from photoreal product shots to illustrated and cinematic looks.',
          },
          {
            title: 'Video edits',
            desc: 'Motion timelines with pacing, transitions, and title cards built in. Drop in your footage and export a finished cut.',
          },
          {
            title: 'Social post kits',
            desc: 'Multi-format sets sized for every platform, ready to fill with copy and visuals for a coordinated launch.',
          },
          {
            title: 'Brand kits',
            desc: 'Logos, palettes, type scales, and reusable components packaged as Canvas tokens so everything stays on-brand.',
          },
          {
            title: 'Agent workflows',
            desc: 'Prebuilt Agent CLI flows that chain generation, editing, and export steps you can run or adapt for your own pipeline.',
          },
          {
            title: 'Document & slide layouts',
            desc: 'Structured starting points for docs and decks — sections, grids, and styles already wired up and ready to write.',
          },
        ]}
      />
    </Section>

    <Section title="How templates work">
      <Prose
        blocks={[
          {
            h: 'Open in the relevant app',
            p: (
              <>
                Each template opens directly in the XENO app it belongs to — an image style in Pixel, a
                video edit in Motion, a brand kit in Canvas. Hub keeps you signed in, so a template is
                always one click from a live project.
              </>
            ),
          },
          {
            h: 'Customize it',
            p: (
              <>
                Templates are real, editable projects, not flattened exports. Swap the content, adjust
                the styling, rewire steps, and use AI generation in place to take it from a starting
                point to something that is unmistakably yours.
              </>
            ),
          },
          {
            h: 'Save your own',
            p: (
              <>
                Turn any project into a reusable template and save it to your workspace. Your templates
                travel with you across apps and devices, and you can share them with your team or
                publish them on the Marketplace.
              </>
            ),
          },
        ]}
      />
    </Section>

    <CTA
      href="/products"
      label="Open the apps"
      title="Find a template inside any XENO app"
      desc="Every template lives in the app it was built for — launch one and start creating."
    />
  </MarketingPage>
);

export default Templates;
