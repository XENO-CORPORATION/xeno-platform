import React from 'react';
import MarketingPage, { Section, FeatureGrid, CheckList, CTA } from '../components/marketing/MarketingPage';

const Features: React.FC = () => (
  <MarketingPage
    eyebrow="FEATURES"
    title="One platform for every kind of creation"
    subtitle="XENO is an AI-native creative and productivity ecosystem. Generate, edit, design, and automate with tools that share one account, one credit balance, and one workspace — so your work flows between them instead of fighting them."
    updated="June 2026"
  >
    <Section title="Everything you can do with XENO">
      <FeatureGrid
        cols={3}
        items={[
          { title: 'Generate', desc: 'Create images, video, and audio from a prompt. State-of-the-art models, one consistent interface, results you can take straight into the editors.' },
          { title: 'Edit with Pixel, Motion & Sound', desc: 'A professional image editor, video editor, and DAW — Photoshop, Premiere, and Audition reimagined around AI from the ground up.' },
          { title: 'Design with Canvas', desc: 'UI and product design with components, variants, auto-layout, tokens, and multiplayer. A Figma replacement built on the same engine as everything else.' },
          { title: 'Automate with agents', desc: 'The Agent CLI and embedded AI agents run real tasks across your tools — generating, editing, and assembling work on your behalf.' },
          { title: 'Launch with Hub', desc: 'The XENO Hub desktop launcher installs every app, manages updates, and keeps your credits and settings in sync across machines.' },
          { title: 'Extend via Marketplace', desc: 'Install apps, panels, plugins, models, and agents — or publish your own and earn. One catalog, one entitlement system.' },
        ]}
      />
    </Section>

    <Section title="AI built into everything">
      <FeatureGrid
        cols={3}
        items={[
          { title: 'Generative core', desc: 'Image, video, and audio generation run on the same unified inference runtime, so quality and speed stay consistent across every app.' },
          { title: 'In-canvas AI', desc: 'Upscale, denoise, remove backgrounds, transcribe, and restyle directly inside Pixel, Motion, and Sound — no exporting to a separate tool.' },
          { title: 'Agentic workflows', desc: 'Describe an outcome and let an agent do the steps: batch edits, asset pipelines, and multi-app tasks handled for you.' },
          { title: 'Bring your own models', desc: 'Run XENO models or connect your own. The runtime exposes an OpenAI-compatible API so your stack stays portable.' },
          { title: 'Local or cloud', desc: 'Inference runs where it makes sense — on your machine through Hub, or in the cloud OS when you need scale.' },
          { title: 'Private by design', desc: 'Your projects, prompts, and outputs are yours. Agents act with scoped permissions and explicit confirmation for sensitive actions.' },
        ]}
      />
    </Section>

    <Section title="Works together">
      <CheckList
        items={[
          'One account across every app, on desktop and in the cloud.',
          'One credit balance — buy credits once and spend them on any AI action, in any tool.',
          'One workspace where files, assets, and projects move between apps without conversion.',
          'Shared engine for rendering, color, and formats, so a Pixel layer, a Canvas frame, and a Motion clip all speak the same language.',
          'Real-time multiplayer and agent collaboration built into the foundation, not bolted on.',
        ]}
      />
    </Section>

    <CTA
      href="/products"
      label="Explore products"
      title="See the whole ecosystem"
      desc="From generation to editing to design and automation — explore every XENO product and how they fit together."
    />
  </MarketingPage>
);

export default Features;
