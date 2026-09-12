import React from 'react';
import MarketingPage, { Section, Prose, FeatureGrid, CheckList } from '../components/marketing/MarketingPage';

const Careers: React.FC = () => (
  <MarketingPage
    eyebrow="CAREERS"
    title="Build XENO with us"
    subtitle="We're a small, senior team rebuilding the creative and productivity stack for the AI era. If that sounds like the work you want to be doing, we'd love to hear from you."
    updated="June 2026"
  >
    <Section title="Why XENO">
      <CheckList
        items={[
          'Remote-first — work from anywhere, with overlap hours that respect your time zone.',
          'Real ownership — you own surfaces end to end, not tickets handed down from above.',
          'Ship fast — short feedback loops, frequent releases, and a bias toward putting things in front of users.',
          'Work across the stack — touch the parts of the system that matter for the problem, not just your lane.',
          'Competitive equity — early team members share meaningfully in what we build.',
          'Learning budget — books, courses, hardware, and conferences to keep you sharp.',
        ]}
      />
    </Section>

    <Section title="Open roles">
      <FeatureGrid
        cols={2}
        items={[
          {
            title: 'Senior Frontend Engineer (React)',
            desc: 'Own complex, performant UI across the creative apps and the web platform. React 19, TypeScript, canvas-heavy interfaces.',
          },
          {
            title: 'Rust Systems Engineer',
            desc: 'Build the native processing and inference runtime — video/image/audio pipelines, model serving, and high-throughput I/O.',
          },
          {
            title: 'AI/ML Engineer',
            desc: 'Integrate and optimize generation and task models, design agent tooling, and push the quality and cost of inference.',
          },
          {
            title: 'Product Designer',
            desc: 'Shape how powerful tools feel effortless — interaction design, design systems, and end-to-end product flows.',
          },
          {
            title: 'Developer Advocate',
            desc: 'Grow the marketplace and plugin ecosystem with great docs, samples, and a strong relationship with builders.',
          },
          {
            title: 'Growth',
            desc: 'Own acquisition, lifecycle, and subscription growth — experiments, analytics, and storytelling that scales.',
          },
        ]}
      />
      <p className="mt-5 text-[13px] leading-[1.6] text-[#948d83]">
        Don't see your exact role? We hire for talent and curiosity over titles. Email us anyway at{' '}
        <a href="mailto:careers@xenostudio.ai" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">careers@xenostudio.ai</a>.
      </p>
    </Section>

    <Section title="How we hire">
      <Prose
        blocks={[
          {
            p: (
              <>
                Our process is short and respectful of your time: an intro conversation, a focused
                discussion or paid work-sample tied to the actual role, and a final round with the team
                you'd work with. No whiteboard trivia, no take-homes that swallow a weekend.
              </>
            ),
          },
          {
            p: (
              <>
                We read every application. Tell us what you've built, link the work you're proud of, and
                be specific about the kind of problems you want to spend your days on.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Apply">
      <Prose
        blocks={[
          {
            p: (
              <>
                Send a short note and links to your work to{' '}
                <a href="mailto:careers@xenostudio.ai" className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 hover:text-white">careers@xenostudio.ai</a>.
                Mention the role you're interested in (or propose your own), and include anything that
                helps us see how you think.
              </>
            ),
          },
        ]}
      />
    </Section>
  </MarketingPage>
);

export default Careers;
