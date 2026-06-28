import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage, { Section, FeatureGrid } from '../components/marketing/MarketingPage';

const Roadmap: React.FC = () => (
  <MarketingPage
    eyebrow="ROADMAP"
    title="What we're building"
    subtitle="XENO is a platform under active construction. Here's what's shipping today, what's coming next, and where the ecosystem is headed — straight from the people building it."
    updated="June 2026"
  >
    <Section title="Now (shipping)">
      <FeatureGrid
        cols={2}
        items={[
          { title: 'XENO Hub', desc: 'The desktop launcher is released — install apps, manage updates, and keep credits and settings in sync across machines.' },
          { title: 'XENO Pixel', desc: 'The AI-native image editor: brush engine, layers, viewport, and in-canvas generative tools, in active development.' },
          { title: 'Image, video & audio generation', desc: 'Generate from a prompt on the unified inference runtime, with GGUF and CUDA support and an OpenAI-compatible API.' },
          { title: 'Marketplace', desc: 'A unified catalog for apps, panels, plugins, models, and agents — buy, subscribe, rent, or publish and earn.' },
        ]}
      />
    </Section>

    <Section title="Next">
      <FeatureGrid
        cols={2}
        items={[
          { title: 'XENO Canvas', desc: 'Design with components, variants, auto-layout, tokens, and multiplayer — a Figma replacement on the shared engine, closing in on launch.' },
          { title: 'Motion & Sound polish', desc: 'The video editor and DAW move from scaffolding to daily-driver quality, with the generative core wired through.' },
          { title: 'AI agents', desc: 'Embedded agents and the Agent CLI run real multi-step tasks across your tools, with scoped permissions and the Anima personal agent.' },
          { title: 'XENO Comms', desc: 'Universal human + agent communications — messenger-grade on mobile and desktop first, workspace collaboration second.' },
        ]}
      />
    </Section>

    <Section title="Later">
      <FeatureGrid
        cols={2}
        items={[
          { title: 'XENO 3D', desc: 'Modeling, animation, and rendering — a Blender-class tool built on the shared engine.' },
          { title: 'XENO Architect', desc: 'AI-native architecture and CAD: BIM, parametric design, and rendering.' },
          { title: 'XENO Engine', desc: 'An AI-native game engine with ECS, WebGPU, physics, scripting, and multiplayer.' },
          { title: 'XENO Workflow', desc: 'Visual workflow automation — a Zapier / Make / n8n replacement wired into agents and apps.' },
          { title: 'Mobile', desc: 'Native iOS and Android apps so generation, comms, and review come with you everywhere.' },
        ]}
      />
    </Section>

    <Section>
      <p className="text-[13.5px] leading-[1.7] text-[#9b948a]">
        Roadmaps move. Priorities shift as we learn what creators and developers actually need —
        and your input shapes them.{' '}
        <Link to="/contact" className="text-[#a760ff] hover:underline">
          Tell us what to build next
        </Link>
        .
      </p>
    </Section>
  </MarketingPage>
);

export default Roadmap;
